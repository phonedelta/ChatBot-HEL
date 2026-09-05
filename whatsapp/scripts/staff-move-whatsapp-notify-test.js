/**
 * Staff agenda move → patient WhatsApp notification.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { msgStaffMovedPatient } = require('../src/crm/smart/slot-proposals')

function weekdayFuture(daysAhead = 5, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 21; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return { date: `${yyyy}-${mm}-${dd}`, time }
  }
  throw new Error('no weekday')
}

async function main() {
  console.log('--- message templates ---')
  const fr = msgStaffMovedPatient({
    full_name: 'Salim Zouhairi',
    old_date: '2026-09-10',
    old_time: '11:30',
    new_date: '2026-09-14',
    new_time: '15:00',
  }, 'fr')
  assert.match(fr, /Bonjour Salim/)
  assert.match(fr, /modifié|changé|Nouveau créneau/i)
  assert.match(fr, /Ancien créneau/)

  const ar = msgStaffMovedPatient({
    full_name: 'Salim Zouhairi',
    old_date: '2026-09-10',
    old_time: '11:30',
    new_date: '2026-09-14',
    new_time: '15:00',
  }, 'darija')
  assert.match(ar, /تغيير|تم تغيير/)
  assert.match(ar, /سلام/)

  const tmp = path.join(os.tmpdir(), `hel-staff-move-wa-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const slot = weekdayFuture(5, '11:30')
  const next = weekdayFuture(9, '15:00')

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
  try {
    crm.db.prepare(`
      UPDATE customers SET preferred_language = 'fr', whatsapp_chat_id = ? WHERE id = ?
    `).run('212612345678@c.us', booking.customer.id)
  } catch { /* optional */ }

  const sent = []
  crm.smart.setSlotProposalSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId }
  })

  console.log('--- staff move notifies patient ---')
  const result = await crm.smart.moveAppointmentAndNotify({
    appointmentId: booking.appointment.id,
    slotDate: next.date,
    slotTime: next.time,
    actorName: 'Assistante',
  })
  assert.equal(result.appointment.appointment_date, next.date)
  assert.equal(String(result.appointment.appointment_time).slice(0, 5), next.time)
  assert.equal(result.whatsapp.sent, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /Nouveau créneau|modifié/i)
  assert.match(sent[0].text, /Salim/)

  console.log('--- notifyPatient=false skips WhatsApp ---')
  const slot3 = weekdayFuture(12, '16:00')
  const before = sent.length
  const skipped = await crm.smart.moveAppointmentAndNotify({
    appointmentId: booking.appointment.id,
    slotDate: slot3.date,
    slotTime: slot3.time,
    notifyPatient: false,
  })
  assert.equal(skipped.whatsapp.skipped, true)
  assert.equal(sent.length, before)

  console.log('--- move does not create fake new-booking bell ---')
  const board = crm.smart.getNotificationsBoard({ limit: 30 })
  const fakeNew = board.items.filter(
    (n) => n.type === 'appointment_created' && n.appointment_id === booking.appointment.id,
  )
  assert.equal(fakeNew.length, 0)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('\nstaff-move-whatsapp-notify: passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
