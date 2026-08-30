/**
 * Internal dashboard notifications when a slot becomes newly free.
 * Never auto-proposes WhatsApp — staff action only.
 */

const { validateAppointmentHours } = require('../working-hours')

function nowIso() {
  return new Date().toISOString()
}

function todayLocalIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTime(value) {
  return String(value || '').slice(0, 5)
}

function isSlotInFuture(slotDate, slotTime) {
  const date = String(slotDate || '').trim()
  const time = formatTime(slotTime)
  if (!date || !time) return false
  const today = todayLocalIso()
  if (date < today) return false
  if (date > today) return true
  const parts = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!parts) return false
  const slotMin = Number(parts[1]) * 60 + Number(parts[2])
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return slotMin > nowMin
}

function isSlotCurrentlyFree(db, slotDate, slotTime, { excludeAppointmentId = null } = {}) {
  const date = String(slotDate || '').trim()
  const time = formatTime(slotTime)
  if (!date || !time) return false
  const hours = validateAppointmentHours(date, time)
  if (!hours.ok) return false
  if (!isSlotInFuture(date, time)) return false

  const params = [date, time]
  let sql = `
    SELECT id FROM appointments
    WHERE appointment_date = ?
      AND substr(appointment_time, 1, 5) = ?
      AND status IN ('non_confirme', 'confirmed')
  `
  if (excludeAppointmentId) {
    sql += ' AND id != ?'
    params.push(Number(excludeAppointmentId))
  }
  sql += ' LIMIT 1'
  const busy = db.prepare(sql).get(...params)
  return !busy
}

function sourceMessage(sourceEvent) {
  if (sourceEvent === 'appointment_cancelled') {
    return 'Un rendez-vous vient d’être annulé. Ce créneau est maintenant disponible.'
  }
  // Only cancellations create user-facing notifications — other events never reach here.
  return 'Un rendez-vous vient d’être annulé. Ce créneau est maintenant disponible.'
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function ensureNotificationColumns(db) {
  for (const sql of [
    'ALTER TABLE notifications ADD COLUMN unique_key TEXT',
    'ALTER TABLE notifications ADD COLUMN slot_date TEXT',
    'ALTER TABLE notifications ADD COLUMN slot_time TEXT',
    'ALTER TABLE notifications ADD COLUMN appointment_id INTEGER',
    'ALTER TABLE notifications ADD COLUMN source_event TEXT',
    'ALTER TABLE notifications ADD COLUMN metadata_json TEXT',
  ]) {
    try {
      db.exec(sql)
    } catch (error) {
      if (!/duplicate column/i.test(String(error?.message || error))) throw error
    }
  }
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_key
        ON notifications(unique_key)
      WHERE unique_key IS NOT NULL
    `)
  } catch { /* ignore */ }
}

/** User-facing slot notifications only (bell / unread / sound). */
const USER_SLOT_NOTIFICATION_TYPES = new Set([
  'slot_released',
  'slot_available_after_cancellation',
])

function isUserFacingSlotNotification(row) {
  if (!row) return false
  if (!USER_SLOT_NOTIFICATION_TYPES.has(String(row.type || ''))) return false
  const source = String(row.source_event || '')
  // Legacy rows without source_event: only keep if type is slot_released (cancellation era)
  // Explicitly exclude moved/proposal sources.
  if (source && source !== 'appointment_cancelled') return false
  return true
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [helpers]
 */
function createSlotReleaseNotificationService(db, helpers = {}) {
  ensureNotificationColumns(db)

  function createSlotReleasedNotification({
    slotDate,
    slotTime,
    appointmentId = null,
    sourceEvent = 'appointment_cancelled',
    durationMinutes = 30,
  } = {}) {
    // HARD RULE: only appointment cancellations create bell notifications
    if (String(sourceEvent || '') !== 'appointment_cancelled') {
      return { ok: false, reason: 'not_cancellation' }
    }

    const date = String(slotDate || '').trim()
    const time = formatTime(slotTime)
    if (!date || !time) return { ok: false, reason: 'invalid_slot' }

    if (!isSlotInFuture(date, time)) {
      return { ok: false, reason: 'past' }
    }

    const hours = validateAppointmentHours(date, time)
    if (!hours.ok) {
      return { ok: false, reason: 'outside_hours' }
    }

    // After cancel the appointment may still exist as cancelled — exclude it
    if (!isSlotCurrentlyFree(db, date, time, { excludeAppointmentId: appointmentId })) {
      return { ok: false, reason: 'still_occupied' }
    }

    const uniqueKey = `cancelled-slot:${appointmentId || 'na'}:${date}:${time}`

    const existing = db.prepare(`
      SELECT id FROM notifications WHERE unique_key = ?
    `).get(uniqueKey)
    if (existing) {
      return { ok: true, already: true, notification: existing }
    }

    // Also idempotent against older unique_key format
    const legacyKey = `slot_released:${appointmentId || 'na'}:${date}:${time}:appointment_cancelled`
    const legacy = db.prepare(`
      SELECT id FROM notifications WHERE unique_key = ?
    `).get(legacyKey)
    if (legacy) {
      return { ok: true, already: true, notification: legacy }
    }

    const body = sourceMessage(sourceEvent)
    const linkPath = `/agenda?from=${encodeURIComponent(date)}&highlightDate=${encodeURIComponent(date)}&highlightTime=${encodeURIComponent(time)}&action=choose`
    const metadata = JSON.stringify({
      slot_date: date,
      slot_time: time,
      duration_minutes: Number(durationMinutes) || 30,
      appointment_id: appointmentId,
      source_event: 'appointment_cancelled',
    })

    try {
      const result = db.prepare(`
        INSERT INTO notifications (
          type, title, body, link_path, unique_key, slot_date, slot_time,
          appointment_id, source_event, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'slot_released',
        'Créneau disponible',
        body,
        linkPath,
        uniqueKey,
        date,
        time,
        appointmentId ? Number(appointmentId) : null,
        'appointment_cancelled',
        metadata,
        nowIso(),
      )
      const notification = db.prepare('SELECT * FROM notifications WHERE id = ?')
        .get(result.lastInsertRowid)
      return { ok: true, notification }
    } catch (error) {
      if (/UNIQUE/i.test(String(error?.message || error))) {
        return { ok: true, already: true }
      }
      throw error
    }
  }

  function notifyIfSlotReleased(appointmentRow, sourceEvent) {
    if (!appointmentRow) return { ok: false, reason: 'missing' }
    if (String(sourceEvent || '') !== 'appointment_cancelled') {
      return { ok: false, reason: 'not_cancellation' }
    }
    return createSlotReleasedNotification({
      slotDate: appointmentRow.appointment_date,
      slotTime: appointmentRow.appointment_time,
      appointmentId: appointmentRow.id,
      sourceEvent: 'appointment_cancelled',
      durationMinutes: appointmentRow.duration_minutes || 30,
    })
  }

  return {
    ensureNotificationColumns,
    createSlotReleasedNotification,
    notifyIfSlotReleased,
    isSlotCurrentlyFree: (slotDate, slotTime, opts) => isSlotCurrentlyFree(db, slotDate, slotTime, opts),
    isSlotInFuture,
    isUserFacingSlotNotification,
  }
}

module.exports = {
  createSlotReleaseNotificationService,
  isSlotInFuture,
  isSlotCurrentlyFree,
  isUserFacingSlotNotification,
  USER_SLOT_NOTIFICATION_TYPES,
}
