/**
 * Dental problem / service classifier — expressed patient concern only (no diagnosis).
 *
 * Separates:
 *   intent (handled elsewhere) | dentalProblem | service | confidence
 */

const { applyServiceAsrFixes, normalizeServiceText } = require('./services-dictionary')
const { OFFICIAL_SERVICES } = require('../crm/services')

/** Internal problem taxonomy (not medical diagnoses). */
const DENTAL_PROBLEMS = {
  BLEEDING_GUMS: 'BLEEDING_GUMS',
  RED_GUMS: 'RED_GUMS',
  SWOLLEN_GUMS: 'SWOLLEN_GUMS',
  GUM_PAIN: 'GUM_PAIN',
  GUM_PROBLEM_GENERAL: 'GUM_PROBLEM_GENERAL',
  TARTAR: 'TARTAR',
  SCALING_REQUEST: 'SCALING_REQUEST',
  CAVITY: 'CAVITY',
  TOOTH_DECAY: 'TOOTH_DECAY',
  YELLOW_TEETH: 'YELLOW_TEETH',
  STAINED_TEETH: 'STAINED_TEETH',
  WHITENING_REQUEST: 'WHITENING_REQUEST',
  TEETH_MISALIGNED: 'TEETH_MISALIGNED',
  OVERLAPPING_TEETH: 'OVERLAPPING_TEETH',
  GAPS_BETWEEN_TEETH: 'GAPS_BETWEEN_TEETH',
  BRACES_REQUEST: 'BRACES_REQUEST',
  CLEAR_ALIGNERS_REQUEST: 'CLEAR_ALIGNERS_REQUEST',
  VENEERS_REQUEST: 'VENEERS_REQUEST',
  HOLLYWOOD_SMILE: 'HOLLYWOOD_SMILE',
  SMILE_MAKEOVER: 'SMILE_MAKEOVER',
  CHILD_DENTAL_PROBLEM: 'CHILD_DENTAL_PROBLEM',
  SEVERE_TOOTH_PAIN: 'SEVERE_TOOTH_PAIN',
  TOOTH_PAIN: 'TOOTH_PAIN',
  DENTAL_SWELLING: 'DENTAL_SWELLING',
  EMERGENCY_REQUEST: 'EMERGENCY_REQUEST',
  EXTRACTION_REQUEST: 'EXTRACTION_REQUEST',
  UNKNOWN_DENTAL_PROBLEM: 'UNKNOWN_DENTAL_PROBLEM',
}

/** Map problem → official CRM service label. */
const PROBLEM_TO_SERVICE = {
  BLEEDING_GUMS: 'Soins des gencives',
  RED_GUMS: 'Soins des gencives',
  SWOLLEN_GUMS: 'Soins des gencives',
  GUM_PAIN: 'Soins des gencives',
  GUM_PROBLEM_GENERAL: 'Soins des gencives',
  TARTAR: 'Détartrage',
  SCALING_REQUEST: 'Détartrage',
  CAVITY: 'Soins dentaires et traitement des caries',
  TOOTH_DECAY: 'Soins dentaires et traitement des caries',
  YELLOW_TEETH: 'Blanchiment des dents',
  STAINED_TEETH: 'Blanchiment des dents',
  WHITENING_REQUEST: 'Blanchiment des dents',
  TEETH_MISALIGNED: 'Orthodontie',
  OVERLAPPING_TEETH: 'Orthodontie',
  GAPS_BETWEEN_TEETH: 'Orthodontie',
  BRACES_REQUEST: 'Orthodontie',
  CLEAR_ALIGNERS_REQUEST: 'Orthodontie',
  VENEERS_REQUEST: 'Facettes dentaires',
  HOLLYWOOD_SMILE: 'Facettes dentaires',
  SMILE_MAKEOVER: 'Facettes dentaires',
  CHILD_DENTAL_PROBLEM: 'Dentisterie pédiatrique',
  SEVERE_TOOTH_PAIN: 'Urgences dentaires',
  DENTAL_SWELLING: 'Urgences dentaires',
  EMERGENCY_REQUEST: 'Urgences dentaires',
  TOOTH_PAIN: 'Urgences dentaires',
  EXTRACTION_REQUEST: 'Extraction dentaire',
  UNKNOWN_DENTAL_PROBLEM: null,
}

