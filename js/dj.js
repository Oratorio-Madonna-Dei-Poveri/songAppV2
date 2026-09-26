// =============================================
// MdP SongApp - Logica Pagina DJ
// =============================================

let sortableInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.body.dataset.page = 'dj';

  onPlaylistUpdate = renderDJPlaylist;

  await loadPlaylist();
  initRealtime();
});

function renderDJPlaylist(playlist) {
  const container = document.getElementById('playlist-list');
  const countEl = document.getElementById('playlist-count');
  if (!container) return;

  if (countEl) countEl.textContent = playlist.length;

  if (playlist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎶</div>
        <p>Nessun brano nella playlist</p>
        <p>In attesa di richieste...</p>
      </div>
    `;
    if (sortableInstance) {
      sortableInstance.destroy();
      sortableInstance = null;
    }
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
      </div>
      <div class="song-actions">
        <button class="btn btn-success btn-sm" onclick="markAsPlayed('${song.id}')">
          ✅ Suonato
        </button>
      </div>
    </div>
  `).join('');

  initSortable();
}

function initSortable() {
  const container = document.getElementById('playlist-list');
  if (!container) return;

  if (sortableInstance) {
    sortableInstance.destroy();
  }

  sortableInstance = new Sortable(container, {
    animation: 200,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return;
      await saveNewOrder();
    }
  });
}

async function saveNewOrder() {
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
      await loadPlaylist(); // Resync
      return;
    }

    // Update local positions
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

async function markAsPlayed(songId) {
  try {
    const { error } = await supabaseClient.rpc('dj_delete_song', {
      p_song_id: songId
    });

    if (error) {
      showToast('Errore nella rimozione del brano', 'error');
      return;
    }

    showToast('Brano rimosso dalla playlist ✅', 'success');
  } catch (err) {
    showToast('Errore nella rimozione', 'error');
  }
}
