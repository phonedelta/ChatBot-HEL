/**
 * QA regression tests — QACRM tickets (automatable backend checks).
 * Run: npm run test:qa-regressions
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { createSmartCrm } = require('../src/crm/smart/index')
const { normalizeBusinessDate, assertSlotAvailable } = require('../src/crm/appointment-slots')
const { buildSimplePdf } = require('../src/dashboard/simple-pdf')

function weekdayFuture(daysAhead = 5, time = '10:30') {
  for (let i = daysAhead; i < daysAhead + 14; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return { date: `${yyyy}-${mm}-${dd}`, time: d.getDay() === 6 ? '11:00' : time }
  }
  throw new Error('no weekday')
}

async function run() {
  // QACRM-014 — date preservation
  assert.strictEqual(normalizeBusinessDate('2026-09-01'), '2026-09-01')
  assert.strictEqual(normalizeBusinessDate('2026-09-05'), '2026-09-05')
  let threw = false
  try {
    normalizeBusinessDate('2026-13-01')
  } catch (e) {
    threw = true
    assert.strictEqual(e.code, 'VALIDATION')
  }
  assert.ok(threw, 'invalid date rejected')

  const dbPath = path.join(os.tmpdir(), `hel-qa-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath })
  const smart = createSmartCrm(crm.db)
  const slot = weekdayFuture(7, '10:30')

  // QACRM-012 — manual patient name preserved
  const manual = smart.createManualPatient({
    fullName: 'QA Test 20260831',
    phoneNumber: '+212600000111',
    city: 'Casablanca',
  })
  assert.strictEqual(manual.patient.full_name, 'QA Test 20260831')

  // QACRM-015 — slot conflict on manual create
  crm.repo.createManualAppointment({
    full_name: 'Slot Patient A',
    phone_number: '+212600000222',
    problem: 'consultation',
    appointment_date: slot.date,
    appointment_time: slot.time,
  })
  let conflict = false
  try {
    crm.repo.createManualAppointment({
      full_name: 'Slot Patient B',
      phone_number: '+212600000223',
      problem: 'consultation',
      appointment_date: slot.date,
      appointment_time: slot.time,
    })
  } catch (e) {
    conflict = true
    assert.strictEqual(e.code, 'SLOT_CONFLICT')
  }
  assert.ok(conflict, 'duplicate active slot blocked')

  // QACRM-013 — required motif/time
  let missingMotif = false
  try {
    crm.repo.createManualAppointment({
      full_name: 'No Motif Test',
      phone_number: '+212600000224',
      problem: '',
      appointment_date: weekdayFuture(8).date,
      appointment_time: '11:00',
    })
  } catch (e) {
    missingMotif = true
    assert.strictEqual(e.code, 'VALIDATION')
  }
  assert.ok(missingMotif, 'empty motif rejected')

  // QACRM-018 — cancelled visible in agenda filter
  const apptRow = crm.db.prepare(`
    SELECT id FROM appointments WHERE appointment_date = ? AND appointment_time = ?
  `).get(slot.date, slot.time)
  crm.repo.updateAppointment(apptRow.id, { status: 'cancelled' })
  const boardCancelled = smart.getAgendaBoard({ view: 'week', from: slot.date, status: 'cancelled' })
  assert.ok(
    boardCancelled.appointments.some((a) => Number(a.id) === Number(apptRow.id)),
    'cancelled appointment visible in Annulé filter',
  )

  // QACRM-010 — PDF bytes + signature
  const pdf = buildSimplePdf('Test', ['line 1'])
  assert.ok(pdf.length > 100)
  assert.ok(pdf.slice(0, 5).toString() === '%PDF-')

  // QACRM-009 — date helper sanity (backend storage unchanged)
  const stored = crm.db.prepare('SELECT appointment_date FROM appointments WHERE id = ?').get(apptRow.id)
  assert.strictEqual(String(stored.appointment_date), slot.date)

  try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  console.log('qa-regressions-test: PASS')
}

run().catch((err) => {
  console.error('qa-regressions-test: FAIL', err)
  process.exit(1)
})
