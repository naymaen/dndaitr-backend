-- =============================================
-- dndai TR — Supabase Veritabanı Şeması
-- Supabase > SQL Editor'e yapıştır ve çalıştır
-- =============================================

-- Kullanıcılar
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT DEFAULT NULL,
  total_adventures INT DEFAULT 0,
  last_login TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Maceralar
CREATE TABLE IF NOT EXISTS adventures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scenario TEXT,
  scenario_full TEXT,
  character_name TEXT,
  character_race TEXT,
  character_class TEXT,
  character_gender TEXT,
  character_stats JSONB DEFAULT '{}',
  current_hp INT DEFAULT 10,
  max_hp INT DEFAULT 10,
  turn_count INT DEFAULT 0,
  status TEXT DEFAULT 'active', -- active | completed | abandoned
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mesajlar
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  adventure_id UUID REFERENCES adventures(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Odalar (çok oyunculu)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  host_id UUID REFERENCES users(id),
  host_name TEXT,
  status TEXT DEFAULT 'waiting', -- waiting | playing | ended
  max_players INT DEFAULT 4,
  scenario TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Oda oyuncuları
CREATE TABLE IF NOT EXISTS room_players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  username TEXT,
  character_name TEXT,
  character_class TEXT,
  is_ready BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- FONKSİYONLAR
-- =============================================

-- Tur sayısı artır
CREATE OR REPLACE FUNCTION increment_turns(adv_id UUID)
RETURNS VOID AS $$
  UPDATE adventures
  SET turn_count = turn_count + 1, updated_at = NOW()
  WHERE id = adv_id;
$$ LANGUAGE SQL;

-- Macera tamamlandığında kullanıcı sayacını artır
CREATE OR REPLACE FUNCTION update_user_adventure_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE users SET total_adventures = total_adventures + 1 WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER adventure_completed
  AFTER UPDATE ON adventures
  FOR EACH ROW EXECUTE FUNCTION update_user_adventure_count();

-- =============================================
-- GÜVENLİK (RLS) — backend service key kullandığı için kapalı
-- =============================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE adventures DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
ALTER TABLE room_players DISABLE ROW LEVEL SECURITY;

-- =============================================
-- INDEXLER
-- =============================================
CREATE INDEX IF NOT EXISTS idx_adventures_user ON adventures(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_adventure ON messages(adventure_id);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
