/**
 * Official HEL dental services + synonym resolution.
 * Patient wording → canonical CRM service label.
 */

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Official service catalogue (CRM `problem` / motif IA). */
const OFFICIAL_SERVICES = [
  'Orthodontie',
  'Soins dentaires et traitement des caries',
  'Détartrage',
  'Soins des gencives',
  'Dentisterie pédiatrique',
  'Facettes dentaires',
  'Blanchiment des dents',
  'Urgences dentaires',
  'Implants dentaires',
  'Extraction dentaire',
  'Consultation',
]

/**
 * Synonyms / free-text → official service.
 * Keys must be normalized via normalizeKey.
 */
const SERVICE_SYNONYMS = {
  // Détartrage
  'nettoyage des dents': 'Détartrage',
  nettoyage: 'Détartrage',
  'nettoyage dentaire': 'Détartrage',
  detartrage: 'Détartrage',
  'detartrage dentaire': 'Détartrage',
  tartre: 'Détartrage',
  'jir snan': 'Détartrage',
  jir: 'Détartrage',
  tandif: 'Détartrage',
  tn9iya: 'Détartrage',
  'تنظيف الاسنان': 'Détartrage',
  'جير الاسنان': 'Détartrage',
  تنظيف: 'Détartrage',
  جير: 'Détartrage',

  // Orthodontie
  orthodontie: 'Orthodontie',
  appareil: 'Orthodontie',
  'appareil dentaire': 'Orthodontie',
  apareil: 'Orthodontie',
  bagues: 'Orthodontie',
  brisat: 'Orthodontie',
  aligneur: 'Orthodontie',
  t9wim: 'Orthodontie',
  ta9wim: 'Orthodontie',
  تقويم: 'Orthodontie',

  // Caries / soins
  carie: 'Soins dentaires et traitement des caries',
  caries: 'Soins dentaires et traitement des caries',
  'soins dentaires': 'Soins dentaires et traitement des caries',
  plombage: 'Soins dentaires et traitement des caries',
  hachwa: 'Soins dentaires et traitement des caries',
  '7chwa': 'Soins dentaires et traitement des caries',
  tsous: 'Soins dentaires et traitement des caries',
  tsouss: 'Soins dentaires et traitement des caries',
  tssous: 'Soins dentaires et traitement des caries',
  تسوس: 'Soins dentaires et traitement des caries',
  حشو: 'Soins dentaires et traitement des caries',
  حشوة: 'Soins dentaires et traitement des caries',

  // Orthodontie extras
  'appareil lsnani': 'Orthodontie',
  'appareil snani': 'Orthodontie',
  n9awem: 'Orthodontie',
  n9awm: 'Orthodontie',

  // Gencives
  'soins des gencives': 'Soins des gencives',
  gencive: 'Soins des gencives',
  gencives: 'Soins des gencives',
  parodontie: 'Soins des gencives',
  paradontie: 'Soins des gencives',
  saignement: 'Soins des gencives',
  'gencives saignent': 'Soins des gencives',
  lta: 'Soins des gencives',
  lita: 'Soins des gencives',
  l7ya: 'Soins des gencives',
  ltha: 'Soins des gencives',
  lta7ya: 'Soins des gencives',
  lta7ia: 'Soins des gencives',
  katnzeff: 'Soins des gencives',
  katnzef: 'Soins des gencives',
  katdmi: 'Soins des gencives',
  katdemi: 'Soins des gencives',
  لثة: 'Soins des gencives',
  'نزيف اللثة': 'Soins des gencives',

  // Pédiatrie
  'dentisterie pediatrique': 'Dentisterie pédiatrique',
  pediatrie: 'Dentisterie pédiatrique',
  enfant: 'Dentisterie pédiatrique',
  bebe: 'Dentisterie pédiatrique',
  sghir: 'Dentisterie pédiatrique',
  'tbib snan': 'Dentisterie pédiatrique',
  'wldi khaso': 'Dentisterie pédiatrique',
  'weldi khaso': 'Dentisterie pédiatrique',
  'wldi khaso tbib': 'Dentisterie pédiatrique',
  'wldi khaso tbib snan': 'Dentisterie pédiatrique',
  طفل: 'Dentisterie pédiatrique',
  'اسنان الاطفال': 'Dentisterie pédiatrique',

  // Facettes
  'facettes dentaires': 'Facettes dentaires',
  facette: 'Facettes dentaires',
  facettes: 'Facettes dentaires',
  veneer: 'Facettes dentaires',
  lumineers: 'Facettes dentaires',
  لومينير: 'Facettes dentaires',

  // Blanchiment
  'blanchiment des dents': 'Blanchiment des dents',
  blanchiment: 'Blanchiment des dents',
  blanshmon: 'Blanchiment des dents',
  whitening: 'Blanchiment des dents',
  tabyid: 'Blanchiment des dents',
  tabyit: 'Blanchiment des dents',
  tbyid: 'Blanchiment des dents',
  nbyed: 'Blanchiment des dents',
  nbiyad: 'Blanchiment des dents',
  تبييض: 'Blanchiment des dents',

  // Urgences — explicit urgency only (bare "douleur" is NOT an emergency)
  'urgences dentaires': 'Urgences dentaires',
  urgence: 'Urgences dentaires',
  urgences: 'Urgences dentaires',
  urgent: 'Urgences dentaires',
  musta3jil: 'Urgences dentaires',
  must3jil: 'Urgences dentaires',
  مستعجل: 'Urgences dentaires',
  'douleur dentaire': 'Urgences dentaires',
  'douleur insupportable': 'Urgences dentaires',
  'douleur forte': 'Urgences dentaires',
  '7ri9': 'Urgences dentaires',
  hri9: 'Urgences dentaires',
  '7ri9 f darssa': 'Urgences dentaires',
  'wje3 kbir': 'Urgences dentaires',
  'kaydrni bzaf': 'Urgences dentaires',
  'gonflement important': 'Urgences dentaires',
  nafkha: 'Urgences dentaires',
  نفخة: 'Urgences dentaires',

  // Implants
  'implants dentaires': 'Implants dentaires',
  implant: 'Implants dentaires',
  implants: 'Implants dentaires',
  زرع: 'Implants dentaires',

  // Extraction — prefer tartar phrases before bare n7yed
  'n7yed ljir': 'Détartrage',
  'n7yed jir': 'Détartrage',
  'n7ayed ljir': 'Détartrage',
  'bghit n7yed ljir': 'Détartrage',
  'bghit n7yed jir': 'Détartrage',
  'extraction dentaire': 'Extraction dentaire',
  extraction: 'Extraction dentaire',
  arrache: 'Extraction dentaire',
  n7ayed: 'Extraction dentaire',
  n7yed: 'Extraction dentaire',
  nhayed: 'Extraction dentaire',
  t7ayd: 'Extraction dentaire',
  t7ayed: 'Extraction dentaire',
  'khassha t7ayd': 'Extraction dentaire',
  'khassha t7ayed': 'Extraction dentaire',
  'n7yed ders': 'Extraction dentaire',
  'n7yed derssa': 'Extraction dentaire',
  'n7yed sn': 'Extraction dentaire',
  'n7ayed ders': 'Extraction dentaire',
  'n9ala3 ders': 'Extraction dentaire',
  'n9ala3 sn': 'Extraction dentaire',
  n9ala3: 'Extraction dentaire',
  nqala3: 'Extraction dentaire',
  qala3: 'Extraction dentaire',
  khla3: 'Extraction dentaire',
  قلع: 'Extraction dentaire',
  خلع: 'Extraction dentaire',
  'بغيت نحيد ضرس': 'Extraction dentaire',
  'بغيت نقلع ضرس': 'Extraction dentaire',
  'ضرس خاصني نحيدو': 'Extraction dentaire',
  'سن خاصني نحيدو': 'Extraction dentaire',

  // Consultation
  consultation: 'Consultation',
  'consultation generale': 'Consultation',
  controle: 'Consultation',
  visite: 'Consultation',
}

