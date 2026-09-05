/**
 * Staff dashboard cancel → patient WhatsApp notification.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { msgStaffCancelledPatient } = require('../src/crm/smart/whatsapp-cancel')

function weekdayFuture(daysAhead = 4, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 21; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const t = d.getDay() === 6 ? '11:00' : time
    return { date: `${yyyy}-${mm}-${dd}`, time: t }
  }
  throw new Error('no weekday')
}

async function main() {
  console.log('--- message templates ---')
  const fr = msgStaffCancelledPatient({
    full_name: 'Salim Zouhairi',
    appointment_date: '2026-09-10',
    appointment_time: '14:00',
  }, 'fr')
  assert.match(fr, /Bonjour Salim/)
  assert.match(fr, /annulé/i)
  assert.ok(!/Arabizi|mdina|bghit/i.test(fr))

  const ar = msgStaffCancelledPatient({
    full_name: 'Salim Zouhairi',
    appointment_date: '2026-09-10',
    appointment_time: '14:00',
  }, 'darija')
  assert.match(ar, /إلغا|تم إلغا/)
  assert.match(ar, /سلام/)

  const tmp = path.join(os.tmpdir(), `hel-staff-cancel-wa-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const slot = weekdayFuture(5, '11:30')
  const booking = crm.repo.saveConfirmedBooking({
    full_name: 'Salim Zouhairi',
    phone_number: '+212612345678',
    city: 'Rabat',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: slot.time,
    whatsapp_chat_id: '212612345678@c.us',
    language: 'fr',
  })
  const apptId = booking.appointment.id

  // Set preferred language + chat on customer if columns exist
  try {
    crm.db.prepare(`
      UPDATE customers
      SET preferred_language = 'fr', whatsapp_chat_id = ?
      WHERE id = ?
    `).run('212612345678@c.us', booking.customer.id)
  } catch { /* optional columns */ }

  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId }
  })

  console.log('--- staff cancel notifies patient ---')
  const result = await crm.smart.cancelAppointmentAndNotify(apptId, {
    source: 'staff_dashboard',
    actorName: 'Assistante',
  })
  assert.equal(result.ok, true)
  assert.ok(!result.already)
  assert.equal(result.appointment.status, 'cancelled')
  assert.equal(result.whatsapp.sent, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /annulé/i)
  assert.match(sent[0].text, /Salim/)

  console.log('--- patient self-cancel source does not double-notify ---')
  const slot2 = weekdayFuture(8, '11:00')
  const booking2 = crm.repo.saveConfirmedBooking({
    full_name: 'Salim Zouhairi',
    phone_number: '+212612345678',
    city: 'Rabat',
    problem: 'Consultation',
    appointment_date: slot2.date,
    appointment_time: slot2.time,
  })
  const before = sent.length
  const patientCancel = await crm.smart.cancelAppointmentAndNotify(booking2.appointment.id, {
    source: 'whatsapp_patient',
  })
  assert.equal(patientCancel.ok, true)
  assert.equal(patientCancel.whatsapp.skipped, true)
  assert.equal(sent.length, before)

  console.log('--- already cancelled skips notify ---')
  const again = await crm.smart.cancelAppointmentAndNotify(apptId, {
    source: 'staff_dashboard',
  })
  assert.equal(again.already, true)
  assert.equal(again.whatsapp.skipped, true)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('\nstaff-cancel-whatsapp-notify: passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
