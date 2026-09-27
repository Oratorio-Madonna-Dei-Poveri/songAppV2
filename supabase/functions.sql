-- =============================================
-- MdP SongApp - Funzioni RPC
-- =============================================

-- ======================
-- FUNZIONI UTENTE
-- ======================

-- Aggiunge un brano alla playlist (controlla se bannato, inserisce in coda con is_staff = FALSE)
CREATE OR REPLACE FUNCTION user_add_song(
  p_title TEXT,
  p_artist TEXT,
  p_genre TEXT DEFAULT NULL,
  p_album_art_url TEXT DEFAULT NULL,
  p_deezer_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_max_pos INTEGER;
  v_new_id UUID;
BEGIN
  -- Controlla se il brano è bannato
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  -- Calcola la prossima posizione
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_max_pos FROM playlist;

  -- Inserisci il brano
  INSERT INTO playlist (title, artist, genre, album_art_url, deezer_id, position, session_id, is_staff)
  VALUES (p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_max_pos, p_session_id, FALSE)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Modifica un brano (solo se session_id corrisponde) — sostituisce con un nuovo brano da Deezer
CREATE OR REPLACE FUNCTION user_update_song(
  p_song_id UUID,
  p_session_id TEXT,
  p_title TEXT,
  p_artist TEXT,
  p_genre TEXT DEFAULT NULL,
  p_album_art_url TEXT DEFAULT NULL,
  p_deezer_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Controlla se il nuovo brano è bannato
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  UPDATE playlist
  SET title = p_title, artist = p_artist, genre = p_genre,
      album_art_url = p_album_art_url, deezer_id = p_deezer_id
  WHERE id = p_song_id AND session_id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Non puoi modificare questo brano';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Elimina un brano (solo se session_id corrisponde)
CREATE OR REPLACE FUNCTION user_delete_song(
  p_song_id UUID,
  p_session_id TEXT
)
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist
  WHERE id = p_song_id AND session_id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Non puoi eliminare questo brano';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================
-- FUNZIONI STAFF
-- ======================

-- Staff aggiunge un brano: lo inserisce subito sotto il primo blocco di brani selezionati dallo staff
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

  -- Scorre i brani attivi (non ancora suonati) in ordine di posizione
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
      -- Trovato il primo brano non-staff o già oltre il blocco
      IF NOT v_found_break THEN
        v_found_break := TRUE;
        -- Se il primo brano attivo non era staff, il blocco iniziale ha dimensione 0
        IF v_insert_pos IS NULL THEN
          v_insert_pos := v_rec.position;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Se non ci sono brani attivi nella playlist
  IF v_insert_pos IS NULL THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;
  END IF;

  -- Scala di 1 la posizione di tutti i brani successivi o uguali alla posizione scelta
  UPDATE playlist 
  SET position = position + 1 
  WHERE position >= v_insert_pos;

  -- Inserisci il brano con flag is_staff = TRUE
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

-- ======================
-- FUNZIONI DJ
-- ======================

-- DJ segna un brano come suonato (non lo elimina, lo marca)
CREATE OR REPLACE FUNCTION dj_delete_song(p_song_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE playlist SET played_at = now() WHERE id = p_song_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- DJ riordina i brani
CREATE OR REPLACE FUNCTION dj_reorder_songs(
  p_song_ids UUID[],
  p_positions INTEGER[]
)
RETURNS VOID AS $$
BEGIN
  IF array_length(p_song_ids, 1) != array_length(p_positions, 1) THEN
    RAISE EXCEPTION 'Gli array devono avere la stessa lunghezza';
  END IF;

  FOR i IN 1..array_length(p_song_ids, 1) LOOP
    UPDATE playlist SET position = p_positions[i] WHERE id = p_song_ids[i];
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================
-- FUNZIONI ADMIN
-- ======================

-- Admin aggiunge un brano (bypassa controllo ban)
CREATE OR REPLACE FUNCTION admin_add_song(
  p_title TEXT,
  p_artist TEXT,
  p_genre TEXT DEFAULT NULL,
  p_album_art_url TEXT DEFAULT NULL,
  p_deezer_id TEXT DEFAULT NULL,
  p_is_staff BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  v_max_pos INTEGER;
  v_new_id UUID;
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_max_pos FROM playlist;
  INSERT INTO playlist (title, artist, genre, album_art_url, deezer_id, position, session_id, is_staff)
  VALUES (p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_max_pos, 'admin', p_is_staff)
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin modifica un brano (sostituisce)
CREATE OR REPLACE FUNCTION admin_update_song(
  p_song_id UUID,
  p_title TEXT,
  p_artist TEXT,
  p_genre TEXT DEFAULT NULL,
  p_album_art_url TEXT DEFAULT NULL,
  p_deezer_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE playlist SET title = p_title, artist = p_artist, genre = p_genre,
                      album_art_url = p_album_art_url, deezer_id = p_deezer_id
  WHERE id = p_song_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin aggiorna le note private di un brano
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

-- Admin elimina un brano (qualsiasi)
CREATE OR REPLACE FUNCTION admin_delete_song(p_song_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist WHERE id = p_song_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin svuota tutta la playlist (WHERE id IS NOT NULL evita errore safeupdate)
CREATE OR REPLACE FUNCTION admin_clear_playlist()
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist WHERE id IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin banna un brano (e lo rimuove dalla playlist se presente)
CREATE OR REPLACE FUNCTION admin_ban_song(
  p_title TEXT,
  p_artist TEXT,
  p_deezer_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO banned_songs (title, artist, deezer_id, reason)
  VALUES (p_title, p_artist, p_deezer_id, p_reason)
  ON CONFLICT (deezer_id) DO UPDATE SET reason = EXCLUDED.reason;

  IF p_deezer_id IS NOT NULL THEN
    DELETE FROM playlist WHERE deezer_id = p_deezer_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin rimuove il ban da un brano
CREATE OR REPLACE FUNCTION admin_unban_song(p_ban_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM banned_songs WHERE id = p_ban_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin imposta stato portale staff (attivato/disattivato e messaggio)
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

-- Admin ottiene metriche di salute e statistiche del Database
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
