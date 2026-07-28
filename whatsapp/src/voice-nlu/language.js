/**
 * Lightweight language detection for French / Moroccan Darija / mixed.
 */

/**
 * @param {string} text
 * @returns {'fr'|'darija'|'mixed'|'auto'}
 */
function detectLanguage(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return 'auto'
  }

  const arabicChars = (raw.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (raw.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const lower = raw.toLowerCase()

  const darijaMarkers = /\b(salam|labas|bghit|bghiti|baghit|baghi|ba8i|wach|wash|kifash|kifach|3endi|3andi|andi|safi|chkoun|fin|mzyan|bzaf|chwiya|wje3\w*|waj3\w*|ouj3\w*|ders\w*|drass\w*|darssa|7ri9|nafkha|ghdda|ghedda|nji|nakhod|nkhod|ndir|bach|bash|n9dar|n9ala3|nqala3|ch7al|chhal|tbib|nssawal|kayn|dyal|kan|lalla|sidi|blassa|randivo|serviss)\b|[\u0600-\u06FF]/i
  // "rendez-vous" alone is not enough to mark French when Darija markers are present.
  const frenchMarkers = /\b(bonjour|bonsoir|merci|je|j'|vous|nous|avec|pour|horaires?|docteur|dentiste|douleur|urgence|combien|où|demain|aujourd|s'il|svp)\b/i

  const hasDarija = darijaMarkers.test(lower) || arabicChars >= 2
  const hasFrench = frenchMarkers.test(lower)
  const wordCount = lower.trim() ? lower.trim().split(/\s+/).length : 0

  // Avoid matching "vous" inside "rendez-vous" (hyphen creates a word boundary).
  const strongFrench = (
    /\b(bonjour|bonsoir|horaires?|s'il vous pla[iî]t)\b/i.test(lower)
    || /(^|[^a-zà-ÿ-])(je|j'|nous)([^a-zà-ÿ-]|$)/i.test(lower)
  )

  // Darija (incl. Latin keyboard) often mixes French loanwords: docteur, rendez-vous, service.
  if (hasDarija && !strongFrench) {
    return 'darija'
  }

  if (hasDarija && hasFrench) {
    return 'mixed'
  }
  if (arabicChars >= 2 && arabicChars >= latinChars) {
    return 'darija'
  }
  if (hasDarija && !hasFrench) {
    return 'darija'
  }
  if (hasFrench && !hasDarija) {
    return 'fr'
  }
  if (latinChars > 0 && !hasDarija) {
    return 'fr'
  }
  if (hasDarija) {
    return 'darija'
  }
  return 'auto'
}

/**
 * Map detector output to reply language hint used by the bot.
 * @param {'fr'|'darija'|'mixed'|'auto'} language
 * @returns {'fr'|'darija'|'auto'}
 */
function toReplyLanguageHint(language) {
  if (language === 'mixed') {
    // Prefer Darija for mixed dental voice notes in Morocco.
    return 'darija'
  }
  if (language === 'fr' || language === 'darija') {
    return language
  }
  return 'auto'
}

module.exports = {
  detectLanguage,
  toReplyLanguageHint,
}
