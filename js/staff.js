// =============================================
// MdP SongApp - Logica Pagina Staff
// =============================================

let isStaffPortalEnabled = true;

document.addEventListener('DOMContentLoaded', async () => {
  document.body.dataset.page = 'staff';

  onPlaylistUpdate = renderStaffPlaylist;
  onBannedUpdate = () => {};
  onSettingsUpdate = handleStaffSettingsUpdate;

  await loadBannedSongs();
  await loadAppSettings();
  await loadPlaylist();

  initRealtime();
  initSearch('search-results', addSongAsStaff);

  // Verifica stato iniziale impostazioni
  if (appSettings && appSettings.staff_page) {
    handleStaffSettingsUpdate(appSettings);
  }
});

// --- Gestione abilitazione/disabilitazione portale staff ---
function handleStaffSettingsUpdate(settings) {
  const staffConfig = settings?.staff_page;
  const banner = document.getElementById('staff-disabled-banner');
  const searchSection = document.getElementById('staff-search-section');
  const reasonText = document.getElementById('staff-disabled-reason');

  if (staffConfig && staffConfig.enabled === false) {
    isStaffPortalEnabled = false;
    if (banner) {
      banner.style.display = 'block';
      if (reasonText) {
        reasonText.textContent = staffConfig.disabled_reason || 'Le richieste da parte dello staff non sono al momento disponibili.';
      }
    }
    if (searchSection) {
      searchSection.style.display = 'none';
    }
  } else {
    isStaffPortalEnabled = true;
    if (banner) banner.style.display = 'none';
    if (searchSection) searchSection.style.display = '';
  }
}

// --- Aggiunta brano da parte dello staff con algoritmo a blocchi ---
async function addSongAsStaff(trackData) {
  if (!isStaffPortalEnabled) {
    showToast('Le richieste dello staff sono attualmente disattivate', 'warning');
    return;
  }

  try {
    // 1. Prova a chiamare la funzione RPC dedicata
    const { data, error } = await supabaseClient.rpc('staff_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null,
      p_session_id: SESSION_ID
    });

    if (error) {
      console.warn('RPC staff_add_song non disponibile, eseguo algoritmo lato client:', error);
      // Fallback lato client se la funzione RPC non è ancora stata creata nel DB
      await addSongAsStaffClientFallback(trackData);
      return;
    }

    showToast('Brano aggiunto dallo Staff! 🛡️🎵', 'success');
    
    // Pulisci ricerca
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.innerHTML = '';

  } catch (err) {
    console.error('Errore aggiunta brano staff:', err);
    showToast('Errore nell\'aggiunta del brano', 'error');
  }
}

// Fallback algoritmo a blocchi lato client (se RPC non ancora deployata)
async function addSongAsStaffClientFallback(trackData) {
  // Trova la posizione sotto il primo blocco di brani selezionati dallo staff
  const activeSongs = currentPlaylist.filter(s => !s.played_at);
  let insertPos = null;
  let foundBreak = false;

  for (const s of activeSongs) {
    if (s.is_staff && !foundBreak) {
      insertPos = s.position + 1;
    } else {
      if (!foundBreak) {
        foundBreak = true;
        if (insertPos === null) {
          insertPos = s.position;
        }
      }
    }
  }

  if (insertPos === null) {
    const maxPos = currentPlaylist.reduce((max, s) => Math.max(max, s.position || 0), 0);
    insertPos = maxPos + 1;
  }

  // Sposta in avanti i successivi
  const songsToShift = currentPlaylist.filter(s => s.position >= insertPos);
  for (const s of songsToShift) {
    await supabaseClient.from('playlist').update({ position: s.position + 1 }).eq('id', s.id);
  }

  // Inserisci brano con is_staff = true
  const { error: insertError } = await supabaseClient.from('playlist').insert({
    title: trackData.title,
    artist: trackData.artist,
    genre: trackData.genre || null,
    album_art_url: trackData.album_art || null,
    deezer_id: trackData.id || null,
    position: insertPos,
    session_id: SESSION_ID,
    is_staff: true
  });

  if (insertError) {
    // Se la colonna is_staff non esiste ancora, prova inserimento normale
    await supabaseClient.rpc('user_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null,
      p_session_id: SESSION_ID
    });
  }

  showToast('Brano aggiunto dallo Staff! 🛡️🎵', 'success');
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const searchResults = document.getElementById('search-results');
  if (searchResults) searchResults.innerHTML = '';
  await loadPlaylist();
}

// --- Render playlist staff ---
function renderStaffPlaylist(playlist) {
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
        <p>Cerca un brano e richiedilo come Staff!</p>
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
          <div class="song-title">
            ${escapeHtml(song.title)}
            ${song.is_staff ? renderStaffBadge(true) : ''}
          </div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
        </div>
        <div class="song-actions">
          ${isOwn ? `
            <button class="btn btn-icon btn-ghost btn-sm" onclick="openStaffEditModal('${song.id}')" title="Modifica">
              ${ICONS.edit}
            </button>
            <button class="btn btn-icon btn-danger btn-sm" onclick="deleteStaffSong('${song.id}')" title="Elimina">
              ${ICONS.delete}
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// --- Modale Sostituzione Brano Staff ---
let staffEditSearchTimeout = null;
let staffEditSearchAbort = null;

function openStaffEditModal(songId) {
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
      clearTimeout(staffEditSearchTimeout);
      const resultsContainer = document.getElementById('edit-search-results');

      if (query.length < 2) {
        if (staffEditSearchAbort) { staffEditSearchAbort.abort(); staffEditSearchAbort = null; }
        if (resultsContainer) resultsContainer.innerHTML = '';
        return;
      }

      staffEditSearchTimeout = setTimeout(() => performStaffEditSearch(query), 300);
    });
  }
}

async function performStaffEditSearch(query) {
  const resultsContainer = document.getElementById('edit-search-results');
  if (!resultsContainer) return;

  if (staffEditSearchAbort) staffEditSearchAbort.abort();
  staffEditSearchAbort = new AbortController();

  resultsContainer.innerHTML = '<div class="search-loading">Ricerca in corso...</div>';

  try {
    const response = await fetch(`${SEARCH_FUNCTION_URL}?q=${encodeURIComponent(query)}&limit=10`, {
      signal: staffEditSearchAbort.signal,
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
             onclick="handleStaffEditCardClick(this)"
             role="button"
             tabindex="${banned ? '-1' : '0'}"
             title="${banned ? 'Brano bannato' : 'Clicca per sostituire'}">
          ${coverUrl 
            ? `<img src="${coverUrl}" alt="" loading="lazy">` 
            : `<div class="song-artwork-fallback" style="width:48px;height:48px">${ICONS.music}</div>`
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
    staffEditSearchAbort = null;
  }
}

async function handleStaffEditCardClick(card) {
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

// --- Eliminazione brano Staff ---
let staffSongToDelete = null;

function deleteStaffSong(songId) {
  staffSongToDelete = songId;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.add('active');
  
  const confirmBtn = document.getElementById('confirm-delete-btn');
  if (confirmBtn) {
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', executeDeleteStaffSong);
  }
}

function closeConfirmModal() {
  staffSongToDelete = null;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function executeDeleteStaffSong() {
  if (!staffSongToDelete) return;
  const songId = staffSongToDelete;
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
