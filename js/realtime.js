// =============================================
// MdP SongApp - Modulo Real-Time & Helper Comuni
// =============================================

// --- Icone SVG semplici, uniformi e ad alta visibilità ---
const ICONS = {
  music: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`,
  edit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  delete: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
  ban: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`,
  note: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  drag: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
  staff: `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>`
};

// Helper visualizzazione copertina semplice e chiara
function renderSongArtwork(albumArtUrl) {
  if (albumArtUrl) {
    return `<img class="song-artwork" src="${albumArtUrl}" alt="" loading="lazy">`;
  }
  return `<div class="song-artwork song-artwork-fallback" title="Nessuna copertina">${ICONS.music}</div>`;
}

// Helper per identificare se un brano è dello staff (supporta sia is_staff da migration sia session_id staff_)
function isStaffSong(song) {
  if (!song) return false;
  if (song.is_staff === true || song.is_staff === 'true') return true;
  if (song.session_id && String(song.session_id).startsWith('staff_')) return true;
  return false;
}

// Helper indicatore Staff (per DJ e Admin)
function renderStaffBadge(songOrFlag) {
  const isStaff = typeof songOrFlag === 'object' ? isStaffSong(songOrFlag) : !!songOrFlag;
  if (!isStaff) return '';
  return `<span class="badge-staff" title="Richiesto dallo Staff">${ICONS.staff} Staff</span>`;
}

// --- Stato globale ---
let currentPlaylist = [];
let bannedSongs = [];
let appSettings = {
  staff_page: { enabled: true, disabled_reason: '' },
  rate_limit: {
    enabled: false,
    max_active_tracks_enabled: false,
    max_active_tracks: 3,
    cooldown_minutes_enabled: false,
    cooldown_minutes: 15
  },
  priority_algo: { enabled: true, mode: 'block', ratio: 3 },
  maintenance_mode: {
    enabled: false,
    block_staff: false,
    block_dj: false,
    message: "L'app è momentaneamente in manutenzione. Riprova più tardi."
  }
};
let isConnected = false;

// --- Callback da impostare nelle pagine specifiche ---
let onPlaylistUpdate = null;   // chiamata quando la playlist cambia
let onBannedUpdate = null;     // chiamata quando i brani bannati cambiano
let onPresenceUpdate = null;   // chiamata con il conteggio utenti online
let onSettingsUpdate = null;   // chiamata quando le impostazioni di sistema cambiano

// --- Caricamento iniziale ---
async function loadPlaylist() {
  try {
    const { data, error } = await supabaseClient
      .from('playlist')
      .select('*')
      .order('position', { ascending: true });
    if (!error && data) {
      currentPlaylist = data;
      if (onPlaylistUpdate) onPlaylistUpdate(currentPlaylist);
    }
  } catch (e) {
    console.error('Errore nel caricamento playlist:', e);
  }
  return currentPlaylist;
}

async function loadBannedSongs() {
  try {
    const { data, error } = await supabaseClient
      .from('banned_songs')
      .select('*')
      .order('banned_at', { ascending: false });
    if (!error && data) {
      bannedSongs = data;
      if (onBannedUpdate) onBannedUpdate(bannedSongs);
    }
  } catch (e) {
    console.error('Errore nel caricamento brani bannati:', e);
  }
  return bannedSongs;
}

async function loadAppSettings() {
  try {
    const { data, error } = await supabaseClient
      .from('app_settings')
      .select('*');
    if (!error && data) {
      data.forEach(item => {
        appSettings[item.key] = item.value;
      });
    } else {
      // Fallback a localStorage se tabella non ancora migrata
      const cached = localStorage.getItem('mdp_staff_page_settings');
      if (cached) {
        try { appSettings.staff_page = JSON.parse(cached); } catch(e) {}
      }
    }
    notifySettingsUpdate();
  } catch (e) {
    console.warn('Errore lettura app_settings (potrebbe mancare la tabella):', e);
  }
  return appSettings;
}

