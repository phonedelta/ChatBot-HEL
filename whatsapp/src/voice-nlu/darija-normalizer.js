/**
 * Moroccan Darija NLU normalizer (hybrid).
 * Preserves raw text; protects phones/dates/times/selection indices from Arabizi mangling.
 */

const { canonicalForToken } = require('./dictionary')
const {
  conceptForToken,
  extractConcepts,
  normalizeLexKey,
} = require('./darija-lexicon')

const ARABIZI_DIGIT_MAP = {
  2: 'ء',
  3: 'ع',
  5: 'خ',
  7: 'ح',
  8: 'غ',
  9: 'ق',
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeLoose(text) {
  return String(text || '')
    .split(/(\s+|[\u0600-\u06FF]+|[A-Za-zÀ-ÿ0-9_+@.:/\-']+)/g)
    .filter((part) => part != null && part !== '')
}

function isProtectedToken(token, context = {}) {
  const t = String(token || '').trim()
  if (!t) return true

  // Selection index in slot/patient selection states — never Arabizi-convert bare digits
  if (context.protectBareIndex !== false) {
    if (/^#?\d{1,2}[).]?$/.test(t)) return true
  }

  // Phone
  if (/^\+?\d[\d\s\-.]{6,}\d$/.test(t) || /^\+212/.test(t) || /^0\d{8,}$/.test(t)) return true

  // Date
  if (/^\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?$/.test(t)) return true
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true

  // Time
  if (/^\d{1,2}:\d{2}$/.test(t)) return true
  if (/^\d{1,2}h(\d{2})?$/i.test(t)) return true

  return false
}

/**
 * Convert Arabizi digits inside a WORD token only (e.g. 3afak → عafak surface help).
 * Does not touch protected tokens.
 */
function arabiziTokenToLatinFriendly(token) {
  const t = String(token || '')
  // Must contain a letter next to digit to count as Arabizi word
  if (!/[a-zà-ÿ]/i.test(t) || !/[235789]/.test(t)) return t
  // Don't convert pure numbers
  if (/^\d+$/.test(t)) return t

  return t.replace(/[235789]/g, (d) => ARABIZI_DIGIT_MAP[d] || d)
}

/**
 * Collapse excessive repeated letters: bghiiiiit → bghiit (still maps via lexicon collapse).
 */
function collapseRepeatedLetters(token) {
  const t = String(token || '')
  if (isProtectedToken(t)) return t
  if (!/[a-zà-ÿ\u0600-\u06ff]/i.test(t)) return t
  return t.replace(/([a-zà-ÿ\u0600-\u06ff])\1{2,}/gi, '$1$1')
}

/**
 * Map known surface variants to a stable Latin canonical used by classifiers.
 * Keeps Arabic script forms readable; expands common Arabizi to Latin keys.
 */
function surfaceNormalizeToken(token) {
  let t = collapseRepeatedLetters(token)
  const lower = normalizeLexKey(t)

  // High-frequency orthography fixes before concept lookup
  const SURFACE = {
    chnou: 'chno',
    chnoo: 'chno',
    achno: 'chno',
    achnou: 'chno',
    wash: 'wach',
    wesh: 'wach',
    kayen: 'kayn',
    kaynn: 'kayn',
    gheda: 'ghdda',
    ghedda: 'ghdda',
    ghada: 'ghdda',
    gadda: 'ghdda',
    lyom: 'lyoum',
    brit: 'bghit',
    baghi: 'bghit',
    bagha: 'bghit',
    baghit: 'bghit',
    afak: '3afak',
    aafak: '3afak',
    diali: 'dyali',
    diyali: 'dyali',
    makainch: 'makaynch',
    makayench: 'makaynch',
    foqach: 'fo9ach',
    chhal: 'ch7al',
    nchoufo: 'nchof',
    nalghi: 'nlghi',
    nbdel: 'nbdl',
    nbddl: 'nbdl',
    bdal: 'bdel',
    bdell: 'bdel',
    bddl: 'bdel',
    motaha: 'disponible',
    moutaha: 'disponible',
    mawjoda: 'disponible',
    mawjuda: 'disponible',
    mawa3id: 'maw3id',
    mwa3id: 'maw3id',
    ma3id: 'maw3id',
    mou3id: 'maw3id',
  }
  if (SURFACE[lower]) return SURFACE[lower]

  // Dictionary canonical (dental vocab) when available
  try {
    const can = canonicalForToken(t)
    if (can && can !== t) return can
  } catch { /* optional */ }

  return t
}

/**
 * @param {string} rawText
 * @param {{
 *   protectBareIndex?: boolean,
 *   stage?: string|null,
 * }} [context]
 * @returns {{
 *   rawText: string,
 *   normalizedText: string,
 *   tokens: string[],
 *   concepts: string[],
 *   script: 'latin'|'arabic'|'mixed'|'other',
 *   hasDarijaSignal: boolean,
 * }}
 */
function normalizeDarijaForNlu(rawText, context = {}) {
  const raw = String(rawText || '').trim()
  if (!raw) {
    return {
      rawText: '',
      normalizedText: '',
      tokens: [],
      concepts: [],
      script: 'other',
      hasDarijaSignal: false,
    }
  }

  // In selection / confirmation states with bare digits — protect hard
  const stage = String(context.stage || '')
  const protectBareIndex = context.protectBareIndex !== false
    || /selection|slot|confirm|awaiting_/i.test(stage)

  const parts = tokenizeLoose(raw)
  const outTokens = []
  const rebuilt = []

  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      rebuilt.push(' ')
      continue
    }
    if (/^[,.!?;:]+$/.test(part)) {
      rebuilt.push(part)
      continue
    }

    if (isProtectedToken(part, { protectBareIndex })) {
      outTokens.push(part)
      rebuilt.push(part)
      continue
    }

    let token = collapseRepeatedLetters(part)
    // Arabizi digit→letter only inside alphanumeric words
    if (/[a-z]/i.test(token) && /[235789]/.test(token) && !/^\d+$/.test(token)) {
      // Keep Latin surface for classifier (3afak stays recognizable via lexicon);
      // also add digit-stripped Latin form: 3afak → keep 3afak as primary
      token = surfaceNormalizeToken(token)
    } else {
      token = surfaceNormalizeToken(token)
    }

    outTokens.push(token)
    rebuilt.push(token)
  }

  const normalizedText = rebuilt.join('').replace(/\s+/g, ' ').trim().toLowerCase()
  const concepts = extractConcepts(outTokens.map((t) => normalizeLexKey(t)))

  // Also scan multi-word relative dates
  if (/\bba3d\s+ghdda\b|\bmn\s+b3d\s+ghdda\b|بعد\s*غدا/i.test(raw)) {
    if (!concepts.includes('after_tomorrow')) concepts.push('after_tomorrow')
  }

  const hasArabic = /[\u0600-\u06FF]/.test(raw)
  const hasLatin = /[A-Za-z]/.test(raw)
  let script = 'other'
  if (hasArabic && hasLatin) script = 'mixed'
  else if (hasArabic) script = 'arabic'
  else if (hasLatin) script = 'latin'

  const hasDarijaSignal = concepts.length > 0
    || /\b(bghit|chno|wach|kayn|3afak|ghdda|lyoum|dyali|fin|fo9ach|ch7al|m3a|3ndi)\b/i.test(raw)
    || /بغيت|شنو|واش|كاين|غدا|اليوم|عفاك|فين/.test(raw)

  return {
    rawText: raw,
    normalizedText,
    tokens: outTokens.filter((t) => !/^\s+$/.test(t)),
    concepts,
    script,
    hasDarijaSignal,
  }
}

/**
 * Score intent from concept combinations (phrase-level, not keyword-only).
 * @param {string[]} concepts
 * @param {string} normalizedText
 * @returns {{ intent: string, confidence: number, matched: string }|null}
 */
function classifyIntentFromConcepts(concepts, normalizedText = '') {
  const c = new Set(concepts)
  const text = String(normalizedText || '').toLowerCase()

  // Out-of-scope sports / football — never cabinet hours
  if (
    c.has('sports')
    || /\b(la3ba|l3ba|lbarca|barca|match|football|foot|madrid|كورة|مباراة)\b/i.test(text)
  ) {
    return { intent: 'OTHER', confidence: 0.9, matched: 'concepts:sports_out_of_scope' }
  }

  // Identity / who are you
  if (
    (c.has('identity') && (c.has('pronoun_you') || /\b(nta|nti|bot|assistant|hada)\b/i.test(text)))
    || /\b(chkon|chkoun|shkon|shkoun)\s+(nta|nti|hada)\b/i.test(text)
    || /\b(qui\s+es|vous\s+etes\s+qui|tu\s+es\s+qui)\b/i.test(text)
  ) {
    return { intent: 'ASK_IDENTITY', confidence: 0.95, matched: 'concepts:identity' }
  }

  // CANCEL before LIST (e.g. "bghit nlghi rdv dyali")
  if (c.has('cancel') && (c.has('appointment') || c.has('want') || c.has('my') || /\brdv\b|موعد/.test(text))) {
    return { intent: 'CANCEL_APPOINTMENT', confidence: 0.92, matched: 'concepts:cancel' }
  }

  // RESCHEDULE
  if (c.has('reschedule') && (c.has('appointment') || c.has('want') || /\brdv\b|موعد|lwa9t|heure/.test(text))) {
    return { intent: 'RESCHEDULE_APPOINTMENT', confidence: 0.9, matched: 'concepts:reschedule' }
  }

  // LIST_MY_APPOINTMENTS (critical distinction vs availability)
  // "nom dyali adam" is a name correction — not "my appointments"
  const looksLikeNameClaim = /\b(nom\s+dyali|smiti|smyti|smiya|je\s+m['’]appelle|اسمي|سميتي)\b/i.test(text)
  if (!looksLikeNameClaim && c.has('my') && (c.has('appointment') || /\brdv\b|موعد/.test(text))) {
    return { intent: 'LIST_MY_APPOINTMENTS', confidence: 0.94, matched: 'concepts:my+appointment' }
  }
  if (!looksLikeNameClaim && (
    /\b(rdv|rendez|موعد).{0,12}(dyali|diyali|ديالي)\b/.test(text)
    || /\b(dyali|ديالي).{0,12}(rdv|rendez|موعد)\b/.test(text)
  )) {
    return { intent: 'LIST_MY_APPOINTMENTS', confidence: 0.93, matched: 'phrase:rdv_dyali' }
  }
  if (!looksLikeNameClaim && c.has('whether') && c.has('have') && c.has('appointment')) {
    return { intent: 'LIST_MY_APPOINTMENTS', confidence: 0.9, matched: 'concepts:wach+3ndi+rdv' }
  }

  // CHECK availability — before BOOK (e.g. "bghit maw3id … 3tini l mawa3id li motaha")
  const asksAvailableSlots = (
    c.has('available')
    || /\b(motaha|moutaha|mawjoda|mawjuda|khawya|khawi|dispo|disponible)\b/i.test(text)
    || ((c.has('give') || /\b(3tini|atini|sift)\b/i.test(text))
      && /\b(mawa3id|maw3id|rdv|creneau|créneau|motaha|dispo)\b/i.test(text))
  )
  if (
    asksAvailableSlots
    && (c.has('appointment') || c.has('place_slot') || c.has('available') || c.has('tomorrow') || c.has('today')
      || /\b(mawa3id|maw3id|rdv|creneau|créneau|nhar|horaire)\b/i.test(text))
    && !c.has('my')
  ) {
    return { intent: 'CHECK_APPOINTMENT_AVAILABILITY', confidence: 0.94, matched: 'concepts:availability' }
  }
  if (
    (c.has('what') || c.has('whether') || c.has('see') || c.has('want'))
    && (c.has('exist') || c.has('available') || c.has('place_slot'))
    && (c.has('appointment') || c.has('place_slot') || c.has('available') || c.has('tomorrow') || c.has('today'))
  ) {
    if (!c.has('my')) {
      return { intent: 'CHECK_APPOINTMENT_AVAILABILITY', confidence: 0.92, matched: 'concepts:availability' }
    }
  }
  if (/\b(wach|wash)\s+kayn\s+chi\s+(blassa|rdv|mo3id)/i.test(text)) {
    return { intent: 'CHECK_APPOINTMENT_AVAILABILITY', confidence: 0.95, matched: 'phrase:wach_kayn_chi' }
  }
  if (/\bchno\s+kayn\b/i.test(text) && !/\bdyali\b/i.test(text)) {
    if (/\b(rdv|rendez|mo3id|disponible|blassa|ghdda|lyoum|nhar|سوايع|موعد|demain)\b/i.test(text)
      || c.has('appointment') || c.has('available') || c.has('tomorrow')) {
      return { intent: 'CHECK_APPOINTMENT_AVAILABILITY', confidence: 0.9, matched: 'phrase:chno_kayn' }
    }
  }

  // BOOK
  if (c.has('want') && c.has('appointment') && !asksAvailableSlots) {
    return { intent: 'BOOK_APPOINTMENT', confidence: 0.93, matched: 'concepts:want+appointment' }
  }
  if ((c.has('want') || /\bvouloir\b/.test(text)) && c.has('take') && (c.has('appointment') || /\brdv\b|rendez/.test(text))) {
    return { intent: 'BOOK_APPOINTMENT', confidence: 0.94, matched: 'concepts:want+take+rdv' }
  }
  if ((c.has('want') || /\bvouloir\b/.test(text)) && c.has('appointment') && !asksAvailableSlots) {
    return { intent: 'BOOK_APPOINTMENT', confidence: 0.93, matched: 'concepts:vouloir+appointment' }
  }
  if (c.has('want') && c.has('come')) {
    return { intent: 'BOOK_APPOINTMENT', confidence: 0.86, matched: 'concepts:want+come' }
  }

  // FAQ
  if (c.has('location') || (c.has('where') && (c.has('exist') || c.has('give') || /\b(fin|fayn|فين|localisation|adresse)\b/.test(text)))) {
    if (/\b(fin|fayn|فين|localisation|adresse|dyalkom|sift)\b/.test(text) || c.has('location') || c.has('give')) {
      return { intent: 'ASK_LOCATION', confidence: 0.9, matched: 'concepts:where' }
    }
  }
  // Hours only when clearly about cabinet opening — not bare "imta" + sports
  if ((c.has('hours') && (c.has('what') || c.has('whether') || c.has('when')))
    || (c.has('when') && c.has('hours'))
    || /\b(fo9ach|kat7ell|horaire|حالين|وقتاش)\b/i.test(text)) {
    return { intent: 'ASK_OPENING_HOURS', confidence: 0.88, matched: 'concepts:hours' }
  }
  if (c.has('how_much') || (c.has('price') && !c.has('want'))) {
    return { intent: 'ASK_PRICE', confidence: 0.9, matched: 'concepts:price' }
  }
  // Services offered? (not booking)
  if (
    (c.has('whether') || c.has('what'))
    && (c.has('implant') || c.has('braces') || c.has('cleaning') || c.has('extraction') || /\b(katdiro|katdirou|كتديرو|implant|appareil)\b/i.test(text))
    && !c.has('want')
    && !c.has('appointment')
  ) {
    return { intent: 'ASK_SERVICES', confidence: 0.88, matched: 'concepts:ask_service' }
  }
  if (c.has('pain') && (c.has('tooth') || /\b(ders|darsa|drssa|ضرس|سن)\b/i.test(text))) {
    return { intent: 'DENTAL_PAIN', confidence: 0.92, matched: 'concepts:pain+tooth' }
  }
  if (c.has('emergency') || c.has('swelling')) {
    return { intent: 'DENTAL_EMERGENCY', confidence: 0.88, matched: 'concepts:emergency' }
  }
  if (c.has('thanks') && concepts.length <= 3) {
    return { intent: 'THANKS', confidence: 0.9, matched: 'concepts:thanks' }
  }
  if ((c.has('please') || /\bsalm?\b|سلام|bonjour/i.test(text)) && concepts.length <= 3 && !c.has('want')) {
    if (/\b(salam|slm|سلام|bonjour|bonsoir)\b/i.test(text)) {
      return { intent: 'GREETING', confidence: 0.9, matched: 'concepts:greeting' }
    }
  }

  return null
}

function logDarijaNlu(payload) {
  if (process.env.CRM_DEBUG_DARIJA !== '1') return
  console.log('[DARIJA_NLU]', {
    raw: String(payload.raw || '').slice(0, 120),
    normalized: String(payload.normalized || '').slice(0, 120),
    language: payload.language || null,
    intent: payload.intent || null,
    source: payload.source || null,
    confidence: payload.confidence ?? null,
    concepts: payload.concepts || null,
  })
}

module.exports = {
  normalizeDarijaForNlu,
  classifyIntentFromConcepts,
  isProtectedToken,
  collapseRepeatedLetters,
  arabiziTokenToLatinFriendly,
  tokenizeLoose,
  logDarijaNlu,
  ARABIZI_DIGIT_MAP,
}
