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
  let resolvingElements = new WeakSet();
  let isUpdatingDOM = false;
  let pendingResolveCount = 0; // Global pending counter for citation lookups

  const OPTIONAL_KEYWORDS = new Set([
    'conference', 'journal', 'transactions', 'transaction', 'proceedings',
    'proceeding', 'symposium', 'workshop', 'ieee', 'acm',
    'cvf'
  ]);

  const WORD_ALIASES = {
    proc: ['proceedings'],
    trans: ['transactions', 'transaction'],
    transact: ['transactions', 'transaction'],
    j: ['journal'],
    jour: ['journal'],
    conf: ['conference'],
    intl: ['international'],
    int: ['international'],
    symp: ['symposium'],
    sym: ['symposium'],
    wkshp: ['workshop'],
    comput: ['computer', 'computing'],
    comp: ['computer', 'computing'],
    commun: ['communication', 'communications'],
    comm: ['communication', 'communications'],
    syst: ['system', 'systems'],
    sys: ['system', 'systems'],
    graph: ['graphic', 'graphics'],
    vis: ['vision', 'visualization'],
    anal: ['analysis'],
    mach: ['machine'],
    intell: ['intelligence'],
    learn: ['learning'],
    lang: ['language', 'languages'],
    softw: ['software'],
    inf: ['information'],
    inform: ['information'],
    sci: ['science'],
    technol: ['technology', 'technologies'],
    appl: ['application', 'applications'],
    netw: ['network', 'networks'],
    distrib: ['distributed'],
    med: ['medical']
  };

  const COMMON_WORD_ABBREVIATIONS = new Set([
    'ALT', 'BIT', 'CAD', 'DAM', 'DATE', 'DIS', 'FAST', 'GROUP',
    'HEALTH', 'IMAGE', 'MASS', 'PASTE', 'SAC', 'SAT', 'SEC',
    'WINE', 'WISE'
  ]);

  const ROMAN_NUMERAL_TOKENS = new Set([
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII',
    'XIX', 'XX'
  ]);

  /**
   * Normalize text for name-based lookup.
   * Strips all spaces, punctuation, and lowercases - must match the key format in CCF_NAME_LOOKUP.
   */
  function normalizeName(text) {
    return text
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[\s\-,:\/()'\.;]+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  function stripAbbreviationNote(text) {
    return (text || '')
      .replace(/\s*[（(][^）)]*[）)]/g, '')
      .trim();
  }

  function normalizeAbbreviation(text) {
    return stripAbbreviationNote(text)
      .toUpperCase()
      .replace(/\s*([+\-\/&.])\s*/g, '$1')
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9+\-\/&.]/g, '');
  }

  function hasAbbreviationShape(text) {
    const stripped = stripAbbreviationNote(text);
    const compact = normalizeAbbreviation(stripped).replace(/[+\-\/&.]/g, '');
    if (compact.length < 2 || compact.length > 20) return false;

    const upperCount = (stripped.match(/[A-Z]/g) || []).length;
    const lowerCount = (stripped.match(/[a-z]/g) || []).length;
    const hasSeparator = /[+\-\/&.]/.test(stripped);

    return /^[A-Z0-9\s+\-\/&.]+$/.test(stripped) ||
      hasSeparator ||
      (upperCount >= 2 && lowerCount > 0);
  }

  function isCommonWordAbbreviation(abbr) {
    return COMMON_WORD_ABBREVIATIONS.has(normalizeAbbreviation(abbr));
  }

  function isRomanNumeralToken(text) {
    return ROMAN_NUMERAL_TOKENS.has(normalizeAbbreviation(text));
  }

  function containsExplicitAbbreviation(venueParts, abbr) {
    const normalizedTarget = normalizeAbbreviation(abbr);
    if (!normalizedTarget) return false;

    const escaped = (abbr || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundaryRegex = escaped
      ? new RegExp('\\b' + escaped + '\\b', 'g')
      : null;

    return venueParts.some(part => {
      if (normalizeAbbreviation(part) === normalizedTarget) return true;

      const extracted = extractAbbreviations(part)
        .some(candidate => normalizeAbbreviation(candidate) === normalizedTarget);
      if (extracted) return true;

      if (!boundaryRegex) return false;
      boundaryRegex.lastIndex = 0;
      let match;
      while ((match = boundaryRegex.exec(part)) !== null) {
        if (hasAbbreviationShape(match[0])) return true;
      }

      return false;
    });
  }

  function isLikelyAbbreviationEntry(entry) {
    return hasAbbreviationShape(entry?.abbr || '');
  }

  function buildAbbreviationAliasLookup() {
    const aliases = new Map();

    for (const [key, entry] of Object.entries(CCF_ABBR_LOOKUP)) {
      if (!isLikelyAbbreviationEntry(entry)) continue;

      const aliasKeys = [
        key,
        entry.abbr,
        stripAbbreviationNote(key),
        stripAbbreviationNote(entry.abbr),
      ];

      for (const alias of aliasKeys) {
        const normalized = normalizeAbbreviation(alias);
        if (!normalized) continue;

        const existing = aliases.get(normalized);
        if (!existing) {
          aliases.set(normalized, entry);
        } else if (existing.full_name !== entry.full_name || existing.level !== entry.level) {
          aliases.set(normalized, null);
        }
      }
    }

    return aliases;
  }

  const CCF_ABBR_ALIAS_LOOKUP = buildAbbreviationAliasLookup();

  function buildExactAbbreviationNameLookup() {
    const names = new Map();

    for (const entry of Object.values(CCF_ABBR_LOOKUP)) {
      const normalized = normalizeName(entry.abbr || '');
      if (!normalized) continue;

      const existing = names.get(normalized);
      if (!existing) {
        names.set(normalized, entry);
      } else if (existing.full_name !== entry.full_name || existing.level !== entry.level || existing.type !== entry.type) {
        names.set(normalized, null);
      }
    }

    return names;
  }

  const CCF_EXACT_ABBR_NAME_LOOKUP = buildExactAbbreviationNameLookup();

  function buildSpecialNameLookup() {
    const aliases = new Map();
    const addAlias = (alias, canonicalName) => {
      const entry = CCF_NAME_LOOKUP[normalizeName(canonicalName)];
      if (entry) aliases.set(normalizeName(alias), entry);
    };

    addAlias('The Web Conference', 'International World Wide Web Conference');

    return aliases;
  }

  const CCF_SPECIAL_NAME_LOOKUP = buildSpecialNameLookup();

  function buildNameConflictLookup() {
    const grouped = new Map();

    for (const entry of Object.values(CCF_ABBR_LOOKUP)) {
      const normalized = normalizeName(entry.full_name || '');
      if (!normalized) continue;

      if (!grouped.has(normalized)) grouped.set(normalized, []);
      const entries = grouped.get(normalized);
      const key = `${entry.abbr}|${entry.level}|${entry.type}|${entry.category}|${entry.full_name}`;
      if (!entries.some(existing => `${existing.abbr}|${existing.level}|${existing.type}|${existing.category}|${existing.full_name}` === key)) {
        entries.push(entry);
      }
    }

    const conflicts = new Map();
    for (const [normalized, entries] of grouped.entries()) {
      const distinct = new Set(entries.map(entry => `${entry.abbr}|${entry.level}|${entry.type}|${entry.category}`));
      if (distinct.size > 1) conflicts.set(normalized, entries);
    }

    return conflicts;
  }

  const CCF_NAME_CONFLICT_LOOKUP = buildNameConflictLookup();

  function resolveNameLookup(normalized, venueParts, allAbbrs) {
    const conflictEntries = CCF_NAME_CONFLICT_LOOKUP.get(normalized);
    if (!conflictEntries) {
      return CCF_NAME_LOOKUP[normalized] || CCF_SPECIAL_NAME_LOOKUP.get(normalized) || null;
    }

    const abbrs = [...allAbbrs].map(normalizeAbbreviation);
    const abbrMatch = conflictEntries.find(entry => abbrs.includes(normalizeAbbreviation(entry.abbr)));
    if (abbrMatch) return abbrMatch;

    const hasConferenceCue = venueParts.some(part => {
      return /\b(proceedings?|conferences?|conf\.?|symposium|workshops?)\b/i.test(part);
    });
    if (hasConferenceCue) {
      const conferenceMatches = conflictEntries.filter(entry => entry.type === 'conference');
      if (conferenceMatches.length === 1) return conferenceMatches[0];
    }

    const hasJournalCue = venueParts.some(part => {
      return /\b(journals?|vol\.?|volume|issue|no\.)\b/i.test(part);
    });
    if (hasJournalCue) {
      const journalMatches = conflictEntries.filter(entry => entry.type === 'journal');
      if (journalMatches.length === 1) return journalMatches[0];
    }

    console.log('[CCF Rank] Ambiguous CCF venue name, skipped:', conflictEntries[0]?.full_name, conflictEntries.map(entry => entry.abbr));
    return null;
  }

  function hasNonMainVenueQualifier(entry, venueParts) {
    const entryName = (entry?.full_name || '').toLowerCase();
    const checks = [
      [/\bworkshops?\b/i, /\bworkshops?\b/i],
      [/\badjunct\b/i, /\badjunct\b/i],
      [/\bcompanion\b/i, /\bcompanion\b/i],
      [/\bextended\s+abstracts?\b/i, /\bextended\s+abstracts?\b/i],
      [/\bposters?\b/i, /\bposters?\b/i],
      [/\bdemos?\b|\bdemonstrations?\b/i, /\bdemos?\b|\bdemonstrations?\b/i],
      [/\btutorials?\b/i, /\btutorials?\b/i],
      [/\bdoctoral\s+consortium\b/i, /\bdoctoral\s+consortium\b/i]
    ];

    return venueParts.some(part => {
      return checks.some(([venueRegex, entryRegex]) => {
        return venueRegex.test(part) && !entryRegex.test(entryName);
      });
    });
  }

  function addWordVariant(words, word) {
    if (!word || word.length < 2) return;

    words.add(word);

    const aliases = WORD_ALIASES[word];
    if (aliases) {
      aliases.forEach(alias => words.add(alias));
    }

    if (word.endsWith('ies') && word.length > 4) {
      words.add(word.slice(0, -3) + 'y');
    } else if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('sis') && word.length > 4) {
      words.add(word.slice(0, -1));
    } else if (!word.endsWith('s') && word.length > 3) {
      words.add(word + 's');
    }
  }

  function extractVenueWords(text) {
    const words = new Set();
    if (!text) return words;

    const tokens = text
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[’']/g, '')
      .replace(/…|\.\.\./g, ' ')
      .replace(/\b\d{4}\b/g, ' ')
      .replace(/\b\d+(st|nd|rd|th)\b/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    const stopWords = new Set([
      'a', 'an', 'the', 'of', 'on', 'in', 'and', 'or', 'for', 'to', 'with',
      'from', 'by', 'at', 'via', 'using', 'based', 'vol', 'volume', 'no',
      'issue', 'pp', 'pages', 'page'
    ]);

    for (const token of tokens) {
      if (!stopWords.has(token)) {
        addWordVariant(words, token);
      }
    }

    return words;
  }

  function getVenueNameVariants(part) {
    const variants = new Set();
    const trimmed = (part || '').trim();
    if (!trimmed) return [];

    variants.add(trimmed);

    const withoutProceedings = trimmed
      .replace(/^(?:proceedings|proc)\.?\s+(?:of\s+)?(?:the\s+)?/i, '')
      .trim();
    if (withoutProceedings) variants.add(withoutProceedings);

    const withoutLeadingYear = withoutProceedings
      .replace(/^\d{4}\s+/, '')
      .trim();
    if (withoutLeadingYear) variants.add(withoutLeadingYear);

    return [...variants];
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

    // Also split by "•" (dot separator in new layout) — only if "•" actually exists
    if (text.includes('•')) {
      const dotParts = text.split('•');
      parts.push(dotParts[0]);
    }

    // Remove year and trailing content from venue parts
    const cleaned = parts.map(p => {
      // Remove ", 2024" or ", 2023" etc.
      return p.replace(/,\s*\d{4}\b.*$/, '').trim();
    });

    // If no separators were found, treat the entire text as a venue name
    // (safe because text without separators doesn't contain author/publisher info)
    if (parts.length === 0) {
      const cleanedText = text.replace(/,\s*\d{4}\b.*$/, '').trim();
      return [cleanedText, text].filter(Boolean);
    }

    return [...new Set([...cleaned, ...parts])].filter(Boolean);
  }

  /**
   * Extract abbreviation-like tokens from text.
   */
  function extractAbbreviations(text) {
    if (!text) return [];
    const candidates = new Set();

    const compoundMatches = text.match(/\b[A-Za-z0-9]+(?:\s*[+\-\/]\s*[A-Za-z0-9]+)+\b/g);
    if (compoundMatches) {
      for (const match of compoundMatches) {
        const spaced = match.replace(/\s+/g, ' ').trim().toUpperCase();
        const compact = match.replace(/\s*([+\-\/])\s*/g, '$1').toUpperCase();
        if (spaced.length <= 25) candidates.add(spaced);
        if (compact.length <= 25) candidates.add(compact);
      }
    }

    const dottedMatches = text.match(/\b[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)+\b/g);
    if (dottedMatches) {
      for (const match of dottedMatches) {
        if (match.length <= 25) candidates.add(match.toUpperCase());
      }
    }
    
    // Find uppercase abbreviation-like tokens (2-15 chars)
    const tokens = text.split(/[\s,\-–—·.()\/]+/);
    for (const token of tokens) {
      const trimmed = token.trim();
      if (isRomanNumeralToken(trimmed)) continue;
      // Match pure uppercase tokens (TC, TPDS, SIGCOMM, etc.)
      if (trimmed && /^[A-Z][A-Z0-9\-\/&]{1,14}$/.test(trimmed)) {
        candidates.add(trimmed.toUpperCase());
      }
      // Also try the original token as-is if it looks like an abbreviation (NeurIPS, EuroSys)
      if (trimmed.length >= 2 && trimmed.length <= 15 && /^[A-Z]/.test(trimmed) && /[A-Z].*[A-Z]/.test(trimmed)) {
        candidates.add(trimmed.toUpperCase());
      }
    }

    // Find mixed-case abbreviations like "NeurIPS", "SIGMOD"
    const mixedCase = text.match(/\b[A-Z][A-Za-z]*[A-Z]+[A-Za-z]*\b/g);
    if (mixedCase) {
      for (const m of mixedCase) {
        if (isRomanNumeralToken(m)) continue;
        candidates.add(m.toUpperCase());
      }
    }

    return [...candidates];
  }

  function lookupAbbreviation(abbr, venueParts) {
    const entry = CCF_ABBR_LOOKUP[abbr] ||
      CCF_ABBR_LOOKUP[abbr.toUpperCase()] ||
      CCF_ABBR_ALIAS_LOOKUP.get(normalizeAbbreviation(abbr));

    if (!entry) return null;
    if (hasNonMainVenueQualifier(entry, venueParts)) return null;
    if (isLikelyAbbreviationEntry(entry)) return entry;

    const entryAbbr = normalizeAbbreviation(entry.abbr);
    const exactPartMatch = venueParts.some(part => normalizeAbbreviation(part) === entryAbbr);
    return exactPartMatch ? entry : null;
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
      for (const part of parts) {
        const variants = getVenueNameVariants(part);
        allVenueParts.push(...variants);
        // Only extract abbreviations from parsed venue parts (not raw text with author names)
        for (const variant of variants) {
          for (const abbr of extractAbbreviations(variant)) {
            allAbbrs.add(abbr);
          }
        }
      }
    }

    // === Strategy 1: Exact normalized full-name matching ===
    // & and 'and' are treated as equivalent. Full names must win over
    // abbreviations embedded inside them (e.g. "The VLDB Journal" vs "VLDB").
    for (const part of allVenueParts) {
      if (part.includes('…') || part.includes('...')) continue;
      const normalized = normalizeName(part);
      if (normalized.length > 5) {
        const match = resolveNameLookup(normalized, allVenueParts, allAbbrs);
        if (match) return match;
      }
    }

    // === Strategy 2: Exact abbreviation/name matching ===
    // Some CCF venues use name-like abbreviations (e.g. Middleware, Eurographics).
    // Match them only when the parsed venue field is exactly that name.
    for (const part of allVenueParts) {
      if (part.includes('…') || part.includes('...')) continue;
      const normalized = normalizeName(part);
      const match = CCF_EXACT_ABBR_NAME_LOOKUP.get(normalized);
      if (match && !hasNonMainVenueQualifier(match, allVenueParts)) return match;
    }

    // === Strategy 3: Comma-rearranged name matching ===
    // Google Scholar sometimes inverts venue names: "Computers, IEEE Transactions on"
    // Try rearranging: "X, Y" → "Y X"
    for (const part of allVenueParts) {
      if (part.includes('…') || part.includes('...')) continue;
      const commaIdx = part.indexOf(',');
      if (commaIdx > 0) {
        const rearranged = part.substring(commaIdx + 1).trim() + ' ' + part.substring(0, commaIdx).trim();
        const normalized = normalizeName(rearranged);
        if (normalized.length > 5) {
          const match = resolveNameLookup(normalized, allVenueParts, allAbbrs);
          if (match) return match;
        }
      }
    }

    // === Strategy 4: Direct abbreviation lookup ===
    for (const abbr of allAbbrs) {
      const match = lookupAbbreviation(abbr, allVenueParts);
      if (match) return match;
    }

    // === Strategy 5: Abbreviation with variations ===
    for (const abbr of allAbbrs) {
      const variations = [
        normalizeAbbreviation(abbr),
        abbr.replace(/-/g, ''),
        abbr + 'S',
        abbr.replace(/S$/, ''),
      ];
      for (const v of variations) {
        if (v === abbr) continue;
        const match = lookupAbbreviation(v, allVenueParts);
        if (match) return match;
      }
    }

    // === Strategy 6: Whole-word abbreviation search in venue parts only ===
    // Use only parsed venue parts (author names excluded) to avoid false positives
    const venuePartsText = allVenueParts.join(' ').toUpperCase();
    for (const [abbr, entry] of Object.entries(CCF_ABBR_LOOKUP)) {
      if (abbr.length >= 3 && isLikelyAbbreviationEntry(entry)) {
        if (hasNonMainVenueQualifier(entry, allVenueParts)) continue;
        if (
          (isCommonWordAbbreviation(abbr) || isCommonWordAbbreviation(entry.abbr)) &&
          !containsExplicitAbbreviation(allVenueParts, abbr) &&
          !containsExplicitAbbreviation(allVenueParts, entry.abbr)
        ) {
          continue;
        }
        const regex = new RegExp('\\b' + abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        if (regex.test(venuePartsText)) {
          return entry;
        }
      }
    }

    // === Strategy 7: Suffix matching for truncated venue names ===
    // When Scholar truncates the start: "… transactions on Computers" → "transactionsoncomputers"
    // This is a suffix of "ieeetransactionsoncomputers" → safe to match
    // Only used when match is UNIQUE (no ambiguity between different entries)
    for (const part of allVenueParts) {
      // Only try if the text appears truncated (starts with … or contains …)
      if (part.includes('…') || part.includes('...')) {
        const cleanPart = part.replace(/…/g, '').replace(/\.\.\./g, '').trim();
        const normalized = normalizeName(cleanPart);
        const hasVenueDesignator = /\b(transactions?|journal|conference|symposium|workshop|proceedings?)\b/i.test(cleanPart);
        const coreWordCount = cleanPart
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(word => word && !['a', 'an', 'the', 'of', 'on', 'in', 'and', 'or', 'for', 'to', 'with'].includes(word))
          .length;
        if (!hasVenueDesignator && coreWordCount < 3) continue;

        if (normalized.length > 10) {
          let matchCount = 0;
          let lastMatch = null;
          for (const [key, value] of Object.entries(CCF_NAME_LOOKUP)) {
            // Key must end with our normalized text, and our text must be a meaningful portion of the full key.
            const minCoverage = hasVenueDesignator ? 0.45 : 0.6;
            if (key.length > normalized.length && key.endsWith(normalized) && normalized.length / key.length >= minCoverage) {
              matchCount++;
              lastMatch = value;
              if (matchCount > 1) break; // Ambiguous, stop
            }
          }
          // Only return if exactly one entry matched (unambiguous)
          if (matchCount === 1) return lastMatch;
        }
      }
    }

    // === Strategy 8: High-confidence keyword matching ===
    // Handles Scholar variants like "Proceedings of the IEEE/CVF Conference on ..."
    // and common abbreviated journal names like "IEEE Trans. Pattern Anal. Mach. Intell."
    const keywordMatches = [];
    for (const part of allVenueParts) {
      const words = extractVenueWords(part);
      if (words.size < 2) continue;

      for (const [keywordKey, entry] of Object.entries(CCF_KEYWORD_LOOKUP)) {
        let matchEntry = entry;
        const conflictingName = normalizeName(entry.full_name || '');
        if (CCF_NAME_CONFLICT_LOOKUP.has(conflictingName)) {
          const resolved = resolveNameLookup(conflictingName, allVenueParts, allAbbrs);
          if (!resolved) continue;
          matchEntry = resolved;
        }
        if (hasNonMainVenueQualifier(matchEntry, [part])) continue;

        const keyWords = keywordKey.split('|').filter(Boolean);
        if (keyWords.length < 2) continue;

        const matched = keyWords.filter(word => words.has(word));
        const missing = keyWords.filter(word => !words.has(word));
        const distinctiveWords = keyWords.filter(word => !OPTIONAL_KEYWORDS.has(word));
        if (distinctiveWords.length < 3) continue;

        const matchedDistinctive = distinctiveWords.filter(word => words.has(word));

        const coverage = matched.length / keyWords.length;
        const distinctiveCoverage = distinctiveWords.length === 0
          ? 1
          : matchedDistinctive.length / distinctiveWords.length;
        const onlyOptionalMissing = missing.every(word => OPTIONAL_KEYWORDS.has(word));

        const isStrongMatch =
          coverage === 1 ||
          (coverage >= 0.8 && distinctiveCoverage === 1 && onlyOptionalMissing);

        if ((part.includes('…') || part.includes('...')) && matchedDistinctive.length < 4) {
          continue;
        }

        if (isStrongMatch && matchedDistinctive.length >= 2) {
          keywordMatches.push({
            entry: matchEntry,
            score: matched.length * 100 + matchedDistinctive.length * 10 + coverage,
            keyLength: keyWords.length
          });
        }
      }
    }

    if (keywordMatches.length > 0) {
      keywordMatches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.keyLength - a.keyLength;
      });

      const best = keywordMatches[0];
      const tied = keywordMatches.filter(match => match.score === best.score);
      const sameVenue = tied.every(match => match.entry.abbr === best.entry.abbr);
      if (sameVenue) return best.entry;
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
   * Counts badges directly from the DOM to stay accurate after async updates.
   */
  function createStatsBar() {
    isUpdatingDOM = true;
    try {
      // Count badges directly from the DOM
      const resultBadges = document.querySelectorAll('.gs_r .ccf-badge, .gsc_a_tr .ccf-badge');
      const counts = { total: 0, A: 0, B: 0, C: 0 };
      const counted = new Set();
      resultBadges.forEach(badge => {
        const resultItem = badge.closest('.gs_r') || badge.closest('.gsc_a_tr');
        if (resultItem && !counted.has(resultItem)) {
          counted.add(resultItem);
          counts.total++;
          if (badge.classList.contains('ccf-badge-A')) counts.A++;
          else if (badge.classList.contains('ccf-badge-B')) counts.B++;
          else if (badge.classList.contains('ccf-badge-C')) counts.C++;
        }
      });

      const pendingHtml = pendingResolveCount > 0
        ? `<span class="ccf-stats-pending">（${pendingResolveCount}篇识别中<span class="ccf-loading-dots"></span>）</span>`
        : '';

      const content = `
        <span class="ccf-stats-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg></span>
        <span>CCF标注: <span class="ccf-stats-count">${counts.total}</span> 篇${pendingHtml}</span>
        <span class="ccf-stats-sep"></span>
        ${counts.A > 0 ? `<span class="ccf-badge ccf-badge-A" style="font-size:11px;padding:1px 6px;">A×${counts.A}</span>` : ''}
        ${counts.B > 0 ? `<span class="ccf-badge ccf-badge-B" style="font-size:11px;padding:1px 6px;">B×${counts.B}</span>` : ''}
        ${counts.C > 0 ? `<span class="ccf-badge ccf-badge-C" style="font-size:11px;padding:1px 6px;">C×${counts.C}</span>` : ''}
      `;

      // Reuse existing bar if possible (just update innerHTML — no DOM insert/remove)
      let bar = document.querySelector('.ccf-stats-bar');
      if (bar) {
        bar.innerHTML = content;
        return;
      }

      // First time: create and insert the bar
      bar = document.createElement('div');
      bar.className = 'ccf-stats-bar';
      bar.innerHTML = content;

      const searchContainer = document.querySelector('#gs_res_ccl_mid');
      if (searchContainer) {
        searchContainer.insertBefore(bar, searchContainer.firstChild);
        return;
      }

      const profileTable = document.querySelector('#gsc_a_t');
      if (profileTable && profileTable.parentNode) {
        bar.classList.add('ccf-stats-bar-profile');
        profileTable.parentNode.insertBefore(bar, profileTable);
      }
    } finally {
      isUpdatingDOM = false;
    }
  }

  /**
   * Fetch all candidate venue names from Google Scholar citation page.
   * Used when the venue name is truncated (contains "…").
   * @param {string} articleId - The article ID from the title link's id attribute.
   * @returns {Promise<string[]>} Array of candidate venue names.
   */
  async function fetchVenueCandidates(articleId) {
    if (!articleId) return [];
    let timeoutId = null;
    try {
      const url = `/scholar?q=info:${articleId}:scholar.google.com/&output=cite&scirp=0&hl=en`;
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) return [];
      const html = await resp.text();

      const candidates = [];
      const seen = new Set();

      // Extract all <i>...</i> texts (venue names in MLA/APA/Chicago formats)
      const italicMatches = html.match(/<i>([^<]+)<\/i>/g) || [];
      for (const m of italicMatches) {
        const text = m.replace(/<\/?i>/g, '').trim();
        // Skip very short matches or things that look like volume/issue numbers
        if (text.length > 5 && !/^\d/.test(text) && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          candidates.push(text);
        }
      }

      // Also try BibTeX journal/booktitle field
      const journalMatch = html.match(/(?:journal|booktitle)\s*=\s*\{([^}]+)\}/i);
      if (journalMatch) {
        const text = journalMatch[1].trim();
        if (!seen.has(text.toLowerCase())) {
          candidates.push(text);
        }
      }

      return candidates;
    } catch (e) {
      console.log(`[CCF Rank] Failed to fetch citation for ${articleId}:`, e);
      return [];
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Check if any venue text is truncated (contains "…").
   */
  function isVenueTruncated(venueTexts) {
    return venueTexts.some(t => t.includes('…') || t.includes('...'));
  }

  /**
   * Process all search result items on the page.
   */
  function processResults() {
    stats = { total: 0, A: 0, B: 0, C: 0 };

    // Google Scholar search result entries
    const resultItems = document.querySelectorAll('.gs_r.gs_or.gs_scl');
    
    // Items that need async resolution (truncated venue names)
    const pendingItems = [];

    resultItems.forEach(item => {
      if (processedElements.has(item)) return;

      // Extract venue text from all available sources within this result
      const venueTexts = extractVenueText(item);
      
      if (venueTexts.length === 0) return;

      const match = findCCFMatch(venueTexts);
      
      if (match) {
        isUpdatingDOM = true;
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
        isUpdatingDOM = false;
      } else if (isVenueTruncated(venueTexts)) {
        // Venue is truncated and no match found — queue for async resolution
        // Use data-cid from the result container (the Google Scholar article ID)
        const articleId = item.getAttribute('data-cid');
        if (articleId && !resolvingElements.has(item)) {
          pendingItems.push({ item, articleId });
          resolvingElements.add(item);
          console.log(`[CCF Rank] Truncated venue detected, queued for citation fetch: ${articleId}`);
        }
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

    if (pendingItems.length > 0) {
      pendingResolveCount += pendingItems.length;
    }
    createStatsBar();

    // Async resolution for truncated results
    if (pendingItems.length > 0) {
      resolveTruncatedVenues(pendingItems);
    }
  }

  // Cache citation results to avoid re-fetching across processResults calls
  const venueCache = {};

  /**
   * Resolve truncated venue names by fetching citation data.
   * Processes items sequentially with randomized delays to avoid rate limiting.
   */
  async function resolveTruncatedVenues(items) {
    let newMatches = 0;
    for (const { item, articleId } of items) {
      if (item.querySelector('.ccf-badge')) {
        resolvingElements.delete(item);
        pendingResolveCount = Math.max(0, pendingResolveCount - 1);
        createStatsBar();
        continue;
      }

      // Check cache first
      let candidates;
      if (venueCache[articleId]) {
        candidates = venueCache[articleId];
        console.log(`[CCF Rank] Cache hit for ${articleId}:`, candidates);
      } else {
        console.log(`[CCF Rank] Fetching citation for ${articleId}...`);
        candidates = await fetchVenueCandidates(articleId);
        venueCache[articleId] = candidates;
        console.log(`[CCF Rank] Citation candidates for ${articleId}:`, candidates);
      }

      if (candidates.length > 0) {
        // Try each candidate until we find a CCF match
        let match = null;
        for (const venue of candidates) {
          match = findCCFMatch([venue]);
          if (match) break;
        }

        if (match) {
          isUpdatingDOM = true;
          let targetEl = item.querySelector('.gs_a.gs_fma_s') || item.querySelector('.gs_a');
          if (targetEl && !targetEl.querySelector('.ccf-badge')) {
            targetEl.appendChild(createBadge(match));
          }
          const expandedEl = item.querySelector('.gs_fmaa');
          if (expandedEl && !expandedEl.querySelector('.ccf-badge')) {
            expandedEl.appendChild(createBadge(match));
          }
          isUpdatingDOM = false;
          processedElements.add(item);
          stats.total++;
          stats[match.level]++;
          newMatches++;
        }
      }

      // Update pending count after each item
      resolvingElements.delete(item);
      pendingResolveCount = Math.max(0, pendingResolveCount - 1);
      createStatsBar();

      // Randomized delay (800-1200ms) to mimic human-like behavior
      const delay = 800 + Math.floor(Math.random() * 400);
      await new Promise(r => setTimeout(r, delay));
    }

    if (newMatches > 0) {
      console.log(`[CCF Rank] Resolved ${newMatches} truncated venues via citation lookup.`);
    }
  }

  /**
   * Initialize with MutationObserver for dynamic content.
   */
  function init() {
    processResults();

    const observer = new MutationObserver((mutations) => {
      if (isUpdatingDOM) return; // Ignore our own DOM changes
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
