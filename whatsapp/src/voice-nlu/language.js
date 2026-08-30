/**
 * Absolute language adaptation rule for Centre Dentaire HEL.
 *
 * PRIORITY over all other reply instructions:
 * 1) Pure / majority French → reply in French
 * 2) Darija (Arabic script, Latin keyboard, or Darija+French mix) → reply in Arabic script only
 * 3) Never reply in Latin-letter Darija
 *
 * Also exposes confidence + neutral classification for conversation language memory.
 */

const LANGUAGE_CONFIDENCE_THRESHOLD = 0.75

const NEUTRAL_EXACT = new Set([
  'ok', 'okay', 'oki', 'okey',
  'oui', 'non', 'yes', 'no', 'yep', 'nope',
  'merci', 'thanks', 'thx', 'svp', 'stp',
  'rdv', 'hel', 'whatsapp', 'wa', 'dentiste',
  'hi', 'hello', 'salut', 'cv', 'cc',
  'wakha', 'wahka', 'safi',
  '👍', '😂', '🙏', '😊', '😅', '❤️', '♥️',
])

/**
 * Messages too short / universal to drive a language switch.
 * @param {string} text
 * @returns {boolean}
 */
function isLanguageNeutral(text) {
  const raw = String(text || '').trim()
  if (!raw) return true

  // Emoji / punctuation only
  if (/^[\s\p{Emoji}\p{P}\p{S}]+$/u.test(raw)) return true
  if (/^[?؟!.…]+$/.test(raw)) return true
  if (raw.length <= 2) return true

  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (NEUTRAL_EXACT.has(lower)) return true

  // Single token very short acknowledgements
  if (!/\s/.test(lower) && lower.length <= 5 && /^(ok|oui|non|yes|no|merci|thx|svp|rdv|wakha|safi|hi|cv)$/i.test(lower)) {
    return true
  }

  return false
}

/**
 * @param {string} text
 * @returns {{
 *   hasDarijaLatin: boolean,
 *   hasDarijaArabic: boolean,
 *   hasArabicScript: boolean,
 *   hasStrongFrench: boolean,
 *   hasFrench: boolean,
 *   arabicChars: number,
 *   latinChars: number,
 * }}
 */
