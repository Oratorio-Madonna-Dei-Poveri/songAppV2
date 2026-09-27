// =============================================
// MdP SongApp - Logica Pagina Utente
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  document.body.dataset.page = 'user';

  onPlaylistUpdate = renderPlaylist;
  onBannedUpdate = () => {};

  await loadBannedSongs();
  await loadPlaylist();

  initRealtime();
  initSearch('search-results', addSongToPlaylist);
});

// --- Aggiunta brano alla playlist ---
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
      if (error.message && error.message.includes('bannato')) {
        showToast('Questo brano è stato bannato e non può essere richiesto', 'error');
      } else {
        showToast('Errore nell\'aggiunta del brano', 'error');
      }
      return;
    }

    showToast('Brano aggiunto alla playlist! 🎵', 'success');
    
    // Pulisci barra e risultati di ricerca
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.innerHTML = '';

  } catch (err) {
    console.error('Errore:', err);
    showToast('Errore nell\'aggiunta del brano', 'error');
  }
}

// --- Render playlist (pubblica: brani non suonati, nessun indicatore staff/note) ---
function renderPlaylist(playlist) {
  const activeSongs = playlist.filter(s => !s.played_at);
  const container = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  if (!container) return;

  if (countEl) countEl.textContent = activeSongs.length;

  if (activeSongs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎶</div>
        <p>Nessun brano nella playlist</p>
        <p>Cerca un brano e aggiungilo!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = activeSongs.map((song, index) => {
    const isOwn = song.session_id === SESSION_ID;
    return `
      <div class="playlist-item ${isOwn ? 'own-song' : ''}" data-id="${song.id}">
        <span class="song-position">${index + 1}</span>
        ${renderSongArtwork(song.album_art_url)}
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
        <div class="song-actions">
          ${isOwn ? `
            <button class="btn btn-icon btn-ghost btn-sm" onclick="openEditModal('${song.id}')" title="Modifica">
              ${ICONS.edit}
            </button>
            <button class="btn btn-icon btn-danger btn-sm" onclick="deleteSong('${song.id}')" title="Elimina">
              ${ICONS.delete}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// --- Modale Sostituzione Brano ---
let editSearchTimeout = null;
let editSearchAbort = null;

function openEditModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;

  const overlay = document.getElementById('modal-overlay');
  const songIdInput = document.getElementById('edit-song-id');
  const currentSongDisplay = document.getElementById('edit-current-song');
  const editSearchInput = document.getElementById('edit-search-input');
  const editSearchResults = document.getElementById('edit-search-results');

  if (songIdInput) songIdInput.value = songId;
  if (currentSongDisplay) currentSongDisplay.textContent = `Brano attuale: ${song.title} — ${song.artist}`;
  if (editSearchInput) editSearchInput.value = '';
  if (editSearchResults) editSearchResults.innerHTML = '';
  if (overlay) overlay.classList.add('active');

  setTimeout(() => { if (editSearchInput) editSearchInput.focus(); }, 100);

  if (editSearchInput) {
    const newInput = editSearchInput.cloneNode(true);
    editSearchInput.parentNode.replaceChild(newInput, editSearchInput);

    newInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(editSearchTimeout);
      const resultsContainer = document.getElementById('edit-search-results');

      if (query.length < 2) {
        if (editSearchAbort) { editSearchAbort.abort(); editSearchAbort = null; }
        if (resultsContainer) resultsContainer.innerHTML = '';
        return;
      }

      editSearchTimeout = setTimeout(() => performEditSearch(query), 300);
    });
  }
}

async function performEditSearch(query) {
  const resultsContainer = document.getElementById('edit-search-results');
  if (!resultsContainer) return;

  if (editSearchAbort) editSearchAbort.abort();
  editSearchAbort = new AbortController();

  resultsContainer.innerHTML = '<div class="search-loading">Ricerca in corso...</div>';

  try {
    const response = await fetch(`${SEARCH_FUNCTION_URL}?q=${encodeURIComponent(query)}&limit=10`, {
      signal: editSearchAbort.signal,
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      resultsContainer.innerHTML = '<div class="search-loading">Nessun risultato trovato</div>';
      return;
    }

    resultsContainer.innerHTML = result.data.map(track => {
      const banned = isSongBanned(String(track.id));
      const coverUrl = track.album?.cover_small || track.album?.cover_medium || '';
      const trackData = JSON.stringify({
        id: String(track.id),
        title: track.title,
        artist: track.artist?.name || 'Sconosciuto',
        genre: track.genre_id ? (DEEZER_GENRES[track.genre_id] || '') : '',
        album_art: track.album?.cover_medium || coverUrl
      }).replace(/'/g, '&#39;');

      return `
        <div class="search-result-card ${banned ? 'banned' : ''}" 
             data-track='${trackData}'
             onclick="handleEditCardClick(this)"
             role="button"
             tabindex="${banned ? '-1' : '0'}"
             title="${banned ? 'Brano bannato' : 'Clicca per sostituire'}">
          ${coverUrl 
            ? `<img src="${coverUrl}" alt="" loading="lazy">` 
            : `<div class="song-artwork-fallback">${ICONS.music}</div>`
          }
          <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-artist">${escapeHtml(track.artist?.name || 'Sconosciuto')}</div>
          </div>
          ${banned
            ? '<span class="btn btn-sm btn-ghost" disabled>🚫 Bannato</span>'
            : '<button class="btn btn-sm btn-primary btn-add" tabindex="-1">✏️ Sostituisci</button>'
          }
        </div>
      `;
    }).join('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Errore nella ricerca:', error);
    resultsContainer.innerHTML = '<div class="search-loading">Errore nella ricerca. Riprova.</div>';
  } finally {
    editSearchAbort = null;
  }
}

// Click su qualsiasi punto della scheda per sostituire
async function handleEditCardClick(card) {
  if (card.classList.contains('banned')) return;
  card.classList.add('card-selected');

  const songId = document.getElementById('edit-song-id').value;
  if (!songId) return;

  try {
    const trackData = JSON.parse(card.dataset.track);

    const { error } = await supabaseClient.rpc('user_update_song', {
      p_song_id: songId,
      p_session_id: SESSION_ID,
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null
    });

    if (error) {
      if (error.message && error.message.includes('bannato')) {
        showToast('Questo brano è stato bannato', 'error');
      } else {
        showToast('Errore nella sostituzione del brano', 'error');
      }
      return;
    }

    showToast('Brano sostituito ✏️', 'success');
    closeModal();
  } catch (err) {
    console.error('Errore:', err);
    showToast('Errore nella sostituzione', 'error');
  }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

// --- Eliminazione brano ---
let songToDelete = null;

function deleteSong(songId) {
  songToDelete = songId;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.add('active');
  
  const confirmBtn = document.getElementById('confirm-delete-btn');
  if (confirmBtn) {
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', executeDeleteSong);
  }
}

function closeConfirmModal() {
  songToDelete = null;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function executeDeleteSong() {
  if (!songToDelete) return;
  const songId = songToDelete;
  closeConfirmModal();

  const item = document.querySelector(`.playlist-item[data-id="${songId}"]`);
  if (item) item.style.display = 'none';

  try {
    const { error } = await supabaseClient.rpc('user_delete_song', {
      p_song_id: songId,
      p_session_id: SESSION_ID
    });

    if (error) {
      if (item) item.style.display = '';
      showToast('Errore nell\'eliminazione del brano', 'error');
      return;
    }

    if (item) item.remove();
    showToast('Brano eliminato 🗑️', 'success');
  } catch (err) {
    if (item) item.style.display = '';
    showToast('Errore nell\'eliminazione', 'error');
  }
}

// --- Modale Crediti ---
function openCreditsModal() {
  const overlay = document.getElementById('credits-modal-overlay');
  if (overlay) overlay.classList.add('active');
}

function closeCreditsModal() {
  const overlay = document.getElementById('credits-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}
