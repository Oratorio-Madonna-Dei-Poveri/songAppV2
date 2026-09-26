-- =============================================
-- MdP SongApp - Funzioni RPC
-- =============================================

-- ======================
-- FUNZIONI UTENTE
-- ======================

-- Aggiunge un brano alla playlist (controlla se bannato)
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
  INSERT INTO playlist (title, artist, genre, album_art_url, deezer_id, position, session_id)
  VALUES (p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_max_pos, p_session_id)
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
  p_deezer_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_max_pos INTEGER;
  v_new_id UUID;
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_max_pos FROM playlist;
  INSERT INTO playlist (title, artist, genre, album_art_url, deezer_id, position, session_id)
  VALUES (p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_max_pos, 'admin')
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

-- Admin elimina un brano (qualsiasi)
CREATE OR REPLACE FUNCTION admin_delete_song(p_song_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist WHERE id = p_song_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin svuota tutta la playlist
CREATE OR REPLACE FUNCTION admin_clear_playlist()
RETURNS VOID AS $$
BEGIN
  DELETE FROM playlist;
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

  -- Rimuovi dalla playlist se presente
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
