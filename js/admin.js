// =============================================
// MdP SongApp - Logica Pagina Admin
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

  await loadBannedSongs();
  await loadPlaylist();
  initRealtime();
  initSearch('search-results', addSongAsAdmin);
});

// --- Add song as admin ---
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
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
  } catch (err) {
    showToast('Errore nell\'aggiunta', 'error');
  }
}

// --- Render admin playlist ---
function renderAdminPlaylist(playlist) {
  const container = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  const statSongs = document.getElementById('stat-songs');
  const statGenres = document.getElementById('stat-genres');

  if (countEl) countEl.textContent = playlist.length;
  if (statSongs) statSongs.textContent = playlist.length;

  // Count unique genres
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

  container.innerHTML = playlist.map((song, index) => `
    <div class="playlist-item" data-id="${song.id}">
      <span class="drag-handle" title="Trascina per riordinare">☰</span>
      <span class="song-position">${index + 1}</span>
      ${song.album_art_url
        ? `<img class="song-artwork" src="${song.album_art_url}" alt="" loading="lazy">`
        : '<div class="song-artwork" style="background:#333;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🎵</div>'
      }
      <div class="song-info">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
        ${song.genre ? `<span class="song-genre">${escapeHtml(song.genre)}</span>` : ''}
      </div>
      <div class="song-actions">
        <button class="btn btn-icon btn-ghost btn-sm" onclick="openAdminEditModal('${song.id}')" title="Modifica">✏️</button>
        <button class="btn btn-icon btn-danger btn-sm" onclick="adminDeleteSong('${song.id}')" title="Elimina">🗑️</button>
        <button class="btn btn-icon btn-warning btn-sm" onclick="openBanModal('${song.id}')" title="Banna">🚫</button>
      </div>
    </div>
  `).join('');

  initAdminSortable();
}

// --- Sortable ---
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
    // Admin uses dj_reorder_songs (same function)
    const { error } = await supabaseClient.rpc('dj_reorder_songs', {
      p_song_ids: songIds,
      p_positions: positions
    });
    if (error) { showToast('Errore nel riordino', 'error'); await loadPlaylist(); return; }
    items.forEach((item, index) => {
      const posEl = item.querySelector('.song-position');
      if (posEl) posEl.textContent = index + 1;
    });
    showToast('Ordine aggiornato', 'success');
  } catch (err) {
    showToast('Errore nel riordino', 'error');
    await loadPlaylist();
  }
}

// --- Admin Edit ---
function openAdminEditModal(songId) {
  const song = currentPlaylist.find(s => s.id === songId);
  if (!song) return;
  document.getElementById('edit-song-id').value = songId;
  document.getElementById('edit-title').value = song.title;
  document.getElementById('edit-artist').value = song.artist;
  document.getElementById('edit-genre').value = song.genre || '';
  document.getElementById('edit-modal-overlay').classList.add('active');
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('active');
}

async function saveAdminEdit() {
  const songId = document.getElementById('edit-song-id').value;
  const title = document.getElementById('edit-title').value.trim();
  const artist = document.getElementById('edit-artist').value.trim();
  const genre = document.getElementById('edit-genre').value.trim();

  if (!title || !artist) { showToast('Titolo e artista sono obbligatori', 'error'); return; }

  try {
    const { error } = await supabaseClient.rpc('admin_update_song', {
      p_song_id: songId,
      p_title: title,
      p_artist: artist,
      p_genre: genre || null
    });
    if (error) { showToast('Errore nella modifica', 'error'); return; }
    showToast('Brano modificato ✏️', 'success');
    closeEditModal();
  } catch (err) {
    showToast('Errore nella modifica', 'error');
  }
}

// --- Admin Delete ---
async function adminDeleteSong(songId) {
  if (!confirm('Sei sicuro di voler eliminare questo brano?')) return;
  try {
    const { error } = await supabaseClient.rpc('admin_delete_song', { p_song_id: songId });
    if (error) { showToast('Errore nell\'eliminazione', 'error'); return; }
    showToast('Brano eliminato 🗑️', 'success');
  } catch (err) {
    showToast('Errore nell\'eliminazione', 'error');
  }
}

// --- Clear Playlist ---
async function clearPlaylist() {
  if (!confirm('⚠️ Sei sicuro di voler svuotare TUTTA la playlist? Questa azione non può essere annullata.')) return;
  try {
    const { error } = await supabaseClient.rpc('admin_clear_playlist');
    if (error) { showToast('Errore nello svuotamento', 'error'); return; }
    showToast('Playlist svuotata 🗑️', 'success');
  } catch (err) {
    showToast('Errore nello svuotamento', 'error');
  }
}

// --- Export CSV ---
function exportCSV() {
  if (currentPlaylist.length === 0) {
    showToast('La playlist è vuota', 'error');
    return;
  }

  const headers = ['Posizione', 'Titolo', 'Artista', 'Genere', 'Data Aggiunta'];
  const rows = currentPlaylist.map((song, index) => [
    index + 1,
    `"${(song.title || '').replace(/"/g, '""')}"`,
    `"${(song.artist || '').replace(/"/g, '""')}"`,
    `"${(song.genre || '').replace(/"/g, '""')}"`,
    `"${new Date(song.created_at).toLocaleString('it-IT')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `playlist_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV esportato 📥', 'success');
}

// --- Ban Song ---
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
  } catch (err) {
    showToast('Errore nel ban', 'error');
  }
}

// --- Render Banned Songs ---
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
  } catch (err) {
    showToast('Errore nello sblocco', 'error');
  }
}
