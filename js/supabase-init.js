// =============================================
// MdP SongApp - Inizializzazione Supabase
// =============================================

// Crea il client Supabase (usiamo un nome diverso per non sovrascrivere l'oggetto globale)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Genera o recupera un ID sessione anonimo per l'utente
function getSessionId() {
  let sessionId = localStorage.getItem('mdp_session_id');
  if (!sessionId) {
    // Gestione sicura per contesti dove crypto.randomUUID potrebbe non esistere
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    localStorage.setItem('mdp_session_id', sessionId);
  }
  return sessionId;
}

const SESSION_ID = getSessionId();