/** Terms that must never appear inside a person name. */
const NAME_FORBIDDEN_TERMS = [
  'orthodontie', 'detartrage', 'détartrage', 'nettoyage', 'blanchiment',
  'implant', 'implants', 'extraction', 'urgence', 'urgences', 'consultation',
  'facettes', 'facette', 'appareil', 'apareil', 'caries', 'carie', 'soins',
  'gencives', 'gencive', 'dent', 'dents', 'tartre', 'plombage', 'whitening',
  'veneer', 'pediatrie', 'parodontie',
  'تنظيف', 'جير', 'تبييض', 'تقويم', 'زرع', 'قلع', 'لثة', 'تسوس',
]

function isOfficialService(value) {
  const key = normalizeKey(value)
  return OFFICIAL_SERVICES.some((s) => normalizeKey(s) === key)
}

function buildServiceResult(service, clientText) {
  const urgency = service === 'Urgences dentaires'
    ? 'haute'
    : (service === 'Extraction dentaire'
      || service === 'Soins des gencives'
      || service === 'Soins dentaires et traitement des caries')
      ? 'moyenne'
      : 'basse'

  const clientNorm = normalizeKey(clientText)
  const serviceNorm = normalizeKey(service)
  const display = clientNorm && clientNorm !== serviceNorm
    ? `${service} (${clientText.trim()})`
    : service

  return {
    service,
    clientLabel: clientText.trim(),
    displayLabel: display,
    urgency,
  }
}

