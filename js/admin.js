// =============================================
// MdP SongApp - Logica Pagina Admin (SysAdmin)
// =============================================

let sortableInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.body.dataset.page = 'admin';

  onPlaylistUpdate = renderAdminPlaylist;
  onBannedUpdate = renderBannedSongs;
  onPresenceUpdate = (count) => {
    const el = document.getElementById('stat-online');
    if (el) el.textContent = count;
  };
  onSettingsUpdate = updateAdminStaffControls;

  await loadBannedSongs();
  await loadPlaylist();
  await loadAppSettings();
  initRealtime();
  initSearch('search-results', addSongAsAdmin);

  if (appSettings && appSettings.staff_page) {
    updateAdminStaffControls(appSettings);
  }

  // Carica statistiche di vita del DB
  refreshDbVitals();
});

// --- Aggiunta brano come Admin ---
async function addSongAsAdmin(trackData) {
  try {
    const { error } = await supabaseClient.rpc('admin_add_song', {
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null
    });
    if (error) {
      showToast('Errore nell\'aggiunta del brano', 'error');
      return;
    }
    showToast('Brano aggiunto 🎵', 'success');
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const searchResults = document.getElementById('search-results');
    if (searchResults) searchResults.innerHTML = '';
    refreshDbVitals();
  } catch (err) {
    showToast('Errore nell\'aggiunta', 'error');
  }
}