const CONFIDENCE_STRONG = 0.8
const CONFIDENCE_WEAK = 0.55

/**
 * @typedef {object} DentalClassification
 * @property {string} dentalProblem
 * @property {string|null} service
 * @property {number} confidence
 * @property {string[]} evidence
 * @property {string[]} dentalProblems
 * @property {string|null} secondaryProblem
 * @property {string} normalizedText
 * @property {string} originalText
 */

/**
 * @param {string} rawText
 * @returns {string}
 */
function prepareText(rawText) {
  return applyServiceAsrFixes(String(rawText || '').trim())
}

function linguisticExtra(rawText) {
  try {
    const { normalizeDarijaText } = require('./normalize')
    return String(normalizeDarijaText(rawText).normalizedText || '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Collect regex matches as evidence tokens (Unicode-aware boundaries for Arabic).
 * @param {RegExp} pattern
 * @param {string} text
 * @returns {string[]}
 */
function matchEvidence(pattern, text) {
  const hits = []
  let source = pattern.source
  if (source.startsWith('\\b')) source = source.slice(2)
  if (source.endsWith('\\b')) source = source.slice(0, -2)
  source = source.replace(/\\b/g, '')
  source = `(?<![\\p{L}\\p{N}_])${source}(?![\\p{L}\\p{N}_])`

  let flags = pattern.flags || 'i'
  if (!flags.includes('u')) flags += 'u'
  if (!flags.includes('g')) flags += 'g'

  const re = new RegExp(source, flags)
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[0]) hits.push(m[0])
  }
  return hits
}

/**
 * Literal phrase match (robust for Arabic / mixed scripts).
 * @param {string[]} phrases
 * @param {string} text
 * @param {string} originalText
 * @returns {string[]}
 */
function matchPhrases(phrases, text, originalText) {
  const hits = []
  for (const phrase of phrases) {
    const norm = normalizeServiceText(phrase)
    if ((norm && text.includes(norm)) || originalText.includes(phrase)) {
      hits.push(phrase)
    }
  }
  return hits
}

/**
 * @param {string} text - prepared lowercase text
 * @returns {DentalClassification}
 */
function classifyDentalProblem(rawText) {
  const originalText = String(rawText || '').trim()
  const normalizedText = prepareText(originalText)
  const text = normalizedText
  const ling = linguisticExtra(originalText)
  const painSearch = ling && ling !== text.toLowerCase() ? `${text} ${ling}` : text

  /** @type {{ problem: string, service: string|null, confidence: number, evidence: string[], priority: number }[]} */
  const candidates = []

  function add(problem, confidence, evidence, priority = 50) {
    if (!evidence.length && confidence < 0.9) return
    candidates.push({
      problem,
      service: PROBLEM_TO_SERVICE[problem] ?? null,
      confidence,
      evidence,
      priority,
    })
  }

  // --- Strong explicit service requests (highest priority) ---
  const veneerHits = [
    ...matchEvidence(
      /\b(facettes?\s*dentaires?|facettes?|veneers?|hollywood\s*smile|bghit\s*(l\s*)?veneers?|bghit\s*hollywood)\b/i,
      text,
    ),
    ...matchPhrases(['فينير', 'لومينير', 'بغيت الفينير', 'بغيت Hollywood Smile'], text, originalText),
  ]
  if (veneerHits.length) {
    const isHollywood = /hollywood/i.test(text)
    add(isHollywood ? 'HOLLYWOOD_SMILE' : 'VENEERS_REQUEST', 0.96, veneerHits, 90)
  }

  const whiteningHits = [
    ...matchEvidence(
      /\b(blanchiment|blanchir|whitening|tabyid|tabyit|tbyid|nbyed\s*snan|snani?\s*(sfar|saffrin|jaunes?)|dents?\s+(?:sont\s+|tr[eè]s\s+)?(?:jaunes?|tach[eé]es?)|(?:jaunes?|tach[eé]es?)\s+dents?|bghit\s*(ndir\s*)?(blanchiment|tabyid|nbyed))\b/i,
      text,
    ),
    ...matchPhrases(['تبييض', 'بغيت نبيض سناني', 'سناني صفرين', 'snani sfar'], text, originalText),
  ]
  if (whiteningHits.length && !veneerHits.length) {
    const isYellow = /jaune|sfar|saffrin|tach|صفر/i.test(text) || /صفر/i.test(originalText)
    add(isYellow ? 'YELLOW_TEETH' : 'WHITENING_REQUEST', 0.94, whiteningHits, 85)
  }

  const scalingHits = [
    ...matchEvidence(
      /\b(d[eé]tartrage|ditartraj|detartrage|tartre|tn9iya|tnqiya|jir|nettoyage\s*(des\s*)?dents?|bghit\s*(ndir\s*)?(detartrage|d[eé]tartrage|tn9iya))\b/i,
      text,
    ),
    ...matchPhrases(['جير', 'تنظيف', 'الجير', 'عندي الجير', 'بغيت ندير الديتارتراج', '3ndi jerr'], text, originalText),
  ]
  if (scalingHits.length) {
    const isTartar = /tartre|jir|tn9iya|detartr|جير/i.test(text) || /جير/i.test(originalText)
    add(isTartar ? 'TARTAR' : 'SCALING_REQUEST', 0.95, scalingHits, 84)
  }

  const cavityHits = [
    ...matchEvidence(
      /\b(carie?s?|cavite|cavité|plombage|tsous|tsouss|tssaws|tsaws|3ndi\s*tsaws|hachwa|7chwa)\b/i,
      text,
    ),
    ...matchPhrases(['تسوس', 'عندي تسوس', 'سن مسوس'], text, originalText),
  ]
  if (cavityHits.length) {
    add('CAVITY', 0.94, cavityHits, 83)
  }

  const orthoHits = [
    ...matchEvidence(
      /\b(orthodontie|appareil|apareil|bagues|aligneurs?|goutti[eè]res?(?:\s+transparentes?)?|ta9wim|t9wim|taqwim|bghit\s*appareil|snan(i)?\s*(machi\s*)?(mratbin|m3awjin|meaouja|pas\s*droites?)|dents?\s*(?:mal\s*align[eé]es?|(?:qui\s+)?se\s+chevauchent|pas\s*droites?))\b/i,
      text,
    ),
    ...matchPhrases([
      'تقويم الأسنان', 'بغيت ندير تقويم', 'سناني ماشي مرصوصين مزيان', 'snani machi mratbin',
    ], text, originalText),
  ]
  if (orthoHits.length) {
    const overlapping = /chevauch|m3awj|mratbin|pas\s*droites?|mach.*mratbin|ماشي\s*مرصوص/i.test(text)
      || /mratbin|مرصوص/i.test(originalText)
    add(overlapping ? 'OVERLAPPING_TEETH' : 'BRACES_REQUEST', 0.93, orthoHits, 82)
  }

  const gapHits = matchEvidence(
    /\b(espace?s?\s*(?:entre\s*)?(?:mes\s+|les\s+|mes\s+)?dents?|espaces?\s+entre|espacement|faragh|farag|فراغ|3ndi\s*faragh|gaps?\s*between)\b/i,
    text,
  )
  if (gapHits.length && !veneerHits.length) {
    const alignIntent = /\b(aligner|fermer|appareil|orthodont|ta9wim|t9wim)\b/i.test(text)
    add('GAPS_BETWEEN_TEETH', alignIntent ? 0.88 : 0.72, gapHits, alignIntent ? 81 : 60)
  }

  const bleedingHits = [
    ...matchEvidence(
      /\b(gencives?\s*saign|saignement|saignent|saigne|sang\s*(quand|au|des|du)|katdmi|katdemi|kaydmi|kaydemi|kayn?z?l\s*(l\s*)?dam|nzl\s*dam|nzel\s*dam|ltha?\s*dyali\s*katdmi|l7ya\s*dyali\s*katdmi|ltha\s*katdmi)\b/i,
      text,
    ),
    ...matchPhrases([
      'اللثة ديالي كتدمي', 'كتدمي', 'كيدمي', 'نزيف اللثة', 'مني كنغسل سناني كينزل الدم',
    ], text, originalText),
  ]
  if (bleedingHits.length) {
    add('BLEEDING_GUMS', 0.96, bleedingHits, 86)
  }

  const gumPainHits = matchEvidence(
    /\b(mal\s*(aux?\s*)?gencives?|douleur\s*(aux?\s*)?gencives?|wje3\s*(f\s*)?(lta|l7ya|ltha|lta7ya|gencive)|gencives?\s*(douleur|mal|inflam|gonfl|rouge)|لثة\s*توجع|وجع\s*اللثة|lta7ya\s*katwja3|l7ya\s*katwja3)\b/i,
    text,
  )
  if (gumPainHits.length && !bleedingHits.length) {
    add(/gonfl|inflam|rouge|nafkha/i.test(text) ? 'SWOLLEN_GUMS' : 'GUM_PAIN', 0.9, gumPainHits, 80)
  }

  const extractionHits = matchEvidence(
    /\b(extraction|n7yed|n7ayed|nhayed|n9ala3|nqala3|n9la3|qala3|arracher|خلع|قلع|بغيت\s*نحيد|بغيت\s*نقلع)\b/i,
    text,
  )
  if (extractionHits.length) {
    add('EXTRACTION_REQUEST', 0.92, extractionHits, 79)
  }

  const pediatricHits = matchEvidence(
    /\b(enfant|b[eé]b[eé]|p[eé]diatrique|pediatrique|weldi|waldi|bnti|bniti|tfl|sghir|drari|طفل|ولدي|بنتي|fils|fille)\b/i,
    text,
  )
  if (pediatricHits.length && (/\b(mal|douleur|wje3|kaydr|probleme|probl[eè]me|snan|dent)\b/i.test(text))) {
    add('CHILD_DENTAL_PROBLEM', 0.88, pediatricHits, 78)
  }

  const emergencyHits = [
    ...matchEvidence(
      /\b(urgence|urgent|mesta3?j[ie]l|musta3jil|douleur\s*insupportable|mal\s*(tr[eè]s\s*)?(fort|insupportable)|kaydrni\s*bzaf|kaydreni\s*bzaf|ki?drni\s*bzaf|wje3\s*kbir|joue\s*gonfl|gonflement\s*(important|fort))\b/i,
      text,
    ),
    ...matchPhrases(['مستعجل', 'طوارئ', 'سني كيضرني بزاف و مستعجل', 'كيضرني بزاف'], text, originalText),
  ]
  if (emergencyHits.length) {
    add(/gonfl|nafkha|joue/i.test(text) ? 'DENTAL_SWELLING' : 'EMERGENCY_REQUEST', 0.91, emergencyHits, 88)
  }

  const severePainHits = matchEvidence(
    /\b(tr[eè]s\s*mal|mal\s*fort|douleur\s*forte|kaydrni\s*bzaf|wje3\s*kbir|7ri9|hri9)\b/i,
    text,
  )
  if (severePainHits.length && !emergencyHits.length) {
    add('SEVERE_TOOTH_PAIN', 0.78, severePainHits, 70)
  }

  const weakPainHits = matchEvidence(/\b(mal|douleur|wje3|waj3|wja3|lwja3|kaydrni|kaydreni|kadarni|kaderni|katdarni|kaydarni|katwja3|kaywja3|وجع|ألم|كايضر|كاتضر)\b/i, painSearch)
  const hasSpecificDentalContext = candidates.length > 0
    || /\b(gencive|gencives|lta|l7ya|ltha|lta7ya|carie|tartre|jir|blanchiment|facette|appareil|orthodont|detartrage|tsous)\b/i.test(text)

  if (weakPainHits.length && !hasSpecificDentalContext) {
    // Vague dental problem
    if (/probl[eè]me\s*(avec\s*)?(une\s*)?(dent|dents?)|probleme\s*(de\s*)?dent/i.test(text)) {
      add('UNKNOWN_DENTAL_PROBLEM', 0.35, weakPainHits, 10)
    } else if (/^(mal|douleur|j['']ai\s*mal)\.?$/i.test(text.trim()) || /^mal\s*$/i.test(text.trim())) {
      add('UNKNOWN_DENTAL_PROBLEM', 0.2, weakPainHits, 5)
    } else if (/\b(mal|douleur|wje3|kaydrni|kadarni|wja3)\b/i.test(painSearch)
      && /\b(dent|ders|darssa|darsa|snan|sni|snani|ضرس|سن)\b/i.test(painSearch)) {
      add('TOOTH_PAIN', 0.58, weakPainHits, 40)
    }
  }

  // Multi-problem: tartar + bleeding
  let secondaryProblem = null
  if (bleedingHits.length && scalingHits.length) {
    secondaryProblem = 'TARTAR'
  }

  if (!candidates.length) {
    return {
      dentalProblem: DENTAL_PROBLEMS.UNKNOWN_DENTAL_PROBLEM,
      service: null,
      confidence: 0,
      evidence: [],
      dentalProblems: [],
      secondaryProblem: null,
      normalizedText,
      originalText,
    }
  }

  candidates.sort((a, b) => (b.priority - a.priority) || (b.confidence - a.confidence))
  const best = candidates[0]
  const dentalProblems = [...new Set(candidates.map((c) => c.problem))]

  // Suppress low-confidence classifications
  if (best.confidence < CONFIDENCE_WEAK) {
    return {
      dentalProblem: DENTAL_PROBLEMS.UNKNOWN_DENTAL_PROBLEM,
      service: null,
      confidence: best.confidence,
      evidence: best.evidence,
      dentalProblems: dentalProblems.filter((p) => p !== DENTAL_PROBLEMS.UNKNOWN_DENTAL_PROBLEM),
      secondaryProblem,
      normalizedText,
      originalText,
    }
  }

  return {
    dentalProblem: best.problem,
    service: best.service,
    confidence: best.confidence,
    evidence: best.evidence,
    dentalProblems,
    secondaryProblem,
    normalizedText,
    originalText,
  }
}

/**
 * Whether a service hit from the legacy dictionary should be overridden/discarded.
 * @param {{ service?: string|null, confidence?: number }} dictionaryHit
 * @param {DentalClassification} classification
 */
function shouldPreferClassification(dictionaryHit, classification) {
  if (!classification?.dentalProblem || classification.dentalProblem === DENTAL_PROBLEMS.UNKNOWN_DENTAL_PROBLEM) {
    if ((classification?.confidence || 0) < CONFIDENCE_WEAK && dictionaryHit?.service) {
      // Discard weak dictionary hits when classifier says unknown
      const weakDouleurUrgence = dictionaryHit.service === 'Urgences dentaires'
        && classification.confidence < CONFIDENCE_WEAK
      return weakDouleurUrgence
    }
    return false
  }
  if ((classification.confidence || 0) >= CONFIDENCE_STRONG) return true
  if ((classification.confidence || 0) >= CONFIDENCE_WEAK
    && (!dictionaryHit?.service || (dictionaryHit.confidence || 0) < (classification.confidence || 0))) {
    return true
  }
  return false
}

module.exports = {
  DENTAL_PROBLEMS,
  PROBLEM_TO_SERVICE,
  CONFIDENCE_STRONG,
  CONFIDENCE_WEAK,
  classifyDentalProblem,
  shouldPreferClassification,
  prepareText,
}