// Punto unico di notifica per ogni aggiornamento di app_settings (sia al caricamento
// iniziale sia via Realtime). Applica sempre la modalità manutenzione (component
// condiviso, indipendente dalla pagina) e poi, se presente, avvisa anche il gestore
// specifico della pagina già impostato in onSettingsUpdate (es. banner rate limit,
// stato portale staff, pannelli admin), senza sostituirlo.
function notifySettingsUpdate() {
  applyMaintenanceMode(appSettings);
  if (onSettingsUpdate) onSettingsUpdate(appSettings);
}

// --- Real-time subscriptions ---
let playlistChannel = null;
let presenceChannel = null;

// initRealtime() è VOLUTAMENTE idempotente: rimuove sempre prima ogni canale già
// esistente (se presente) e ne crea uno nuovo da zero. Così può essere richiamata in
// sicurezza più volte — sia dal normale avvio della pagina sia dal ripristino dopo
// sospensione (schermo spento) — senza mai tentare di aggiungere listener
// "postgres_changes" a un canale già sottoscritto (che genererebbe l'errore
// "cannot add postgres_changes callbacks... after subscribe()" e bloccherebbe
// l'esecuzione dello script, impedendo anche l'inizializzazione della ricerca).
function initRealtime() {
  if (playlistChannel) {
    try { supabaseClient.removeChannel(playlistChannel); } catch (e) { /* ignora */ }
    playlistChannel = null;
  }
  if (presenceChannel) {
    try { supabaseClient.removeChannel(presenceChannel); } catch (e) { /* ignora */ }
    presenceChannel = null;
  }

  // Canale Realtime modifiche DB
  playlistChannel = supabaseClient
    .channel('playlist-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist' }, (payload) => {
      handlePlaylistChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_songs' }, () => {
      loadBannedSongs();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
      if (payload.new && payload.new.key) {
        appSettings[payload.new.key] = payload.new.value;
        notifySettingsUpdate();
      }
    })
    .subscribe((status) => {
      updateConnectionStatus(status);
    });

  // Presenza utenti online
  presenceChannel = supabaseClient.channel('online-users');
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      const count = Object.keys(state).length;
      if (onPresenceUpdate) onPresenceUpdate(count);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await presenceChannel.track({
            user_id: SESSION_ID,
            page: document.body.dataset.page || 'user',
            joined_at: new Date().toISOString()
          });
        } catch (e) {
          console.warn('Presence tracking fallito:', e);
        }
      }
    });
}

// --- Ripristino dopo sospensione (schermo spento / app in background) ---
// Su mobile, quando lo schermo si spegne o il browser va in background, il sistema
// operativo può sospendere il timer del client Supabase e/o interrompere silenziosamente
// il websocket senza che venga generato subito un evento di chiusura. Il risultato è che
// gli aggiornamenti realtime smettono di arrivare finché non si ricarica manualmente la
// pagina. Per risolvere: ogni volta che la pagina torna visibile/attiva, ricarichiamo
// sempre i dati da zero (indipendentemente dallo stato apparente del canale) e, se il
// canale realtime non risulta più "joined", lo ricreiamo da capo.
let _visibilityResumeInProgress = false;

// Guardie anti-corsa con l'inizializzazione iniziale della pagina.
// BUG RISOLTO: "pageshow" viene generato dal browser anche al primissimo caricamento
// della pagina (con persisted=false) e "focus" può scattare subito dopo il load. Senza
// queste guardie, handleVisibilityResume() partiva PRIMA che la pagina avesse finito la
// propria inizializzazione (initRealtime iniziale), ricreando i canali Realtime in corsa
// con essa: il canale 'playlist-changes' risultava già sottoscritto quando la pagina
// tentava di sottoscriverlo a sua volta, causando l'errore
// "cannot add postgres_changes callbacks... after subscribe()" non gestito, che
// interrompeva l'esecuzione dello script PRIMA che venisse chiamato initSearch() —
// motivo per cui la ricerca dei brani smetteva di funzionare.
let _appReady = false;
let _pageWasHidden = false;

window.addEventListener('load', () => { _appReady = true; });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _pageWasHidden = true;
});