// --- Render Admin Playlist ---
function renderAdminPlaylist(playlist) {
  const container = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  const statSongs = document.getElementById('stat-songs');
  const statGenres = document.getElementById('stat-genres');

  if (countEl) countEl.textContent = playlist.length;
  if (statSongs) statSongs.textContent = playlist.length;

  if (statGenres) {
    const genres = new Set(playlist.map(s => s.genre).filter(Boolean));
    statGenres.textContent = genres.size;
  }

  if (!container) return;

  if (playlist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎶</div>
        <p>Nessun brano nella playlist</p>
      </div>
    `;
    if (sortableInstance) { sortableInstance.destroy(); sortableInstance = null; }
    return;
  }

  container.innerHTML = playlist.map((song, index) => {
    const isPlayed = !!song.played_at;
    const hasNotes = !!(song.notes && song.notes.trim());
    return `
      <div class="playlist-item ${isPlayed ? 'played' : ''}" data-id="${song.id}" style="${isPlayed ? 'opacity: 0.65; border: 1px dashed rgba(255,255,255,0.25);' : ''}">
        <span class="drag-handle" title="Trascina per riordinare" style="${isPlayed ? 'visibility: hidden;' : ''}">${ICONS.drag}</span>
        <span class="song-position">${isPlayed ? '✓' : index + 1}</span>
        ${renderSongArtwork(song.album_art_url)}
        <div class="song-info">
          <div class="song-title">
            ${escapeHtml(song.title)}
            ${renderStaffBadge(song)}
            ${isPlayed ? '<span class="played-indicator">✓ Suonato</span>' : ''}
          </div>
          <div class="song-artist">${escapeHtml(song.artist)}</div>
          ${song.genre ? `<span class="song-genre">${escapeHtml(song.genre)}</span>` : ''}
        </div>
        <div class="song-actions">
          <!-- Pulsante Note (presente sia su brani in coda sia su quelli già suonati) -->
          <button class="btn btn-icon ${hasNotes ? 'btn-note-active' : 'btn-ghost'} btn-sm" 
                  onclick="openNotesModal('${song.id}')" 
                  title="${hasNotes ? 'Note: ' + escapeHtml(song.notes) : 'Aggiungi nota privata'}">
            ${ICONS.note}
          </button>
          ${!isPlayed ? `
            <button class="btn btn-icon btn-ghost btn-sm" onclick="openAdminEditModal('${song.id}')" title="Modifica brano">
              ${ICONS.edit}
            </button>
          ` : ''}
          <button class="btn btn-icon btn-danger btn-sm" onclick="adminDeleteSong('${song.id}')" title="Elimina brano">
            ${ICONS.delete}
          </button>
          <button class="btn btn-icon btn-warning btn-sm" onclick="openBanModal('${song.id}')" title="Banna brano">
            ${ICONS.ban}
          </button>
        </div>
      </div>
    `;
  }).join('');

  initAdminSortable();
}

// --- Sortable (permette al sysadmin di mescolare qualsiasi brano) ---
function initAdminSortable() {
  const container = document.getElementById('playlist-list');
  if (!container) return;
  if (sortableInstance) sortableInstance.destroy();

  sortableInstance = new Sortable(container, {
    animation: 200,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      await saveAdminOrder();
    }
  });
}

async function saveAdminOrder() {
  const container = document.getElementById('playlist-list');
  if (!container) return;
  const items = container.querySelectorAll('.playlist-item');
  const songIds = [];
  const positions = [];
  items.forEach((item, index) => {
    songIds.push(item.dataset.id);
    positions.push(index + 1);
  });

  try {
    const { error } = await supabaseClient.rpc('dj_reorder_songs', {
      p_song_ids: songIds,
      p_positions: positions
    });
    if (error) {
      showToast('Errore nel riordino', 'error');
      await loadPlaylist();
      return;
    }
    items.forEach((item, index) => {
      const posEl = item.querySelector('.song-position');
      if (posEl && !item.classList.contains('played')) {
        posEl.textContent = index + 1;
      }
    });
    showToast('Ordine aggiornato', 'success');
  } catch (err) {
    showToast('Errore nel riordino', 'error');
    await loadPlaylist();
  }
}

// --- Modale Note per Brano (Note Private SysAdmin) ---
function openNotesModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;

  const overlay = document.getElementById('notes-modal-overlay');
  const songIdInput = document.getElementById('notes-song-id');
  const displayEl = document.getElementById('notes-song-display');
  const textarea = document.getElementById('song-notes-text');

  if (songIdInput) songIdInput.value = songId;
  if (displayEl) {
    displayEl.textContent = `${song.title} — ${song.artist}${isStaffSong(song) ? ' (Staff)' : ''}`;
  }
  if (textarea) {
    textarea.value = song.notes || '';
  }

  if (overlay) overlay.classList.add('active');
  setTimeout(() => { if (textarea) textarea.focus(); }, 100);
}

function closeNotesModal() {
  const overlay = document.getElementById('notes-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function saveSongNotes() {
  const songId = document.getElementById('notes-song-id').value;
  const textarea = document.getElementById('song-notes-text');
  if (!songId || !textarea) return;

  const notesText = textarea.value.trim();

  try {
    // Prova prima con RPC dedicata
    const { error } = await supabaseClient.rpc('admin_update_song_notes', {
      p_song_id: songId,
      p_notes: notesText || null
    });

    if (error) {
      // Fallback a UPDATE diretto
      const { error: directError } = await supabaseClient
        .from('playlist')
        .update({ notes: notesText || null })
        .eq('id', songId);

      if (directError) {
        if (directError.message && directError.message.includes('notes')) {
          showToast('Colonna "notes" non presente nel DB. Esegui la migrazione SQL in supabase/', 'error');
        } else {
          showToast('Errore nel salvataggio della nota', 'error');
        }
        return;
      }
    }

    // Aggiorna localmente
    const song = currentPlaylist.find(s => s.id === songId);
    if (song) {
      song.notes = notesText || null;
      renderAdminPlaylist(currentPlaylist);
    }

    showToast('Nota salvata 📝', 'success');
    closeNotesModal();
  } catch (err) {
    console.error('Errore salvataggio nota:', err);
    showToast('Errore nel salvataggio della nota', 'error');
  }
}

// --- Gestione Portale Staff (Abilitazione/Disabilitazione e Messaggio) ---
function updateAdminStaffControls(settings) {
  const staffConfig = settings?.staff_page;
  const statusBadge = document.getElementById('staff-control-status-badge');
  const statusText = document.getElementById('staff-status-text');
  const msgDisplay = document.getElementById('staff-control-message-display');

  if (!statusBadge || !statusText) return;

  if (staffConfig && staffConfig.enabled === false) {
    statusBadge.className = 'staff-control-status disabled';
    statusText.textContent = 'Disattivato (Chiuso)';
    if (msgDisplay) {
      msgDisplay.style.display = 'block';
      msgDisplay.textContent = `Messaggio visualizzato allo staff: "${staffConfig.disabled_reason || 'Nessun messaggio specificato'}"`;
    }
  } else {
    statusBadge.className = 'staff-control-status active';
    statusText.textContent = 'Attivo (Aperto)';
    if (msgDisplay) {
      msgDisplay.style.display = 'none';
      msgDisplay.textContent = '';
    }
  }
}

function openStaffSettingsModal() {
  const overlay = document.getElementById('staff-settings-modal-overlay');
  const checkbox = document.getElementById('staff-enabled-checkbox');
  const textarea = document.getElementById('staff-disabled-message-textarea');

  const staffConfig = appSettings?.staff_page || { enabled: true, disabled_reason: '' };

  if (checkbox) checkbox.checked = staffConfig.enabled !== false;
  if (textarea) textarea.value = staffConfig.disabled_reason || '';

  if (overlay) overlay.classList.add('active');
}

function closeStaffSettingsModal() {
  const overlay = document.getElementById('staff-settings-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function saveStaffSettings() {
  const checkbox = document.getElementById('staff-enabled-checkbox');
  const textarea = document.getElementById('staff-disabled-message-textarea');

  const enabled = checkbox ? checkbox.checked : true;
  const reason = textarea ? textarea.value.trim() : '';

  try {
    // 1. Prova RPC set_staff_status
    const { error } = await supabaseClient.rpc('set_staff_status', {
      p_enabled: enabled,
      p_reason: reason
    });

    if (error) {
      // 2. Fallback a tabella app_settings diretta
      const { error: directErr } = await supabaseClient
        .from('app_settings')
        .upsert({
          key: 'staff_page',
          value: { enabled, disabled_reason: reason },
          updated_at: new Date().toISOString()
        });

      if (directErr) {
        console.warn('Tabella app_settings non presente, salvo in locale:', directErr);
        localStorage.setItem('mdp_staff_page_settings', JSON.stringify({ enabled, disabled_reason: reason }));
      }
    }

    appSettings.staff_page = { enabled, disabled_reason: reason };
    updateAdminStaffControls(appSettings);
    closeStaffSettingsModal();
    showToast(enabled ? 'Portale Staff attivato 🛡️' : 'Portale Staff disattivato ⏸️', 'success');
  } catch (err) {
    console.error('Errore impostazione staff:', err);
    showToast('Errore nel salvataggio impostazioni', 'error');
  }
}

// --- Admin Sostituzione Brano ---
let adminEditSearchTimeout = null;
let adminEditSearchAbort = null;

function openAdminEditModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;

  const overlay = document.getElementById('edit-modal-overlay');
  const songIdInput = document.getElementById('edit-song-id');
  const currentSongDisplay = document.getElementById('edit-current-song');
  const searchInput = document.getElementById('edit-search-input');
  const searchResults = document.getElementById('edit-search-results');

  if (songIdInput) songIdInput.value = songId;
  if (currentSongDisplay) currentSongDisplay.textContent = `Brano attuale: ${song.title} — ${song.artist}`;
  if (searchInput) searchInput.value = '';
  if (searchResults) searchResults.innerHTML = '';
  if (overlay) overlay.classList.add('active');

  setTimeout(() => { if (searchInput) searchInput.focus(); }, 100);

  if (searchInput) {
    const newInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newInput, searchInput);

    newInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(adminEditSearchTimeout);
      const resContainer = document.getElementById('edit-search-results');
      if (query.length < 2) {
        if (adminEditSearchAbort) { adminEditSearchAbort.abort(); adminEditSearchAbort = null; }
        if (resContainer) resContainer.innerHTML = '';
        return;
      }
      adminEditSearchTimeout = setTimeout(() => performAdminEditSearch(query), 300);
    });
  }
}

async function performAdminEditSearch(query) {
  const resultsContainer = document.getElementById('edit-search-results');
  if (!resultsContainer) return;

  if (adminEditSearchAbort) adminEditSearchAbort.abort();
  adminEditSearchAbort = new AbortController();

  resultsContainer.innerHTML = '<div class="search-loading">Ricerca in corso...</div>';

  try {
    const response = await fetch(`${SEARCH_FUNCTION_URL}?q=${encodeURIComponent(query)}&limit=10`, {
      signal: adminEditSearchAbort.signal,
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      resultsContainer.innerHTML = '<div class="search-loading">Nessun risultato trovato</div>';
      return;
    }

    resultsContainer.innerHTML = result.data.map(track => {
      const coverUrl = track.album?.cover_small || track.album?.cover_medium || '';
      const trackData = JSON.stringify({
        id: String(track.id),
        title: track.title,
        artist: track.artist?.name || 'Sconosciuto',
        genre: track.genre_id ? (DEEZER_GENRES[track.genre_id] || '') : '',
        album_art: track.album?.cover_medium || coverUrl
      }).replace(/'/g, '&#39;');

      return `
        <div class="search-result-card" 
             data-track='${trackData}' 
             onclick="handleAdminEditCardClick(this)"
             role="button"
             tabindex="0"
             title="Clicca per sostituire con questo brano">
          ${coverUrl 
            ? `<img src="${coverUrl}" alt="" loading="lazy">` 
            : `<div class="song-artwork-fallback">${ICONS.music}</div>`
          }
          <div class="result-info">
            <div class="result-title">${escapeHtml(track.title)}</div>
            <div class="result-artist">${escapeHtml(track.artist?.name || 'Sconosciuto')}</div>
          </div>
          <button class="btn btn-sm btn-primary btn-add" tabindex="-1">✏️ Sostituisci</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    if (error.name === 'AbortError') return;
    resultsContainer.innerHTML = '<div class="search-loading">Errore nella ricerca. Riprova.</div>';
  } finally {
    adminEditSearchAbort = null;
  }
}

