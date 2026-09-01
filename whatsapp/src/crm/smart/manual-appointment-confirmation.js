/**
 * Deterministic Darija (Arabic script) confirmation for dashboard manual appointments.
 */
const { resolveService } = require('../services')

const SERVICE_AR_LABELS = {
  'Extraction dentaire': 'خلع السن',
  Détartrage: 'إزالة الجير',
  'Blanchiment des dents': 'تبييض الأسنان',
  'Blanchiment dentaire': 'تبييض الأسنان',
  Orthodontie: 'تقويم الأسنان',
  'Implants dentaires': 'زراعة الأسنان',
  'Implant dentaire': 'زراعة الأسنان',
  'Soins dentaires et traitement des caries': 'علاج التسوس',
  'Traitement des caries': 'علاج التسوس',
  'Soins des gencives': 'علاج اللثة',
  'Facettes dentaires': 'القشور التجميلية',
  'Dentisterie pédiatrique': 'طب أسنان الأطفال',
  'Urgences dentaires': 'علاج حالات ألم الأسنان المستعجلة',
  Consultation: 'استشارة',
}

function formatManualAppointmentDate(isoDate) {
  const raw = String(isoDate || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return raw
  return `${match[3]}/${match[2]}/${match[1]}`
}

function formatManualAppointmentTime(timeStr) {
  const raw = String(timeStr || '').trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return raw.slice(0, 5)
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`
}

function resolveReasonLabelAr(reason) {
  const raw = String(reason || '').trim()
  if (!raw) return null
  if (SERVICE_AR_LABELS[raw]) return SERVICE_AR_LABELS[raw]
  const resolved = resolveService(raw)
  const canonical = resolved?.service || raw
  return SERVICE_AR_LABELS[canonical] || null
}

/**
 * @param {{
 *   patientName: string,
 *   date: string,
 *   time: string,
 *   reason?: string|null,
 *   sharedContact?: boolean,
 * }} input
 */
function buildManualAppointmentConfirmationMessage({
  patientName,
  date,
  time,
  reason = null,
  sharedContact = false,
}) {
  const name = String(patientName || '').trim()
  const dateLabel = formatManualAppointmentDate(date)
  const timeLabel = formatManualAppointmentTime(time)
  const reasonAr = resolveReasonLabelAr(reason)
  const reasonLine = reasonAr
    ? `🦷 الموعد: ${reasonAr}`
    : (String(reason || '').trim() ? `🦷 الموعد: ${String(reason).trim()}` : null)

  const greeting = sharedContact
    ? 'السلام عليكم 👋'
    : `السلام عليكم ${name} 👋`

  const intro = sharedContact
    ? `تم تسجيل الموعد ديال ${name} بنجاح فمركز HEL لطب الأسنان.`
    : 'تم تسجيل الموعد ديالك بنجاح فمركز HEL لطب الأسنان.'

  const lines = [
    greeting,
    '',
    intro,
    '',
    `📅 النهار: ${dateLabel}`,
    `🕐 الساعة: ${timeLabel}`,
  ]
  if (reasonLine) lines.push(reasonLine)
  lines.push('', 'إلى بغيتي تبدل ولا تلغي الموعد، تقدر تجاوبنا هنا فواتساب.')
  return lines.join('\n')
}

module.exports = {
  SERVICE_AR_LABELS,
  formatManualAppointmentDate,
  formatManualAppointmentTime,
  resolveReasonLabelAr,
  buildManualAppointmentConfirmationMessage,
}
