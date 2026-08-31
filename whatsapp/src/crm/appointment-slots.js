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

function todayLocalIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
 * Real free HH:mm slots for a day (same grid as Agenda: 30 min within HEL hours).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} slotDate
 * @param {{ limit?: number, excludeAppointmentId?: number|null, durationMinutes?: number }} [options]
 * @returns {string[]}
 */
function listAvailableSlotTimes(db, slotDate, options = {}) {
  let date
  try {
    date = normalizeBusinessDate(slotDate)
  } catch {
    return []
  }
  const weekday = weekdayFromIsoDate(date)
  if (weekday == null) return []
  const hours = WEEKLY_HOURS[weekday]
  if (!hours) return []
  const open = toMinutes(hours.open)
  const close = toMinutes(hours.close)
  if (open == null || close == null) return []

  const duration = Math.max(15, Number(options.durationMinutes) || 30)
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 3))
  const free = []
  for (let m = open; m + duration <= close; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const time = `${hh}:${mm}`
    if (isSlotFree(db, date, time, {
      excludeAppointmentId: options.excludeAppointmentId,
      durationMinutes: duration,
    })) {
      free.push(time)
      if (free.length >= limit) break
    }
  }
  return free
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
  checkSlotAvailability,
  isSlotFree,
  assertSlotAvailable,
  listAvailableSlotTimes,
  runSlotWriteTransaction,
  createSlotUnavailableError,
  isSlotUnavailableError,
  isUniqueSlotConstraintError,
  parseTimeMinutes,
  todayLocalIso,
}
