/**
 * Extensible dental-service dictionary for Darija / French / Arabic ASR.
 *
 * Add a new service by appending an entry to SERVICES with:
 *   - id, service (display label), intent, crmProblem
 *   - keywords: exact phrases/words (FR, AR, Darija latin, ASR variants)
 *
 * Matching pipeline:
 *   1) lowercase + strip accents
 *   2) common ASR typo corrections
 *   3) exact / phrase match
 *   4) fuzzy token match (Levenshtein)
 */

/** @typedef {{ id: string, service: string, intent: string, crmProblem: string, urgency?: string, keywords: string[] }} ServiceEntry */
/** @typedef {{ service: string, serviceId: string, confidence: number, matched: string, matchType: string, intent: string, crmProblem: string, urgency: string }} ServiceMatch */

/** @type {ServiceEntry[]} */
const SERVICES = [
  {
    id: 'orthodontie',
    service: 'Orthodontie',
    intent: 'appareil_dentaire',
    crmProblem: 'appareil dentaire',
    urgency: 'basse',
    keywords: [
      'orthodontie', 'orthodontiste', 'orthodontique', 'ortodonti', 'ortodontie', 'orthodonti',
      'appareil dentaire', 'appareil', 'apareil', 'appareils',
      'bagues', 'bague', 'bagat', 'brackets', 'bracket', 'brisat', 'bra',
      'aligneur', 'aligneurs', 'gouttiere', 'gouttière', 'alignement',
      'redresser les dents', 'redresser dents',
      'تقويم الأسنان', 'تقويم', 'بريسات', 'أباري',
      'ta9wim', 'ta9ouim', 't9wim', 'taqwim', 'brisat',
      'dent m3awja', 'snan m3awjin', 'snan m3wjin', 'snan meaouja',
    ],
  },
  {
    id: 'caries',
    service: 'Soins dentaires et traitement des caries',
    intent: 'traitement',
    crmProblem: 'carie',
    urgency: 'moyenne',
    keywords: [
      'carie', 'caries', 'traitement carie', 'soin dentaire', 'soins dentaires',
      'plombage', 'plomba', 'obturation', 'composite', 'cavite', 'cavité',
      'traitmon carie', 'traitment carie', 'traitement caries',
      'حشوة', 'تسوس', 'علاج التسوس',
      'tsous', 'tsouss', 'tssaws', '7chwa', 'hachwa', 'hchouwa',
      'soin ders', 'ders mkelkh', 'ders khser', 'ders khassar',
    ],
  },
  {
    id: 'detartrage',
    service: 'Détartrage',
    intent: 'traitement',
    crmProblem: 'détartrage',
    urgency: 'basse',
    keywords: [
      'detartrage', 'détartrage', 'ditartraj', 'ditartrage', 'tartre', 'nettoyage', 'nettoyage des dents',
      'nettoyer les dents', 'polissage', 'depot', 'dépôt',
      'جير الأسنان', 'تنظيف الأسنان', 'تنظيف',
      'tn9iya', 'tn9iyat snan', 'tnqiya', 'tandif',
      'jir', 'jir snan', 'jir dial snan', 'kan bghi nettoyage',
    ],
  },
  {
    id: 'gencives',
    service: 'Soins des gencives',
    intent: 'traitement',
    crmProblem: 'soins des gencives',
    urgency: 'moyenne',
    keywords: [
      'gencive', 'gencives', 'parodontologie', 'paradontoloji', 'parodontologie',
      'parodonte', 'saignement', 'inflammation',
      'لثة', 'نزيف اللثة',
      'lta', 'lita', 'litta', 'lutha',
      'dam men lta', 'nafkha f lta', 'wje3 lta', 'wje3 f lta',
    ],
  },
  {
    id: 'pediatrique',
    service: 'Dentisterie pédiatrique',
    intent: 'consultation',
    crmProblem: 'dentisterie pédiatrique',
    urgency: 'basse',
    keywords: [
      'enfant', 'bebe', 'bébé', 'pediatrique', 'pédiatrique', 'pediatrie', 'pédiatrie',
      'dent enfant', 'dent de lait', 'dents de lait',
      'طفل', 'أسنان الأطفال', 'اطفال',
      'tfl', 'sghir', 'sghar', 'waldi', 'weldi', 'bnti', 'bniti',
      'snan sghar', 'snan sghir', 'drari',
    ],
  },
  {
    id: 'facettes',
    service: 'Facettes dentaires',
    intent: 'traitement',
    crmProblem: 'facettes dentaires',
    urgency: 'basse',
    keywords: [
      'facette', 'facettes', 'facette dentaire', 'facettes dentaires',
      'veneer', 'veneers', 'luminir', 'lumineer', 'luminers',
      'لومينير', 'فينير',
      'snan zwinin', 'snani zwinin',
    ],
  },
  {
    id: 'blanchiment',
    service: 'Blanchiment des dents',
    intent: 'blanchiment',
    crmProblem: 'blanchiment',
    urgency: 'basse',
    keywords: [
      'blanchiment', 'blanchiment dentaire', 'blanchir', 'blanshmon', 'blanchmon', 'blanciment',
      'white', 'whitening', 'eclaircissement', 'éclaircissement',
      'تبييض الأسنان', 'تبييض',
      'tabyid', 'tabyit', 'tbyid', 'tbiyid', 'tabyid snan',
      'byad snan', 'snani saffrin', 'bghit nbyed snani', 'nbyed snani',
    ],
  },
  {
    id: 'implants',
    service: 'Implants dentaires',
    intent: 'implant',
    crmProblem: 'implant',
    urgency: 'basse',
    keywords: [
      'implant', 'implants', 'implants dentaires', 'implant dentaire',
      'emplant', 'inplant', 'امبلونت', 'امبلانت', 'انبلونت', 'زرع', 'زراعة',
    ],
  },
  {
    id: 'couronnes',
    service: 'Couronnes dentaires',
    intent: 'traitement',
    crmProblem: 'couronne dentaire',
    urgency: 'basse',
    keywords: [
      'couronne', 'couronnes', 'couronnes dentaires', 'couronne dentaire',
      'crown', 'crowns', 'bridge', 'pont dentaire',
      'تاج', 'تيجان', 'كورون',
    ],
  },
  {
    id: 'extraction',
    service: 'Extraction dentaire',
    intent: 'extraction',
    crmProblem: 'extraction',
    urgency: 'moyenne',
    keywords: [
      'extraction', 'extraction dentaire', 'arracher', 'enlever dent',
      'n9ala3', 'nqala3', 'n9la3', 'qala3', 'قلع', 'نقلع',
      'n7ayed', 'nhayed',
    ],
  },
  {
    id: 'consultation',
    service: 'Consultation',
    intent: 'consultation',
    crmProblem: 'consultation générale',
    urgency: 'basse',
    keywords: [
      'consultation', 'consult', 'visite', 'controle', 'contrôle',
      'nssawal', 'nsawal', 'سؤال', 'info', 'information',
      'bghit nchouf tbib', 'bghit nchouf docteur',
    ],
  },
  {
    id: 'urgence',
    service: 'Urgence dentaire',
    intent: 'urgence',
    crmProblem: 'urgence',
    urgency: 'haute',
    keywords: [
      'urgence', 'urgence dentaire', 'urgent', 'douleur', 'abces', 'abcès',
      'gonflement', 'dent cassee', 'dent cassée', 'hemorragie', 'hémorragie', 'infection',
      'طوارئ', 'مستعجل',
      'mosta3jal', 'mosta3jel', 'musta3jil', 'must3jil',
      'wje3', 'wje3 kbir', 'nafkha', 'waram', '7ri9', 'hri9',
      'khrej liya dam', 'ders t9sem', 'ders tkeser', 'ders t9esser',
      '3endi l9i7', '3endi infection', 'l9i7', '3andi wje3',
    ],
  },
]

