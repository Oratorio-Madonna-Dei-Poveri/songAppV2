-- =============================================
-- MdP SongApp - Database Schema
-- =============================================

-- Tabella playlist: contiene i brani richiesti
CREATE TABLE playlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT,
  album_art_url TEXT,
  deezer_id TEXT,
  position INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabella brani bannati
CREATE TABLE banned_songs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  deezer_id TEXT UNIQUE,
  reason TEXT,
  banned_at TIMESTAMPTZ DEFAULT now()
);

-- Abilita Row Level Security
ALTER TABLE playlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_songs ENABLE ROW LEVEL SECURITY;

-- Policy: chiunque può leggere la playlist
CREATE POLICY "Chiunque può leggere la playlist" ON playlist
  FOR SELECT USING (true);

-- Policy: chiunque può leggere i brani bannati (per controllo lato client)
CREATE POLICY "Chiunque può leggere i brani bannati" ON banned_songs
  FOR SELECT USING (true);

-- Abilita Realtime sulla tabella playlist
ALTER PUBLICATION supabase_realtime ADD TABLE playlist;
ALTER PUBLICATION supabase_realtime ADD TABLE banned_songs;

-- Indici per performance
CREATE INDEX idx_playlist_position ON playlist(position);
CREATE INDEX idx_playlist_session_id ON playlist(session_id);
CREATE INDEX idx_banned_songs_deezer_id ON banned_songs(deezer_id);
