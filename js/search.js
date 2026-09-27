// =============================================
// MdP SongApp - Modulo Ricerca Brani (Ottimizzato)
// =============================================

let searchTimeout = null;
let searchResultsContainer = null;
let onSongSelected = null;
let currentSearchAbortController = null;
const searchCache = new Map(); // Cache per ricerche recenti

function initSearch(resultsContainerId, songSelectedCallback) {
  searchResultsContainer = document.getElementById(resultsContainerId);
  onSongSelected = songSelectedCallback;

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(searchTimeout);

      if (query.length < 2) {
        if (currentSearchAbortController) {
          currentSearchAbortController.abort();
          currentSearchAbortController = null;
        }
        if (searchResultsContainer) searchResultsContainer.innerHTML = '';
        return;
      }

      searchTimeout = setTimeout(() => performSearch(query), 300);
    });
  }
}

async function performSearch(query) {
  if (!searchResultsContainer) return;

  const cacheKey = query.toLowerCase();
  if (searchCache.has(cacheKey)) {
    renderSearchResults(searchCache.get(cacheKey));
    return;
  }

  // Annulla eventuale ricerca precedente ancora in corso
  if (currentSearchAbortController) {
    currentSearchAbortController.abort();
  }
  currentSearchAbortController = new AbortController();

  searchResultsContainer.innerHTML = '<div class="search-loading">Ricerca in corso...</div>';

  try {
    const response = await fetch(`${SEARCH_FUNCTION_URL}?q=${encodeURIComponent(query)}&limit=15`, {
      signal: currentSearchAbortController.signal,
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      searchResultsContainer.innerHTML = '<div class="search-loading">Nessun risultato trovato</div>';
      return;
    }

    // Salva in cache (limite 30 query)
    if (searchCache.size > 30) {
      const firstKey = searchCache.keys().next().value;
      searchCache.delete(firstKey);
    }
    searchCache.set(cacheKey, result.data);

    renderSearchResults(result.data);
  } catch (error) {
    if (error.name === 'AbortError') return; // Richiesta annullata, normale
    console.error('Errore nella ricerca:', error);
    searchResultsContainer.innerHTML = '<div class="search-loading">Errore nella ricerca. Riprova.</div>';
  } finally {
    currentSearchAbortController = null;
  }
}

function renderSearchResults(tracks) {
  if (!searchResultsContainer) return;

  searchResultsContainer.innerHTML = tracks.map(track => {
    const banned = isSongBanned(String(track.id));
    const coverUrl = track.album?.cover_small || track.album?.cover_medium || '';
    const trackPayload = JSON.stringify({
      id: String(track.id),
      title: track.title,
      artist: track.artist?.name || 'Sconosciuto',
      genre: track.genre_id ? (DEEZER_GENRES[track.genre_id] || '') : '',
      album_art: track.album?.cover_medium || coverUrl
    }).replace(/'/g, '&#39;');

    return `
      <div class="search-result-card ${banned ? 'banned' : ''}" 
           data-track='${trackPayload}'
           onclick="handleSongCardClick(this, event)"
           role="button"
           tabindex="${banned ? '-1' : '0'}"
           title="${banned ? 'Brano bannato' : 'Clicca per aggiungere alla playlist'}">
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
          : '<button class="btn btn-sm btn-primary btn-add" tabindex="-1">＋ Aggiungi</button>'
        }
      </div>
    `;
  }).join('');
}

// Click su QUALSIASI punto della scheda del brano per aggiungerlo
function handleSongCardClick(card, event) {
  if (card.classList.contains('banned')) return;

  // Effetto visivo di selezione istantaneo
  card.classList.add('card-selected');

  try {
    const trackData = JSON.parse(card.dataset.track);
    if (onSongSelected) {
      onSongSelected(trackData);
    }
  } catch (e) {
    console.error('Errore nel parsing del brano:', e);
  }
}

// Mappatura generi Deezer
const DEEZER_GENRES = {
  0: 'Altro', 85: 'Alternativo', 116: 'Rap/Hip Hop', 152: 'Pop',
  113: 'Dance', 165: 'R&B', 132: 'Rock', 106: 'Electro',
  84: 'Country', 98: 'Jazz', 95: 'Kids', 81: 'Blues',
  129: 'Soul/Funk', 169: 'Classical', 173: 'Film/Giochi',
  75: 'Reggae', 464: 'Metal', 466: 'Latino', 2: 'Musica Italiana'
};
