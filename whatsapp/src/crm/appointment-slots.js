/**
 * Shared appointment slot availability (WhatsApp + dashboard + agenda + reschedule).
 * Conflict is based on date+time (+ duration overlap), never on patient/phone alone.
 */

const {
  validateAppointmentHours,
  WEEKLY_HOURS,
  weekdayFromIsoDate,
  toMinutes,
} = require('./working-hours')

/** Statuses that occupy a clinic slot for new bookings / moves. */
const SLOT_BLOCKING_STATUSES = Object.freeze([
  'non_confirme',
  'pending_confirmation',
  'confirmed',
])

const ACTIVE_SLOT_STATUSES = SLOT_BLOCKING_STATUSES

const SLOT_UNAVAILABLE_CODE = 'APPOINTMENT_SLOT_UNAVAILABLE'
/** Legacy alias kept for existing API / tests */
const SLOT_CONFLICT_CODE = 'SLOT_CONFLICT'

function isAppointmentSlotBlocking(status) {
  return SLOT_BLOCKING_STATUSES.includes(String(status || '').trim())
}

function slotBlockingStatusesSql() {
  return SLOT_BLOCKING_STATUSES.map((s) => `'${s}'`).join(', ')
}

function parseTimeMinutes(value) {
  const raw = String(value || '').trim().slice(0, 5)
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function normalizeSlotTime(value) {
  const raw = String(value || '').trim().slice(0, 5)
  const match = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return raw
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`
}

/**
 * Normalize natural Moroccan / FR time expressions to HH:mm.
 * Safe for: 12h30, 12 h 30, 12:30, 12H30, 14h, 14 h, m3a 14h, à 11h.
 * Does NOT treat bare digits like "3" as 03:00 (selection indices stay separate).
 * Does NOT treat dates or phone numbers as times.
 *
 * @param {string} text
 * @returns {{ hour: number, minute: number, normalized: string }|null}
 */
function normalizeTimeExpression(text) {
  const raw = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .trim()
  if (!raw) return null

  // Phones / dates / ISO — never treat as clock times
  if (/^\+?\d[\d\s\-.]{6,}\d$/.test(raw) || /^\+212/.test(raw) || /^0\d{8,}$/.test(raw)) return null
  if (/^\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?$/.test(raw)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  // Bare index / year-like — leave to callers
  if (/^#?\d{1,2}[).]?$/.test(raw)) return null

  const pack = (hour, minute) => {
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return {
      hour,
      minute,
      normalized: normalizeSlotTime(`${hour}:${String(minute).padStart(2, '0')}`),
    }
  }

  // 11 ونص / 11 w nos
  const half = raw.match(/^(?:(?:m3a|مع|a|à)\s+)?(\d{1,2})\s*(?:ونص|w\s*nos|ou?\s*nos)\s*$/i)
  if (half) return pack(Number(half[1]), 30)

  // 12h30 / 12 h 30 / 12:30 / 12H30 / m3a 12h30
  const withMin = raw.match(/^(?:(?:m3a|مع|a|à)\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})\s*$/i)
  if (withMin) return pack(Number(withMin[1]), Number(withMin[2]))

  // 14h / 14 h / m3a 14h / à 14h
  const hourOnly = raw.match(/^(?:(?:m3a|مع|a|à)\s+)?(\d{1,2})\s*h\s*$/i)
  if (hourOnly) return pack(Number(hourOnly[1]), 0)

  // strict HH:MM
  const strict = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (strict) return pack(Number(strict[1]), Number(strict[2]))

  return null
}

/**
 * Find a clock time inside a longer sentence (e.g. "Ghda m3a 14h").
 * @param {string} text
 * @returns {string|null} HH:mm
 */
function extractEmbeddedTime(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const direct = normalizeTimeExpression(raw)
  if (direct) return direct.normalized

  const candidates = []
  const re = /(?:(?:m3a|مع|a|à)\s*)?\d{1,2}\s*(?:h|:)\s*\d{2}|(?:(?:m3a|مع|a|à)\s*)?\d{1,2}\s*h\b|\d{1,2}:\d{2}|(?:m3a|مع)\s*\d{1,2}\b/gi
  let m
  while ((m = re.exec(raw)) !== null) {
    candidates.push(m[0])
  }
  for (const c of candidates) {
    const hit = normalizeTimeExpression(c)
      || normalizeTimeExpression(c.replace(/\s+/g, ' ').trim())
    if (hit) return hit.normalized
    // "m3a 14" without h
    const bare = c.match(/(?:m3a|مع)\s*(\d{1,2})\b/i)
    if (bare) {
      const packed = normalizeTimeExpression(`${bare[1]}h`)
      if (packed) return packed.normalized
    }
  }
  return null
}

function todayLocalIso() {
  return todayLocalIsoFrom(new Date())
}

/**
 * Normalize business date-only value to YYYY-MM-DD without timezone conversion.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBusinessDate(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    const err = new Error('Date invalide (format attendu : AAAA-MM-JJ)')
    err.code = 'VALIDATION'
    throw err
  }
  const [, y, mo, d] = match
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    const err = new Error('Date invalide')
    err.code = 'VALIDATION'
    throw err
  }
  return `${y}-${mo}-${d}`
}

function isSlotUnavailableError(error) {
  const code = String(error?.code || '')
  return code === SLOT_UNAVAILABLE_CODE
    || code === SLOT_CONFLICT_CODE
    || code === 'SLOT_TAKEN'
}

function createSlotUnavailableError(message = 'Ce créneau est déjà réservé.') {
  const err = new Error(message)
  err.code = SLOT_UNAVAILABLE_CODE
  err.legacyCode = SLOT_CONFLICT_CODE
  return err
}

function isUniqueSlotConstraintError(error) {
  const msg = String(error?.message || error || '')
  return /UNIQUE constraint failed/i.test(msg)
    && /appointments/i.test(msg)
    && (/appointment_date|appointment_time|idx_appointments_active_slot/i.test(msg) || true)
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   date: string,
 *   time: string,
 *   practitionerId?: number|null,
 *   excludeAppointmentId?: number|null,
 *   durationMinutes?: number,
 * }} input
 * @returns {{
 *   available: boolean,
 *   conflictAppointmentId: number|null,
 *   reason: 'missing'|'outside_hours'|'past'|'occupied'|null,
 * }}
 */
function checkSlotAvailability(db, input = {}) {
  const rawDate = String(input.date || '').trim()
  const time = normalizeSlotTime(input.time)
  if (!rawDate || !time) {
    return { available: false, conflictAppointmentId: null, reason: 'missing' }
  }

  let date
  try {
    date = normalizeBusinessDate(rawDate)
  } catch {
    return { available: false, conflictAppointmentId: null, reason: 'missing' }
  }

  const hoursCheck = validateAppointmentHours(date, time)
  if (!hoursCheck.ok) {
    return { available: false, conflictAppointmentId: null, reason: 'outside_hours' }
  }

  const today = todayLocalIso()
  if (date < today) {
    return { available: false, conflictAppointmentId: null, reason: 'past' }
  }
  if (date === today) {
    const startMin = parseTimeMinutes(time)
    if (startMin == null) {
      return { available: false, conflictAppointmentId: null, reason: 'missing' }
    }
    const now = new Date()
    if (startMin <= now.getHours() * 60 + now.getMinutes()) {
      return { available: false, conflictAppointmentId: null, reason: 'past' }
    }
  }

  const excludeAppointmentId = input.excludeAppointmentId
    ? Number(input.excludeAppointmentId)
    : null
  const durationMinutes = Math.max(15, Number(input.durationMinutes) || 30)
  const practitionerId = input.practitionerId != null && input.practitionerId !== ''
    ? Number(input.practitionerId)
    : null

  // Single-resource cabinet: ignore practitioner filter unless explicitly set on both sides later.
  const busy = db.prepare(`
    SELECT id, appointment_time, COALESCE(duration_minutes, 30) AS duration_minutes,
           practitioner_id
    FROM appointments
    WHERE appointment_date = ?
      AND status IN (${slotBlockingStatusesSql()})
      ${excludeAppointmentId ? 'AND id != ?' : ''}
  `).all(...(excludeAppointmentId ? [date, excludeAppointmentId] : [date]))

  const startMin = parseTimeMinutes(time)
  if (startMin == null) {
    return { available: false, conflictAppointmentId: null, reason: 'missing' }
  }
  const endMin = startMin + durationMinutes

  for (const row of busy) {
    if (practitionerId != null && row.practitioner_id != null
      && Number(row.practitioner_id) !== practitionerId) {
      continue
    }
    const otherStart = parseTimeMinutes(row.appointment_time)
    if (otherStart == null) continue
    const otherEnd = otherStart + Math.max(15, Number(row.duration_minutes) || 30)
    if (startMin < otherEnd && endMin > otherStart) {
      return {
        available: false,
        conflictAppointmentId: Number(row.id) || null,
        reason: 'occupied',
      }
    }
  }

  return { available: true, conflictAppointmentId: null, reason: null }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function isSlotFree(db, slotDate, slotTime, options = {}) {
  const result = checkSlotAvailability(db, {
    date: slotDate,
    time: slotTime,
    excludeAppointmentId: options.excludeAppointmentId,
    durationMinutes: options.durationMinutes,
    practitionerId: options.practitionerId,
  })
  return result.available
}

function assertSlotAvailable(db, slotDate, slotTime, options = {}) {
  const result = checkSlotAvailability(db, {
    date: slotDate,
    time: slotTime,
    excludeAppointmentId: options.excludeAppointmentId,
    durationMinutes: options.durationMinutes,
    practitionerId: options.practitionerId,
  })
  if (result.available) return result
  if (result.reason === 'outside_hours' || result.reason === 'past' || result.reason === 'missing') {
    // Caller should use working-hours / date validators for those cases.
    // Still treat as unavailable for assert used at insert time.
  }
  throw createSlotUnavailableError('Ce créneau est déjà réservé.')
}

/**
 * Real free HH:mm slots for a day (same grid as Agenda).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} slotDate
 * @param {{
 *   limit?: number,
 *   excludeAppointmentId?: number|null,
 *   durationMinutes?: number,
 *   appointmentsSettings?: object|null,
 *   now?: Date,
 *   applyBookingRules?: boolean,
 * }} [options]
 * @returns {string[]}
 */
function listAvailableSlotTimes(db, slotDate, options = {}) {
  const result = getBookableSlotsForDate(db, slotDate, {
    ...options,
    applyBookingRules: options.applyBookingRules !== false,
  })
  if (!result.ok) return []
  const limit = options.limit != null
    ? Math.max(1, Math.min(48, Number(options.limit) || 3))
    : result.times.length
  return result.times.slice(0, limit)
}

/**
 * Canonical bookable slots for one calendar day — shared by Agenda + WhatsApp.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} slotDate YYYY-MM-DD
 * @param {{
 *   excludeAppointmentId?: number|null,
 *   durationMinutes?: number,
 *   practitionerId?: number|null,
 *   appointmentsSettings?: {
 *     slotDurationMinutes?: number,
 *     minBookingLeadMinutes?: number,
 *     bookingHorizonDays?: number,
 *     allowSameDayBooking?: boolean,
 *   }|null,
 *   now?: Date,
 *   applyBookingRules?: boolean,
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   reason: 'invalid_date'|'closed_day'|'past_date'|'same_day_disabled'|'horizon_exceeded'|'none'|null,
 *   date: string|null,
 *   times: string[],
 *   durationMinutes: number,
 *   closed: boolean,
 * }}
 */
function getBookableSlotsForDate(db, slotDate, options = {}) {
  let date
  try {
    date = normalizeBusinessDate(slotDate)
  } catch {
    return {
      ok: false,
      reason: 'invalid_date',
      date: null,
      times: [],
      durationMinutes: 30,
      closed: false,
    }
  }

  const now = options.now instanceof Date ? options.now : new Date()
  const settings = options.appointmentsSettings || null
  const duration = Math.max(
    15,
    Number(options.durationMinutes)
      || Number(settings?.slotDurationMinutes)
      || 30,
  )

  const weekday = weekdayFromIsoDate(date)
  if (weekday == null) {
    return {
      ok: false, reason: 'invalid_date', date, times: [], durationMinutes: duration, closed: false,
    }
  }
  const hours = WEEKLY_HOURS[weekday]
  if (!hours) {
    return {
      ok: false, reason: 'closed_day', date, times: [], durationMinutes: duration, closed: true,
    }
  }

  const today = todayLocalIsoFrom(now)
  if (date < today) {
    return {
      ok: false, reason: 'past_date', date, times: [], durationMinutes: duration, closed: false,
    }
  }

  if (settings && options.applyBookingRules !== false) {
    if (date === today && settings.allowSameDayBooking === false) {
      return {
        ok: false, reason: 'same_day_disabled', date, times: [], durationMinutes: duration, closed: false,
      }
    }
    const apptDate = new Date(`${date}T12:00:00`)
    const todayDate = new Date(`${today}T12:00:00`)
    const diffDays = Math.floor((apptDate.getTime() - todayDate.getTime()) / 86400000)
    const horizon = Number(settings.bookingHorizonDays)
    if (Number.isFinite(horizon) && diffDays > horizon) {
      return {
        ok: false, reason: 'horizon_exceeded', date, times: [], durationMinutes: duration, closed: false,
      }
    }
  }

  const open = toMinutes(hours.open)
  const close = toMinutes(hours.close)
  if (open == null || close == null || close <= open) {
    return {
      ok: false, reason: 'closed_day', date, times: [], durationMinutes: duration, closed: true,
    }
  }

  const step = duration
  const free = []
  for (let m = open; m + duration <= close; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const time = `${hh}:${mm}`

    if (settings && options.applyBookingRules !== false) {
      const lead = Number(settings.minBookingLeadMinutes) || 0
      if (lead > 0) {
        const apptMs = new Date(`${date}T${time}:00`).getTime()
        const minMs = now.getTime() + lead * 60000
        if (!Number.isFinite(apptMs) || apptMs < minMs) continue
      } else if (date === today) {
        const nowMin = now.getHours() * 60 + now.getMinutes()
        if (m <= nowMin) continue
      }
    } else if (date === today) {
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (m <= nowMin) continue
    }

    if (isSlotFree(db, date, time, {
      excludeAppointmentId: options.excludeAppointmentId,
      durationMinutes: duration,
      practitionerId: options.practitionerId,
    })) {
      free.push(time)
    }
  }

  return {
    ok: true,
    reason: free.length ? null : 'none',
    date,
    times: free,
    durationMinutes: duration,
    closed: false,
  }
}

function todayLocalIsoFrom(now = new Date()) {
  const d = now instanceof Date ? now : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * SERIALIZED write: BEGIN IMMEDIATE → check+insert → COMMIT.
 * Maps unique-slot constraint failures to APPOINTMENT_SLOT_UNAVAILABLE.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => any} fn
 */
function runSlotWriteTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    if (isUniqueSlotConstraintError(error) || isSlotUnavailableError(error)) {
      throw createSlotUnavailableError('Ce créneau est déjà réservé.')
    }
    throw error
  }
}

module.exports = {
  SLOT_BLOCKING_STATUSES,
  ACTIVE_SLOT_STATUSES,
  SLOT_UNAVAILABLE_CODE,
  SLOT_CONFLICT_CODE,
  isAppointmentSlotBlocking,
  slotBlockingStatusesSql,
  normalizeBusinessDate,
  normalizeSlotTime,
  normalizeTimeExpression,
  extractEmbeddedTime,
  checkSlotAvailability,
  isSlotFree,
  assertSlotAvailable,
  listAvailableSlotTimes,
  getBookableSlotsForDate,
  runSlotWriteTransaction,
  createSlotUnavailableError,
  isSlotUnavailableError,
  isUniqueSlotConstraintError,
  parseTimeMinutes,
  todayLocalIso,
  todayLocalIsoFrom,
}
