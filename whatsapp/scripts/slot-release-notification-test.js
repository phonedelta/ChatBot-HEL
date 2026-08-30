/**
 * Slot-release dashboard notifications — cancel / move / idempotency / read state.
 * Never auto-proposes WhatsApp.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')

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

function countSlotReleased(crm) {
  return crm.db.prepare(`
    SELECT COUNT(*) AS c FROM notifications WHERE type = 'slot_released'
  `).get().c
}

async function run() {
  const tmp = path.join(os.tmpdir(), `hel-slot-rel-notif-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  assert.ok(crm.smart?.notifySlotReleased, 'notifySlotReleased exported')

  // --- cancel creates notification ---
  const slotA = weekdayFuture(4, '11:00')
  const a = seedAppointment(crm, {
    phone: '+212611111111',
    chat: '212611111111@c.us',
    slot: slotA,
  })
  const beforeCancel = countSlotReleased(crm)
  const updated = crm.repo.updateAppointment(a.appointmentId, { status: 'cancelled' })
  assert.ok(updated?._slot_released, 'cancel flags _slot_released')
  const cancelNotify = crm.smart.notifySlotReleased({
    slotDate: updated._slot_released.slot_date,
    slotTime: updated._slot_released.slot_time,
    appointmentId: updated._slot_released.appointment_id,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(cancelNotify.ok, true)
  assert.ok(cancelNotify.notification?.id)
  assert.equal(countSlotReleased(crm), beforeCancel + 1)

  // --- idempotency ---
  const again = crm.smart.notifySlotReleased({
    slotDate: slotA.date,
    slotTime: slotA.time,
    appointmentId: a.appointmentId,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(again.ok, true)
  assert.equal(again.already, true)
  assert.equal(countSlotReleased(crm), beforeCancel + 1)

  // --- move does NOT create notification ---
  const oldSlot = weekdayFuture(6, '15:00')
  const newSlot = weekdayFuture(8, '11:30')
  const b = seedAppointment(crm, {
    name: 'Sara Dupont',
    phone: '+212622222222',
    chat: '212622222222@c.us',
    slot: oldSlot,
  })
  const beforeMove = countSlotReleased(crm)
  const moved = crm.repo.updateAppointment(b.appointmentId, {
    full_name: 'Sara Dupont',
    phone_number: '+212622222222',
    appointment_date: newSlot.date,
    appointment_time: newSlot.time,
    status: 'confirmed',
  })
  assert.ok(!moved?._slot_released, 'moves must not flag slot notification')
  const moveNotify = crm.smart.notifySlotReleased({
    slotDate: oldSlot.date,
    slotTime: oldSlot.time,
    appointmentId: b.appointmentId,
    sourceEvent: 'appointment_moved',
  })
  assert.equal(moveNotify.ok, false)
  assert.equal(moveNotify.reason, 'not_cancellation')
  assert.equal(countSlotReleased(crm), beforeMove)

  // --- past slot: no notification ---
  const past = crm.smart.notifySlotReleased({
    slotDate: '2020-01-06',
    slotTime: '11:00',
    appointmentId: 999001,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(past.ok, false)
  assert.equal(past.reason, 'past')

  // --- sunday / outside hours ---
  const sunday = crm.smart.notifySlotReleased({
    slotDate: (() => {
      const d = new Date()
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7))
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    })(),
    slotTime: '11:00',
    appointmentId: 999002,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(sunday.ok, false)
  assert.ok(['outside_hours', 'past'].includes(sunday.reason))

  // --- no spam for existing empty availability (calling notify without real free event still needs free slot) ---
  // Creating a notification for a free future weekday slot without an appointment is allowed only if free —
  // but product path never calls this for normal available tiles. Verify board does not invent rows.
  const boardBefore = crm.smart.getNotificationsBoard({ limit: 50 })
  const spamCount = boardBefore.items.filter((n) => n.type === 'slot_released').length
  // Opening agenda does not create notifications
  if (crm.smart.getAgendaBoard) {
    crm.smart.getAgendaBoard({ view: 'week', from: slotA.date })
  }
  const boardAfterAgenda = crm.smart.getNotificationsBoard({ limit: 50 })
  assert.equal(
    boardAfterAgenda.items.filter((n) => n.type === 'slot_released').length,
    spamCount,
    'agenda refresh must not create notifications',
  )

  // --- unread count + mark read ---
  const board = crm.smart.getNotificationsBoard({ limit: 30 })
  assert.ok(board.unreadCount >= 1)
  const unreadId = board.items.find((n) => !n.read_at)?.id
  assert.ok(unreadId)
  crm.smart.markNotificationRead(unreadId)
  const afterRead = crm.smart.getNotificationsBoard({ limit: 30 })
  const that = afterRead.items.find((n) => n.id === unreadId)
  assert.ok(that?.read_at || that?.is_read)

  const unreadBeforeAll = afterRead.unreadCount
  crm.smart.markAllNotificationsRead()
  const afterAll = crm.smart.getNotificationsBoard({ limit: 30 })
  assert.equal(afterAll.unreadCount, 0)
  assert.ok(unreadBeforeAll >= 0)

  // --- slot taken: still_occupied ---
  const occupied = weekdayFuture(5, '12:00')
  const c = seedAppointment(crm, {
    name: 'Karim',
    phone: '+212633333333',
    chat: '212633333333@c.us',
    slot: occupied,
    status: 'confirmed',
  })
  const blocked = crm.smart.notifySlotReleased({
    slotDate: occupied.date,
    slotTime: occupied.time,
    appointmentId: c.appointmentId + 999,
    sourceEvent: 'appointment_cancelled',
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'still_occupied')

  // cleanup
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }

  console.log('slot-release-notification tests OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
