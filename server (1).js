require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);

// ===== CORS =====
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ===== SUPABASE =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ===== GROQ =====
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== SOCKET.IO =====
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'] }
});

// ===== JWT HELPERS =====
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Giriş gerekli' });
  req.user = user;
  next();
}

// ===================================================
// ===== AUTH ROUTES =================================
// ===================================================

// Kayıt
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });

  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash: hash })
    .select('id, username, email, created_at')
    .single();

  if (error) {
    if (error.code === '23505')
      return res.status(400).json({ error: 'Bu kullanıcı adı veya email zaten kayıtlı' });
    return res.status(500).json({ error: 'Kayıt başarısız' });
  }
  const token = signToken({ id: data.id, username: data.username });
  res.json({ token, user: data });
});

// Giriş
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !user)
    return res.status(401).json({ error: 'Email veya şifre hatalı' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ error: 'Email veya şifre hatalı' });

  // Son giriş güncelle
  await supabase.from('users').update({ last_login: new Date() }).eq('id', user.id);

  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

// Profil
app.get('/auth/me', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('users')
    .select('id, username, email, avatar, total_adventures, created_at')
    .eq('id', req.user.id)
    .single();
  res.json(data);
});

// ===================================================
// ===== MACERA (ADVENTURE) ROUTES ===================
// ===================================================

// Macera listesi
app.get('/adventures', authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from('adventures')
    .select('id, title, scenario, character_name, character_race, character_class, status, created_at, updated_at, turn_count')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false });
  res.json(data || []);
});

// Macera oluştur
app.post('/adventures', authMiddleware, async (req, res) => {
  const { title, scenario, character } = req.body;
  const { data, error } = await supabase
    .from('adventures')
    .insert({
      user_id: req.user.id,
      title: title || `${character.name}'in Macerası`,
      scenario: scenario.title,
      scenario_full: scenario.full,
      character_name: character.name,
      character_race: character.race,
      character_class: character.cls,
      character_gender: character.gender,
      character_stats: character.stats,
      current_hp: character.hp,
      max_hp: character.hp,
      status: 'active'
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Macera oluşturulamadı' });
  res.json(data);
});

// Macera yükle (sohbet geçmişiyle)
app.get('/adventures/:id', authMiddleware, async (req, res) => {
  const { data: adventure } = await supabase
    .from('adventures')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (!adventure) return res.status(404).json({ error: 'Macera bulunamadı' });

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('adventure_id', req.params.id)
    .order('created_at', { ascending: true });

  res.json({ adventure, messages: messages || [] });
});

// Macera HP güncelle
app.patch('/adventures/:id/hp', authMiddleware, async (req, res) => {
  const { current_hp } = req.body;
  await supabase
    .from('adventures')
    .update({ current_hp, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  res.json({ ok: true });
});

// Macera sil
app.delete('/adventures/:id', authMiddleware, async (req, res) => {
  await supabase.from('messages').delete().eq('adventure_id', req.params.id);
  await supabase.from('adventures').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ ok: true });
});

// ===================================================
// ===== AI (GROQ) ROUTE =============================
// ===================================================

app.post('/ai/chat', async (req, res) => {
  const { adventure_id, system_prompt, messages, user_message, is_opening } = req.body;

  try {
    const chatMessages = [{ role: 'system', content: system_prompt }];
    if (messages && messages.length > 0) {
      messages.forEach(m => chatMessages.push({ role: m.role, content: m.content }));
    }
    if (!is_opening) {
      chatMessages.push({ role: 'user', content: user_message });
    } else {
      chatMessages.push({ role: 'user', content: 'Şimdi açılış sahnesini yaz. Oyuncuyu direkt sahneye sok.' });
    }

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: chatMessages,
      temperature: 0.9,
      max_tokens: 1000
    });

    const reply = completion.choices[0]?.message?.content || '';

    // Mesajları kaydet
    if (adventure_id) {
      if (!is_opening && user_message) {
        await supabase.from('messages').insert({
          adventure_id, role: 'user', content: user_message
        });
      }
      await supabase.from('messages').insert({
        adventure_id, role: 'assistant', content: reply
      });
      // Tur sayısını artır
      await supabase.rpc('increment_turns', { adv_id: adventure_id });
    }

    res.json({ reply });
  } catch (err) {
    console.error('Groq error:', err.message);
    res.status(500).json({ error: 'AI yanıt veremedi: ' + err.message });
  }
});