/** Common ASR / typing corrections applied before matching. */
const SERVICE_ASR_FIXES = {
  tabyit: 'tabyid',
  tbyit: 'tabyid',
  blanshmon: 'blanchiment',
  blanchmon: 'blanchiment',
  blanciment: 'blanchiment',
  ortodonti: 'orthodontie',
  ortodontie: 'orthodontie',
  orthodonti: 'orthodontie',
  paradontoloji: 'parodontologie',
  paradontologie: 'parodontologie',
  apareil: 'appareil',
  brisat: 'brisat',
  tsouss: 'tsous',
  tnqiya: 'tn9iya',
  mosta3jal: 'mosta3jel',
  detartrage: 'détartrage',
  ditartraj: 'détartrage',
  ditartrage: 'détartrage',
  luminir: 'lumineer',
  traitmon: 'traitement',
  traitment: 'traitement',
  emplant: 'implant',
  inplant: 'implant',
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeServiceText(value) {
  return stripAccents(String(value || ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\u0600-\u06FF\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} value
 * @returns {string}
 */
function applyServiceAsrFixes(value) {
  let text = ` ${normalizeServiceText(value)} `
  const entries = Object.entries(SERVICE_ASR_FIXES).sort((a, b) => b[0].length - a[0].length)
  for (const [from, to] of entries) {
    const pattern = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    text = text.replace(pattern, ` ${to} `)
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length

  const rows = left.length + 1
  const cols = right.length + 1
  /** @type {number[]} */
  let prev = new Array(cols)
  /** @type {number[]} */
  let curr = new Array(cols)

  for (let j = 0; j < cols; j += 1) prev[j] = j

  for (let i = 1; i < rows; i += 1) {
    curr[0] = i
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[right.length]
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} similarity 0..1
 */
function similarity(a, b) {
  const left = normalizeServiceText(a)
  const right = normalizeServiceText(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const maxLen = Math.max(left.length, right.length)
  if (!maxLen) return 0
  return 1 - (levenshtein(left, right) / maxLen)
}

/**
 * Max edit distance allowed for fuzzy token match.
 * @param {number} length
 * @returns {number}
 */
function maxDistanceForLength(length) {
  if (length <= 3) return 0
  if (length <= 5) return 1
  if (length <= 8) return 2
  return 3
}

/**
 * Build searchable forms for one service.
 * @param {ServiceEntry} entry
 */
function buildServiceIndex(entry) {
  const phrases = []
  const tokens = []

  for (const raw of entry.keywords || []) {
    const normalized = normalizeServiceText(raw)
    if (!normalized) continue
    if (normalized.includes(' ')) {
      phrases.push(normalized)
    } else {
      tokens.push(normalized)
    }
    // Also index individual words of multi-word keywords when useful (>= 4 chars)
    for (const part of normalized.split(' ')) {
      if (part.length >= 4) tokens.push(part)
    }
  }

  return {
    ...entry,
    phrases: Array.from(new Set(phrases)).sort((a, b) => b.length - a.length),
    tokens: Array.from(new Set(tokens)),
  }
}

const SERVICE_INDEX = SERVICES.map(buildServiceIndex)

/**
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeForServices(text) {
  return normalizeServiceText(text)
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Detect all services above threshold (useful for logging / multi-intent).
 * @param {string} rawText
 * @param {{ minConfidence?: number }} [options]
 * @returns {ServiceMatch[]}
 */
function detectServices(rawText, options = {}) {
  const minConfidence = Number(options.minConfidence ?? 0.72)
  const prepared = applyServiceAsrFixes(rawText)
  if (!prepared) return []

  /** @type {ServiceMatch[]} */
  const matches = []
  for (const entry of SERVICE_INDEX) {
    const score = scoreService(prepared, entry)
    if (score && score.confidence >= minConfidence) {
      matches.push(score)
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Detect the best matching dental service from a transcript.
 * @param {string} rawText
 * @param {{ minConfidence?: number }} [options]
 * @returns {ServiceMatch|null}
 */
function detectService(rawText, options = {}) {
  return detectServices(rawText, options)[0] || null
}

/**
 * @param {string} prepared
 * @param {ReturnType<typeof buildServiceIndex>} entry
 * @returns {ServiceMatch|null}
 */
function scoreService(prepared, entry) {
  const tokens = tokenizeForServices(prepared)
  /** @type {ServiceMatch|null} */
  let best = null

  for (const phrase of entry.phrases) {
    if (prepared.includes(phrase)) {
      const confidence = Math.min(0.99, 0.9 + Math.min(phrase.length, 20) * 0.004)
      const candidate = {
        service: entry.service,
        serviceId: entry.id,
        confidence,
        matched: phrase,
        matchType: 'phrase',
        intent: entry.intent,
        crmProblem: entry.crmProblem,
        urgency: entry.urgency || 'moyenne',
      }
      if (!best || candidate.confidence > best.confidence) best = candidate
    }
  }

  for (const token of tokens) {
    if (entry.tokens.includes(token)) {
      const confidence = token.length >= 6 ? 0.95 : 0.9
      const candidate = {
        service: entry.service,
        serviceId: entry.id,
        confidence,
        matched: token,
        matchType: 'exact',
        intent: entry.intent,
        crmProblem: entry.crmProblem,
        urgency: entry.urgency || 'moyenne',
      }
      if (!best || candidate.confidence > best.confidence) best = candidate
    }
  }

  for (const token of tokens) {
    if (token.length < 4) continue
    for (const keyword of entry.tokens) {
      if (keyword.length < 4) continue
      const dist = levenshtein(token, keyword)
      const allowed = Math.min(maxDistanceForLength(token.length), maxDistanceForLength(keyword.length))
      if (dist > allowed) continue
      const sim = similarity(token, keyword)
      if (sim < 0.72) continue
      const confidence = Math.max(0.75, Math.min(0.93, sim - 0.02))
      const candidate = {
        service: entry.service,
        serviceId: entry.id,
        confidence,
        matched: `${token}~${keyword}`,
        matchType: 'fuzzy',
        intent: entry.intent,
        crmProblem: entry.crmProblem,
        urgency: entry.urgency || 'moyenne',
      }
      if (!best || candidate.confidence > best.confidence) best = candidate
    }
  }

  return best
}

/**
 * Register / replace a service definition at runtime (extensibility helper).
 * @param {ServiceEntry} entry
 */
function upsertService(entry) {
  if (!entry?.id || !entry?.service || !Array.isArray(entry.keywords)) {
    throw new Error('upsertService requires id, service, keywords')
  }
  const index = SERVICES.findIndex((item) => item.id === entry.id)
  const normalized = {
    intent: entry.intent || 'traitement',
    crmProblem: entry.crmProblem || entry.service,
    urgency: entry.urgency || 'moyenne',
    ...entry,
  }
  if (index >= 0) SERVICES[index] = normalized
  else SERVICES.push(normalized)

  SERVICE_INDEX.length = 0
  for (const item of SERVICES) {
    SERVICE_INDEX.push(buildServiceIndex(item))
  }
  return normalized
}

module.exports = {
  SERVICES,
  SERVICE_ASR_FIXES,
  normalizeServiceText,
  applyServiceAsrFixes,
  levenshtein,
  similarity,
  detectService,
  detectServices,
  upsertService,
  scoreService,
}
