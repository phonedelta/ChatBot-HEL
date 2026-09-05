/**
 * WhatsApp booking → dashboard bell notification.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')

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
  const tmp = path.join(os.tmpdir(), `hel-wa-booking-notif-${Date.now()}.sqlite`)
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

  console.log('--- registerBookingCreated creates bell notification ---')
  crm.smart.registerBookingCreated(apptId, {
    chatKey: '212612345678@c.us',
    language: 'fr',
  })
  const board = crm.smart.getNotificationsBoard({ limit: 20 })
  const created = board.items.find((n) => n.type === 'appointment_created')
  assert.ok(created, 'expected appointment_created notification')
  assert.match(created.title, /Nouveau rendez-vous/i)
  assert.match(String(created.body || ''), /Salim/)
  assert.equal(created.appointment_id, apptId)
  assert.equal(created.type_label, 'Nouveau rendez-vous')
  assert.ok(board.unreadCount >= 1)

  console.log('--- idempotent unique_key ---')
  crm.smart.registerBookingCreated(apptId, {
    chatKey: '212612345678@c.us',
    language: 'fr',
  })
  const again = crm.smart.getNotificationsBoard({ limit: 50 })
  const sameType = again.items.filter((n) => n.type === 'appointment_created' && n.appointment_id === apptId)
  assert.equal(sameType.length, 1)

  console.log('--- settings toggle disables ---')
  crm.smart.updateNotificationsSettings({ appointmentCreated: false })
  const slot2 = weekdayFuture(9, '14:00')
  const booking2 = crm.repo.saveConfirmedBooking({
    full_name: 'Salim Zouhairi',
    phone_number: '+212612345678',
    city: 'Rabat',
    problem: 'Consultation',
    appointment_date: slot2.date,
    appointment_time: slot2.time,
    whatsapp_chat_id: '212612345678@c.us',
  })
  const beforeCount = crm.smart.getNotificationsBoard({ limit: 50 }).items
    .filter((n) => n.type === 'appointment_created').length
  crm.smart.registerBookingCreated(booking2.appointment.id, {
    chatKey: '212612345678@c.us',
  })
  const afterCount = crm.smart.getNotificationsBoard({ limit: 50 }).items
    .filter((n) => n.type === 'appointment_created').length
  assert.equal(afterCount, beforeCount)

  const prefs = crm.smart.getNotificationsSettings()
  assert.strictEqual(prefs.appointmentCreated, false)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('\nwhatsapp-booking-notification: passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