/**
 * Token-level Darija Latin / Arabizi canonicalization.
 * Never rewrite the source message (phones, dates and hours stay on the raw text).
 */
function linguisticSurface(text) {
  try {
    const { normalizeDarijaText } = require('../voice-nlu/normalize')
    const n = normalizeDarijaText(String(text || ''))
    return n.normalizedText || String(text || '')
  } catch {
    return String(text || '')
  }
}

function combinedLinguisticKey(text) {
  const exact = String(text || '')
  const orig = normalizeKey(exact)
  const ling = normalizeKey(linguisticSurface(exact))
  if (ling && ling !== orig) return `${orig} ${ling}`.trim()
  return orig
}

const TOOTH_SURFACE = /\b(dent|dents|molaire|dersa?s?|dars+a?|derssa|drssa|drass|snani?|sni|sinn|incisive|canine)\b/
const TOOTH_AR = /ضرس|سن|سنان|السن/
const PAIN_SURFACE = /\b(douleur|mal|wje3|wji3|wja3|lwja3|7ri9|hri9|kadarn?i|kadern?i|katdarn?i|kaydarn?i|kaydrni|katdrni|kaydreni)\b|\bka[ty]?w?ja3\w*/
const PAIN_AR = /وجع|ألم|كايضر|كاتضر|كيضر|يضرني|توجع|كايوجع|كاتوجع/
const GUM_SURFACE = /\b(gencive|gencives|lta7ya|lta7ia|l7ya|ltha|lta|lita)\b/
const GUM_AR = /لثة|اللثة/
const BROKEN_SURFACE = /\b(casse[eé]?s?|cass[eé]e|tksrat|tkasrat|tqesrat|tekser|teksser|casse)\b/
const BROKEN_AR = /تكسر|مكسور|كسرة/
const SWELL_SURFACE = /\b(nafkha|nfakh|naf5a|gonflement|enflure)\b/
const SWELL_AR = /نفخة|ورم/
const PROBLEM_SURFACE = /\b(mochkil|mochkel|probleme|problem|probl[eè]me)\b/
const PROBLEM_AR = /مشكل|مشكلة/

function hasToothContext(hay, original) {
  return TOOTH_SURFACE.test(hay) || TOOTH_AR.test(original)
}

function hasPainContext(hay, original) {
  return PAIN_SURFACE.test(hay) || PAIN_AR.test(original)
}

function hasGumContext(hay, original) {
  return GUM_SURFACE.test(hay) || GUM_AR.test(original)
}

function hasPersonalDentalComplaint(text) {
  const exact = String(text || '')
  const hay = combinedLinguisticKey(exact)
  const tooth = hasToothContext(hay, exact)
  const gum = hasGumContext(hay, exact)
  const pain = hasPainContext(hay, exact)
  const broken = BROKEN_SURFACE.test(hay) || BROKEN_AR.test(exact)
  const swell = SWELL_SURFACE.test(hay) || SWELL_AR.test(exact)
  const problem = PROBLEM_SURFACE.test(hay) || PROBLEM_AR.test(exact)
  if (pain && (tooth || gum)) return true
  if ((broken || swell || problem) && (tooth || gum)) return true
  return false
}

