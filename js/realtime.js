// =============================================
// MdP SongApp - Modulo Real-Time
// =============================================

// --- Stato globale ---
let currentPlaylist = [];
let bannedSongs = [];
let isConnected = false;

// --- Callback da impostare nelle pagine specifiche ---
let onPlaylistUpdate = null;  // chiamata quando la playlist cambia
let onBannedUpdate = null;    // chiamata quando i brani bannati cambiano
let onPresenceUpdate = null;  // chiamata con il conteggio utenti online

// --- Caricamento iniziale ---
async function loadPlaylist() {
  const { data, error } = await supabaseClient
    .from('playlist')
    .select('*')
    .order('position', { ascending: true });
  if (!error && data) {
    currentPlaylist = data;
    if (onPlaylistUpdate) onPlaylistUpdate(currentPlaylist);
  }
  return currentPlaylist;
}

async function loadBannedSongs() {
  const { data, error } = await supabaseClient
    .from('banned_songs')
    .select('*')
    .order('banned_at', { ascending: false });
  if (!error && data) {
    bannedSongs = data;
    if (onBannedUpdate) onBannedUpdate(bannedSongs);
  }
  return bannedSongs;
}

// --- Real-time subscriptions ---
let playlistChannel = null;
let presenceChannel = null;

function initRealtime() {
  // Subscribe to playlist changes
  playlistChannel = supabaseClient
    .channel('playlist-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist' }, (payload) => {
      handlePlaylistChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'banned_songs' }, (payload) => {
      // Reload banned songs on any change
      loadBannedSongs();
    })
    .subscribe((status) => {
      updateConnectionStatus(status);
    });

  // Presence channel for online users
  presenceChannel = supabaseClient.channel('online-users');
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      const count = Object.keys(state).length;
      if (onPresenceUpdate) onPresenceUpdate(count);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          user_id: SESSION_ID,
          page: document.body.dataset.page || 'user',
          joined_at: new Date().toISOString()
        });
      }
    });
}

function handlePlaylistChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  switch (eventType) {
    case 'INSERT':
      // Add new song in correct position
      currentPlaylist.push(newRecord);
      currentPlaylist.sort((a, b) => a.position - b.position);
      break;
    case 'UPDATE':
      const updateIdx = currentPlaylist.findIndex(s => s.id === newRecord.id);
      if (updateIdx !== -1) {
        currentPlaylist[updateIdx] = newRecord;
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
  const dot = badge.querySelector('.dot');
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

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-remove after 3 seconds
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