async function handleVisibilityResume() {
  if (!_appReady) return;
  if (document.visibilityState !== 'visible') return;
  if (_visibilityResumeInProgress) return;
  _visibilityResumeInProgress = true;

  try {
    // Ricarica sempre i dati correnti: se qualcosa è cambiato mentre eravamo
    // "addormentati", questo è l'unico modo affidabile per recuperarlo, dato che un
    // websocket riconnesso riceve solo gli eventi futuri, non quelli persi nel frattempo.
    await Promise.all([loadPlaylist(), loadBannedSongs(), loadAppSettings()]);

    const playlistState = playlistChannel ? playlistChannel.state : 'closed';
    const presenceState = presenceChannel ? presenceChannel.state : 'closed';

    if (playlistState !== 'joined' || presenceState !== 'joined') {
      reconnectRealtime();
    }
  } catch (e) {
    console.warn('Errore nel ripristino dopo sospensione:', e);
  } finally {
    _visibilityResumeInProgress = false;
  }
}

// Ricrea da zero i canali realtime (usato dopo una sospensione prolungata)
function reconnectRealtime() {
  try {
    if (playlistChannel) supabaseClient.removeChannel(playlistChannel);
  } catch (e) { /* ignora */ }
  try {
    if (presenceChannel) supabaseClient.removeChannel(presenceChannel);
  } catch (e) { /* ignora */ }
  playlistChannel = null;
  presenceChannel = null;
  initRealtime();
}

// Eventi che possono segnalare un ritorno in primo piano dopo una sospensione.
// "pageshow" e "focus" vengono ignorati se la pagina non è mai stata effettivamente
// nascosta (o, per pageshow, se non proviene dalla bfcache), proprio per non scattare
// al primo caricamento della pagina.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') handleVisibilityResume();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted || _pageWasHidden) handleVisibilityResume();
});
window.addEventListener('focus', () => {
  if (_pageWasHidden) handleVisibilityResume();
});
window.addEventListener('online', () => {
  if (_appReady) handleVisibilityResume();
});

// Rete di sicurezza aggiuntiva: mentre la pagina è visibile, controlla periodicamente
// che il canale sia ancora "joined". Serve a coprire casi limite in cui nessuno degli
// eventi sopra viene generato dal browser/OS (es. alcuni WebView Android).
setInterval(() => {
  if (!_appReady) return;
  if (document.visibilityState !== 'visible') return;
  const playlistState = playlistChannel ? playlistChannel.state : 'closed';
  if (playlistState !== 'joined' && playlistState !== 'joining') {
    handleVisibilityResume();
  }
}, 20000);

function handlePlaylistChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  switch (eventType) {
    case 'INSERT':
      currentPlaylist.push(newRecord);
      currentPlaylist.sort((a, b) => a.position - b.position);
      break;
    case 'UPDATE':
      const updateIdx = currentPlaylist.findIndex(s => s.id === newRecord.id);
      if (updateIdx !== -1) {
        currentPlaylist[updateIdx] = newRecord;
      } else {
        currentPlaylist.push(newRecord);
      }
      currentPlaylist.sort((a, b) => a.position - b.position);
      break;
    case 'DELETE':
      currentPlaylist = currentPlaylist.filter(s => s.id !== oldRecord.id);
      break;
  }
  
  if (onPlaylistUpdate) onPlaylistUpdate(currentPlaylist);
}

// --- Connection status ---
function updateConnectionStatus(status) {
  const badge = document.getElementById('connection-status');
  if (!badge) return;

  badge.className = 'connection-badge';
  const text = badge.querySelector('.status-text');

  switch (status) {
    case 'SUBSCRIBED':
      badge.classList.add('connected');
      if (text) text.textContent = 'Connesso';
      isConnected = true;
      break;
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
    case 'CLOSED':
      badge.classList.add('disconnected');
      if (text) text.textContent = 'Disconnesso';
      isConnected = false;
      break;
    default:
      badge.classList.add('connecting');
      if (text) text.textContent = 'Connessione...';
      break;
  }
}

// --- Toast notifications ---
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Utility: check if song is banned ---
function isSongBanned(deezerId) {
  if (!deezerId) return false;
  return bannedSongs.some(b => b.deezer_id === deezerId);
}

