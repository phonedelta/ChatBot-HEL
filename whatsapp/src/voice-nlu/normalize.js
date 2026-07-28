/**
 * Normalize Darija / mixed spellings to canonical dental vocabulary.
 */

const { canonicalForToken, normalizeKey } = require('./dictionary')

/**
 * Tokenize loosely for Latin + Arabic text.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text || '')
    .split(/(\s+|[\u0600-\u06FF]+|[A-Za-zÀ-ÿ0-9_']+)/g)
    .filter((part) => part && !/^\s+$/.test(part))
}

/**
 * @param {string} text
 * @returns {{ normalizedText: string, tokens: string[], canonicalTokens: string[] }}
 */
function normalizeDarijaText(text) {
  const source = String(text || '').trim()
  if (!source) {
    return {
      normalizedText: '',
      tokens: [],
      canonicalTokens: [],
    }
  }

  const tokens = tokenize(source)
  const canonicalTokens = []
  const rebuilt = []

  for (const token of tokens) {
    if (/^[\s,.!?;:]+$/.test(token)) {
      rebuilt.push(token)
      continue
    }
    const canonical = canonicalForToken(token)
    canonicalTokens.push(normalizeKey(canonical))
    rebuilt.push(canonical)
  }

  return {
    normalizedText: rebuilt.join('').replace(/\s+/g, ' ').trim(),
    tokens,
    canonicalTokens: canonicalTokens.filter(Boolean),
  }
}

/**
 * Produce a short French gloss for the main LLM when input is Darija.
 * Rule-based only (fast, no extra API call).
 * @param {string} normalizedText
 * @param {string[]} canonicalTokens
 * @returns {string}
 */
function buildMeaningHint(normalizedText, canonicalTokens) {
  const set = new Set(canonicalTokens)
  const lower = String(normalizedText || '').toLowerCase()

  if (set.has('douleur') && (set.has('dent') || set.has('molaire'))) {
    return "J'ai une douleur à la dent."
  }
  if (set.has('gonflement')) {
    return "J'ai un gonflement (possible urgence)."
  }
  if ((set.has('vouloir') || set.has('prendre') || set.has('faire')) && set.has('rendez-vous')) {
    return 'Je voudrais prendre un rendez-vous.'
  }
  if (set.has('vouloir') && set.has('service') && (set.has('rendez-vous') || set.has('venir') || set.has('prendre'))) {
    return 'Je voudrais faire ce service et prendre un rendez-vous pour venir.'
  }
  if (set.has('vouloir') && set.has('venir')) {
    return 'Je voudrais venir / prendre rendez-vous.'
  }
  if (set.has('prendre') && set.has('venir')) {
    return 'Je voudrais prendre rendez-vous pour venir.'
  }
  if (set.has('annuler') && set.has('rendez-vous')) {
    return 'Je voudrais annuler ou modifier un rendez-vous.'
  }
  if (set.has('extraire') && (set.has('dent') || set.has('molaire'))) {
    return 'Je voudrais faire extraire une dent.'
  }
  if (set.has('prix') && set.has('implant')) {
    return "Je demande le prix d'un implant."
  }
  if (set.has('localisation') || /\bfin\b/i.test(lower) || /cabinet|parking/i.test(lower)) {
    return 'Je demande la localisation du cabinet.'
  }
  if (set.has('horaires')) {
    return 'Je demande les horaires.'
  }
  if (set.has('information')) {
    return "Je demande une information."
  }
  if (set.has('salutation') && canonicalTokens.length <= 3) {
    return 'Salutation.'
  }
  if (set.has('remerciement')) {
    return 'Remerciement.'
  }

  return ''
}

module.exports = {
  tokenize,
  normalizeDarijaText,
  buildMeaningHint,
}