// ===================================================
// ===== ODA (ROOM) SİSTEMİ ==========================
// ===================================================

// Oda oluştur
app.post('/rooms', authMiddleware, async (req, res) => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      code,
      host_id: req.user.id,
      host_name: req.user.username,
      status: 'waiting',
      max_players: req.body.max_players || 4
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Oda oluşturulamadı' });
  res.json(data);
});

// Oda bilgisi
app.get('/rooms/:code', async (req, res) => {
  const { data } = await supabase
    .from('rooms')
    .select('*, room_players(user_id, username, character_name, character_class, is_ready)')
    .eq('code', req.params.code.toUpperCase())
    .single();
  if (!data) return res.status(404).json({ error: 'Oda bulunamadı' });
  res.json(data);
});

// ===================================================
// ===== SOCKET.IO — GERÇEK ZAMANLI ==================
// ===================================================

// Aktif odalar (bellek — küçük ölçek için yeterli)
const rooms = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const user = verifyToken(token);
  if (user) socket.user = user;
  next(); // auth olmadan da bağlanabilir (izleyici mod)
});

io.on('connection', (socket) => {
  console.log(`Socket bağlandı: ${socket.id} (${socket.user?.username || 'misafir'})`);

  // ── Odaya katıl ──
  socket.on('join_room', async ({ room_code, character }) => {
    const code = room_code.toUpperCase();

    if (!rooms.has(code)) {
      rooms.set(code, { players: new Map(), messages: [], dm_history: [], host: null });
    }
    const room = rooms.get(code);

    const playerData = {
      socket_id: socket.id,
      user_id: socket.user?.id,
      username: socket.user?.username || 'Misafir',
      character: character || null,
      is_ready: false,
      hp: character?.hp || 10
    };

    if (room.players.size === 0) {
      room.host = socket.id;
      playerData.is_host = true;
    }

    room.players.set(socket.id, playerData);
    socket.join(code);
    socket.room_code = code;

    // Odadaki herkese oyuncu listesi gönder
    io.to(code).emit('room_update', {
      players: Array.from(room.players.values()),
      host: room.host
    });

    // Yeni oyuncuya geçmiş mesajları gönder
    if (room.messages.length > 0) {
      socket.emit('message_history', room.messages);
    }

    console.log(`${playerData.username} odaya katıldı: ${code}`);
  });

  // ── Oyuncu hazır ──
  socket.on('player_ready', ({ is_ready }) => {
    const code = socket.room_code;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const player = room.players.get(socket.id);
    if (player) {
      player.is_ready = is_ready;
      io.to(code).emit('room_update', {
        players: Array.from(room.players.values()),
        host: room.host
      });
    }
  });

  // ── Oyuncu mesaj gönder ──
  socket.on('player_message', async ({ text }) => {
    const code = socket.room_code;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const player = room.players.get(socket.id);
    if (!player) return;

    const msg = {
      type: 'player',
      username: player.username,
      character: player.character?.name || player.username,
      text,
      timestamp: Date.now()
    };
    room.messages.push(msg);
    io.to(code).emit('new_message', msg);

    // DM geçmişine ekle
    room.dm_history.push({ role: 'user', content: `[${player.character?.name || player.username}]: ${text}` });

    // Sadece host AI tetikleyebilir (veya oto-tetikle)
    io.to(code).emit('dm_typing', true);
    try {
      const systemPrompt = buildMultiplayerSystemPrompt(room);
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...room.dm_history.slice(-20) // son 20 mesaj
        ],
        temperature: 0.9,
        max_tokens: 1000
      });
      const reply = completion.choices[0]?.message?.content || '';
      room.dm_history.push({ role: 'assistant', content: reply });

      const dmMsg = { type: 'dm', text: reply, timestamp: Date.now() };
      room.messages.push(dmMsg);
      io.to(code).emit('new_message', dmMsg);
      io.to(code).emit('dm_typing', false);

      // HP değişikliklerini parse et ve ilgili oyuncuya gönder
      const hpMatch = reply.match(/\[CAN:\s*([+-]?\d+)\]/g);
      if (hpMatch) {
        // Basitçe herkese gönder — gelişmiş versiyonda hedef oyuncu belirtilir
        io.to(code).emit('hp_change', { change: parseInt(hpMatch[0].match(/[+-]?\d+/)[0]) });
      }

    } catch (err) {
      io.to(code).emit('dm_typing', false);
      io.to(code).emit('new_message', {
        type: 'system', text: '⚠️ DM yanıt veremedi: ' + err.message, timestamp: Date.now()
      });
    }
  });

  // ── Zar sonucu (oda geneline yayınla) ──
  socket.on('dice_result', ({ dice_type, result, context }) => {
    const code = socket.room_code;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const player = room.players.get(socket.id);

    const maxVals = { d20:20, d12:12, d10:10, d8:8, d6:6, d4:4, d10p:'90' };
    const maxVal = maxVals[dice_type];
    let label = '';
    if (dice_type === 'd10p') {
      label = result === '90' ? 'MÜKEMMEL' : result === '00' ? 'FELAKET' : '%' + result;
    } else {
      const n = parseInt(result), mx = parseInt(maxVal);
      label = n === mx ? 'KRİTİK BAŞARI!' : n === 1 ? 'KRİTİK BAŞARISIZLIK!' : n >= mx * 0.75 ? 'Başarılı' : n >= mx * 0.5 ? 'Orta' : 'Zayıf';
    }

    const diceMsg = {
      type: 'dice',
      username: player?.username || 'Oyuncu',
      character: player?.character?.name || player?.username,
      dice_type: dice_type.toUpperCase(),
      result,
      label,
      context,
      timestamp: Date.now()
    };
    room.messages.push(diceMsg);
    io.to(code).emit('new_message', diceMsg);

    // DM geçmişine zar sonucunu ekle
    const diceText = `🎲 ${dice_type.toUpperCase()}: ${result} (${label}) — ${context}`;
    room.dm_history.push({ role: 'user', content: `[${player?.character?.name || player?.username}] ${diceText}` });
  });

  // ── Bağlantı kesildi ──
  socket.on('disconnect', () => {
    const code = socket.room_code;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    room.players.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(code);
    } else {
      // Host devret
      if (room.host === socket.id) {
        room.host = room.players.keys().next().value;
        room.players.get(room.host).is_host = true;
      }
      io.to(code).emit('room_update', {
        players: Array.from(room.players.values()),
        host: room.host
      });
    }
  });
});

