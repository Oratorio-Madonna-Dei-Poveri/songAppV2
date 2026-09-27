-- =====================================================
-- MdP SongApp - Migrazione: Rate Limit utenti + Algoritmi
-- di priorità Staff configurabili
-- Esegui questo script nel SQL Editor di Supabase se hai
-- già un database esistente (creato prima di questa versione).
-- È scritto per essere idempotente: puoi rieseguirlo senza problemi.
-- =====================================================

-- 1. Impostazioni predefinite (non sovrascrivono valori già presenti)

-- Rate limit richieste utente: disattivato di default, lo abilita l'admin quando serve.
INSERT INTO app_settings (key, value)
VALUES ('rate_limit', '{
  "enabled": false,
  "max_active_tracks_enabled": false,
  "max_active_tracks": 3,
  "cooldown_minutes_enabled": false,
  "cooldown_minutes": 15
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Algoritmo priorità Staff: attivo di default in modalità "block", per non cambiare
-- il comportamento a chi già usa l'app senza toccare le nuove impostazioni.
INSERT INTO app_settings (key, value)
VALUES ('priority_algo', '{"enabled": true, "mode": "block", "ratio": 3}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Funzione user_add_song: aggiunge il controllo del rate limit
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
  v_rl JSONB;
  v_active_count INTEGER;
  v_max_tracks INTEGER;
  v_cooldown_min INTEGER;
  v_last_created TIMESTAMPTZ;
  v_wait_seconds INTEGER;
  v_wait_label TEXT;
BEGIN
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  SELECT value INTO v_rl FROM app_settings WHERE key = 'rate_limit';

  IF v_rl IS NOT NULL AND COALESCE((v_rl->>'enabled')::boolean, false) = true THEN

    IF COALESCE((v_rl->>'max_active_tracks_enabled')::boolean, false) = true THEN
      v_max_tracks := COALESCE((v_rl->>'max_active_tracks')::integer, 0);
      SELECT COUNT(*) INTO v_active_count FROM playlist
        WHERE session_id = p_session_id AND played_at IS NULL;

      IF v_max_tracks > 0 AND v_active_count >= v_max_tracks THEN
        RAISE EXCEPTION 'Hai già % brani in coda (limite massimo: %). Attendi che vengano suonati prima di aggiungerne altri.',
          v_active_count, v_max_tracks;
      END IF;
    END IF;

    IF COALESCE((v_rl->>'cooldown_minutes_enabled')::boolean, false) = true THEN
      v_cooldown_min := COALESCE((v_rl->>'cooldown_minutes')::integer, 0);
      IF v_cooldown_min > 0 THEN
        SELECT MAX(created_at) INTO v_last_created FROM playlist
          WHERE session_id = p_session_id;

        IF v_last_created IS NOT NULL AND v_last_created + (v_cooldown_min || ' minutes')::interval > now() THEN
          v_wait_seconds := GREATEST(1, CEIL(EXTRACT(EPOCH FROM
            ((v_last_created + (v_cooldown_min || ' minutes')::interval) - now())
          ))::integer);

          v_wait_label := CASE
            WHEN v_wait_seconds >= 60 THEN CEIL(v_wait_seconds / 60.0)::text || ' minuti'
            ELSE v_wait_seconds::text || ' secondi'
          END;

          RAISE EXCEPTION 'Devi attendere ancora circa % prima di poter richiedere un altro brano.', v_wait_label;
        END IF;
      END IF;
    END IF;

  END IF;

  SELECT COALESCE(MAX(position), 0) + 1 INTO v_max_pos FROM playlist;

  INSERT INTO playlist (title, artist, genre, album_art_url, deezer_id, position, session_id, is_staff)
  VALUES (p_title, p_artist, p_genre, p_album_art_url, p_deezer_id, v_max_pos, p_session_id, FALSE)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Funzione staff_add_song: supporta i nuovi algoritmi di priorità ('off', 'top',
--    'block', 'ratio') invece del solo algoritmo a blocchi fisso.
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
  v_pa JSONB;
  v_mode TEXT := 'block';
  v_ratio INTEGER := 3;
  v_public_counter INTEGER := 0;
  v_candidate INTEGER;
BEGIN
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  SELECT value INTO v_pa FROM app_settings WHERE key = 'priority_algo';
  IF v_pa IS NOT NULL THEN
    v_mode := COALESCE(v_pa->>'mode', 'block');
    v_ratio := COALESCE((v_pa->>'ratio')::integer, 3);
    IF COALESCE((v_pa->>'enabled')::boolean, true) = false THEN
      v_mode := 'off';
    END IF;
  END IF;

  IF v_ratio IS NULL OR v_ratio < 1 THEN
    v_ratio := 1;
  END IF;

  IF v_mode = 'off' THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;

  ELSIF v_mode = 'top' THEN
    SELECT MIN(position) INTO v_insert_pos FROM playlist WHERE played_at IS NULL;
    IF v_insert_pos IS NULL THEN
      SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;
    ELSE
      UPDATE playlist SET position = position + 1 WHERE position >= v_insert_pos;
    END IF;

  ELSIF v_mode = 'ratio' THEN
    v_candidate := NULL;
    FOR v_rec IN
      SELECT id, position, is_staff FROM playlist
      WHERE played_at IS NULL
      ORDER BY position ASC, created_at ASC
    LOOP
      IF COALESCE(v_rec.is_staff, FALSE) = TRUE THEN
        v_public_counter := 0;
      ELSE
        v_public_counter := v_public_counter + 1;
        IF v_public_counter >= v_ratio AND v_candidate IS NULL THEN
          v_candidate := v_rec.position + 1;
        END IF;
      END IF;
    END LOOP;

    IF v_candidate IS NOT NULL THEN
      v_insert_pos := v_candidate;
      UPDATE playlist SET position = position + 1 WHERE position >= v_insert_pos;
    ELSE
      SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;
    END IF;

  ELSE
    v_insert_pos := NULL;

    FOR v_rec IN
      SELECT id, position, is_staff
      FROM playlist
      WHERE played_at IS NULL
      ORDER BY position ASC, created_at ASC
    LOOP
      IF COALESCE(v_rec.is_staff, FALSE) = TRUE AND NOT v_found_break THEN
        v_insert_pos := v_rec.position + 1;
      ELSE
        IF NOT v_found_break THEN
          v_found_break := TRUE;
          IF v_insert_pos IS NULL THEN
            v_insert_pos := v_rec.position;
          END IF;
        END IF;
      END IF;
    END LOOP;

    IF v_insert_pos IS NULL THEN
      SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;
    ELSE
      UPDATE playlist SET position = position + 1 WHERE position >= v_insert_pos;
    END IF;
  END IF;

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

-- 4. Nuove funzioni RPC per l'admin
CREATE OR REPLACE FUNCTION admin_set_rate_limit(
  p_enabled BOOLEAN,
  p_max_tracks_enabled BOOLEAN DEFAULT FALSE,
  p_max_tracks INTEGER DEFAULT NULL,
  p_cooldown_enabled BOOLEAN DEFAULT FALSE,
  p_cooldown_minutes INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('rate_limit', jsonb_build_object(
    'enabled', p_enabled,
    'max_active_tracks_enabled', p_max_tracks_enabled,
    'max_active_tracks', p_max_tracks,
    'cooldown_minutes_enabled', p_cooldown_enabled,
    'cooldown_minutes', p_cooldown_minutes
  ), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_set_priority_algorithm(
  p_enabled BOOLEAN,
  p_mode TEXT DEFAULT 'block',
  p_ratio INTEGER DEFAULT 3
)
RETURNS VOID AS $$
BEGIN
  IF p_mode NOT IN ('block', 'top', 'ratio') THEN
    RAISE EXCEPTION 'Modalità algoritmo non valida: %', p_mode;
  END IF;

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('priority_algo', jsonb_build_object(
    'enabled', p_enabled,
    'mode', p_mode,
    'ratio', GREATEST(1, COALESCE(p_ratio, 3))
  ), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
