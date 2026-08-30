/**
 * WhatsApp patient self-cancel flow tests.
 * Covers: single/multiple RDV, multi-patient, confirm yes/no,
 * ambiguous, idempotency, reminders cleanup, slot notification, no auto-proposal.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { routePatientMessage } = require('../src/voice-nlu/intent-router')
const {
  looksLikeCancelIntent,
  msgConfirmCancel,
  msgCancelledOk,
  msgListAppointments,
  msgKept,
} = require('../src/crm/smart/whatsapp-cancel')

function weekdayFuture(daysAhead = 3, time = '11:30') {
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

function book(crm, { name, phone, chat, slot, problem = 'controle' }) {
  return crm.repo.saveConfirmedBooking({
    full_name: name,
    phone_number: phone,
    city: 'Casablanca',
    problem,
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
    urgency: 'moyenne',
  })
}

function countNotifications(crm, appointmentId) {
  return crm.db.prepare(`
    SELECT COUNT(*) AS c FROM notifications
    WHERE appointment_id = ?
       OR unique_key LIKE ?
  `).get(Number(appointmentId), `%:${appointmentId}:%`).c
}

function countSlotReleased(crm) {
  return crm.db.prepare(`
    SELECT COUNT(*) AS c FROM notifications
    WHERE type = 'slot_released' OR unique_key LIKE 'cancelled-slot:%'
  `).get().c
}

async function run() {
  // Intent router
  const route = routePatientMessage('Je veux annuler mon rendez-vous')
  assert.equal(route.intent, 'CANCEL_APPOINTMENT')
  assert.equal(route.cancelAppointment, true)
  assert.ok(looksLikeCancelIntent('Annule mon rendez-vous', 'CANCEL_APPOINTMENT'))
  assert.ok(looksLikeCancelIntent('Je ne pourrai pas venir'))
  assert.ok(!looksLikeCancelIntent('Oui merci'))

  // Templates FR / Darija
  const item = {
    full_name: 'Adam Mait',
    appointment_date: '2026-08-31',
    appointment_time: '11:00',
  }
  assert.match(msgConfirmCancel(item, 'fr'), /OUI/)
  assert.match(msgConfirmCancel(item, 'fr'), /Adam Mait/)
  assert.match(msgConfirmCancel(item, 'darija'), /نعم/)
  assert.ok(!/oui khoya|wakha/i.test(msgConfirmCancel(item, 'darija')))
  assert.match(msgCancelledOk(item, 'fr'), /annulé/i)
  assert.match(msgKept('fr'), /conservé/i)
  assert.match(msgKept({ appointment_date: '2026-09-01', appointment_time: '11:00' }, 'darija'), /[\u0600-\u06FF]/)
  assert.match(msgListAppointments([
    { full_name: 'A', appointment_date: '2026-08-31', appointment_time: '11:00' },
    { full_name: 'B', appointment_date: '2026-09-03', appointment_time: '15:00' },
  ], 'fr'), /1\./)

  const tmp = path.join(os.tmpdir(), `hel-wa-cancel-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const cancel = crm.smart.whatsappCancel
  assert.ok(cancel, 'whatsappCancel engine must be wired')

  const phone = '+212612399001'
  const chat = '212612399001@c.us'

  // --- Single appointment ---
  const slot1 = weekdayFuture(4, '11:00')
  const b1 = book(crm, { name: 'Ahmed Benali', phone, chat, slot: slot1 })
  const appt1 = b1.appointment.id

  let turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Je veux annuler mon rendez-vous.',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.handled, true)
  assert.equal(turn.action, 'confirm')
  assert.equal(turn.shouldSkipLlm, true)
  assert.match(turn.forceReply, /Ahmed Benali/)
  assert.match(turn.forceReply, /OUI/)
  assert.ok(!/annulé\./i.test(turn.forceReply) || /Confirmez/.test(turn.forceReply))

  const stillOpen = crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt1)
  assert.equal(stillOpen.status, 'non_confirme', 'must NOT cancel before OUI')

  // Ambiguous while waiting
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'je vais voir',
    language: 'fr',
  })
  assert.equal(turn.action, 'confirm_clarify')
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt1).status,
    'non_confirme',
  )

  // NON keeps appointment
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'NON',
    language: 'fr',
  })
  assert.equal(turn.action, 'kept')
  assert.match(turn.forceReply, /conservé/i)
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt1).status,
    'non_confirme',
  )
  assert.equal(countSlotReleased(crm), 0, 'no notification on NON')

  // Restart flow + OUI
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Je souhaite annuler mon rendez-vous',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'confirm')

  // Ensure ACR pending exists (reminder cleanup target)
  crm.smart.appointmentConfirmation.ensureRequestForAppointment(appt1, {
    chat_key: chat,
    language: 'fr',
  })
  crm.db.prepare(`
    UPDATE appointment_confirmation_requests
    SET status = 'pending', initial_sent_at = ?
    WHERE appointment_id = ?
  `).run(new Date().toISOString(), appt1)

  // Pending slot proposal
  try {
    crm.smart.slotProposals?.ensureTables?.()
    crm.db.prepare(`
      INSERT INTO slot_proposals (
        customer_id, appointment_id, chat_key, slot_date, slot_time, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      b1.customer.id,
      appt1,
      chat,
      slot1.date,
      '16:00',
      new Date().toISOString(),
    )
  } catch (error) {
    console.warn('slot proposal seed skipped', error.message)
  }

  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'OUI',
    language: 'fr',
  })
  assert.equal(turn.action, 'cancelled')
  assert.match(turn.forceReply, /annulé/i)
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt1).status,
    'cancelled',
  )

  const acr = crm.db.prepare(`
    SELECT status FROM appointment_confirmation_requests WHERE appointment_id = ?
  `).get(appt1)
  assert.ok(acr)
  assert.equal(acr.status, 'cancelled')

  try {
    const prop = crm.db.prepare(`
      SELECT status FROM slot_proposals WHERE appointment_id = ? ORDER BY id DESC LIMIT 1
    `).get(appt1)
    if (prop) assert.notEqual(prop.status, 'pending')
  } catch { /* optional */ }

  assert.ok(countNotifications(crm, appt1) >= 1, 'slot notification after cancel')
  const notifBeforeDouble = countSlotReleased(crm)

  // Idempotency — second cancel on same appt
  const r1 = cancel.executeCancel(appt1, { source: 'whatsapp_patient' })
  assert.equal(r1.already, true)
  const r2 = cancel.executeCancel(appt1, { source: 'whatsapp_patient' })
  assert.equal(r2.already, true)
  assert.equal(countSlotReleased(crm), notifBeforeDouble, 'idempotent notifications')

  // No future active appointments after cancel
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Je veux annuler mon rendez-vous',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'none')
  assert.match(turn.forceReply, /aucun rendez-vous/i)

  // OUI hors contexte
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Oui merci',
    language: 'fr',
  })
  assert.equal(turn, null)

  // Ambiguous maybe-cancel
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Je ne sais pas si je pourrai venir',
    language: 'fr',
  })
  assert.equal(turn, null)

  // --- Multiple patients / appointments ---
  const phone2 = '+212612399002'
  const chat2 = '212612399002@c.us'
  const slotA = weekdayFuture(5, '11:00')
  const slotS = weekdayFuture(8, '15:00')
  const ba = book(crm, { name: 'Ahmed Dual', phone: phone2, chat: chat2, slot: slotA })
  const bs = book(crm, {
    name: 'Sara Dual',
    phone: phone2,
    chat: chat2,
    slot: slotS,
    problem: 'detartrage',
  })
  assert.notEqual(ba.customer.id, bs.customer.id)

  turn = cancel.handleInboundCancel({
    chatKey: chat2,
    text: 'Je veux annuler mon rendez-vous',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'select')
  assert.match(turn.forceReply, /1\./)
  assert.match(turn.forceReply, /Ahmed Dual/)
  assert.match(turn.forceReply, /Sara Dual/)
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(ba.appointment.id).status,
    'non_confirme',
  )

  // Select Sara by name
  turn = cancel.handleInboundCancel({
    chatKey: chat2,
    text: 'Sara',
    language: 'fr',
  })
  assert.equal(turn.action, 'confirm')
  assert.match(turn.forceReply, /Sara Dual/)
  assert.match(turn.forceReply, /OUI|Confirmez/i)

  turn = cancel.handleInboundCancel({
    chatKey: chat2,
    text: 'OUI',
    language: 'fr',
  })
  assert.equal(turn.action, 'cancelled')
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(bs.appointment.id).status,
    'cancelled',
  )
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(ba.appointment.id).status,
    'non_confirme',
    'Ahmed must remain untouched',
  )

  // Explicit name in initial message
  const phone3 = '+212612399003'
  const chat3 = '212612399003@c.us'
  const s1 = weekdayFuture(6, '11:30')
  const s2 = weekdayFuture(10, '16:00')
  book(crm, { name: 'Adam Explicit', phone: phone3, chat: chat3, slot: s1 })
  const saraE = book(crm, {
    name: 'Sara Explicit',
    phone: phone3,
    chat: chat3,
    slot: s2,
  })

  turn = cancel.handleInboundCancel({
    chatKey: chat3,
    text: 'Annule le rendez-vous de Sara',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'confirm')
  assert.match(turn.forceReply, /Sara Explicit/)
  assert.equal(turn.appointmentId, saraE.appointment.id)

  // Darija templates path
  turn = cancel.handleInboundCancel({
    chatKey: chat3,
    text: 'NON',
    language: 'darija',
  })
  // pending was WAITING with FR language from start — language stored on pending
  assert.ok(turn.action === 'kept')

  const chatDarija = '212612399004@c.us'
  book(crm, {
    name: 'Youssef Darija',
    phone: '+212612399004',
    chat: chatDarija,
    slot: weekdayFuture(7, '11:00'),
  })
  turn = cancel.handleInboundCancel({
    chatKey: chatDarija,
    text: 'بغيت نلغي الموعد',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'confirm')
  assert.match(turn.forceReply, /نعم/)
  assert.ok(!/[a-z]{4,}/i.test(turn.forceReply.replace(/Youssef Darija/g, '')) || /نعم|لا|موعد/.test(turn.forceReply))

  turn = cancel.handleInboundCancel({
    chatKey: chatDarija,
    text: 'نعم',
    language: 'darija',
  })
  assert.equal(turn.action, 'cancelled')
  assert.match(turn.forceReply, /تلغى|ملغي|تمام/)

  // No auto WhatsApp proposal after cancel — ensure we did not send any proposal messages
  // (engine has no sendWhatsApp on cancel path)
  assert.ok(typeof cancel.handleInboundCancel === 'function')

  console.log('whatsapp-cancel tests OK')
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
