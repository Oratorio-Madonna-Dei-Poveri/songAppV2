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

// Helper indicatore Staff (per DJ e Admin)
function renderStaffBadge(isStaff) {
  if (!isStaff) return '';
  return `<span class="badge-staff" title="Richiesto dallo Staff">${ICONS.staff} Staff</span>`;
}

// --- Stato globale ---
let currentPlaylist = [];
let bannedSongs = [];
let appSettings = {
  staff_page: { enabled: true, disabled_reason: '' }
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
    if (onSettingsUpdate) onSettingsUpdate(appSettings);
  } catch (e) {
    console.warn('Errore lettura app_settings (potrebbe mancare la tabella):', e);
  }
  return appSettings;
}

// --- Real-time subscriptions ---
let playlistChannel = null;
let presenceChannel = null;

function initRealtime() {
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
        if (onSettingsUpdate) onSettingsUpdate(appSettings);
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
