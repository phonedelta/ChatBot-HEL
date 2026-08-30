/**
 * NLU fallback — short clarification when the patient message is unclear.
 * Never starts booking or other sensitive workflows on low confidence / gibberish.
 */

const { hasExplicitBookingIntent } = require('./intent-table')

const CONFIDENCE_EXECUTE = 0.75
const CONFIDENCE_UNKNOWN_MAX = 0.45

const EXPLICIT_UNCLEAR = [
  /^je\s+(ne\s+)?(sais|comprends)\s+pas\b/i,
  /^j\s*['']?ai\s+pas\s+compris\b/i,
  /^je\s+ne\s+comprends\s+pas\b/i,
  /^what\s*\?*$/i,
  /^hein\s*\?*$/i,
  /^huh\s*\?*$/i,
  /^مفهمتش\b/,
  /^ما\s*فهمتش\b/,
]

const GIBBERISH_EXACT = new Set([
  'ui', 'u', 'i', 'ii', 'iii', 'hhh', 'hh', 'h', 'asdf', 'asdfgh', 'qwerty',
  'test', 'okok', '???', '??', '?', '...', '..', 'xxx', 'zzz',
])

const SHORT_ALLOWED = new Set([
  'oui', 'non', 'ok', 'salam', 'slm', 'bonjour', 'bjr', 'bonsoir', 'salut',
  'merci', 'cc', 'cv', 'ah', 'wi', 'na', 'la', 'laa', 'لا', 'نعم', 'wakha',
  'safi', 'labas', 'lbss',
])

/**
 * @param {string} text
 */
function normalizeFallbackText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\u0600-\u06FF?؟!.…]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 */
function isExplicitUnclearPhrase(text) {
  const raw = String(text || '').trim()
  const norm = normalizeFallbackText(raw)
  if (!norm) return true
  return EXPLICIT_UNCLEAR.some((re) => re.test(raw) || re.test(norm))
}

/**
 * @param {string} text
 */
function isGibberishMessage(text) {
  const raw = String(text || '').trim()
  if (!raw) return true

  const norm = normalizeFallbackText(raw)
  if (!norm) return true

  if (/^[?؟!.…\s]+$/u.test(raw)) return true
  if (GIBBERISH_EXACT.has(norm)) return true

  // Repeated single letter / keyboard mash
  if (/^(.)\1{2,}$/i.test(norm.replace(/\s/g, ''))) return true
  if (/^(asdf|qwer|zxcv|hjkl|fghj|dfgh)+$/i.test(norm.replace(/\s/g, ''))) return true

  // Very short token — not a known greeting / binary reply
  if (norm.length <= 3 && !SHORT_ALLOWED.has(norm)) {
    return true
  }

  return false
}

/**
 * Message long enough or with clinic vocabulary — let LLM / router handle even if OTHER.
 * @param {string} text
 */
function hasSubstantiveContent(text) {
  const raw = String(text || '').trim()
  const norm = normalizeFallbackText(raw)
  if (norm.length >= 14) return true
  if (/[\u0600-\u06FF]{5,}/.test(raw)) return true
  return /\b(rdv|rendez|annul|douleur|dent|dents|tbib|dentiste|cabinet|urgence|horaire|ouvert|prix|adresse|service|consult|bghit|wach|wash|fin|fayn|chno|chnou|salam|bonjour|mo3id|mow3id|موعد|وجع|ضرس|ساع|فتح|ثمن|عنوان|خدم|لعيادة|مركز)\b/i.test(norm)
}

const SENSITIVE_LOW_CONF_INTENTS = new Set([
  'BOOK_APPOINTMENT',
  'CANCEL_APPOINTMENT',
  'RESCHEDULE_APPOINTMENT',
])

/**
 * @param {{ intent?: string, intentConfidence?: number, bookAppointment?: boolean }} router
 * @param {string} text
 */
function shouldUseNluFallback(router, text) {
  const raw = String(text || '').trim()
  if (!raw) return true

  if (isExplicitUnclearPhrase(raw) || isGibberishMessage(raw)) {
    return true
  }

  const intent = String(router?.intent || 'OTHER').toUpperCase()
  const conf = Number(router?.intentConfidence || 0)

  if (intent === 'UNKNOWN') return true

  // Never block clear booking / cancel when confidence is high enough
  if (router?.bookAppointment && conf >= CONFIDENCE_EXECUTE && hasExplicitBookingIntent(raw)) {
    return false
  }

  if (hasSubstantiveContent(raw) && !isGibberishMessage(raw)) {
    // Classifier missed but message looks real → LLM may answer (hours, pain, etc.)
    if (intent !== 'OTHER' && conf >= CONFIDENCE_UNKNOWN_MAX) return false
    if (intent === 'OTHER' && hasSubstantiveContent(raw)) return false
  }

  if (conf < CONFIDENCE_UNKNOWN_MAX && intent === 'OTHER') {
    return true
  }

  if (
    conf >= CONFIDENCE_UNKNOWN_MAX
    && conf < CONFIDENCE_EXECUTE
    && SENSITIVE_LOW_CONF_INTENTS.has(intent)
    && !hasExplicitBookingIntent(raw)
  ) {
    return true
  }

  return false
}

/**
 * @param {'fr'|'darija'|string} language
 * @param {number} [attempt=1]
 */
function clarificationMessage(language, attempt = 1) {
  const darija = language === 'darija' || language === 'ar' || language === 'mixed'
  if (attempt >= 2) {
    if (darija) {
      return 'مازال ما قدرتش نفهم الطلب ديالك. تقدر تكتب مثلا: « بغيت موعد »، أو كتب ليا السؤال ديالك مباشرة.'
    }
    return 'Je n’arrive toujours pas à identifier votre demande. Vous pouvez écrire par exemple : « Je veux un rendez-vous », ou poser directement votre question.'
  }
  if (darija) {
    return 'ما فهمتش مزيان شنو بغيتي. واش بغيتي تاخد موعد، ولا عندك شي سؤال آخر على المركز؟'
  }
  return [
    'Je n’ai pas bien compris votre demande. Que souhaitez-vous faire exactement ?',
    '',
    'Voulez-vous prendre un rendez-vous, ou avez-vous une autre question concernant le cabinet ?',
  ].join('\n')
}

/**
 * When patient is already in bulk form stage but sends gibberish.
 * @param {'fr'|'darija'|string} language
 */
function formAwaitingClarifyMessage(language) {
  const darija = language === 'darija' || language === 'ar' || language === 'mixed'
  if (darija) {
    return 'ما فهمتش الجواب ديالك. عافاك صيفط المعلومات الناقصة برسالة نصية (تقدر تصيفطهم فمساج واحد ولا فكثر من مساج).'
  }
  return 'Je n’ai pas bien compris votre message. Merci d’envoyer les informations encore manquantes par texte — vous pouvez les envoyer en un ou plusieurs messages.'
}

module.exports = {
  CONFIDENCE_EXECUTE,
  CONFIDENCE_UNKNOWN_MAX,
  shouldUseNluFallback,
  clarificationMessage,
  formAwaitingClarifyMessage,
  isGibberishMessage,
  isExplicitUnclearPhrase,
  hasSubstantiveContent,
  normalizeFallbackText,
}
