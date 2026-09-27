-- =============================================
-- MdP SongApp - Funzioni RPC
-- =============================================

-- ======================
-- FUNZIONI UTENTE
-- ======================

-- Aggiunge un brano alla playlist (controlla se bannato, applica il rate limit se attivo,
-- inserisce in coda con is_staff = FALSE)
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
  -- Controlla se il brano è bannato
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  -- ======================
  -- RATE LIMIT (opzionale, configurabile dall'admin in tempo reale)
  -- ======================
  -- Importante: le impostazioni vengono lette QUI, ad ogni chiamata, direttamente
  -- dalla tabella app_settings. Questo garantisce che una modifica fatta dall'admin
  -- si applichi immediatamente alla richiesta successiva di QUALSIASI client, anche
  -- se quel client è connesso da ore e non ha mai ricaricato la pagina. Le richieste
  -- già soddisfatte in passato non vengono in alcun modo toccate (non è retroattivo).
  SELECT value INTO v_rl FROM app_settings WHERE key = 'rate_limit';

  IF v_rl IS NOT NULL AND COALESCE((v_rl->>'enabled')::boolean, false) = true THEN

    -- Limite: numero massimo di brani "attivi" (non ancora suonati) per sessione
    IF COALESCE((v_rl->>'max_active_tracks_enabled')::boolean, false) = true THEN
      v_max_tracks := COALESCE((v_rl->>'max_active_tracks')::integer, 0);
      SELECT COUNT(*) INTO v_active_count FROM playlist
        WHERE session_id = p_session_id AND played_at IS NULL;

      IF v_max_tracks > 0 AND v_active_count >= v_max_tracks THEN
        RAISE EXCEPTION 'Hai già % brani in coda (limite massimo: %). Attendi che vengano suonati prima di aggiungerne altri.',
          v_active_count, v_max_tracks;
      END IF;
    END IF;

    -- Limite: tempo minimo di attesa tra una richiesta e la successiva
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

-- Staff aggiunge un brano. La posizione in cui viene inserito dipende dall'algoritmo di
-- priorità scelto dall'admin (impostazione 'priority_algo' in app_settings), letto in
-- tempo reale ad ogni chiamata — così un cambio di algoritmo si applica subito alla
-- richiesta successiva, senza bisogno che nessuno ricarichi la pagina.
--
-- Modalità supportate:
--  - 'off'   : nessuna priorità, il brano va semplicemente in fondo alla coda (FIFO),
--              esattamente come una richiesta pubblica (resta comunque marcato is_staff
--              per il badge e le note dell'admin).
--  - 'top'   : il brano va sempre in cima alla coda attiva (massima priorità assoluta).
--  - 'block' : (default, comportamento storico) il brano viene inserito subito sotto il
--              primo blocco contiguo di brani staff già in cima alla coda.
--  - 'ratio' : "un brano staff ogni N brani pubblici". Si scorre la coda dall'inizio
--              contando i brani pubblici consecutivi dall'ultimo brano staff incontrato;
--              appena il conteggio raggiunge N, il nuovo brano staff viene inserito lì.
--              Se in coda non ci sono ancora N brani pubblici consecutivi, il brano va
--              in fondo (evita di "bruciare" priorità quando non ancora necessaria).
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
  -- Controlla se il brano è bannato
  IF p_deezer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM banned_songs WHERE deezer_id = p_deezer_id
  ) THEN
    RAISE EXCEPTION 'Questo brano è stato bannato e non può essere richiesto';
  END IF;

  -- Legge l'algoritmo di priorità corrente
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
    -- Nessuna priorità: semplice append in fondo, come un utente normale
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_insert_pos FROM playlist;

  ELSIF v_mode = 'top' THEN
    -- Sempre in cima alla coda attiva
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
    -- 'block' (comportamento storico/default)
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

-- Admin imposta il rate limit delle richieste utente (opzionale, tweakable in tempo reale).
-- I client leggono questa riga tramite Realtime (tabella app_settings) per mostrare subito
-- il messaggio informativo, ma l'enforcement vero e proprio avviene lato server dentro
-- user_add_song, quindi si applica immediatamente a TUTTI i client, anche quelli già
-- connessi da tempo, senza bisogno che nessuno ricarichi la pagina.
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

-- Admin imposta l'algoritmo di priorità Staff (opzionale, tweakable in tempo reale).
-- Letto live da staff_add_song ad ogni richiesta: si applica subito alla richiesta
-- successiva di qualunque client Staff già connesso.
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

-- Admin imposta la modalità manutenzione (opzionale, tweakable in tempo reale).
-- I client leggono questa riga tramite Realtime (tabella app_settings) e mostrano
-- subito l'overlay di blocco, anche se già connessi da tempo. La pagina Admin non
-- viene mai bloccata (lo verifica il client in base a document.body.dataset.page).
CREATE OR REPLACE FUNCTION admin_set_maintenance_mode(
  p_enabled BOOLEAN,
  p_block_staff BOOLEAN DEFAULT FALSE,
  p_block_dj BOOLEAN DEFAULT FALSE,
  p_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('maintenance_mode', jsonb_build_object(
    'enabled', p_enabled,
    'block_staff', p_block_staff,
    'block_dj', p_block_dj,
    'message', COALESCE(NULLIF(p_message, ''), 'L''app è momentaneamente in manutenzione. Riprova più tardi.')
  ), now())
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