/**
 * Price / hours / location / catalogue questions are not a patient motif.
 */
function looksLikeAdminOrCatalogQuestion(text) {
  const exact = String(text || '').trim()
  if (!exact) return false
  if (hasPersonalDentalComplaint(exact)) return false
  const hay = combinedLinguisticKey(exact)

  if (/\b(prix|taman|combien|ch7al|chhal|cout|ثمن|بشحال)\b/.test(hay)) return true
  if (/\b(horaire|horaires|ouvert|7alin|halin|wa9t)\b/.test(hay)
    && /\b(wach|wash|lyom|lyoum|aujourd|aujourdhui)\b/.test(hay)) return true
  if (/\b(fin kayna|fayn|ou kayn|oukayn)\b/.test(hay)) return true
  if (/\b(fin|fayn)\b/.test(hay) && /\b(clinique|cabinet|clinic)\b/.test(hay)) return true
  if (/\b(wach|wash|est ce que)\b/.test(hay)
    && /\b(katdirou|katdiru|kat3aljo|vous faites|vous proposez)\b/.test(hay)) return true
  if (/\b(bghit n3rf|bghit n3raf|je veux savoir|je voudrais savoir)\b/.test(hay)) return true
  return false
}

function resolveDescriptiveDentalMotif(exact) {
  if (looksLikeAdminOrCatalogQuestion(exact)) return null
  const hay = combinedLinguisticKey(exact)
  const gum = hasGumContext(hay, exact)
  const tooth = hasToothContext(hay, exact)
  const pain = hasPainContext(hay, exact)
  const broken = BROKEN_SURFACE.test(hay) || BROKEN_AR.test(exact)
  const swell = SWELL_SURFACE.test(hay) || SWELL_AR.test(exact)
  const problem = PROBLEM_SURFACE.test(hay) || PROBLEM_AR.test(exact)

  if (gum && (pain || problem || swell)) {
    return buildServiceResult('Soins des gencives', exact)
  }
  if (tooth && pain) {
    return buildServiceResult('Urgences dentaires', exact)
  }
  if (tooth && swell) {
    return buildServiceResult('Urgences dentaires', exact)
  }
  if (tooth && (broken || problem)) {
    return buildServiceResult('Consultation', exact)
  }
  return null
}

/**
 * Resolve free-text motif → official service.
 * @returns {{ service: string, clientLabel: string, displayLabel: string, urgency: string } | null}
 */
function resolveService(text) {
  const exact = String(text || '').trim().slice(0, 280)
  if (!exact) return null

  const key = normalizeKey(exact)
  if (!key) return null

  if (looksLikeAdminOrCatalogQuestion(exact)) return null

  if (SERVICE_SYNONYMS[key]) {
    return buildServiceResult(SERVICE_SYNONYMS[key], exact)
  }

  const entries = Object.entries(SERVICE_SYNONYMS).sort((a, b) => b[0].length - a[0].length)
  for (const [syn, service] of entries) {
    if (syn.length >= 3 && key.includes(syn)) {
      return buildServiceResult(service, exact)
    }
  }

  for (const service of OFFICIAL_SERVICES) {
    const sk = normalizeKey(service)
    if (key === sk || key.includes(sk)) {
      return buildServiceResult(service, exact)
    }
  }

  return resolveDescriptiveDentalMotif(exact)
}

function containsForbiddenNameTerm(value) {
  const key = normalizeKey(value)
  if (!key) return false
  const tokens = key.split(/\s+/).filter(Boolean)
  return NAME_FORBIDDEN_TERMS.some((term) => {
    const t = normalizeKey(term)
    if (!t) return false
    if (tokens.includes(t)) return true
    if (t.length >= 5 && key.includes(t)) return true
    return false
  })
}

function looksLikeServiceText(value) {
  if (resolveService(value)) return true
  return containsForbiddenNameTerm(value)
}

module.exports = {
  OFFICIAL_SERVICES,
  SERVICE_SYNONYMS,
  NAME_FORBIDDEN_TERMS,
  normalizeKey,
  isOfficialService,
  resolveService,
  containsForbiddenNameTerm,
  looksLikeServiceText,
  looksLikeAdminOrCatalogQuestion,
  hasPersonalDentalComplaint,
}
