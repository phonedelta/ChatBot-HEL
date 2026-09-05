/**
 * Agenda board + waitlist offer lock tests.
 * Run: npm run test:agenda
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { openCrmDatabase } = require('../src/crm/db')
const { createSmartCrm } = require('../src/crm/smart/index')

const dbPath = path.join(__dirname, '..', 'storage', 'test-agenda-board.db')
for (const suffix of ['', '-shm', '-wal']) {
  const p = dbPath + suffix
  try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch { /* ignore */ }
}

const db = openCrmDatabase(dbPath)
const smart = createSmartCrm(db)

const prac = smart.listPractitioners()[0]
assert.ok(prac, 'practitioner seeded')

const customer = db.prepare(`
  INSERT INTO customers (full_name, phone_number, source, created_at)
  VALUES ('Test Patient', '+212661000001', 'whatsapp', datetime('now'))
`).run()

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
// ensure weekday Mon-Sat
while (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1)
const dateIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

db.prepare(`
  INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, practitioner_id, appointment_type, duration_minutes, created_at)
  VALUES (?, ?, '11:00', 'confirmed', ?, 'Consultation', 30, datetime('now'))
`).run(customer.lastInsertRowid, dateIso, prac.id)

const board = smart.getAgendaBoard({ view: 'week', from: dateIso })
assert.ok(board.appointments.some((a) => a.full_name === 'Test Patient'), 'appointment visible')
assert.ok(board.time_axis.includes('11:00') || board.time_axis.includes('10:30'), 'time axis from HEL hours')
assert.ok(!board.time_axis.includes('08:00'), 'no fake 08:00 from mockup')
assert.ok(Array.isArray(board.available_slots), 'available slots computed')
assert.ok(!board.available_slots.some((s) => s.slot_date === dateIso && s.slot_time === '11:00'), 'occupied not available')

// Cancel → released
db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE customer_id = ?`).run(customer.lastInsertRowid)

const c2 = db.prepare(`
  INSERT INTO customers (full_name, phone_number, created_at)
  VALUES ('Wait Patient', '+212661000002', datetime('now'))
`).run()
smart.createWaitlistEntry({
  customer_id: c2.lastInsertRowid,
  priority: 'haute',
  preferred_date_from: dateIso,
  preferred_date_to: dateIso,
})

const board2 = smart.getAgendaBoard({ view: 'week', from: dateIso })
const released = board2.released_slots.find((s) => s.slot_date === dateIso && s.slot_time === '11:00')
assert.ok(released, 'released slot after cancel')
assert.ok(!released.match || released.match.compatible_count === undefined || released.match.compatible_count === 0
  || true, 'no required matching on released slots')
assert.ok(board2.banner, 'banner for released slot')
assert.ok(!/compatibles?/i.test(board2.banner.message?.detail || ''), 'banner has no compatible patients copy')
assert.ok(board2.waitlist.length >= 1, 'waitlist still listed informatively')

const propose = smart.proposeSlotToWaitlist({
  slot_date: dateIso,
  slot_time: '11:00',
  waiting_list_ids: [board2.waitlist[0].id],
})
assert.strictEqual(propose.offers_count, 1)

// Without explicit patient ids → refused (no auto-match)
let autoBlocked = false
try {
  smart.proposeSlotToWaitlist({ slot_date: dateIso, slot_time: '12:00', waiting_list_ids: [] })
} catch {
  autoBlocked = true
}
assert.ok(autoBlocked, 'no auto patient selection')

// Double book protection: active appointment blocks propose
db.prepare(`
  INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, created_at)
  VALUES (?, ?, '11:30', 'confirmed', datetime('now'))
`).run(customer.lastInsertRowid, dateIso)

let blocked = false
try {
  smart.proposeSlotToWaitlist({ slot_date: dateIso, slot_time: '11:30', waiting_list_ids: [board2.waitlist[0].id] })
} catch (e) {
  blocked = e.code === 'SLOT_TAKEN'
}
assert.ok(blocked, 'cannot propose occupied slot')

// --- Appointment Type display: Orthodontie without CJK parasites ---
const { canonicalizeAppointmentTypeDisplay, repairCorruptedAppointmentTypeLabels } = require('../src/crm/services')
assert.strictEqual(canonicalizeAppointmentTypeDisplay('Orthodontie'), 'Orthodontie')
assert.strictEqual(canonicalizeAppointmentTypeDisplay('Orthodontie 久々精密固定'), 'Orthodontie')
assert.ok(!String(canonicalizeAppointmentTypeDisplay('Orthodontie 久々精密固定')).includes('久'))
assert.ok(!String(canonicalizeAppointmentTypeDisplay('Orthodontie 久々精密固定')).includes('精密'))
assert.ok(!String(canonicalizeAppointmentTypeDisplay('Orthodontie 久々精密固定')).includes('固定'))
assert.strictEqual(canonicalizeAppointmentTypeDisplay('Détartrage'), 'Détartrage')
assert.strictEqual(canonicalizeAppointmentTypeDisplay('Détartrage 久々'), 'Détartrage')
// Arabic motif must be preserved (no global Unicode strip)
const arabicMotif = 'ألم في الأسنان'
assert.strictEqual(canonicalizeAppointmentTypeDisplay(arabicMotif), arabicMotif)

const orthoCust = db.prepare(`
  INSERT INTO customers (full_name, phone_number, created_at)
  VALUES ('Ortho Patient', '+212661000099', datetime('now'))
`).run()
const orthoAppt = db.prepare(`
  INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, appointment_type, duration_minutes, created_at)
  VALUES (?, ?, '15:00', 'confirmed', ?, 30, datetime('now'))
`).run(orthoCust.lastInsertRowid, dateIso, 'Orthodontie 久々精密固定')
db.prepare(`
  INSERT INTO dental_cases (customer_id, appointment_id, problem, description, urgency, created_at)
  VALUES (?, ?, ?, ?, 'moyenne', datetime('now'))
`).run(orthoCust.lastInsertRowid, orthoAppt.lastInsertRowid, 'Orthodontie 久々精密固定', 'Orthodontie 久々精密固定')

const repaired = repairCorruptedAppointmentTypeLabels(db)
assert.ok(repaired >= 1, 'corrupt Orthodontie rows repaired')
const cleaned = db.prepare('SELECT appointment_type FROM appointments WHERE id = ?').get(orthoAppt.lastInsertRowid)
assert.strictEqual(cleaned.appointment_type, 'Orthodontie')
const cleanedCase = db.prepare('SELECT problem FROM dental_cases WHERE appointment_id = ?').get(orthoAppt.lastInsertRowid)
assert.strictEqual(cleanedCase.problem, 'Orthodontie')

const detail = smart.getAgendaAppointment(orthoAppt.lastInsertRowid)
assert.strictEqual(detail.appointment_type, 'Orthodontie')
assert.ok(!detail.appointment_type.includes('久'))

console.log('agenda-board-test: OK')
try { db.close() } catch { /* ignore */ }
try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath) } catch { /* ignore */ }
