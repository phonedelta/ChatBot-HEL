/**
 * Parse patient-requested date for availability consultation.
 */

const { extractAppointment } = require('../extract')
const { todayLocalIsoFrom } = require('../appointment-slots')

const MONTH_NAMES = {
  janvier: 1, janv: 1, january: 1, jan: 1,
  fevrier: 2, février: 2, fevr: 2, february: 2, feb: 2,
  mars: 3, march: 3, mar: 3,
  avril: 4, april: 4, avr: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, june: 6,
  juillet: 7, juil: 7, july: 7, jul: 7,
  aout: 8, août: 8, august: 8, aug: 8,
  septembre: 9, sept: 9, september: 9, sep: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, décembre: 12, dec: 12, december: 12,
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDisplayDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso || '')
  return `${m[3]}/${m[2]}/${m[1]}`
}

function normalizeDateText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isValidYmd(y, mo, d) {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

function nextOccurrence(day, month, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let year = now.getFullYear()
  let candidate = new Date(year, month - 1, day)
  if (!isValidYmd(year, month, day)) return null
  if (candidate < today) {
    year += 1
    if (!isValidYmd(year, month, day)) return null
    candidate = new Date(year, month - 1, day)
  }
  return candidate
}

/**
 * @param {string} message
 * @param {Date} [cabinetNow]
 * @returns {{
 *   valid: boolean,
 *   date?: string,
 *   displayDate?: string,
 *   time?: string|null,
 *   reason?: string,
 * }}
 */
function parseAvailabilityDate(message, cabinetNow = new Date()) {
  const raw = String(message || '').trim()
  if (!raw) return { valid: false, reason: 'empty' }
  const now = cabinetNow instanceof Date ? cabinetNow : new Date()
  const todayIso = todayLocalIsoFrom(now)
  const normalized = normalizeDateText(raw)

  // ISO YYYY-MM-DD
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const y = Number(iso[1])
    const mo = Number(iso[2])
    const d = Number(iso[3])
    if (!isValidYmd(y, mo, d)) return { valid: false, reason: 'invalid_date' }
    const date = `${y}-${pad2(mo)}-${pad2(d)}`
    if (date < todayIso) return { valid: false, reason: 'past_date', date, displayDate: formatDisplayDate(date) }
    return { valid: true, date, displayDate: formatDisplayDate(date), time: null }
  }

  // DD month [YYYY]
  const named = normalized.match(/\b(\d{1,2})\s+([a-z]+)\s*(20\d{2})?\b/)
  if (named && MONTH_NAMES[named[2]]) {
    const day = Number(named[1])
    const month = MONTH_NAMES[named[2]]
    const year = named[3] ? Number(named[3]) : null
    let candidate
    if (year) {
      if (!isValidYmd(year, month, day)) return { valid: false, reason: 'invalid_date' }
      candidate = new Date(year, month - 1, day)
    } else {
      candidate = nextOccurrence(day, month, now)
    }
    if (!candidate) return { valid: false, reason: 'invalid_date' }
    const date = `${candidate.getFullYear()}-${pad2(candidate.getMonth() + 1)}-${pad2(candidate.getDate())}`
    if (date < todayIso) return { valid: false, reason: 'past_date', date, displayDate: formatDisplayDate(date) }
    return { valid: true, date, displayDate: formatDisplayDate(date), time: null }
  }

  // DD/MM[/YYYY] or DD-MM
  const dmy = raw.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let year = dmy[3] ? Number(dmy[3]) : null
    if (year != null && year < 100) year += 2000
    let candidate
    if (year != null) {
      if (!isValidYmd(year, month, day)) return { valid: false, reason: 'invalid_date' }
      candidate = new Date(year, month - 1, day)
    } else {
      candidate = nextOccurrence(day, month, now)
    }
    if (!candidate) return { valid: false, reason: 'invalid_date' }
    const date = `${candidate.getFullYear()}-${pad2(candidate.getMonth() + 1)}-${pad2(candidate.getDate())}`
    if (date < todayIso) return { valid: false, reason: 'past_date', date, displayDate: formatDisplayDate(date) }

    // Optional time in same message
    const appt = extractAppointment(raw, now)
    const time = appt?.appointment_time || null
    return { valid: true, date, displayDate: formatDisplayDate(date), time }
  }

  // Relative / weekday via existing extractor
  const appt = extractAppointment(raw, now)
  if (appt?.appointment_date) {
    const date = appt.appointment_date
    if (date < todayIso) return { valid: false, reason: 'past_date', date, displayDate: formatDisplayDate(date) }
    return {
      valid: true,
      date,
      displayDate: formatDisplayDate(date),
      time: appt.appointment_time || null,
    }
  }

  return { valid: false, reason: 'unparsed' }
}

module.exports = {
  parseAvailabilityDate,
  formatDisplayDate,
  nextOccurrence,
}
