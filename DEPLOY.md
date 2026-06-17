# dndai TR — Deploy Rehberi (Tamamen Ücretsiz)

## 🗺️ Genel Bakış
Frontend (HTML) → Netlify (ücretsiz)
Backend (Node.js) → Railway (ücretsiz)
Veritabanı → Supabase (ücretsiz)
AI → Groq (ücretsiz)

---

## ADIM 1 — Supabase Kurulum (5 dakika)

1. https://supabase.com → "Start for free" → GitHub ile giriş
2. "New project" → İsim: `dndai` → Şifre not al → Region: Frankfurt
3. Sol menü: **SQL Editor** → "New query"
4. `schema.sql` dosyasının içeriğini yapıştır → **Run**
5. Sol menü: **Settings → API** → şunları kopyala:
   - `Project URL` → `.env` dosyasında `SUPABASE_URL`
   - `service_role` key → `.env` dosyasında `SUPABASE_SERVICE_KEY`

---

## ADIM 2 — Groq API Key (2 dakika)

1. https://console.groq.com → giriş yap
2. **API Keys** → "Create API Key"
3. Kopyala → `.env` dosyasında `GROQ_API_KEY`

---

## ADIM 3 — GitHub'a Yükle (3 dakika)

```bash
# Terminalde:
cd dndai-backend
git init
git add .
git commit -m "dndai TR backend"
git branch -M main

# GitHub'da yeni repo oluştur: dndai-backend
git remote add origin https://github.com/KULLANICI_ADIN/dndai-backend.git
git push -u origin main
```

---

## ADIM 4 — Railway Deploy (5 dakika)

1. https://railway.app → GitHub ile giriş
2. "New Project" → "Deploy from GitHub repo" → `dndai-backend` seç
3. Deploy başlar — **Variables** sekmesine tıkla:
   ```
   SUPABASE_URL      = https://xxxxx.supabase.co
   SUPABASE_SERVICE_KEY = eyJ...
   GROQ_API_KEY      = gsk_...
   JWT_SECRET        = dndai-secret-2024-degistir
   FRONTEND_URL      = * (şimdilik, sonra Netlify URL'ini yaz)
   ```
4. **Settings → Networking → Generate Domain** → URL'ini kopyala
   → Bu Railway URL'ini backend `server.js` yerine `dndai_tr_v23.html` içindeki
     `BACKEND_URL` satırına yaz

---

## ADIM 5 — Frontend'i Güncelle

`dndai_tr_v23.html` içinde şu satırı bul ve Railway URL'ini yaz:
```js
const BACKEND_URL = 'https://dndai-backend.up.railway.app';
// ↑ bunu Railway'in verdiği URL ile değiştir
```

---

## ADIM 6 — Netlify Deploy (3 dakika)

1. https://netlify.com → GitHub ile giriş
2. "Add new site" → "Deploy manually"
3. `dndai_tr_v23.html` dosyasını sürükle bırak
4. Site URL'ini al (örn: `https://dndai-tr.netlify.app`)

---

## ADIM 7 — Railway'de FRONTEND_URL Güncelle

Railway → Variables:
```
FRONTEND_URL = https://dndai-tr.netlify.app
```

"Redeploy" yap.

---

## ✅ Hazır!

- Site: `https://dndai-tr.netlify.app`
- API: `https://xxx.up.railway.app`

### Sonraki Adımlar
- Domain aldığında Netlify'a ekle: Settings → Domain management
- Railway ücretsiz 500 saat/ay → çok kullanılırsa Render.com'a geç (de ücretsiz)
- Supabase 500MB ücretsiz → binlerce kullanıcı için yeter
