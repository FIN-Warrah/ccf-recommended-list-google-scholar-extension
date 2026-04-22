/**
 * CCF Rank - Popup Script
 * Provides quick venue search and displays database stats.
 */

(function () {
  'use strict';

  // Calculate stats from the embedded data
  function calculateStats() {
    let countA = 0, countB = 0, countC = 0;
    for (const key of Object.keys(CCF_ABBR_LOOKUP)) {
      const entry = CCF_ABBR_LOOKUP[key];
      if (entry.level === 'A') countA++;
      else if (entry.level === 'B') countB++;
      else if (entry.level === 'C') countC++;
    }
    return { A: countA, B: countB, C: countC };
  }

  // Update stats display
  const stats = calculateStats();
  document.getElementById('count-a').textContent = stats.A;
  document.getElementById('count-b').textContent = stats.B;
  document.getElementById('count-c').textContent = stats.C;

  // Search functionality
  const searchInput = document.getElementById('search-input');
  const searchResult = document.getElementById('search-result');

  function search(query) {
    if (!query || query.length < 1) {
      searchResult.innerHTML = '';
      return;
    }

    const q = query.toUpperCase();
    const qLower = query.toLowerCase();
    const results = [];

    for (const [abbr, entry] of Object.entries(CCF_ABBR_LOOKUP)) {
      const abbrMatch = abbr.includes(q);
      const nameMatch = entry.full_name && entry.full_name.toLowerCase().includes(qLower);
      
      if (abbrMatch || nameMatch) {
        results.push({ abbr, ...entry, score: abbrMatch ? 1 : 0 });
      }

      if (results.length >= 20) break;
    }

    // Sort: exact abbr match first, then A > B > C
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return 'ABC'.indexOf(a.level) - 'ABC'.indexOf(b.level);
    });

    if (results.length === 0) {
      searchResult.innerHTML = '<div class="no-results">未找到匹配的期刊/会议</div>';
      return;
    }

    searchResult.innerHTML = results.map(r => `
      <div class="search-result-item">
        <span class="badge-mini badge-mini-${r.level}">CCF-${r.level}</span>
        <span class="venue-name" title="${r.full_name || ''}">${r.abbr || ''}${r.full_name ? ' · ' + r.full_name : ''}</span>
        <span class="venue-type">${r.type === 'journal' ? '期刊' : '会议'}</span>
      </div>
    `).join('');
  }

  searchInput.addEventListener('input', (e) => {
    search(e.target.value.trim());
  });
})();
