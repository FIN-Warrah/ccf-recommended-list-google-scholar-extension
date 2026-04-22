/**
 * CCF Rank - Content Script for Google Scholar
 * Injects CCF level badges next to journal/conference names in search results.
 * 
 * Handles multiple Google Scholar layouts:
 * - New layout: .gs_fma_s (compact, truncated) + .gs_fma_p (expanded, full)
 * - Old layout: plain .gs_a
 * - Profile pages: .gsc_a_tr with .gs_gray
 */

(function () {
  'use strict';

  let stats = { total: 0, A: 0, B: 0, C: 0 };
  let processedElements = new WeakSet();

  /**
   * Normalize text for name-based lookup.
   * Strips all spaces, punctuation, and lowercases - must match the key format in CCF_NAME_LOOKUP.
   */
  function normalizeName(text) {
    return text
      .toLowerCase()
      .replace(/[\s\-,:\/()'&.;]+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Extract venue text from a search result item.
   * Tries multiple strategies to get the FULL (non-truncated) venue name.
   * 
   * Google Scholar DOM structures:
   * 
   * New layout:
   *   <div class="gs_a gs_fma_p">          ← expanded view
   *     <div class="gs_fmaa">Authors</div>  ← just authors
   *     Venue Name, Year <span>•</span> publisher.com  ← venue as direct text
   *   </div>
   *   <div class="gs_a gs_fma_s">          ← compact view (may truncate)
   *     Authors - Venue…, Year - publisher.com
   *   </div>
   * 
   * Old layout:
   *   <div class="gs_a">
   *     Authors - Venue Name, Year - publisher.com
   *   </div>
   */
  function extractVenueText(resultItem) {
    const texts = [];

    // Strategy 1: Expanded view (.gs_a.gs_fma_p) - get direct text nodes (not from .gs_fmaa children)
    const gsaP = resultItem.querySelector('.gs_a.gs_fma_p');
    if (gsaP) {
      // Get text content excluding the .gs_fmaa author div
      const fmaa = gsaP.querySelector('.gs_fmaa');
      if (fmaa) {
        // Clone the element, remove .gs_fmaa, get remaining text
        const clone = gsaP.cloneNode(true);
        const fmaaClone = clone.querySelector('.gs_fmaa');
        if (fmaaClone) fmaaClone.remove();
        const venueOnly = clone.textContent.trim();
        if (venueOnly) texts.push(venueOnly);
      }
      // Also add full text as fallback
      texts.push(gsaP.textContent || '');
    }

    // Strategy 2: Compact .gs_a.gs_fma_s (may be truncated with …)
    const gsaS = resultItem.querySelector('.gs_a.gs_fma_s');
    if (gsaS) {
      texts.push(gsaS.textContent || '');
    }

    // Strategy 3: Plain .gs_a (old layout, no fma_s/fma_p subclass)
    const allGsA = resultItem.querySelectorAll('.gs_a');
    allGsA.forEach(el => {
      if (!el.classList.contains('gs_fma_s') && !el.classList.contains('gs_fma_p')) {
        texts.push(el.textContent || '');
      }
    });

    // Strategy 4: Also check the expanded content area (.gs_fma_con) for venue info
    const fmaCon = resultItem.querySelector('.gs_fma_con');
    if (fmaCon) {
      const fons = fmaCon.querySelector('.gs_fma_fon');
      if (fons) {
        texts.push(fons.textContent || '');
      }
    }

    return texts.filter(t => t.trim().length > 0);
  }

  /**
   * Parse venue name from a source text line.
   * Google Scholar format: "Authors - Venue Name, Year - publisher.com"
   * or just "Venue Name, Year • publisher.com"
   */
  function parseVenueParts(text) {
    if (!text) return [];

    const parts = [];
    
    // Split by " - " (dash with spaces) to separate author/venue/publisher
    const dashParts = text.split(/\s[-–—]\s/);
    if (dashParts.length >= 3) {
      // "authors - venue, year - publisher"
      parts.push(dashParts.slice(1, -1).join(' '));
    } else if (dashParts.length === 2) {
      parts.push(dashParts[1]);
    }

    // Also split by "•" (dot separator in new layout)
    const dotParts = text.split('•');
    if (dotParts.length >= 1) {
      parts.push(dotParts[0]);
    }

    // Remove year and trailing content from venue parts
    const cleaned = parts.map(p => {
      // Remove ", 2024" or ", 2023" etc.
      return p.replace(/,\s*\d{4}\b.*$/, '').trim();
    });

    // Add the full text too as fallback
    parts.push(text);

    return [...new Set([...cleaned, ...parts])].filter(Boolean);
  }

  /**
   * Extract abbreviation-like tokens from text.
   */
  function extractAbbreviations(text) {
    if (!text) return [];
    const candidates = new Set();
    
    // Find uppercase abbreviation-like tokens (2-15 chars)
    const tokens = text.split(/[\s,\-–—·.()\/]+/);
    for (const token of tokens) {
      const trimmed = token.trim();
      const upper = trimmed.toUpperCase();
      // Match pure uppercase tokens (TC, TPDS, SIGCOMM, etc.)
      if (upper && /^[A-Z][A-Z0-9\-\/&]{1,14}$/.test(upper)) {
        candidates.add(upper);
      }
      // Also try the original token as-is if it looks like an abbreviation (NeurIPS, EuroSys)
      if (trimmed.length >= 2 && trimmed.length <= 15 && /^[A-Z]/.test(trimmed)) {
        candidates.add(trimmed.toUpperCase());
      }
    }

    // Find mixed-case abbreviations like "NeurIPS", "SIGMOD"
    const mixedCase = text.match(/\b[A-Z][A-Za-z]*[A-Z]+[A-Za-z]*\b/g);
    if (mixedCase) {
      for (const m of mixedCase) {
        candidates.add(m.toUpperCase());
      }
    }

    return [...candidates];
  }

  /**
   * Try to find a CCF match for the given venue text fragments.
   */
  function findCCFMatch(venueTexts) {
    if (!venueTexts || venueTexts.length === 0) return null;

    // Collect all abbreviation candidates and all venue text parts
    const allAbbrs = new Set();
    const allVenueParts = [];

    for (const text of venueTexts) {
      const parts = parseVenueParts(text);
      allVenueParts.push(...parts);
      for (const part of [text, ...parts]) {
        for (const abbr of extractAbbreviations(part)) {
          allAbbrs.add(abbr);
        }
      }
    }

    // === Strategy 1: Direct abbreviation lookup ===
    for (const abbr of allAbbrs) {
      if (CCF_ABBR_LOOKUP[abbr]) {
        return CCF_ABBR_LOOKUP[abbr];
      }
    }

    // === Strategy 2: Abbreviation with variations ===
    for (const abbr of allAbbrs) {
      const variations = [
        abbr.replace(/-/g, ''),
        abbr + 'S',
        abbr.replace(/S$/, ''),
      ];
      for (const v of variations) {
        if (v !== abbr && CCF_ABBR_LOOKUP[v]) {
          return CCF_ABBR_LOOKUP[v];
        }
      }
    }

    // === Strategy 3: Whole-word abbreviation search in text ===
    const allText = venueTexts.join(' ').toUpperCase();
    for (const abbr of Object.keys(CCF_ABBR_LOOKUP)) {
      if (abbr.length >= 3) {
        const regex = new RegExp('\\b' + abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (regex.test(allText)) {
          return CCF_ABBR_LOOKUP[abbr];
        }
      }
    }

    // === Strategy 4: Normalized full-name matching ===
    for (const part of allVenueParts) {
      const normalized = normalizeName(part);
      if (normalized.length > 5) {
        // Exact normalized match
        if (CCF_NAME_LOOKUP[normalized]) {
          return CCF_NAME_LOOKUP[normalized];
        }
      }
      if (normalized.length > 8) {
        // Substring match (venue text contains or is contained in a known name)
        for (const [key, value] of Object.entries(CCF_NAME_LOOKUP)) {
          if (key.length > 8) {
            if (normalized.includes(key) || key.includes(normalized)) {
              return value;
            }
          }
        }
      }
    }

    // === Strategy 5: Keyword-based fuzzy matching ===
    const allTextLower = venueTexts.join(' ').toLowerCase();
    const venueWords = allTextLower.match(/[a-z]{3,}/g) || [];
    const stopwords = new Set(['the','and','for','with','from','its','vol','www','org','com','http','https','pdf']);
    const venueKeywords = [...new Set(venueWords.filter(w => !stopwords.has(w)))];

    if (venueKeywords.length >= 2 && typeof CCF_KEYWORD_LOOKUP !== 'undefined') {
      let bestMatch = null;
      let bestScore = 0;

      for (const [keyStr, value] of Object.entries(CCF_KEYWORD_LOOKUP)) {
        const entryKeywords = keyStr.split('|');
        let matchCount = 0;
        for (const kw of entryKeywords) {
          if (venueKeywords.includes(kw)) matchCount++;
        }
        // Score = proportion of entry keywords found in venue text
        const score = matchCount / entryKeywords.length;
        // Require at least 50% keyword match AND at least 2 keywords matched
        // Higher keyword count entries can match with lower percentage
        const minScore = entryKeywords.length >= 4 ? 0.5 : 0.6;
        if (score > minScore && matchCount >= 2 && score > bestScore) {
          bestScore = score;
          bestMatch = value;
        }
      }
      if (bestMatch) return bestMatch;
    }

    return null;
  }

  /**
   * Create a CCF badge element.
   */
  function createBadge(match) {
    const badge = document.createElement('span');
    badge.className = `ccf-badge ccf-badge-${match.level}`;
    
    const typeLabel = match.type === 'journal' ? '期刊' : '会议';
    
    // Change annotation tag
    let changeTag = '';
    if (match.change === '新增') {
      changeTag = '<div class="ccf-tooltip-change ccf-change-new">🆕 2026新增</div>';
    } else if (match.change === '晋级') {
      changeTag = '<div class="ccf-tooltip-change ccf-change-upgrade">🔺 2026晋级</div>';
    } else if (match.change === '名称更新') {
      changeTag = '<div class="ccf-tooltip-change ccf-change-rename">✏️ 名称更新</div>';
    }
    
    badge.innerHTML = `
      CCF-${match.level}
      <span class="ccf-badge-type">${typeLabel}</span>
      <span class="ccf-tooltip">
        <div class="ccf-tooltip-level ccf-tooltip-level-${match.level}">CCF ${match.level} 类</div>
        <div class="ccf-tooltip-name">${match.abbr ? match.abbr + ' - ' : ''}${match.full_name || ''}</div>
        <div class="ccf-tooltip-category">📂 ${match.category}</div>
        ${changeTag}
      </span>
    `;
    
    return badge;
  }

  /**
   * Create a summary stats bar.
   */
  function createStatsBar() {
    const existing = document.querySelector('.ccf-stats-bar');
    if (existing) existing.remove();

    if (stats.total === 0) return;

    const bar = document.createElement('div');
    bar.className = 'ccf-stats-bar';
    bar.innerHTML = `
      <span class="ccf-stats-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg></span>
      <span>CCF标注: <span class="ccf-stats-count">${stats.total}</span> 篇</span>
      <span class="ccf-stats-sep"></span>
      ${stats.A > 0 ? `<span class="ccf-badge ccf-badge-A" style="font-size:11px;padding:1px 6px;">A×${stats.A}</span>` : ''}
      ${stats.B > 0 ? `<span class="ccf-badge ccf-badge-B" style="font-size:11px;padding:1px 6px;">B×${stats.B}</span>` : ''}
      ${stats.C > 0 ? `<span class="ccf-badge ccf-badge-C" style="font-size:11px;padding:1px 6px;">C×${stats.C}</span>` : ''}
    `;

    // Search results page: insert at top of results container
    const searchContainer = document.querySelector('#gs_res_ccl_mid');
    if (searchContainer) {
      searchContainer.insertBefore(bar, searchContainer.firstChild);
      return;
    }

    // Profile page: insert before publications table as a sibling
    const profileTable = document.querySelector('#gsc_a_t');
    if (profileTable && profileTable.parentNode) {
      bar.classList.add('ccf-stats-bar-profile');
      profileTable.parentNode.insertBefore(bar, profileTable);
    }
  }

  /**
   * Process all search result items on the page.
   */
  function processResults() {
    stats = { total: 0, A: 0, B: 0, C: 0 };

    // Google Scholar search result entries
    const resultItems = document.querySelectorAll('.gs_r.gs_or.gs_scl');
    
    resultItems.forEach(item => {
      if (processedElements.has(item)) return;

      // Extract venue text from all available sources within this result
      const venueTexts = extractVenueText(item);
      
      if (venueTexts.length === 0) return;

      const match = findCCFMatch(venueTexts);
      
      if (match) {
        // Find the best element to attach the badge to
        // Prefer the compact source line (.gs_a.gs_fma_s), fallback to plain .gs_a
        let targetEl = item.querySelector('.gs_a.gs_fma_s') || item.querySelector('.gs_a');
        
        if (targetEl && !targetEl.querySelector('.ccf-badge')) {
          const badge = createBadge(match);
          targetEl.appendChild(badge);
        }

        // Also add to expanded view if it exists
        const expandedEl = item.querySelector('.gs_fmaa');
        if (expandedEl && !expandedEl.querySelector('.ccf-badge')) {
          const badge2 = createBadge(match);
          expandedEl.appendChild(badge2);
        }

        processedElements.add(item);
        stats.total++;
        stats[match.level]++;
      }
    });

    // Also process author profile pages
    const profileItems = document.querySelectorAll('.gsc_a_tr');
    profileItems.forEach(item => {
      if (processedElements.has(item)) return;

      const venueEl = item.querySelector('.gs_gray:last-child') || item.querySelector('.gsc_a_j');
      if (!venueEl) return;

      const venueText = venueEl.textContent || '';
      const match = findCCFMatch([venueText]);

      if (match) {
        if (!venueEl.querySelector('.ccf-badge')) {
          const badge = createBadge(match);
          venueEl.appendChild(badge);
        }
        processedElements.add(item);
        stats.total++;
        stats[match.level]++;
      }
    });

    createStatsBar();
  }

  /**
   * Initialize with MutationObserver for dynamic content.
   */
  function init() {
    processResults();

    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        clearTimeout(init._timer);
        init._timer = setTimeout(processResults, 300);
      }
    });

    const target = document.querySelector('#gs_res_ccl_mid') || 
                   document.querySelector('#gsc_a_b') || 
                   document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log(`[CCF Rank] Extension loaded. Found ${stats.total} CCF-ranked venues.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
