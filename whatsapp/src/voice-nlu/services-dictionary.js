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
    intent: 'BOOK_APPOINTMENT',
    crmProblem: 'Orthodontie',
    urgency: 'basse',
    keywords: [
      'orthodontie', 'orthodontiste', 'orthodontique', 'ortodonti', 'ortodontie', 'orthodonti',
      'appareil dentaire', 'appareil', 'apareil', 'appareils', 'bghit appareil', 'bghit ta9wim',
      'bagues', 'bague', 'bagat', 'brackets', 'bracket', 'brisat',
      'aligneur', 'aligneurs', 'gouttiere', 'gouttière', 'gouttieres', 'alignement',
      'redresser les dents', 'redresser dents',
      'dents mal alignees', 'dents qui se chevauchent', 'dents pas droites',
      'espace entre les dents', 'espaces entre les dents', 'espacement dentaire',
      'faragh bin snani', '3ndi faragh', 'snani machi mratbin',
      'gouttieres transparentes', 'aligneurs transparents',
      'تقويم الأسنان', 'تقويم', 'بريسات', 'أباري', 'بغيت تقويم', 'بغيت اباراي',
      'ta9wim', 'ta9ouim', 't9wim', 'taqwim',
      'dent m3awja', 'snan m3awjin', 'snan m3wjin', 'snan meaouja',
    ],
  },
  {
    id: 'caries',
    service: 'Soins dentaires et traitement des caries',
    intent: 'traitement',
    crmProblem: 'Soins dentaires et traitement des caries',
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
    intent: 'BOOK_APPOINTMENT',
    crmProblem: 'Détartrage',
    urgency: 'basse',
    keywords: [
      'detartrage', 'détartrage', 'ditartraj', 'ditartrage', 'tartre',
      'beaucoup de tartre', 'enlever le tartre', 'bghit detartrage', 'bghit ndir detartrage',
      'nettoyage', 'nettoyage des dents', 'bghit nettoyage', 'bghit nettoyage des dents',
      'nettoyer les dents', 'polissage', 'depot', 'dépôt',
      'جير الأسنان', 'تنظيف الأسنان', 'تنظيف', 'بغيت تنظيف',
      'tn9iya', 'tn9iyat snan', 'tnqiya', 'tandif', 'bghit tn9iya',
      'jir', 'jir snan', 'jir dial snan', 'kan bghi nettoyage',
    ],
  },
  {
    id: 'gencives',
    service: 'Soins des gencives',
    intent: 'traitement',
    crmProblem: 'Soins des gencives',
    urgency: 'moyenne',
    keywords: [
      'gencive', 'gencives', 'parodontologie', 'paradontoloji', 'parodontologie',
      'parodonte', 'saignement', 'saignent', 'saigne', 'inflammation',
      'gencives saignent', 'sang quand je me brosse',
      'لثة', 'نزيف اللثة', 'اللثة ديالي كتدمي', 'كتدمي', 'كيدمي',
      'lta', 'lita', 'litta', 'l7ya', 'ltha', 'lutha',
      'katdmi', 'katdemi', 'kaydmi', 'kaydemi', 'ltha dyali katdmi',
      'dam men lta', 'nafkha f lta', 'wje3 lta', 'wje3 f lta', 'mal aux gencives',
    ],
  },
  {
    id: 'pediatrique',
    service: 'Dentisterie pédiatrique',
    intent: 'consultation',
    crmProblem: 'Dentisterie pédiatrique',
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
    crmProblem: 'Facettes dentaires',
    urgency: 'basse',
    keywords: [
      'facette', 'facettes', 'facette dentaire', 'facettes dentaires',
      'veneer', 'veneers', 'luminir', 'lumineer', 'luminers',
      'hollywood smile', 'hollywood',
      'refaire mon sourire', 'changer la forme des dents', 'smile makeover',
      'لومينير', 'فينير', 'بغيت الفينير',
      'snan zwinin', 'snani zwinin', 'bghit veneers',
    ],
  },
  {
    id: 'blanchiment',
    service: 'Blanchiment des dents',
    intent: 'BOOK_APPOINTMENT',
    crmProblem: 'Blanchiment des dents',
    urgency: 'basse',
    keywords: [
      'blanchiment', 'blanchiment dentaire', 'blanchir', 'blanshmon', 'blanchmon', 'blanciment',
      'bghit blanchiment', 'bghit tabyid', 'bghit tabyid snani', 'bghit tabyit snani',
      'white', 'whitening', 'eclaircissement', 'éclaircissement',
      'dents jaunes', 'dents tachees', 'dents tachées', 'snani sfar', 'snani sfarin',
      'snani jaunes', 'enlever les taches', 'taches de cafe', 'taches de tabac',
      'تبييض الأسنان', 'تبييض', 'بغيت تبييض',
      'tabyid', 'tabyit', 'tbyid', 'tbiyid', 'tabyid snan', 'tabyid snani', 'tabyit snani',
      'byad snan', 'snani saffrin', 'bghit nbyed snani', 'nbyed snani',
    ],
  },
  {
    id: 'implants',
    service: 'Implants dentaires',
    intent: 'BOOK_APPOINTMENT',
    crmProblem: 'Implants dentaires',
    urgency: 'basse',
    keywords: [
      'implant', 'implants', 'implants dentaires', 'implant dentaire',
      'bghit implant', 'بغيت زرع', 'بغيت امبلونت',
      'emplant', 'inplant', 'امبلونت', 'امبلانت', 'انبلونت', 'زرع', 'زراعة', 'زراعة الأسنان',
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
    intent: 'BOOK_APPOINTMENT',
    crmProblem: 'Extraction dentaire',
    urgency: 'moyenne',
    keywords: [
      // FR
      'extraction', 'extraction dentaire', 'arracher', 'enlever dent', 'enlever une dent',
      // Darija Latin — full phrases first
      'n7yed derssa', 'n7yed ders', 'n7yed sn', 'n7yed snan', 'n7yed senn',
      'nhayed derssa', 'nhayed ders', 'nhayed sn',
      'n9ala3 ders', 'n9ala3 derssa', 'n9ala3 sn', 'n9ala3 snan', 'nqala3 ders', 'nqala3 sn',
      'bghit n7yed derssa', 'bghit n7yed ders', 'bghit n7yed sn',
      'bghit n9ala3 ders', 'bghit n9ala3 sn', 'bghit extraction', 'bghit n9ala3',
      'n9ala3', 'nqala3', 'n9la3', 'qala3', 'khla3', 'n7yed', 'n7ayed', 'nhayed',
      // Arabic
      'خلع', 'قلع', 'نقلع', 'نحيد', 'بغيت نحيد ضرس', 'بغيت نقلع ضرس',
      'بغيت نحيض ضرس', 'ضرس خاصني نحيدو', 'سن خاصني نحيدو',
      'خاصني نحيد ضرس', 'خاصني نقلع ضرس', 'خلع السن', 'قلع الضرس',
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
    service: 'Urgences dentaires',
    intent: 'urgence',
    crmProblem: 'Urgences dentaires',
    urgency: 'haute',
    keywords: [
      'urgence', 'urgence dentaire', 'urgent', 'douleur insupportable',
      'douleur forte', 'tres mal', 'très mal', 'mal fort',
      'gonflement important', 'joue gonflee', 'joue gonflée',
      'dent cassee', 'dent cassée', 'hemorragie', 'hémorragie', 'infection',
      'طوارئ', 'مستعجل',
      'mosta3jal', 'mosta3jel', 'musta3jil', 'must3jil',
      'wje3 kbir', 'nafkha', 'waram', '7ri9', 'hri9',
      'khrej liya dam', 'ders t9sem', 'ders tkeser', 'ders t9esser',
      '3endi l9i7', '3endi infection', 'l9i7',
      'kaydrni bzaf', 'kaydreni bzaf',
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
  detartage: 'détartrage',
  jerr: 'jir',
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
    // Index individual words only when long enough to avoid collisions
    // (e.g. "ders" from caries phrases stealing extraction requests).
    for (const part of normalized.split(' ')) {
      if (part.length >= 6) tokens.push(part)
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

  // Fuzzy only for longer tokens; never fuzzy-match short verbs like n7yed↔nbyed
  for (const token of tokens) {
    if (token.length < 6) continue
    for (const keyword of entry.tokens) {
      if (keyword.length < 6) continue
      const dist = levenshtein(token, keyword)
      const allowed = Math.min(maxDistanceForLength(token.length), maxDistanceForLength(keyword.length))
      if (dist > allowed) continue
      const sim = similarity(token, keyword)
      if (sim < 0.84) continue
      const confidence = Math.max(0.8, Math.min(0.9, sim - 0.02))
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