// --- Utility: HTML escape ---
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================
// Componente "Crediti" (condiviso da tutte le pagine)
// =============================================
// Unica fonte di verità per il popup dei crediti: modificando questo blocco
// il contenuto cambia automaticamente su index.html, staff.html, dj.html e admin.html,
// senza dover tenere sincronizzate 4 copie identiche di HTML.
const CREDITS_MODAL_ID = 'credits-modal-overlay';

function ensureCreditsModal() {
  if (document.getElementById(CREDITS_MODAL_ID)) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="${CREDITS_MODAL_ID}" class="modal-overlay">
      <div class="modal credits-modal" style="max-width: 400px; text-align: center;">
        <div class="modal-header">
          <h3>✦ Crediti</h3>
          <button class="modal-close" onclick="closeCreditsModal()">&times;</button>
        </div>
        <div class="modal-body" style="padding: 1.2rem 0.5rem;">
          <div style="font-size: 2.2rem; margin-bottom: 0.75rem;">🎵</div>
          <p style="font-size: 1.05rem; font-weight: 500; line-height: 1.6; color: rgba(255, 255, 255, 0.9); margin-bottom: 1.2rem;">
            MdP SongApp è realizzata dagli animatori per l'Oratorio.
          </p>
          <div class="credits-product-tag">
            Un prodotto ✦Sirio
          </div>
        </div>
        <div class="modal-footer" style="justify-content: center;">
          <button class="btn btn-primary" onclick="closeCreditsModal()">Chiudi</button>
        </div>
      </div>
    </div>
  `.trim();
  document.body.appendChild(wrapper.firstElementChild);
}

function openCreditsModal() {
  ensureCreditsModal();
  const overlay = document.getElementById(CREDITS_MODAL_ID);
  if (overlay) overlay.classList.add('active');
}

function closeCreditsModal() {
  const overlay = document.getElementById(CREDITS_MODAL_ID);
  if (overlay) overlay.classList.remove('active');
}

// Se la pagina ha già un footer ma nessun link "Crediti" (es. dj.html, admin.html),
// lo aggiunge automaticamente così resta presente ovunque senza doverlo duplicare.
function ensureCreditsFooterLink() {
  if (document.querySelector('.credits-trigger')) return;
  const footerContent = document.querySelector('.app-footer .footer-content');
  if (!footerContent) return;

  const divider = document.createElement('span');
  divider.className = 'footer-divider';
  divider.textContent = '•';

  const btn = document.createElement('button');
  btn.className = 'credits-trigger';
  btn.textContent = 'Crediti';
  btn.onclick = openCreditsModal;

  footerContent.appendChild(divider);
  footerContent.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', ensureCreditsFooterLink);

// =============================================
// Componente "Modalità Manutenzione" (condiviso da tutte le pagine)
// =============================================
// Legge app_settings.maintenance_mode (aggiornato in tempo reale) e, se attivo per la
// pagina corrente, mostra un overlay a schermo intero che blocca l'accesso — istantaneo
// anche per chi ha già la pagina aperta, senza bisogno di ricaricare. La pagina admin
// non viene mai bloccata, qualunque sia l'impostazione.
const MAINTENANCE_OVERLAY_ID = 'maintenance-overlay';

function applyMaintenanceMode(settings) {
  const page = document.body.dataset.page;
  if (page === 'admin') return; // il pannello admin resta sempre accessibile

  const mm = settings?.maintenance_mode;
  const enabled = !!(mm && mm.enabled === true);

  const shouldBlock = enabled && (
    page === 'user' ||
    (page === 'staff' && mm.block_staff === true) ||
    (page === 'dj' && mm.block_dj === true)
  );

  let overlay = document.getElementById(MAINTENANCE_OVERLAY_ID);

  if (!shouldBlock) {
    if (overlay) overlay.style.display = 'none';
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = MAINTENANCE_OVERLAY_ID;
    overlay.className = 'maintenance-overlay';
    overlay.innerHTML = `
      <div class="maintenance-box">
        <div class="maintenance-icon">🛠️</div>
        <h2>Manutenzione in corso</h2>
        <p id="maintenance-message"></p>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const msgEl = overlay.querySelector('#maintenance-message');
  if (msgEl) {
    msgEl.textContent = (mm && mm.message) ||
      "L'app è momentaneamente in manutenzione. Riprova più tardi.";
  }
  overlay.style.display = 'flex';
}
