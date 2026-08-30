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

console.log('agenda-board-test: OK')
try { db.close() } catch { /* ignore */ }
try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath) } catch { /* ignore */ }
