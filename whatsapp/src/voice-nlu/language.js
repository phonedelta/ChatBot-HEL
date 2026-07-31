/**
 * Absolute language adaptation rule for Centre Dentaire HEL.
 *
 * PRIORITY over all other reply instructions:
 * 1) Pure / majority French → reply in French
 * 2) Darija (Arabic script, Latin keyboard, or Darija+French mix) → reply in Arabic script only
 * 3) Never reply in Latin-letter Darija
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

  if (/langue probable du vocal:\s*(darija|arabe)/i.test(raw)) {
    return 'darija'
  }
  if (/langue probable du vocal:\s*fran[cç]ais/i.test(raw)) {
    return 'fr'
  }

  const arabicChars = (raw.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (raw.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const lower = raw.toLowerCase()

  const darijaLatin = /\b(salam|salamou|labas|bghit|bghiti|baghit|baghi|ba8i|kanbghi|kanbghit|wach|wash|kifash|kifach|chno|chkoun|chkou|fin|fayn|homa|kayn|kaynin|dyal|3endi|3andi|andi|safi|mzyan|bzaf|chwiya|ch7al|chhal|bach|bash|wje3\w*|waj3\w*|ouj3\w*|ders\w*|drass\w*|darssa|7ri9|hri9|nafkha|ghdda|ghedda|nji|nakhod|nkhod|ndir|n9dar|n9ala3|nqala3|mow3id|mo3id|randivo|serviss|tbib|nssawal|blassa|lalla|sidi|kan|taman|bghina|3ndek|3andek)\b/i
  const darijaArabic = /بغيت|بغيتي|عندي|واش|فين|شنو|لاباس|سلام|موعد|ضرسي|وجع|كاينين|ديال|نتوما|كيبغ|شحال|مزيان/

  // Avoid matching "vous" inside "rendez-vous"
  const strongFrench = (
    /\b(bonjour|bonsoir|merci beaucoup|s'il vous pla[iî]t|je voudrais|je veux|pouvez-vous|quels? sont|horaires?)\b/i.test(lower)
    || /(^|[^a-zà-ÿ-])(je|j'|nous)([^a-zà-ÿ-]|$)/i.test(lower)
  )
  const frenchMarkers = /\b(bonjour|bonsoir|merci|je|j'|nous|avec|pour|horaires?|docteur|dentiste|douleur|urgence|combien|où|demain|aujourd|s'il|svp|voudrais|pouvez|quels?|services?)\b/i

  const hasDarija = darijaLatin.test(lower) || darijaArabic.test(raw) || arabicChars >= 2
  const hasFrench = frenchMarkers.test(lower) || strongFrench

  // Absolute: any Darija signal (Latin, Arabic, or mixed with French) → darija
  // Reply layer always maps this to Arabic script (never Latin Darija).
  if (hasDarija) {
    return 'darija'
  }

  if (arabicChars >= 2 && arabicChars >= latinChars) {
    return 'darija'
  }

  if (hasFrench || strongFrench) {
    return 'fr'
  }

  if (latinChars > 0) {
    return 'fr'
  }

  if (arabicChars > 0) {
    return 'darija'
  }

  return 'auto'
}

/**
 * Map detector output to reply language hint used by the bot.
 * mixed Darija+French MUST reply in Arabic (never Latin Darija).
 * @param {'fr'|'darija'|'mixed'|'auto'} language
 * @returns {'fr'|'darija'|'auto'}
 */
function toReplyLanguageHint(language) {
  if (language === 'mixed' || language === 'darija') {
    return 'darija'
  }
  if (language === 'fr') {
    return 'fr'
  }
  return 'auto'
}

/**
 * Detect reply language from patient text (latest message / transcript).
 * @param {string} text
 * @returns {'fr'|'darija'|'auto'}
 */
function detectReplyLanguageHint(text) {
  return toReplyLanguageHint(detectLanguage(text))
}

module.exports = {
  detectLanguage,
  toReplyLanguageHint,
  detectReplyLanguageHint,
}
