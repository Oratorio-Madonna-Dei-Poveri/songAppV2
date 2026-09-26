// =============================================
// MdP SongApp - Logica Pagina Utente
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Set page identifier for presence
  document.body.dataset.page = 'user';

  // Set up playlist update callback
  onPlaylistUpdate = renderPlaylist;
  onBannedUpdate = () => {}; // Just keep bannedSongs array updated

  // Load initial data
  await loadBannedSongs();
  await loadPlaylist();

  // Initialize real-time
  initRealtime();

  // Initialize search
  initSearch('search-results', addSongToPlaylist);
});

// --- Add song to playlist ---
async function addSongToPlaylist(trackData) {
  try {
    const { data, error } = await supabaseClient.rpc('user_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null,
      p_session_id: SESSION_ID
    });

    if (error) {
      if (error.message.includes('bannato')) {
        showToast('Questo brano è stato bannato e non può essere richiesto', 'error');
      } else {
        showToast('Errore nell\'aggiunta del brano', 'error');
      }
      return;
    }

    showToast('Brano aggiunto alla playlist! 🎵', 'success');
    
    // Clear search
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.innerHTML = '';

  } catch (err) {
    console.error('Errore:', err);
    showToast('Errore nell\'aggiunta del brano', 'error');
  }
}

// --- Render playlist ---
function renderPlaylist(playlist) {
  const container = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  if (!container) return;

  if (countEl) countEl.textContent = playlist.length;

  if (playlist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎶</div>
        <p>Nessun brano nella playlist</p>
        <p>Cerca un brano e aggiungilo!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = playlist.map((song, index) => {
    const isOwn = song.session_id === SESSION_ID;
    return `
      <div class="playlist-item ${isOwn ? 'own-song' : ''}" data-id="${song.id}">
        <span class="song-position">${index + 1}</span>
        ${song.album_art_url
          ? `<img class="song-artwork" src="${song.album_art_url}" alt="" loading="lazy">`
          : '<div class="song-artwork" style="background:#333;display:flex;align-items:center;justify-content:center">🎵</div>'
        }
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
        <div class="song-actions">
          ${isOwn ? `
            <button class="btn btn-icon btn-ghost btn-sm" onclick="openEditModal('${song.id}')" title="Modifica">
              ✏️
            </button>
            <button class="btn btn-icon btn-danger btn-sm" onclick="deleteSong('${song.id}')" title="Elimina">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// --- Edit song modal ---
function openEditModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;

  const overlay = document.getElementById('modal-overlay');
  const titleInput = document.getElementById('edit-title');
  const artistInput = document.getElementById('edit-artist');
  const songIdInput = document.getElementById('edit-song-id');

  if (titleInput) titleInput.value = song.title;
  if (artistInput) artistInput.value = song.artist;
  if (songIdInput) songIdInput.value = songId;
  if (overlay) overlay.classList.add('active');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function saveEdit() {
  const songId = document.getElementById('edit-song-id').value;
  const title = document.getElementById('edit-title').value.trim();
  const artist = document.getElementById('edit-artist').value.trim();

  if (!title || !artist) {
    showToast('Titolo e artista sono obbligatori', 'error');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('user_update_song', {
      p_song_id: songId,
      p_session_id: SESSION_ID,
      p_title: title,
      p_artist: artist
    });

    if (error) {
      showToast('Errore nella modifica del brano', 'error');
      return;
    }

    showToast('Brano modificato ✏️', 'success');
    closeModal();
  } catch (err) {
    showToast('Errore nella modifica', 'error');
  }
}

// --- Delete song ---
async function deleteSong(songId) {
  if (!confirm('Sei sicuro di voler eliminare questo brano?')) return;

  try {
    const { error } = await supabaseClient.rpc('user_delete_song', {
      p_song_id: songId,
      p_session_id: SESSION_ID
    });

    if (error) {
      showToast('Errore nell\'eliminazione del brano', 'error');
      return;
    }

    showToast('Brano eliminato 🗑️', 'success');
  } catch (err) {
    showToast('Errore nell\'eliminazione', 'error');
  }
}