async function handleAdminEditCardClick(card) {
  card.classList.add('card-selected');
  const songId = document.getElementById('edit-song-id').value;
  if (!songId) return;

  try {
    const trackData = JSON.parse(card.dataset.track);
    const { error } = await supabaseClient.rpc('admin_update_song', {
      p_song_id: songId,
      p_title: trackData.title,
      p_artist: trackData.artist,
      p_genre: trackData.genre || null,
      p_album_art_url: trackData.album_art || null,
      p_deezer_id: trackData.id || null
    });

    if (error) { showToast('Errore nella sostituzione', 'error'); return; }
    showToast('Brano sostituito ✏️', 'success');
    closeEditModal();
  } catch (err) {
    showToast('Errore nella sostituzione', 'error');
  }
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('active');
}

// --- Admin Eliminazione Brano ---
let adminSongToDelete = null;

function adminDeleteSong(songId) {
  adminSongToDelete = songId;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.add('active');
  
  const confirmBtn = document.getElementById('admin-confirm-delete-btn');
  if (confirmBtn) {
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', executeAdminDelete);
  }
}

function closeAdminConfirmModal() {
  adminSongToDelete = null;
  const overlay = document.getElementById('confirm-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function executeAdminDelete() {
  if (!adminSongToDelete) return;
  const songId = adminSongToDelete;
  closeAdminConfirmModal();

  const item = document.querySelector(`.playlist-item[data-id="${songId}"]`);
  if (item) item.style.display = 'none';

  try {
    const { error } = await supabaseClient.rpc('admin_delete_song', { p_song_id: songId });
    if (error) { 
      if (item) item.style.display = '';
      showToast('Errore nell\'eliminazione', 'error'); 
      return; 
    }
    if (item) item.remove();
    showToast('Brano eliminato 🗑️', 'success');
    refreshDbVitals();
  } catch (err) {
    if (item) item.style.display = '';
    showToast('Errore nell\'eliminazione', 'error');
  }
}

// --- Svuota Playlist (Risoluzione bug con WHERE id IS NOT NULL e fallback) ---
async function clearPlaylist() {
  if (!confirm('⚠️ Sei sicuro di voler svuotare TUTTA la playlist? Questa azione eliminerà tutti i brani correnti e non può essere annullata.')) {
    return;
  }

  try {
    // 1. Prova prima con la funzione RPC admin_clear_playlist
    const { error: rpcError } = await supabaseClient.rpc('admin_clear_playlist');

    if (rpcError) {
      console.warn('RPC admin_clear_playlist ha restituito errore (safeupdate o non aggiornata). Tento DELETE REST diretto:', rpcError);
      
      // 2. Fallback diretto con clausola WHERE (evita il safeupdate check di Supabase)
      const { error: directError } = await supabaseClient
        .from('playlist')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (directError) {
        console.error('Anche la cancellazione diretta è fallita:', directError);
        showToast('Errore nello svuotamento della playlist: ' + (directError.message || 'riprova'), 'error');
        return;
      }
    }

    currentPlaylist = [];
    renderAdminPlaylist([]);
    showToast('Playlist svuotata con successo 🗑️', 'success');
    refreshDbVitals();
  } catch (err) {
    console.error('Errore clearPlaylist:', err);
    showToast('Errore nello svuotamento della playlist', 'error');
  }
}

// --- Esporta CSV (include colonna Note, Stato e Richiesto da) ---
function exportCSV() {
  if (currentPlaylist.length === 0) {
    showToast('La playlist è vuota', 'error');
    return;
  }

  const headers = ['Posizione', 'Titolo', 'Artista', 'Genere', 'Data Aggiunta', 'Stato', 'Richiesto da', 'Note Private'];
  const rows = currentPlaylist.map((song, index) => [
    index + 1,
    `"${(song.title || '').replace(/"/g, '""')}"`,
    `"${(song.artist || '').replace(/"/g, '""')}"`,
    `"${(song.genre || '').replace(/"/g, '""')}"`,
    `"${new Date(song.created_at).toLocaleString('it-IT')}"`,
    song.played_at ? '"Suonato"' : '"In attesa"',
    isStaffSong(song) ? '"Staff"' : '"Pubblico"',
    `"${(song.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // BOM per Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `playlist_mdp_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV esportato con successo 📥', 'success');
}

// --- Ban Brano ---
function openBanModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;
  document.getElementById('ban-song-title').value = song.title;
  document.getElementById('ban-song-artist').value = song.artist;
  document.getElementById('ban-song-deezer-id').value = song.deezer_id || '';
  document.getElementById('ban-song-display').textContent = `${song.title} — ${song.artist}`;
  document.getElementById('ban-reason').value = '';
  document.getElementById('ban-modal-overlay').classList.add('active');
}

function closeBanModal() {
  document.getElementById('ban-modal-overlay').classList.remove('active');
}

async function confirmBan() {
  const title = document.getElementById('ban-song-title').value;
  const artist = document.getElementById('ban-song-artist').value;
  const deezerId = document.getElementById('ban-song-deezer-id').value;
  const reason = document.getElementById('ban-reason').value.trim();

  try {
    const { error } = await supabaseClient.rpc('admin_ban_song', {
      p_title: title,
      p_artist: artist,
      p_deezer_id: deezerId || null,
      p_reason: reason || null
    });
    if (error) { showToast('Errore nel ban del brano', 'error'); return; }
    showToast('Brano bannato 🚫', 'success');
    closeBanModal();
    refreshDbVitals();
  } catch (err) {
    showToast('Errore nel ban', 'error');
  }
}

// --- Render Brani Bannati ---
function renderBannedSongs(banned) {
  const container = document.getElementById('banned-list');
  const statBanned = document.getElementById('stat-banned');
  if (statBanned) statBanned.textContent = banned.length;
  if (!container) return;

  if (banned.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Nessun brano bannato</p></div>';
    return;
  }

  container.innerHTML = banned.map(song => `
    <div class="banned-item" data-id="${song.id}">
      <div class="banned-info">
        <div class="banned-title">${escapeHtml(song.title)}</div>
        <div class="banned-artist">${escapeHtml(song.artist)}</div>
        ${song.reason ? `<div class="banned-reason">Motivo: ${escapeHtml(song.reason)}</div>` : ''}
      </div>
      <button class="btn btn-sm btn-ghost" onclick="unbanSong('${song.id}')">↩️ Sblocca</button>
    </div>
  `).join('');
}

async function unbanSong(banId) {
  try {
    const { error } = await supabaseClient.rpc('admin_unban_song', { p_ban_id: banId });
    if (error) { showToast('Errore nello sblocco', 'error'); return; }
    showToast('Brano sbloccato ↩️', 'success');
    refreshDbVitals();
  } catch (err) {
    showToast('Errore nello sblocco', 'error');
  }
}

// --- Stato e Vitali del Database (DB Life & Health Metrics) ---
async function refreshDbVitals() {
  const pingEl = document.getElementById('vital-ping');
  const pingStatusEl = document.getElementById('vital-ping-status');
  const dbSizeEl = document.getElementById('vital-db-size');
  const tableSizeEl = document.getElementById('vital-table-size');
  const staffRatioEl = document.getElementById('vital-staff-ratio');
  const ratioDetailEl = document.getElementById('vital-ratio-detail');
  const syncTimeEl = document.getElementById('vital-sync-time');
  const pgVersionEl = document.getElementById('vital-pg-version');
  const totalSongsEl = document.getElementById('vital-total-songs');
  const playedSongsEl = document.getElementById('vital-played-songs');
  const playedPctEl = document.getElementById('vital-played-pct');

  if (syncTimeEl) {
    syncTimeEl.textContent = `Ultimo sync: ${new Date().toLocaleTimeString('it-IT')}`;
  }

  // 1. Calcolo Latenza Ping Supabase
  try {
    const t0 = performance.now();
    await supabaseClient.from('playlist').select('id', { count: 'exact', head: true });
    const pingMs = Math.round(performance.now() - t0);

    if (pingEl) pingEl.textContent = `${pingMs} ms`;
    if (pingStatusEl) {
      if (pingMs < 120) {
        pingStatusEl.textContent = '🟢 Connessione eccellente';
        pingStatusEl.style.color = '#22c55e';
      } else if (pingMs < 300) {
        pingStatusEl.textContent = '🟡 Connessione buona';
        pingStatusEl.style.color = '#f59e0b';
      } else {
        pingStatusEl.textContent = '🟠 Connessione lenta';
        pingStatusEl.style.color = '#f97316';
      }
    }
  } catch (e) {
    if (pingEl) pingEl.textContent = 'Errore';
    if (pingStatusEl) pingStatusEl.textContent = '🔴 Server non raggiungibile';
  }

  // 2. Calcolo metriche da dati attuali
  const totalInDb = currentPlaylist.length;
  const staffSongsCount = currentPlaylist.filter(s => isStaffSong(s)).length;
  const publicSongsCount = totalInDb - staffSongsCount;
  const playedSongsCount = currentPlaylist.filter(s => s.played_at).length;
  const playedPct = totalInDb > 0 ? Math.round((playedSongsCount / totalInDb) * 100) : 0;
  const staffPct = totalInDb > 0 ? Math.round((staffSongsCount / totalInDb) * 100) : 0;

  if (totalSongsEl) totalSongsEl.textContent = totalInDb;
  if (playedSongsEl) playedSongsEl.textContent = playedSongsCount;
  if (playedPctEl) playedPctEl.textContent = `${playedPct}%`;
  if (staffRatioEl) staffRatioEl.textContent = `${staffPct}% Staff`;
  if (ratioDetailEl) ratioDetailEl.textContent = `${staffSongsCount} staff / ${publicSongsCount} pubblico`;

  // 3. Prova RPC avanzata admin_get_db_vitals se disponibile
  try {
    const { data: vitals, error } = await supabaseClient.rpc('admin_get_db_vitals');
    if (!error && vitals) {
      if (dbSizeEl && vitals.db_size) dbSizeEl.textContent = vitals.db_size;
      if (tableSizeEl && vitals.playlist_table_size) {
        tableSizeEl.textContent = `Tabella playlist: ${vitals.playlist_table_size}`;
      }
      if (pgVersionEl && vitals.postgres_version) {
        pgVersionEl.textContent = vitals.postgres_version;
      }
    } else {
      // Fallback informativo se l'RPC non è ancora stata creata
      if (dbSizeEl) dbSizeEl.textContent = '~' + Math.max(1, Math.round(totalInDb * 0.4)) + ' KB (stimati)';
      if (tableSizeEl) tableSizeEl.textContent = `${totalInDb} righe in playlist`;
      if (pgVersionEl) pgVersionEl.textContent = 'PostgreSQL (Supabase Cloud)';
    }
  } catch (e) {
    if (dbSizeEl) dbSizeEl.textContent = 'Disponibile via SQL';
  }
}
