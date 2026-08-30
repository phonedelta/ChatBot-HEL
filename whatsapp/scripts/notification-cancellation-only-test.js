/**
 * Slot notifications ONLY on cancellation + proposal message templates.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { proposalWhatsAppMessage } = require('../src/crm/smart/slot-proposals')

function weekdayFuture(daysAhead = 3, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 14; i += 1) {
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

function seedAppointment(crm, {
  name = 'Amine Benali',
  phone = '+212612345678',
  chat = '212612345678@c.us',
  slot,
  status = 'confirmed',
} = {}) {
  const cust = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES (?, ?, 'Casablanca', 'fr', ?, datetime('now'))
  `).run(name, phone, chat)
  const customerId = cust.lastInsertRowid
  const appt = crm.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, ?, ?, 30, datetime('now'))
  `).run(customerId, slot.date, slot.time, status, chat)
  return { customerId, appointmentId: appt.lastInsertRowid, chat }
}

function countBellSlots(crm) {
  const board = crm.smart.getNotificationsBoard({ limit: 50 })
  return board.items.filter((n) => n.type === 'slot_released').length
}

async function run() {
  // --- Template FR ---
  const fr = proposalWhatsAppMessage({
    patientName: 'Adam Mait',
    slotDate: '2026-08-31',
    slotTime: '11:00',
    currentDate: '2026-09-03',
    currentTime: '11:00',
    language: 'fr',
  })
  assert.match(fr, /^Bonjour Adam,/m)
  assert.match(fr, /Un créneau est disponible le/)
  assert.match(fr, /Souhaitez-vous déplacer votre rendez-vous actuel/)
  assert.match(fr, /Répondez OUI pour accepter ou NON/)
  assert.ok(!/s'est libéré au Centre Dentaire HEL/i.test(fr))
  assert.ok(!/merci de répondre OUI/i.test(fr))

  // --- Template Darija (Arabic script) ---
  const darija = proposalWhatsAppMessage({
    patientName: 'Adam Mait',
    slotDate: '2026-08-31',
    slotTime: '11:00',
    currentDate: '2026-09-03',
    currentTime: '11:00',
    language: 'darija',
  })
  assert.match(darija, /مرحبا/)
  assert.match(darija, /نعم/)
  assert.ok(!/oui khoya|wakha|bghit/i.test(darija))

  const tmp = path.join(os.tmpdir(), `hel-notif-cancel-only-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })

  // Seed a mistaken historical slot_proposal — must not count
  crm.db.prepare(`
    INSERT INTO notifications (type, title, body, created_at)
    VALUES ('slot_proposal', 'Proposition envoyée', 'Adam · test', datetime('now'))
  `).run()
  // Force re-init soft-hide by calling board (createSmartCrm already ran hide on open)
  // Mark manually if still unread from before soft-hide in same process — soft-hide ran at init
  let board = crm.smart.getNotificationsBoard({ limit: 30 })
  assert.ok(!board.items.some((n) => n.type === 'slot_proposal'))
  assert.equal(board.unreadCount, 0)

  // createNotification must refuse slot_proposal
  const refused = crm.smart.createNotification({
    type: 'slot_proposal',
    title: 'Proposition envoyée',
    body: 'should not appear',
  })
  assert.equal(refused, null)
  board = crm.smart.getNotificationsBoard({ limit: 30 })
  assert.ok(!board.items.some((n) => n.type === 'slot_proposal'))

  // Move must NOT create notification
  const oldSlot = weekdayFuture(6, '15:00')
  const newSlot = weekdayFuture(8, '11:30')
  const b = seedAppointment(crm, {
    name: 'Sara Dupont',
    phone: '+212622222222',
    chat: '212622222222@c.us',
    slot: oldSlot,
  })
  const beforeMove = countBellSlots(crm)
  const moved = crm.repo.updateAppointment(b.appointmentId, {
    full_name: 'Sara Dupont',
    phone_number: '+212622222222',
    appointment_date: newSlot.date,
    appointment_time: newSlot.time,
    status: 'confirmed',
  })
  assert.ok(!moved?._slot_released)
  const moveAttempt = crm.smart.notifySlotReleased({
    slotDate: oldSlot.date,
    slotTime: oldSlot.time,
    appointmentId: b.appointmentId,
    sourceEvent: 'appointment_moved',
  })
  assert.equal(moveAttempt.ok, false)
  assert.equal(moveAttempt.reason, 'not_cancellation')
  assert.equal(countBellSlots(crm), beforeMove)

  // Cancel MUST create notification
  const slotA = weekdayFuture(4, '11:00')
  const a = seedAppointment(crm, {
    phone: '+212611111111',
    chat: '212611111111@c.us',
    slot: slotA,
  })
  const beforeCancel = countBellSlots(crm)
  const updated = crm.repo.updateAppointment(a.appointmentId, { status: 'cancelled' })
  assert.ok(updated?._slot_released)
  const cancelNotify = crm.smart.notifySlotReleased({
    slotDate: updated._slot_released.slot_date,
    slotTime: updated._slot_released.slot_time,
    appointmentId: updated._slot_released.appointment_id,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(cancelNotify.ok, true)
  assert.ok(cancelNotify.notification?.id)
  assert.equal(countBellSlots(crm), beforeCancel + 1)

  board = crm.smart.getNotificationsBoard({ limit: 30 })
  const slotNotif = board.items.find((n) => n.type === 'slot_released')
  assert.ok(slotNotif)
  assert.equal(slotNotif.type_label, 'Créneau disponible')
  assert.ok(!/slot_proposal|appointment_cancelled/i.test(slotNotif.type_label))
  assert.match(slotNotif.body, /annulé/i)

  // Idempotency
  const again = crm.smart.notifySlotReleased({
    slotDate: slotA.date,
    slotTime: slotA.time,
    appointmentId: a.appointmentId,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(again.already, true)
  assert.equal(countBellSlots(crm), beforeCancel + 1)

  // Unread count ignores hidden types
  assert.ok(board.unreadCount >= 1)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('notification-cancellation-only tests OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
