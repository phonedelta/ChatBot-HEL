/**
 * Aggregated Agenda board for the Smart CRM HEL dashboard.
 * Real appointments + computed available slots + released slots + waitlist.
 */

const {
  WEEKLY_HOURS,
  weekdayFromIsoDate,
  toMinutes,
} = require('../working-hours')
const { getBookableSlotsForDate } = require('../appointment-slots')
const {
  appointmentStatusLabel,
  WAITLIST_PRIORITY_LABELS,
} = require('./labels')
const { formatPhoneDisplay } = require('../phone')

const SLOT_MINUTES = 30
const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTH_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function todayLocal() {
  const d = new Date()
  return toIsoDate(d)
}

function toIsoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIsoDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function addDays(iso, days) {
  const d = parseIsoDate(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

function formatTime(value) {
  const raw = String(value || '').trim()
  const m = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return raw.slice(0, 5)
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Monday–Saturday work week containing `anchorIso` (or today).
 */
function resolveWeekRange(anchorIso) {
  const anchor = parseIsoDate(anchorIso || todayLocal()) || new Date()
  const day = anchor.getDay() // 0 Sun
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() + mondayOffset)
  const saturday = new Date(monday)
  saturday.setDate(monday.getDate() + 5)
  return {
    from: toIsoDate(monday),
    to: toIsoDate(saturday),
    days: Array.from({ length: 6 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const iso = toIsoDate(d)
      const wd = weekdayFromIsoDate(iso)
      return {
        date: iso,
        weekday: wd,
        label: `${DAY_SHORT[wd]} ${d.getDate()}`,
        is_today: iso === todayLocal(),
        hours: WEEKLY_HOURS[wd] || null,
      }
    }),
  }
}

function formatWeekSubtitle(from, to, practitionerName = null) {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (!a || !b) return ''
  const sameMonth = a.getMonth() === b.getMonth()
  const left = sameMonth
    ? `${a.getDate()}`
    : `${a.getDate()} ${MONTH_LONG[a.getMonth()]}`
  const right = `${b.getDate()} ${MONTH_LONG[b.getMonth()]} ${b.getFullYear()}`
  const base = `Semaine du ${left} au ${right}`
  return practitionerName ? `${base} · ${practitionerName}` : base
}

function formatDaySubtitle(dateIso, practitionerName = null) {
  const d = parseIsoDate(dateIso)
  if (!d) return ''
  const wd = weekdayFromIsoDate(dateIso)
  const label = `${DAY_SHORT[wd]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
  return practitionerName ? `${label} · ${practitionerName}` : label
}

function shortPatientName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Patient'
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

function waitlistPriorityLabel(key) {
  return WAITLIST_PRIORITY_LABELS[String(key || '')] || 'Normale'
}

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function preferenceLabel(entry) {
  const parts = []
  if (entry.preferred_date_from || entry.preferred_date_to) {
    const from = entry.preferred_date_from
    const to = entry.preferred_date_to
    if (from && to && from === to) {
      const d = parseIsoDate(from)
      const wd = weekdayFromIsoDate(from)
      parts.push(d ? `${DAY_SHORT[wd]} ${d.getDate()}` : from)
    } else if (to) {
      const d = parseIsoDate(to)
      parts.push(d ? `Avant ${DAY_SHORT[weekdayFromIsoDate(to)]} ${d.getDate()}` : `Avant ${to}`)
    } else if (from) {
      parts.push(`À partir du ${from}`)
    }
  }
  const ranges = parseJson(entry.preferred_time_ranges, null)
  if (Array.isArray(ranges) && ranges.length) {
    parts.push(ranges.join(' · '))
  } else if (typeof ranges === 'string' && ranges.trim()) {
    parts.push(ranges.trim())
  }
  if (!parts.length && entry.notes) return String(entry.notes).slice(0, 80)
  if (!parts.length) return 'Dès que possible'
  return parts.join(' · ')
}

function buildSlotsForDay(dateIso, slotMinutes = SLOT_MINUTES) {
  const wd = weekdayFromIsoDate(dateIso)
  if (wd == null) return []
  const hours = WEEKLY_HOURS[wd]
  if (!hours) return []
  const open = toMinutes(hours.open)
  const close = toMinutes(hours.close)
  if (open == null || close == null || close <= open) return []
  const step = Math.max(5, Number(slotMinutes) || SLOT_MINUTES)
  const slots = []
  for (let m = open; m + step <= close; m += step) {
    slots.push(minutesToTime(m))
  }
  return slots
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} deps
 */
function createAgendaBoard(deps) {
  const {
    db,
    listWaitlist,
    listPractitioners,
    listAppointmentTypes,
    getSlotDurationMinutes = () => SLOT_MINUTES,
    getAppointmentsSettings = null,
  } = deps

  function slotStep() {
    return Math.max(5, Number(getSlotDurationMinutes()) || SLOT_MINUTES)
  }

  function appointmentsSettings() {
    return typeof getAppointmentsSettings === 'function'
      ? getAppointmentsSettings()
      : { slotDurationMinutes: slotStep() }
  }

  function loadAppointmentsInRange({ from, to, practitionerId = null, type = null, status = null }) {
    let sql = `
      SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        a.created_at,
        a.practitioner_id,
        a.appointment_type,
        a.duration_minutes,
        c.id AS customer_id,
        c.full_name,
        c.phone_number,
        c.city,
        c.source,
        d.problem,
        d.description AS problem_details,
        d.urgency,
        p.full_name AS practitioner_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      LEFT JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.appointment_date >= ?
        AND a.appointment_date <= ?
    `
    const params = [from, to]
    if (practitionerId) {
      sql += ' AND a.practitioner_id = ?'
      params.push(Number(practitionerId))
    }
    if (type) {
      sql += ' AND (a.appointment_type = ? OR d.problem = ?)'
      params.push(String(type), String(type))
    }
    if (status && status !== 'all') {
      if (status === 'released') {
        sql += " AND a.status = 'cancelled'"
      } else if (status === 'available') {
        // handled client-side — no appointments
        sql += ' AND 1 = 0'
      } else {
        sql += ' AND a.status = ?'
        params.push(String(status))
      }
    }
    sql += ' ORDER BY a.appointment_date ASC, a.appointment_time ASC'
    return db.prepare(sql).all(...params)
  }

  function isSlotOccupied(occupiedSet, date, time) {
    return occupiedSet.has(`${date}|${formatTime(time)}`)
  }

  function getAgendaBoard(options = {}) {
    const view = String(options.view || 'week')
    const anchor = String(options.from || options.date || todayLocal()).slice(0, 10)
    const practitionerId = options.practitionerId ? Number(options.practitionerId) : null
    const type = options.type ? String(options.type).trim() : null
    const status = options.status ? String(options.status).trim() : null

    let range
    if (view === 'day') {
      const wd = weekdayFromIsoDate(anchor)
      range = {
        from: anchor,
        to: anchor,
        days: [{
          date: anchor,
          weekday: wd,
          label: (() => {
            const d = parseIsoDate(anchor)
            return d ? `${DAY_SHORT[wd]} ${d.getDate()}` : anchor
          })(),
          is_today: anchor === todayLocal(),
          hours: WEEKLY_HOURS[wd] || null,
        }],
      }
    } else {
      range = resolveWeekRange(anchor)
      if (options.to) {
        // keep week range
      }
    }

    const practitioners = listPractitioners()
    const appointmentTypes = listAppointmentTypes()
    const practitioner = practitionerId
      ? practitioners.find((p) => Number(p.id) === practitionerId) || null
      : null

    const rows = loadAppointmentsInRange({
      from: range.from,
      to: range.to,
      practitionerId,
      type,
      status: status && !['released', 'available'].includes(status) ? status : null,
    })

    const activeStatuses = new Set(['non_confirme', 'confirmed', 'no_show', 'completed'])
    const showCancelled = status === 'cancelled' || status === 'released'
    const appointments = rows
      .filter((r) => {
        if (showCancelled) return String(r.status) === 'cancelled'
        return activeStatuses.has(String(r.status))
      })
      .filter((r) => {
        if (status === 'available' || status === 'released') return false
        return true
      })
      .map((r) => {
        const time = formatTime(r.appointment_time)
        const duration = Number(r.duration_minutes) || 30
        return {
          id: r.id,
          appointment_id: r.id,
          customer_id: r.customer_id,
          full_name: r.full_name,
          short_name: shortPatientName(r.full_name),
          phone_number: r.phone_number,
          phone_display: formatPhoneDisplay(r.phone_number) || r.phone_number,
          appointment_date: r.appointment_date,
          appointment_time: time,
          duration_minutes: duration,
          end_time: minutesToTime((toMinutes(time) || 0) + duration),
          status: r.status,
          status_label: appointmentStatusLabel(r.status),
          appointment_type: r.appointment_type || r.problem || 'Consultation',
          problem: r.problem,
          practitioner_id: r.practitioner_id || null,
          practitioner_name: r.practitioner_name || null,
          source: r.source || 'whatsapp',
          urgency: r.urgency || null,
        }
      })

    // Occupied = non-cancelled active appointments
    const occupied = new Set()
    const step = slotStep()
    for (const a of appointments) {
      if (a.status === 'cancelled') continue
      const start = toMinutes(a.appointment_time)
      if (start == null) continue
      const spans = Math.max(1, Math.ceil(a.duration_minutes / step))
      for (let i = 0; i < spans; i += 1) {
        occupied.add(`${a.appointment_date}|${minutesToTime(start + i * step)}`)
      }
    }

    // Available slots (same engine as WhatsApp availability)
    const availableSlots = []
    if (!status || status === 'all' || status === 'available') {
      const settings = appointmentsSettings()
      for (const day of range.days) {
        if (!day.hours) continue
        const bookable = getBookableSlotsForDate(db, day.date, {
          durationMinutes: slotStep(),
          appointmentsSettings: settings,
          applyBookingRules: true,
          practitionerId,
        })
        for (const time of bookable.times || []) {
          availableSlots.push({
            slot_date: day.date,
            slot_time: time,
            duration_minutes: slotStep(),
            kind: 'available',
          })
        }
      }
    }

    // Released = cancelled appointments whose slot is still free and not in the past
    const cancelled = rows.filter((r) => String(r.status) === 'cancelled')
    const releasedSlots = []
    for (const r of cancelled) {
      const date = r.appointment_date
      const time = formatTime(r.appointment_time)
      if (date < todayLocal()) continue
      if (date === todayLocal()) {
        const now = new Date()
        const nowMin = now.getHours() * 60 + now.getMinutes()
        if ((toMinutes(time) || 0) < nowMin) continue
      }
      if (isSlotOccupied(occupied, date, time)) continue
      releasedSlots.push({
        appointment_id: r.id,
        slot_date: date,
        slot_time: time,
        duration_minutes: Number(r.duration_minutes) || 30,
        practitioner_id: r.practitioner_id || null,
        practitioner_name: r.practitioner_name || null,
        appointment_type: r.appointment_type || r.problem || null,
        cancelled_at: r.created_at,
        kind: 'released',
      })
    }

    // Banner: first released slot (manual staff action — no auto matching)
    const bannerSlot = releasedSlots[0] || null

    const waitlistRaw = listWaitlist({ status: 'active', limit: 40 })
    const waitlist = waitlistRaw.map((w) => ({
      id: w.id,
      customer_id: w.customer_id,
      patient_name: w.patient_name,
      patient_phone: w.patient_phone,
      priority: w.priority,
      priority_label: waitlistPriorityLabel(w.priority),
      appointment_type: w.appointment_type || null,
      preferred_date_from: w.preferred_date_from || null,
      preferred_date_to: w.preferred_date_to || null,
      preference_label: preferenceLabel(w),
      practitioner_name: w.practitioner_name || null,
      notes: w.notes || null,
    }))

    const subtitle = view === 'day'
      ? formatDaySubtitle(range.from, practitioner?.full_name || null)
      : formatWeekSubtitle(range.from, range.to, practitioner?.full_name || null)

    // Time axis: union of hours across visible days
    const timeAxis = []
    const timeSet = new Set()
    for (const day of range.days) {
      for (const t of buildSlotsForDay(day.date, slotStep())) {
        if (!timeSet.has(t)) {
          timeSet.add(t)
          timeAxis.push(t)
        }
      }
    }
    timeAxis.sort()

    return {
      ok: true,
      view,
      range: {
        from: range.from,
        to: range.to,
        days: range.days,
        subtitle,
        today: todayLocal(),
      },
      working_hours: WEEKLY_HOURS,
      slot_minutes: slotStep(),
      time_axis: timeAxis,
      appointments,
      available_slots: availableSlots,
      released_slots: releasedSlots,
      banner: bannerSlot
        ? {
          slot_date: bannerSlot.slot_date,
          slot_time: bannerSlot.slot_time,
          appointment_id: bannerSlot.appointment_id,
          message: buildBannerMessage(bannerSlot),
        }
        : null,
      waitlist,
      waitlist_count: waitlist.length,
      practitioners,
      appointment_types: appointmentTypes,
      filters: {
        practitioner_id: practitionerId,
        type,
        status,
      },
    }
  }

  function getAgendaAppointment(appointmentId) {
    const id = Number(appointmentId)
    if (!id) return null
    const row = db.prepare(`
      SELECT
        a.id,
        a.customer_id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        COALESCE(a.duration_minutes, 30) AS duration_minutes,
        a.practitioner_id,
        a.appointment_type,
        a.source,
        c.full_name,
        c.phone_number,
        d.problem,
        d.urgency,
        p.display_name AS practitioner_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      LEFT JOIN practitioners p ON p.id = a.practitioner_id
      WHERE a.id = ?
    `).get(id)
    if (!row) return null
    const time = formatTime(row.appointment_time)
    const duration = Number(row.duration_minutes) || 30
    return {
      id: row.id,
      appointment_id: row.id,
      customer_id: row.customer_id,
      full_name: row.full_name,
      short_name: shortPatientName(row.full_name),
      phone_number: row.phone_number,
      phone_display: formatPhoneDisplay(row.phone_number) || row.phone_number,
      appointment_date: row.appointment_date,
      appointment_time: time,
      duration_minutes: duration,
      end_time: minutesToTime((toMinutes(time) || 0) + duration),
      status: row.status,
      status_label: appointmentStatusLabel(row.status),
      appointment_type: row.appointment_type || row.problem || 'Consultation',
      problem: row.problem,
      practitioner_id: row.practitioner_id || null,
      practitioner_name: row.practitioner_name || null,
      source: row.source || 'whatsapp',
      urgency: row.urgency || null,
    }
  }

  return {
    getAgendaBoard,
    getAgendaAppointment,
    resolveWeekRange,
    buildSlotsForDay,
    formatWeekSubtitle,
    SLOT_MINUTES,
  }
}

function buildBannerMessage(slot) {
  const date = slot.slot_date
  const time = slot.slot_time
  const today = todayLocal()
  const tomorrow = addDays(today, 1)
  let when
  if (date === today) when = `aujourd’hui à ${time}`
  else if (date === tomorrow) when = `demain à ${time}`
  else {
    const d = parseIsoDate(date)
    const wd = weekdayFromIsoDate(date)
    when = `${DAY_SHORT[wd]} ${d.getDate()} à ${time}`
  }
  return {
    title: `Un créneau vient de se libérer ${when}.`,
    detail: 'Vous pouvez proposer ce créneau à un patient.',
  }
}

module.exports = {
  createAgendaBoard,
  resolveWeekRange,
  buildSlotsForDay,
  formatWeekSubtitle,
  formatDaySubtitle,
  shortPatientName,
  SLOT_MINUTES,
}