function scoreLanguageSignals(text) {
  const raw = String(text || '').trim()
  const lower = raw.toLowerCase()
  const arabicChars = (raw.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (raw.match(/[A-Za-zÀ-ÿ]/g) || []).length

  const darijaLatin = /\b(salam|salamou|labas|bghit|bghiti|baghit|baghi|ba8i|kanbghi|kanbghit|wach|wash|kifash|kifach|chno|chkoun|chkou|fin|fayn|homa|kayn|kayna|kaynin|dyal|3endi|3andi|andi|safi|mzyan|bzaf|chwiya|ch7al|chhal|bach|bash|wje3\w*|waj3\w*|ouj3\w*|ders\w*|drass\w*|darssa|7ri9|hri9|nafkha|ghdda|ghedda|lyoum|nji|nakhod|nakhdo|nkhod|ndir|n9dar|n9ala3|nqala3|mow3id|mo3id|randivo|serviss|tbib|nssawal|blassa|lalla|sidi|kan|taman|bghina|3ndek|3andek|3lach|ymkn|imken|momkin|khoya|khti)\b/i
  const darijaArabic = /بغيت|بغيتي|عندي|واش|فين|شنو|لاباس|سلام|موعد|ضرسي|وجع|كاينين|كاين|غدا|اليوم|خويا|ديال|نتوما|كيبغ|شحال|مزيان|ممكن/

  const strongFrench = (
    /\b(bonjour|bonsoir|merci beaucoup|s'il vous pla[iî]t|je voudrais|je veux|je souhaite|est-ce que|pouvez-vous|quels? sont|horaires?|vous [eê]tes)\b/i.test(lower)
    || /(^|[^a-zà-ÿ-])(je|j'|nous)([^a-zà-ÿ-]|$)/i.test(lower)
  )
  const frenchMarkers = /\b(bonjour|bonsoir|merci|je|j'|nous|avec|pour|horaires?|docteur|dentiste|douleur|urgence|combien|où|demain|aujourd|s'il|svp|voudrais|souhaite|pouvez|quels?|services?|ouverts?|conna[iî]tre)\b/i

  return {
    hasDarijaLatin: darijaLatin.test(lower),
    hasDarijaArabic: darijaArabic.test(raw),
    hasArabicScript: arabicChars >= 2,
    hasStrongFrench: strongFrench,
    hasFrench: frenchMarkers.test(lower) || strongFrench,
    arabicChars,
    latinChars,
  }
}

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

  const s = scoreLanguageSignals(raw)
  const hasDarija = s.hasDarijaLatin || s.hasDarijaArabic || s.hasArabicScript

  // Absolute: any Darija signal (Latin, Arabic, or mixed with French) → darija
  if (hasDarija) {
    return 'darija'
  }

  if (s.arabicChars >= 2 && s.arabicChars >= s.latinChars) {
    return 'darija'
  }

  if (s.hasFrench || s.hasStrongFrench) {
    return 'fr'
  }

  if (s.latinChars > 0) {
    return 'fr'
  }

  if (s.arabicChars > 0) {
    return 'darija'
  }

  return 'auto'
}

/**
 * Detect language with confidence for conversation memory / switch rules.
 * @param {string} text
 * @returns {{
 *   language: 'fr'|'darija'|'unknown',
 *   languageRaw: 'fr'|'darija'|'mixed'|'auto'|'unknown',
 *   confidence: number,
 *   reliable: boolean,
 *   neutral: boolean,
 * }}
 */
function detectLanguageWithConfidence(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return {
      language: 'unknown',
      languageRaw: 'unknown',
      confidence: 0,
      reliable: false,
      neutral: true,
    }
  }

  if (isLanguageNeutral(raw)) {
    return {
      language: 'unknown',
      languageRaw: 'unknown',
      confidence: 0.25,
      reliable: false,
      neutral: true,
    }
  }

  if (/langue probable du vocal:\s*(darija|arabe)/i.test(raw)) {
    return { language: 'darija', languageRaw: 'darija', confidence: 0.9, reliable: true, neutral: false }
  }
  if (/langue probable du vocal:\s*fran[cç]ais/i.test(raw)) {
    return { language: 'fr', languageRaw: 'fr', confidence: 0.9, reliable: true, neutral: false }
  }

  const s = scoreLanguageSignals(raw)
  let darijaScore = 0
  let frScore = 0

  if (s.hasDarijaArabic) darijaScore += 0.55
  if (s.hasDarijaLatin) darijaScore += 0.5
  if (s.hasArabicScript) darijaScore += 0.35
  if (s.hasStrongFrench) frScore += 0.55
  if (s.hasFrench) frScore += 0.35
  if (s.latinChars > 12 && !s.hasDarijaLatin && !s.hasArabicScript) frScore += 0.15

  const mixed = darijaScore >= 0.35 && frScore >= 0.35
  let languageRaw = 'auto'
  let confidence = 0.4

  if (darijaScore > frScore && darijaScore >= 0.35) {
    languageRaw = mixed ? 'mixed' : 'darija'
    // Darija+French mix is still Darija for HEL reply policy
    confidence = Math.min(0.98, 0.55 + darijaScore + (mixed ? 0.1 : 0))
  } else if (frScore > darijaScore && frScore >= 0.35) {
    languageRaw = 'fr'
    confidence = Math.min(0.98, 0.55 + frScore)
  } else if (s.arabicChars >= 2) {
    languageRaw = 'darija'
    confidence = 0.8
  } else if (s.latinChars >= 8 && s.hasFrench) {
    languageRaw = 'fr'
    confidence = 0.78
  } else if (s.latinChars > 0 && !s.hasDarijaLatin) {
    // Weak latin fallback — not reliable enough to switch alone
    languageRaw = 'fr'
    confidence = 0.55
  } else {
    languageRaw = 'unknown'
    confidence = 0.3
  }

  const mapped = languageRaw === 'mixed' || languageRaw === 'darija'
    ? 'darija'
    : languageRaw === 'fr'
      ? 'fr'
      : 'unknown'

  const reliable = mapped !== 'unknown' && confidence >= LANGUAGE_CONFIDENCE_THRESHOLD

  return {
    language: reliable ? mapped : 'unknown',
    languageRaw,
    confidence: Number(confidence.toFixed(2)),
    reliable,
    neutral: false,
  }
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

/**
 * Explicit patient request to switch conversation language (overrides memory).
 * @param {string} text
 * @returns {'fr'|'darija'|null}
 */
function detectExplicitLanguageRequest(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  if (
    /\b(parlez|répondez|repondez|continuer|continue|préfère|prefere|preferez|préférez)\b.{0,50}\b(fran[cç]ais|français)\b/i.test(raw)
    || /\b(en français|in french|speak french|reply in french)\b/i.test(raw)
    || /\bje préfère\b.{0,30}\bfran[cç]ais\b/i.test(raw)
  ) {
    return 'fr'
  }

  if (
    /جاوبني بال(عربية|دارجة)|هضر معايا بال(عربية|دارجة)|بالدارجة|بالعربية/i.test(raw)
    || /\b(speak|reply|answer).{0,20}(darija|arabic|arab(e)?)\b/i.test(raw)
  ) {
    return 'darija'
  }

  return null
}

module.exports = {
  detectLanguage,
  detectLanguageWithConfidence,
  detectExplicitLanguageRequest,
  isLanguageNeutral,
  toReplyLanguageHint,
  detectReplyLanguageHint,
  LANGUAGE_CONFIDENCE_THRESHOLD,
}
