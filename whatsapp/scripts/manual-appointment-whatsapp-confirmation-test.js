/**
 * Manual appointment WhatsApp confirmation tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  buildManualAppointmentConfirmationMessage,
  formatManualAppointmentDate,
} = require('../src/crm/smart/manual-appointment-confirmation')

function weekdaySlot(daysAhead = 3) {
  for (let i = daysAhead; i < daysAhead + 14; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const time = d.getDay() === 6 ? '11:00' : '10:30'
    return { date: `${yyyy}-${mm}-${dd}`, time }
  }
  throw new Error('no slot')
}

async function run() {
  // Template determinism
  const msg = buildManualAppointmentConfirmationMessage({
    patientName: 'Yassine Zouhairi',
    date: '2026-09-02',
    time: '10:30',
    reason: 'Blanchiment dentaire',
    sharedContact: false,
  })
  assert.match(msg, /السلام عليكم Yassine Zouhairi/)
  assert.match(msg, /02\/09\/2026/)
  assert.match(msg, /10:30/)
  assert.match(msg, /تبييض الأسنان/)
  assert.ok(!/oui|wakha|confirmi/i.test(msg))

  const shared = buildManualAppointmentConfirmationMessage({
    patientName: 'Yassine Zouhairi',
    date: '2026-09-02',
    time: '10:30',
    reason: 'Blanchiment dentaire',
    sharedContact: true,
  })
  assert.match(shared, /تم تسجيل الموعد ديال Yassine Zouhairi/)
  assert.ok(!/السلام عليكم Yassine Zouhairi 👋/.test(shared))

  assert.strictEqual(formatManualAppointmentDate('2026-09-02'), '02/09/2026')

  const tmpDb = path.join(os.tmpdir(), `hel-manual-appt-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId: chatId || `${phone.replace(/\D/g, '')}@c.us` }
  })

  const slot = weekdaySlot(4)

  // Invalid phone
  try {
    crm.repo.createManualAppointment({
      full_name: 'Karim Benali',
      phone_number: '123',
      city: 'Kénitra',
      problem: 'Consultation',
      appointment_date: slot.date,
      appointment_time: slot.time,
    })
    assert.fail('expected invalid phone')
  } catch (error) {
    assert.match(error.message, /téléphone invalide/i)
  }
  assert.strictEqual(sent.length, 0)

  // Success flow
  const booking = crm.repo.createManualAppointment({
    full_name: 'QA Manual Patient',
    phone_number: '0602269408',
    city: 'Kénitra',
    problem: 'Blanchiment dentaire',
    appointment_date: slot.date,
    appointment_time: slot.time,
  })
  assert.strictEqual(booking.appointment.status, 'confirmed')
  assert.strictEqual(booking.customer.phone_number, '+212602269408')

  const sideEffects = await crm.smart.completeManualAppointmentCreation(booking)
  assert.strictEqual(sideEffects.whatsapp.sent, true)
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].phone, '+212602269408')
  assert.match(sent[0].text, new RegExp(booking.customer.full_name, 'i'))
  assert.match(sent[0].text, /تبييض الأسنان/)

  const acr = crm.smart.appointmentConfirmation.getRequestByAppointment(booking.appointment_id)
  assert.ok(acr, 'ACR row must exist')
  assert.strictEqual(acr.status, 'confirmed')
  assert.strictEqual(acr.confirmation_source, 'dashboard_manual')
  assert.ok(acr.initial_sent_at)

  // Idempotency — second call must not send again
  const again = await crm.smart.completeManualAppointmentCreation(booking)
  assert.strictEqual(again.whatsapp.skipped, true)
  assert.strictEqual(sent.length, 1)

  // Slot conflict — no WhatsApp
  try {
    crm.repo.createManualAppointment({
      full_name: 'Other Patient',
      phone_number: '0611111111',
      city: 'Casablanca',
      problem: 'Consultation',
      appointment_date: slot.date,
      appointment_time: slot.time,
    })
    assert.fail('expected slot conflict')
  } catch (error) {
    assert.match(error.message, /déjà réservé/i)
  }
  assert.strictEqual(sent.length, 1)

  // WhatsApp disconnected
  crm.smart.setAppointmentConfirmationSender(async () => {
    const err = new Error('WhatsApp instance not ready (qr)')
    err.code = 'WA_NOT_READY'
    throw err
  })
  const slot2 = weekdaySlot(5)
  const booking2 = crm.repo.createManualAppointment({
    full_name: 'WA Fail Patient',
    phone_number: '0622222222',
    city: 'Rabat',
    problem: 'Détartrage',
    appointment_date: slot2.date,
    appointment_time: slot2.time,
  })
  const failFx = await crm.smart.completeManualAppointmentCreation(booking2)
  assert.strictEqual(failFx.whatsapp.disconnected, true)
  assert.strictEqual(failFx.whatsapp.sent, false)
  const appt2 = crm.repo.db.prepare('SELECT status FROM appointments WHERE id = ?')
    .get(booking2.appointment_id)
  assert.strictEqual(appt2.status, 'confirmed')

  // Multi-patient same phone
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-mp-${sent.length}`, chatId: '212602269408@c.us' }
  })
  crm.repo.createManualAppointment({
    full_name: 'Salim Zouhairi',
    phone_number: '0602269408',
    city: 'Kénitra',
    problem: 'Consultation',
    appointment_date: weekdaySlot(6).date,
    appointment_time: '11:00',
  })
  const slot3 = weekdaySlot(7)
  const yassineBooking = crm.repo.createManualAppointment({
    full_name: 'Yassine Zouhairi',
    phone_number: '0602269408',
    city: 'Kénitra',
    problem: 'Blanchiment dentaire',
    appointment_date: slot3.date,
    appointment_time: slot3.time,
  })
  // Clear idempotency guard for new appointment
  const yFx = await crm.smart.completeManualAppointmentCreation(yassineBooking)
  assert.strictEqual(yFx.whatsapp.sent, true)
  const lastSent = sent[sent.length - 1]
  assert.match(lastSent.text, /Yassine Zouhairi/)
  assert.match(lastSent.text, /تم تسجيل الموعد ديال Yassine Zouhairi/)

  const salim = crm.repo.db.prepare(`
    SELECT full_name FROM customers WHERE full_name LIKE 'Salim%'
  `).get()
  assert.ok(salim, 'Salim must still exist')

  console.log('manual-appointment-whatsapp-confirmation-test: OK')
  try { fs.unlinkSync(tmpDb) } catch { /* ignore */ }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
