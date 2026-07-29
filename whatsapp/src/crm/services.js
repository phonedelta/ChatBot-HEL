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
  تسوس: 'Soins dentaires et traitement des caries',
  حشو: 'Soins dentaires et traitement des caries',
  حشوة: 'Soins dentaires et traitement des caries',

  // Gencives
  'soins des gencives': 'Soins des gencives',
  gencive: 'Soins des gencives',
  gencives: 'Soins des gencives',
  parodontie: 'Soins des gencives',
  paradontie: 'Soins des gencives',
  lta: 'Soins des gencives',
  lita: 'Soins des gencives',
  لثة: 'Soins des gencives',

  // Pédiatrie
  'dentisterie pediatrique': 'Dentisterie pédiatrique',
  pediatrie: 'Dentisterie pédiatrique',
  enfant: 'Dentisterie pédiatrique',
  bebe: 'Dentisterie pédiatrique',
  sghir: 'Dentisterie pédiatrique',
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
  تبييض: 'Blanchiment des dents',

  // Urgences
  'urgences dentaires': 'Urgences dentaires',
  urgence: 'Urgences dentaires',
  urgences: 'Urgences dentaires',
  urgent: 'Urgences dentaires',
  musta3jil: 'Urgences dentaires',
  must3jil: 'Urgences dentaires',
  مستعجل: 'Urgences dentaires',
  'douleur dentaire': 'Urgences dentaires',
  douleur: 'Urgences dentaires',
  '7ri9': 'Urgences dentaires',
  hri9: 'Urgences dentaires',
  wje3: 'Urgences dentaires',
  wji3: 'Urgences dentaires',
  darssa: 'Urgences dentaires',
  darsa: 'Urgences dentaires',
  gonflement: 'Urgences dentaires',
  nafkha: 'Urgences dentaires',
  وجع: 'Urgences dentaires',
  ضر: 'Urgences dentaires',
  حريق: 'Urgences dentaires',
  نفخة: 'Urgences dentaires',

  // Implants
  'implants dentaires': 'Implants dentaires',
  implant: 'Implants dentaires',
  implants: 'Implants dentaires',
  زرع: 'Implants dentaires',

  // Extraction
  'extraction dentaire': 'Extraction dentaire',
  extraction: 'Extraction dentaire',
  arrache: 'Extraction dentaire',
  n7ayed: 'Extraction dentaire',
  n9ala3: 'Extraction dentaire',
  nqala3: 'Extraction dentaire',
  قلع: 'Extraction dentaire',

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
 * Resolve free-text motif → official service.
 * @returns {{ service: string, clientLabel: string, displayLabel: string, urgency: string } | null}
 */
function resolveService(text) {
  const exact = String(text || '').trim().slice(0, 280)
  if (!exact) return null

  const key = normalizeKey(exact)
  if (!key) return null

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

  return null
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
}
