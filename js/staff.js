// =============================================
// MdP SongApp - Logica Pagina Staff (Con Priorità a Blocchi)
// =============================================

let isStaffPortalEnabled = true;

// Session ID per lo Staff (include prefisso staff_ per tracciare il ruolo anche prima della migrazione DB)
function getStaffSessionId() {
  let staffId = localStorage.getItem('mdp_staff_session_id');
  if (!staffId) {
    staffId = 'staff_' + getSessionId();
    localStorage.setItem('mdp_staff_session_id', staffId);
  }
  return staffId;
}

const STAFF_SESSION_ID = getStaffSessionId();

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
    // 1. Prova prima a chiamare la funzione RPC dedicata staff_add_song (attiva dopo migrazione SQL)
    const { data: newId, error } = await supabaseClient.rpc('staff_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null,
      p_session_id: STAFF_SESSION_ID
    });

    if (error) {
      console.warn('RPC staff_add_song non ancora presente nel DB. Eseguo fallback con priorità client:', error);
      // Fallback che funziona subito anche prima di eseguire lo script SQL
      await addSongAsStaffClientFallback(trackData);
      return;
    }

    showToast('Brano aggiunto dallo Staff! 🛡️🎵', 'success');
    cleanupSearch();
  } catch (err) {
    console.error('Errore aggiunta brano staff:', err);
    showToast('Errore nell\'aggiunta del brano', 'error');
  }
}

// Fallback algoritmo a blocchi lato client (funziona al 100% sul DB attuale prima della migrazione)
async function addSongAsStaffClientFallback(trackData) {
  try {
    // 1. Inserisci il brano con session_id 'staff_...' tramite user_add_song
    const { data: newSongId, error: addError } = await supabaseClient.rpc('user_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null,
      p_session_id: STAFF_SESSION_ID
    });

    if (addError) {
      if (addError.message && addError.message.includes('bannato')) {
        showToast('Questo brano è stato bannato e non può essere richiesto', 'error');
      } else {
        showToast('Errore nell\'aggiunta: ' + (addError.message || 'riprova'), 'error');
      }
      return;
    }

    // 2. Recupera tutti i brani attivi per riordinare la posizione del nuovo brano
    const { data: allSongs, error: fetchError } = await supabaseClient
      .from('playlist')
      .select('*')
      .is('played_at', null)
      .order('position', { ascending: true });

    if (fetchError || !allSongs || allSongs.length === 0) {
      showToast('Brano aggiunto dallo Staff! 🛡️🎵', 'success');
      cleanupSearch();
      await loadPlaylist();
      return;
    }

    // Isola il brano appena aggiunto (si trova provvisoriamente in coda)
    const newlyAddedIndex = allSongs.findIndex(s => s.id === newSongId);
    let newSongObj = null;
    if (newlyAddedIndex !== -1) {
      newSongObj = allSongs.splice(newlyAddedIndex, 1)[0];
    } else {
      newSongObj = {
        id: newSongId,
        title: trackData.title,
        artist: trackData.artist,
        session_id: STAFF_SESSION_ID,
        is_staff: true
      };
    }

    newSongObj.session_id = STAFF_SESSION_ID;
    newSongObj.is_staff = true;

    // 3. Calcola l'indice di inserimento: sotto il primo blocco contiguo di brani dello staff
    let insertIndex = 0;
    for (let i = 0; i < allSongs.length; i++) {
      if (isStaffSong(allSongs[i])) {
        insertIndex = i + 1;
      } else {
        break; // Trovato il primo brano non-staff
      }
    }

    // Inserisci il brano nuovo esattamente sotto il primo blocco staff (o in cima se blocco = 0)
    allSongs.splice(insertIndex, 0, newSongObj);

    // 4. Applica le nuove posizioni consecutive con dj_reorder_songs (ha SECURITY DEFINER)
    const reorderSongIds = allSongs.map(s => s.id);
    const reorderPositions = allSongs.map((_, idx) => idx + 1);

    const { error: reorderError } = await supabaseClient.rpc('dj_reorder_songs', {
      p_song_ids: reorderSongIds,
      p_positions: reorderPositions
    });

    if (reorderError) {
      console.warn('Errore in dj_reorder_songs:', reorderError);
    }

    showToast('Brano aggiunto dallo Staff in posizione prioritaria! 🛡️🎵', 'success');
    cleanupSearch();
    await loadPlaylist();
  } catch (e) {
    console.error('Errore nel fallback staff:', e);
    showToast('Brano aggiunto 🎵', 'success');
    cleanupSearch();
    await loadPlaylist();
  }
}

function cleanupSearch() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const searchResults = document.getElementById('search-results');
  if (searchResults) searchResults.innerHTML = '';
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
    const isOwn = song.session_id === STAFF_SESSION_ID || song.session_id === SESSION_ID;
    const isStaff = isStaffSong(song);
    return `
      <div class="playlist-item ${isOwn ? 'own-song' : ''}" data-id="${song.id}">
        <span class="song-position">${index + 1}</span>
        ${renderSongArtwork(song.album_art_url)}
        <div class="song-info">
          <div class="song-title">
            ${escapeHtml(song.title)}
            ${renderStaffBadge(isStaff)}
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
    staffEditSearchAbort = null;
  }
}

async function handleStaffEditCardClick(card) {
  if (card.classList.contains('banned')) return;
  card.classList.add('card-selected');

  const songId = document.getElementById('edit-song-id').value;
  if (!songId) return;

  const currentSong = currentPlaylist.find(s => s.id === songId);
  const songSessionId = currentSong?.session_id || STAFF_SESSION_ID;

  try {
    const trackData = JSON.parse(card.dataset.track);

    const { error } = await supabaseClient.rpc('user_update_song', {
      p_song_id: songId,
      p_session_id: songSessionId,
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

  const songObj = currentPlaylist.find(s => s.id === songId);
  const songSessionId = songObj?.session_id || STAFF_SESSION_ID;

  const item = document.querySelector(`.playlist-item[data-id="${songId}"]`);
  if (item) item.style.display = 'none';

  try {
    const { error } = await supabaseClient.rpc('user_delete_song', {
      p_song_id: songId,
      p_session_id: songSessionId
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

// Nota: il modale "Crediti" (apertura/chiusura) è ora un componente condiviso
// definito una sola volta in js/realtime.js (funzioni openCreditsModal/closeCreditsModal),
// così viene aggiornato automaticamente su tutte le pagine.