// ===================================================
// ===== MULTIPLAYER SYSTEM PROMPT ===================
// ===================================================

function buildMultiplayerSystemPrompt(room) {
  const players = Array.from(room.players.values());
  const charList = players
    .filter(p => p.character)
    .map(p => `- ${p.character.name} (${p.character.race} ${p.character.cls}, oyuncu: ${p.username})`)
    .join('\n');

  return `Sen "dndai TR" adlı Türkçe D&D 5e oyununun Yapay Zeka Zindan Efendisi (DM)'sin.
Bu çok oyunculu bir seans. Aktif karakterler:
${charList || '- Karakterler henüz seçilmedi'}

KURALLARIN:
1. Her yanıtın Türkçe olsun. Atmosferik, kısa ama etkileyici paragraflar yaz.
2. Oyuncular mesajlarında [İsim]: formatında konuşuyor. Hepsinin eylemlerine tepki ver.
3. Zar atmayı gerektiren durumlarda yanıtının sonuna yaz: [ZAR_AT:TİP:Açıklama]
   TİP: d20 / d12 / d10 / d8 / d6 / d4 / d10p
4. Hasar/iyileşmede: [CAN: -5] veya [CAN: +3]
5. Asla meta-konuşma yapma.
6. Birden fazla oyuncu aynı anda eylem yapabilir — hepsini ayrı ayrı ele al.`;
}

// ===================================================
// ===== HEALTH CHECK ================================
// ===================================================

app.get('/', (req, res) => res.json({ status: 'dndai TR backend çalışıyor 🐉' }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`dndai backend port ${PORT}'de çalışıyor`));
