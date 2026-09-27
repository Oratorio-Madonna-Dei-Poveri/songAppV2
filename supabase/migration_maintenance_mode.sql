-- =====================================================
-- MdP SongApp - Migrazione: Modalità Manutenzione
-- Esegui questo script nel SQL Editor di Supabase se hai
-- già un database esistente. È idempotente: puoi rieseguirlo senza problemi.
-- =====================================================

-- Impostazione predefinita (disattivata di default)
INSERT INTO app_settings (key, value)
VALUES ('maintenance_mode', '{"enabled": false, "block_staff": false, "block_dj": false, "message": "L''app è momentaneamente in manutenzione. Riprova più tardi."}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Funzione RPC per l'admin
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
