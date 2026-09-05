/**
 * Staff dashboard confirm → patient WhatsApp notification.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { msgStaffConfirmedPatient } = require('../src/crm/smart/appointment-confirmation')

function weekdayFuture(daysAhead = 4, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 21; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    // Avoid Sunday (closed) and Saturday (short hours / forced 11:00)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return { date: `${yyyy}-${mm}-${dd}`, time }
  }
  throw new Error('no weekday')
}

function makeNonConfirmeBooking(crm, overrides = {}) {
  const slot = weekdayFuture(overrides.daysAhead || 5, overrides.time || '11:30')
  const booking = crm.repo.saveConfirmedBooking({
    full_name: overrides.full_name || 'Salim Zouhairi',
    phone_number: overrides.phone_number || '+212612345678',
    city: 'Rabat',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: slot.time,
    whatsapp_chat_id: overrides.whatsapp_chat_id || '212612345678@c.us',
    language: overrides.language || 'fr',
  })
  crm.db.prepare(`
    UPDATE appointments SET status = 'non_confirme', confirmed_at = NULL, confirmation_source = NULL
    WHERE id = ?
  `).run(booking.appointment.id)
  try {
    crm.db.prepare(`
      UPDATE customers
      SET preferred_language = ?, whatsapp_chat_id = ?
      WHERE id = ?
    `).run(
      overrides.language || 'fr',
      overrides.whatsapp_chat_id || '212612345678@c.us',
      booking.customer.id,
    )
  } catch { /* optional columns */ }
  return booking
}

async function main() {
  console.log('--- message templates ---')
  const fr = msgStaffConfirmedPatient({
    full_name: 'Salim Zouhairi',
    appointment_date: '2026-09-10',
    appointment_time: '14:00',
  }, 'fr')
  assert.match(fr, /Bonjour Salim/)
  assert.match(fr, /confirmé/i)
  assert.ok(!/Arabizi|mdina|bghit/i.test(fr))

  const ar = msgStaffConfirmedPatient({
    full_name: 'Salim Zouhairi',
    appointment_date: '2026-09-10',
    appointment_time: '14:00',
  }, 'darija')
  assert.match(ar, /تأكد/)
  assert.match(ar, /سلام/)

  const tmp = path.join(os.tmpdir(), `hel-staff-confirm-wa-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const booking = makeNonConfirmeBooking(crm)
  const apptId = booking.appointment.id

  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId }
  })

  console.log('--- staff confirm notifies patient ---')
  const result = await crm.smart.confirmAppointmentAndNotify(apptId, {
    source: 'staff_dashboard',
    actorName: 'Assistante',
  })
  assert.equal(result.ok, true)
  assert.ok(!result.already)
  assert.equal(result.appointment.status, 'confirmed')
  assert.equal(result.whatsapp.sent, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /confirmé/i)
  assert.match(sent[0].text, /Salim/)

  console.log('--- patient WhatsApp confirm source does not staff-notify ---')
  const booking2 = makeNonConfirmeBooking(crm, { daysAhead: 9, time: '14:00' })
  const before = sent.length
  const patientConfirm = await crm.smart.confirmAppointmentAndNotify(booking2.appointment.id, {
    source: 'whatsapp_patient',
  })
  assert.equal(patientConfirm.ok, true)
  assert.equal(patientConfirm.whatsapp.skipped, true)
  assert.equal(sent.length, before)

  console.log('--- already confirmed skips notify ---')
  const again = await crm.smart.confirmAppointmentAndNotify(apptId, {
    source: 'staff_dashboard',
  })
  assert.equal(again.already, true)
  assert.equal(again.whatsapp.skipped, true)

  console.log('--- idempotent notify if already logged ---')
  const booking3 = makeNonConfirmeBooking(crm, { daysAhead: 16, time: '16:00' })
  const first = await crm.smart.confirmAppointmentAndNotify(booking3.appointment.id, {
    source: 'staff_dashboard',
  })
  assert.equal(first.whatsapp.sent, true)
  const afterFirst = sent.length
  const notifyAgain = await crm.smart.notifyPatientStaffConfirmation(first.appointment, {
    source: 'staff_dashboard',
  })
  assert.equal(notifyAgain.skipped, true)
  assert.equal(sent.length, afterFirst)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('\nstaff-confirm-whatsapp-notify: passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
