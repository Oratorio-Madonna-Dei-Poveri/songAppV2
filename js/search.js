// =============================================
// MdP SongApp - Modulo Ricerca Brani
// =============================================

let searchTimeout = null;
let searchResultsContainer = null;
let onSongSelected = null; // callback when user clicks add on a search result

function initSearch(resultsContainerId, songSelectedCallback) {
  searchResultsContainer = document.getElementById(resultsContainerId);
  onSongSelected = songSelectedCallback;

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(searchTimeout);

      if (query.length < 2) {
        if (searchResultsContainer) searchResultsContainer.innerHTML = '';
        return;
      }

      searchTimeout = setTimeout(() => performSearch(query), 350);
    });
  }
}

async function performSearch(query) {
  if (!searchResultsContainer) return;

  searchResultsContainer.innerHTML = '<div class="search-loading">Ricerca in corso...</div>';

  try {
    const response = await fetch(`${SEARCH_FUNCTION_URL}?q=${encodeURIComponent(query)}&limit=15`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      searchResultsContainer.innerHTML = '<div class="search-loading">Nessun risultato trovato</div>';
      return;
    }

    renderSearchResults(result.data);
  } catch (error) {
    console.error('Errore nella ricerca:', error);
    searchResultsContainer.innerHTML = '<div class="search-loading">Errore nella ricerca. Riprova.</div>';
  }
}

function renderSearchResults(tracks) {
  if (!searchResultsContainer) return;

  searchResultsContainer.innerHTML = tracks.map(track => {
    const banned = isSongBanned(String(track.id));
    return `
      <div class="search-result-card ${banned ? 'banned' : ''}" data-track='${JSON.stringify({
        id: String(track.id),
        title: track.title,
        artist: track.artist.name,
        genre: track.genre_id ? (DEEZER_GENRES[track.genre_id] || '') : '',
        album_art: track.album.cover_medium || track.album.cover_small || ''
      }).replace(/'/g, '&apos;')}'>
        <img src="${track.album.cover_small || track.album.cover_medium || ''}" alt="" loading="lazy">
        <div class="result-info">
          <div class="result-title">${escapeHtml(track.title)}</div>
          <div class="result-artist">${escapeHtml(track.artist.name)}</div>
        </div>
        ${banned
          ? '<span class="btn btn-sm btn-ghost" disabled>🚫 Bannato</span>'
          : '<button class="btn btn-sm btn-primary btn-add" onclick="handleAddSong(this)">＋ Aggiungi</button>'
        }
      </div>
    `;
  }).join('');
}

// Deezer genre ID mapping (common genres)
const DEEZER_GENRES = {
  0: 'Altro', 85: 'Alternativo', 116: 'Rap/Hip Hop', 152: 'Pop',
  113: 'Dance', 165: 'R&B', 132: 'Rock', 106: 'Electro',
  84: 'Country', 98: 'Jazz', 95: 'Kids', 81: 'Blues',
  129: 'Soul/Funk', 169: 'Classical', 173: 'Film/Giochi',
  75: 'Reggae', 464: 'Metal', 466: 'Latino', 2: 'Musica Italiana'
};

function handleAddSong(button) {
  const card = button.closest('.search-result-card');
  if (!card) return;
  try {
    const trackData = JSON.parse(card.dataset.track);
    if (onSongSelected) onSongSelected(trackData);
  } catch (e) {
    console.error('Errore nel parsing dei dati del brano:', e);
  }
}

