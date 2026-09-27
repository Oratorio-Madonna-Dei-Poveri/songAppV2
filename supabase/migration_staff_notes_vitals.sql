-- =====================================================
-- MdP SongApp - Migrazione: Staff, Note e Vitali Database
-- Esegui questo script nel SQL Editor di Supabase
-- =====================================================

-- 1. Aggiungi colonne per Staff e Note alla tabella playlist
ALTER TABLE playlist ADD COLUMN IF NOT EXISTS is_staff BOOLEAN DEFAULT false;
ALTER TABLE playlist ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_is_staff ON playlist(is_staff);

-- 2. Crea tabella per le impostazioni applicative (es. abilitazione staff)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chiunque può leggere app_settings" ON app_settings;
CREATE POLICY "Chiunque può leggere app_settings" ON app_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Chiunque può modificare app_settings" ON app_settings;
CREATE POLICY "Chiunque può modificare app_settings" ON app_settings
  FOR ALL USING (true);

-- Abilita Realtime su app_settings se non già abilitato
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'app_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;
  END IF;
END $$;

-- Inizializza stato portale staff se non presente
INSERT INTO app_settings (key, value)
VALUES ('staff_page', '{"enabled": true, "disabled_reason": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Fix funzione Svuota Playlist (aggiunge WHERE per safeupdate di Postgres)
CREATE OR REPLACE FUNCTION admin_clear_playlist()
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist WHERE id IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Funzione Aggiunta Brano da parte dello Staff con algoritmo a blocchi
CREATE OR REPLACE FUNCTION staff_add_song(
  p_title TEXT,
  p_artist TEXT,
  p_genre TEXT DEFAULT NULL,
  p_album_art_url TEXT DEFAULT NULL,
  p_deezer_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_new_id UUID;
  v_insert_pos INTEGER;
  v_rec RECORD;
  v_found_break BOOLEAN := FALSE;
BEGIN
  -- Controlla se il brano è bannato
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  v_insert_pos := NULL;

  -- Esamina i brani attivi (non ancora suonati) in ordine di posizione
  FOR v_rec IN 
    SELECT id, position, is_staff 
    FROM playlist 
    WHERE played_at IS NULL 
    ORDER BY position ASC, created_at ASC
  LOOP
    IF COALESCE(v_rec.is_staff, FALSE) = TRUE AND NOT v_found_break THEN
      -- Fa parte del blocco staff iniziale contiguo
      v_insert_pos := v_rec.position + 1;
    ELSE
      -- Trovato il primo brano non-staff o già interrotto il blocco
      IF NOT v_found_break THEN
        v_found_break := TRUE;
        -- Se il primo brano attivo non era dello staff, il blocco staff iniziale ha dimensione 0
        IF v_insert_pos IS NULL THEN
          v_insert_pos := v_rec.position;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Se non ci sono brani attivi, inserisci dopo il massimo esistente (o posizione 1)
  IF v_insert_pos IS NULL THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;
  END IF;

  -- Scala di 1 la posizione di tutti i brani successivi o uguali alla posizione scelta
  UPDATE playlist 
  SET position = position + 1 
  WHERE position >= v_insert_pos;

  -- Inserisci il nuovo brano contrassegnato con is_staff = TRUE
  INSERT INTO playlist (
    title, artist, genre, album_art_url, deezer_id, position, session_id, is_staff
  )
  VALUES (
    p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_insert_pos, p_session_id, TRUE
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Funzione per aggiornare le note private di un brano (Admin)
CREATE OR REPLACE FUNCTION admin_update_song_notes(
  p_song_id UUID,
  p_notes TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE playlist
  SET notes = p_notes
  WHERE id = p_song_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Funzione per impostare lo stato del portale staff (Admin)
CREATE OR REPLACE FUNCTION set_staff_status(
  p_enabled BOOLEAN, 
  p_reason TEXT DEFAULT ''
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('staff_page', jsonb_build_object('enabled', p_enabled, 'disabled_reason', p_reason), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Funzione per ottenere metriche di salute e statistiche del Database
CREATE OR REPLACE FUNCTION admin_get_db_vitals()
RETURNS JSONB AS $$
DECLARE
  v_res JSONB;
  v_total_songs BIGINT;
  v_played_songs BIGINT;
  v_staff_songs BIGINT;
  v_banned_songs BIGINT;
  v_db_size TEXT := 'N/D';
  v_playlist_size TEXT := 'N/D';
  v_pg_version TEXT;
BEGIN
  SELECT COUNT(*) INTO v_total_songs FROM playlist;
  SELECT COUNT(*) INTO v_played_songs FROM playlist WHERE played_at IS NOT NULL;
  SELECT COUNT(*) INTO v_staff_songs FROM playlist WHERE COALESCE(is_staff, false) IS TRUE;
  SELECT COUNT(*) INTO v_banned_songs FROM banned_songs;

  BEGIN
    SELECT pg_size_pretty(pg_database_size(current_database())) INTO v_db_size;
    SELECT pg_size_pretty(pg_total_relation_size('playlist')) INTO v_playlist_size;
  EXCEPTION WHEN OTHERS THEN
    v_db_size := 'N/D';
    v_playlist_size := 'N/D';
  END;

  SELECT split_part(version(), ' on ', 1) INTO v_pg_version;

  v_res := jsonb_build_object(
    'total_songs', v_total_songs,
    'played_songs', v_played_songs,
    'staff_songs', v_staff_songs,
    'public_songs', v_total_songs - v_staff_songs,
    'banned_songs', v_banned_songs,
    'db_size', v_db_size,
    'playlist_table_size', v_playlist_size,
    'postgres_version', v_pg_version,
    'server_time', now()
  );

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
