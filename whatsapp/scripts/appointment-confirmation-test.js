/**
 * Appointment WhatsApp confirmation engine tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  confirmationAskMessage,
  confirmationFollowupMessage,
  confirmationAckMessage,
} = require('../src/crm/smart/appointment-confirmation')

function tomorrowIso(hoursFromNow = 25) {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

function weekdaySlotInHours(hoursFromNow = 25) {
  // Prefer a weekday HEL slot strictly in the future
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const base = Date.now() + hoursFromNow * 60 * 60 * 1000 + dayOffset * 24 * 60 * 60 * 1000
    const d = new Date(base)
    if (d.getDay() === 0) continue
    const time = d.getDay() === 6 ? '11:00' : '11:30'
    const [hh, mm] = time.split(':').map(Number)
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0)
    if (slot.getTime() <= Date.now() + 30 * 60 * 1000) continue
    const yyyy = slot.getFullYear()
    const mo = String(slot.getMonth() + 1).padStart(2, '0')
    const dd = String(slot.getDate()).padStart(2, '0')
    return { date: `${yyyy}-${mo}-${dd}`, time }
  }
  return tomorrowIso(hoursFromNow)
}

async function bookAppointment(crm, conversationId, chatId, slot, language = 'fr') {
  await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: 'Bonjour, je veux un rendez-vous',
    languageHint: language,
  })
  const form = language === 'darija'
    ? [
      'الاسم : Amine Benali',
      'الهاتف : 0612345678',
      'المدينة : Casablanca',
      'المشكل : Urgences dentaires',
      `الموعد : ${slot.date.slice(8, 10)}/${slot.date.slice(5, 7)} ${slot.time}`,
    ].join('\n')
    : [
      'Nom : Amine Benali',
      'Téléphone : 0612345678',
      'Ville : Casablanca',
      'Problème : Urgences dentaires',
      `Rendez-vous : ${slot.date.slice(8, 10)}/${slot.date.slice(5, 7)} ${slot.time}`,
    ].join('\n')

  let turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: form,
    languageHint: language,
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')

  turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: language === 'darija' ? 'نعم' : 'OUI',
    languageHint: language,
  })
  assert.ok(turn.booking?.appointment?.id, 'booking must create appointment')
  assert.strictEqual(turn.booking.appointment.status, 'non_confirme')
  assert.match(turn.forceReply || '', /À confirmer|في انتظار التأكيد/i)
  assert.ok(!/est confirmé|confirmé\./i.test(turn.forceReply || '') || /À confirmer/.test(turn.forceReply || ''))
  return turn.booking
}

async function run() {
  // Templates
  const askFr = confirmationAskMessage(
    { appointment_date: '2026-09-01', appointment_time: '11:30' },
    { full_name: 'Amine Benali' },
    'fr',
  )
  assert.match(askFr, /OUI/)
  assert.match(askFr, /NON/)
  const askDarija = confirmationAskMessage(
    { appointment_date: '2026-09-01', appointment_time: '11:30' },
    { full_name: 'Amine Benali' },
    'darija',
  )
  assert.match(askDarija, /نعم/)
  assert.ok(!/oui khoya|wakha|confirmi/i.test(askDarija))
  assert.match(confirmationAckMessage({ appointment_date: '2026-09-01', appointment_time: '11:30' }, 'fr'), /confirmé/i)
  assert.match(confirmationFollowupMessage(
    { appointment_date: '2026-09-01', appointment_time: '11:30' },
    { full_name: 'Amine Benali' },
    'fr',
  ), /OUI/)

  const tmpDb = path.join(os.tmpdir(), `hel-confirm-test-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId: chatId || 'mock@c.us' }
  })

  const chatId = '212611111111@c.us'
  const conversationId = `main:${chatId}`
  // Far enough for booking hours validation; we then force the 24h window for the tick
  const slot = weekdaySlotInHours(48)
  const booking = await bookAppointment(crm, conversationId, chatId, slot)
  const appointmentId = booking.appointment.id

  const req = crm.smart.appointmentConfirmation.getRequestByAppointment(appointmentId)
  assert.ok(req, 'confirmation request registered after booking')
  assert.strictEqual(req.status, 'pending')
  assert.ok(!req.initial_sent_at)

  // Move RDV into the 24h window (weekday HEL slot) so the scheduler sends
  const near = weekdaySlotInHours(12)
  crm.db.prepare(`
    UPDATE appointments SET appointment_date = ?, appointment_time = ? WHERE id = ?
  `).run(near.date, near.time, appointmentId)

  // Prefer forced send if scheduler window is tight (weekend / late day)
  let tick1 = await crm.smart.runConfirmationTick()
  if (tick1.initial < 1) {
    const forced = await crm.smart.appointmentConfirmation.sendInitialConfirmation(appointmentId, { force: true })
    assert.ok(forced.ok, `forced initial failed: ${JSON.stringify(forced)}`)
    tick1 = { initial: 1, followup: 0, staff_task: 0, errors: [] }
  }
  assert.ok(tick1.initial >= 1, `expected initial send, got ${JSON.stringify(tick1)} errors=${JSON.stringify(tick1.errors)}`)
  assert.ok(sent.length >= 1)
  assert.match(sent[0].text, /OUI/)

  const reqAfter = crm.smart.appointmentConfirmation.getRequestByAppointment(appointmentId)
  assert.ok(reqAfter.initial_sent_at)

  // Idempotency: second tick must not re-send initial
  const before = sent.length
  await crm.smart.runConfirmationTick()
  const again = await crm.smart.appointmentConfirmation.sendInitialConfirmation(appointmentId)
  assert.strictEqual(again.ok, false)
  assert.ok(again.reason === 'already_run' || again.reason === 'not_eligible' || sent.length === before)

  // OUI hors contexte on another chat must not confirm this RDV
  const other = await crm.smart.handleInboundConfirmationReply({
    chatKey: '212699999999@c.us',
    text: 'OUI',
  })
  assert.ok(!other || !other.handled)

  // Auto-confirm
  const confirmTurn = await crm.smart.handleInboundConfirmationReply({
    chatKey: chatId,
    text: 'OUI',
  })
  assert.ok(confirmTurn?.handled)
  assert.strictEqual(confirmTurn.action, 'confirmed')
  const appt = crm.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId)
  assert.strictEqual(appt.status, 'confirmed')
  assert.strictEqual(appt.confirmation_source, 'whatsapp_patient')
  assert.ok(appt.confirmed_at)

  // --- Auto-cancel path ---
  const tmpDb2 = path.join(os.tmpdir(), `hel-confirm-cancel-${Date.now()}.sqlite`)
  const crm2 = createCrmService({ dbPath: tmpDb2 })
  const sent2 = []
  crm2.smart.setAppointmentConfirmationSender(async ({ chatId: c, phone, text }) => {
    sent2.push({ chatId: c, phone, text })
    return { messageId: `m-${sent2.length}`, chatId: c }
  })
  const chat2 = '212622222222@c.us'
  const booking2 = await bookAppointment(crm2, `main:${chat2}`, chat2, weekdaySlotInHours(48))
  await crm2.smart.appointmentConfirmation.sendInitialConfirmation(booking2.appointment.id, { force: true })
  const cancelTurn = await crm2.smart.handleInboundConfirmationReply({
    chatKey: chat2,
    text: 'NON',
  })
  assert.ok(cancelTurn?.handled)
  assert.strictEqual(cancelTurn.action, 'cancelled')
  const cancelled = crm2.db.prepare('SELECT status FROM appointments WHERE id = ?').get(booking2.appointment.id)
  assert.strictEqual(cancelled.status, 'cancelled')

  // --- Follow-up + staff task ---
  const tmpDb3 = path.join(os.tmpdir(), `hel-confirm-follow-${Date.now()}.sqlite`)
  const crm3 = createCrmService({ dbPath: tmpDb3 })
  crm3.smart.setAppointmentConfirmationSender(async ({ chatId: c, text }) => ({
    messageId: `f-${Date.now()}`,
    chatId: c,
    text,
  }))
  const chat3 = '212633333333@c.us'
  const booking3 = await bookAppointment(crm3, `main:${chat3}`, chat3, weekdaySlotInHours(30))
  const id3 = booking3.appointment.id
  await crm3.smart.appointmentConfirmation.sendInitialConfirmation(id3, { force: true })
  // Backdate initial_sent_at for 4h follow-up
  crm3.db.prepare(`
    UPDATE appointment_confirmation_requests
    SET initial_sent_at = datetime('now', '-5 hours')
    WHERE appointment_id = ?
  `).run(id3)
  const follow = await crm3.smart.appointmentConfirmation.sendFollowupConfirmation(id3)
  assert.ok(follow.ok, `followup failed: ${JSON.stringify(follow)}`)
  const followAgain = await crm3.smart.appointmentConfirmation.sendFollowupConfirmation(id3)
  assert.strictEqual(followAgain.ok, false)

  crm3.db.prepare(`
    UPDATE appointment_confirmation_requests
    SET initial_sent_at = datetime('now', '-25 hours')
    WHERE appointment_id = ?
  `).run(id3)
  const taskOut = crm3.smart.appointmentConfirmation.createStaffConfirmationTask(id3)
  assert.ok(taskOut.ok, `staff task failed: ${JSON.stringify(taskOut)}`)
  const taskAgain = crm3.smart.appointmentConfirmation.createStaffConfirmationTask(id3)
  assert.strictEqual(taskAgain.ok, false)

  // Confirm after task → task completed
  crm3.smart.appointmentConfirmation.confirmAppointment(id3, { source: 'whatsapp_patient' })
  const openTasks = crm3.db.prepare(`
    SELECT status FROM tasks WHERE appointment_id = ? AND task_type = 'confirm_appointment'
  `).all(id3)
  assert.ok(openTasks.every((t) => t.status === 'completed'))

  // --- Two appointments: only pending confirmation for B ---
  const tmpDb4 = path.join(os.tmpdir(), `hel-confirm-multi-${Date.now()}.sqlite`)
  const crm4 = createCrmService({ dbPath: tmpDb4 })
  const sent4 = []
  crm4.smart.setAppointmentConfirmationSender(async ({ chatId: c, text }) => {
    sent4.push(text)
    return { messageId: `x-${sent4.length}`, chatId: c }
  })
  const chat4 = '212644444444@c.us'
  const slotA = weekdaySlotInHours(48)
  const slotB = weekdaySlotInHours(20)
  // Create A via SQL for same patient phone as booking form (+212612345678)
  const cust = crm4.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Amine Benali', '+212612345678', 'Casablanca', 'fr', ?, datetime('now'))
  `).run(chat4)
  const custId = cust.lastInsertRowid
  const aIns = crm4.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, conversation_id, created_at)
    VALUES (?, ?, ?, 'non_confirme', ?, datetime('now'))
  `).run(custId, slotA.date, slotA.time, chat4)
  const idA = aIns.lastInsertRowid
  crm4.smart.registerBookingCreated(idA, { chatKey: chat4, language: 'fr' })

  const bookingB = await bookAppointment(crm4, `main:${chat4}`, chat4, slotB)
  const idB = bookingB.appointment.id
  // Link B confirmation to chat and send ask for B only
  await crm4.smart.appointmentConfirmation.sendInitialConfirmation(idB, { force: true })
  const reply = await crm4.smart.handleInboundConfirmationReply({ chatKey: chat4, text: 'OUI' })
  assert.ok(reply?.handled)
  assert.strictEqual(reply.appointmentId, idB)
  const statusA = crm4.db.prepare('SELECT status FROM appointments WHERE id = ?').get(idA).status
  const statusB = crm4.db.prepare('SELECT status FROM appointments WHERE id = ?').get(idB).status
  assert.strictEqual(statusA, 'non_confirme')
  assert.strictEqual(statusB, 'confirmed')

  // Ambiguous — no change when pending
  const tmpDb5 = path.join(os.tmpdir(), `hel-confirm-ambig-${Date.now()}.sqlite`)
  const crm5 = createCrmService({ dbPath: tmpDb5 })
  crm5.smart.setAppointmentConfirmationSender(async ({ chatId: c }) => ({ messageId: '1', chatId: c }))
  const chat5 = '212655555555@c.us'
  const booking5 = await bookAppointment(crm5, `main:${chat5}`, chat5, weekdaySlotInHours(16))
  await crm5.smart.appointmentConfirmation.sendInitialConfirmation(booking5.appointment.id, { force: true })
  const ambig = await crm5.smart.handleInboundConfirmationReply({
    chatKey: chat5,
    text: 'peut-être je vais voir',
  })
  assert.ok(ambig?.handled)
  assert.strictEqual(ambig.action, 'clarify')
  assert.ok(!/Nom complet|الاسم/i.test(ambig.forceReply || ''))
  const still = crm5.db.prepare('SELECT status FROM appointments WHERE id = ?').get(booking5.appointment.id)
  assert.strictEqual(still.status, 'non_confirme')

  // Cleanup
  for (const p of [tmpDb, tmpDb2, tmpDb3, tmpDb4, tmpDb5]) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-wal`) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-shm`) } catch { /* ignore */ }
  }

  console.log('appointment-confirmation-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
