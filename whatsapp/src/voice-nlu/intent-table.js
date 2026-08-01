/**
 * Intention table: direct service booking requests.
 *
 * When a patient asks for a concrete service (not a vague medical complaint),
 * we classify BOOK_APPOINTMENT + service and skip asking "quel est votre problème ?"
 * if confidence >= SERVICE_BOOKING_CONFIDENCE.
 */

const { detectService } = require('./services-dictionary')
const { isOfficialService, resolveService } = require('../crm/services')

const SERVICE_BOOKING_CONFIDENCE = 0.8

/** Arabic labels used in booking intro when service is already known. */
const SERVICE_AR_LABELS = {
  'Extraction dentaire': 'خلع السن',
  'Détartrage': 'تنظيف الأسنان (إزالة الجير)',
  'Blanchiment des dents': 'تبييض الأسنان',
  Orthodontie: 'تقويم الأسنان',
  'Implants dentaires': 'زراعة الأسنان',
  'Implant dentaire': 'زراعة الأسنان',
  'Soins dentaires et traitement des caries': 'علاج تسوس الأسنان',
  'Soins des gencives': 'علاج اللثة',
  'Facettes dentaires': 'قشور الأسنان',
  'Dentisterie pédiatrique': 'طب أسنان الأطفال',
  'Urgences dentaires': 'علاج الحالات المستعجلة',
  Consultation: 'استشارة',
}

/** Clear appointment words (enough alone). */
const BOOKING_HINT = /\b(rendez[- ]?vous|rdv|appointment|موعد|رنديفو|رونديفو|mow3id|mo3id)\b/i

/**
 * True only when the patient clearly asks to book / come for an appointment.
 * Mentioning a service alone (e.g. "consultation", "nettoyage") is NOT enough.
 * Bare "bghit" / "je veux" without RDV or a dental action is NOT enough.
 * @param {string} text
 */
function hasExplicitBookingIntent(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (BOOKING_HINT.test(raw)) return true
  if (/\b(prendre|réserver|reserver)\s+(un\s+)?(rendez[- ]?vous|rdv)\b/i.test(raw)) return true
  if (/\b(n)?reserv(e|er|i|ation)?\b/i.test(raw)) return true
  if (/\b(nhjez|n7jez|n7ajez)\b/i.test(raw)) return true
  if (/\b(je\s+(veux|voudrais))\b.{0,50}\b(rendez[- ]?vous|rdv|appointment|réserver|reserver)\b/i.test(raw)) return true
  if (/\b(nakhod|nkhod)\b.{0,20}\b(rdv|rendez)\b/i.test(raw)) return true
  if (/حجز\s*موعد|نحب\s*نحجز|نبغي\s*نجي/.test(raw)) return true
  // "bghit + come / book / concrete dental action"
  return /\b(bghit|bghiti|baghit|kanbghi|بغيت)\b.{0,40}\b(nji|ndir|rdv|rendez|موعد|nreserve|reserv|n7yed|n9ala3|n9ale3|extraction|nettoyage|tn9iya|blanchiment|tabyid|appareil|ta9wim|implant|خلع|قلع|تنظيف|تبييض|تقويم|زرع|نحيد|نقلع)\b/i.test(raw)
}

/**
 * @param {string} text
 * @returns {{
 *   intent: 'BOOK_APPOINTMENT'|null,
 *   service: string|null,
 *   serviceId: string|null,
 *   crmProblem: string|null,
 *   urgency: string|null,
 *   confidence: number,
 *   matched: string|null,
 *   skipProblemQuestion: boolean,
 * }}
 */
function detectServiceBookingIntent(text) {
  const raw = String(text || '').trim()
  const empty = {
    intent: null,
    service: null,
    serviceId: null,
    crmProblem: null,
    urgency: null,
    confidence: 0,
    matched: null,
    skipProblemQuestion: false,
  }
  if (!raw) return empty

  const match = detectService(raw, { minConfidence: SERVICE_BOOKING_CONFIDENCE })
  if (!match) return empty

  // Normalize to official CRM catalogue labels
  const resolved = resolveService(match.service)
    || resolveService(match.crmProblem)
    || (isOfficialService(match.service) ? { service: match.service } : null)
  const service = resolved?.service || null
  if (!service) return empty

  // Service detected alone → inform LLM/CRM of the service, do NOT open booking form
  if (!hasExplicitBookingIntent(raw)) {
    return {
      intent: null,
      service,
      serviceId: match.serviceId,
      crmProblem: service,
      urgency: match.urgency || resolved?.urgency || 'moyenne',
      confidence: match.confidence,
      matched: match.matched,
      skipProblemQuestion: false,
    }
  }

  return {
    intent: 'BOOK_APPOINTMENT',
    service,
    serviceId: match.serviceId,
    crmProblem: service,
    urgency: match.urgency || resolved?.urgency || 'moyenne',
    confidence: match.confidence,
    matched: match.matched,
    skipProblemQuestion: match.confidence >= SERVICE_BOOKING_CONFIDENCE,
  }
}

function serviceArabicLabel(service) {
  return SERVICE_AR_LABELS[service] || service || 'الاستشارة'
}

module.exports = {
  SERVICE_BOOKING_CONFIDENCE,
  SERVICE_AR_LABELS,
  BOOKING_HINT,
  hasExplicitBookingIntent,
  detectServiceBookingIntent,
  serviceArabicLabel,
}
