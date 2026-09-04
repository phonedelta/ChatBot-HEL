/**
 * Manual slot proposal & appointment move tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { proposalWhatsAppMessage } = require('../src/crm/smart/slot-proposals')

function weekdayFuture(daysAhead = 3, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 10; i += 1) {
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
  status = 'non_confirme',
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

async function run() {
  // Templates
  const fr = proposalWhatsAppMessage({
    patientName: 'Amine Benali',
    slotDate: '2026-08-31',
    slotTime: '11:00',
    currentDate: '2026-09-04',
    currentTime: '15:00',
    language: 'fr',
  })
  assert.match(fr, /OUI/)
  assert.match(fr, /NON/)
  const darija = proposalWhatsAppMessage({
    patientName: 'Amine Benali',
    slotDate: '2026-08-31',
    slotTime: '11:00',
    currentDate: '2026-09-04',
    currentTime: '15:00',
    language: 'darija',
  })
  assert.match(darija, /نعم/)
  assert.ok(!/oui khoya|wakha/i.test(darija))

  // Bug fix: conversation darija + customer preferred fr → Arabic slot proposal (not French)
  const tmpBug = path.join(os.tmpdir(), `hel-slot-lang-${Date.now()}.sqlite`)
  const crmBug = createCrmService({ dbPath: tmpBug })
  const bugSent = []
  crmBug.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    bugSent.push({ chatId, phone, text })
    return { messageId: 'bug-1', chatId }
  })
  const bugChat = '212612345679@c.us'
  const bugCust = crmBug.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Salim Zouhair', '+212612345679', 'Casablanca', 'fr', ?, datetime('now'))
  `).run(bugChat)
  const bugCustomerId = bugCust.lastInsertRowid
  crmBug.smart.applyInboundLanguage({ chatId: bugChat, text: 'بغيت نبدل الموعد' })
  assert.strictEqual(crmBug.smart.getActiveConversationLanguage(bugChat), 'darija')
  const bugCurrent = weekdayFuture(5, '11:00')
  const bugPropose = weekdayFuture(8, '11:00')
  const bugAppt = crmBug.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, 'non_confirme', ?, 30, datetime('now'))
  `).run(bugCustomerId, bugCurrent.date, bugCurrent.time, bugChat)
  await crmBug.smart.createSlotProposal({
    customerId: bugCustomerId,
    appointmentId: bugAppt.lastInsertRowid,
    slotDate: bugPropose.date,
    slotTime: bugPropose.time,
    createdBy: 'Admin Dashboard',
    chatKey: bugChat,
  })
  assert.ok(bugSent.length >= 1)
  const bugText = bugSent[0].text
  assert.match(bugText, /[\u0600-\u06FF]/)
  assert.match(bugText, /نعم/)
  assert.ok(!/Bonjour/i.test(bugText))
  assert.ok(!/Souhaitez-vous/i.test(bugText))
  assert.ok(!/Répondez OUI/i.test(bugText))
  assert.ok(!/pour garder/i.test(bugText))

  // Darija Latin (Arabizi) inbound → Arabic slot proposal
  const tmpArabizi = path.join(os.tmpdir(), `hel-slot-arabizi-${Date.now()}.sqlite`)
  const crmArabizi = createCrmService({ dbPath: tmpArabizi })
  const arabiziSent = []
  crmArabizi.smart.setAppointmentConfirmationSender(async ({ text }) => {
    arabiziSent.push(text)
    return { messageId: 'arabizi-1', chatId: 'x@c.us' }
  })
  const arabiziChat = '212612345680@c.us'
  const arabiziCust = crmArabizi.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Salim Zouhair', '+212612345680', 'Casablanca', 'fr', ?, datetime('now'))
  `).run(arabiziChat)
  const arabiziCustomerId = arabiziCust.lastInsertRowid
  crmArabizi.smart.applyInboundLanguage({ chatId: arabiziChat, text: 'bghit n annuler' })
  crmArabizi.smart.applyInboundLanguage({ chatId: arabiziChat, text: 'la bghit n9a f rendez vous' })
  assert.strictEqual(crmArabizi.smart.getActiveConversationLanguage(arabiziChat), 'darija')
  const arabiziCurrent = weekdayFuture(6, '11:00')
  const arabiziPropose = weekdayFuture(9, '11:00')
  const arabiziPropose2 = weekdayFuture(11, '11:00')
  const arabiziAppt = crmArabizi.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, 'non_confirme', ?, 30, datetime('now'))
  `).run(arabiziCustomerId, arabiziCurrent.date, arabiziCurrent.time, arabiziChat)
  await crmArabizi.smart.createSlotProposal({
    customerId: arabiziCustomerId,
    appointmentId: arabiziAppt.lastInsertRowid,
    slotDate: arabiziPropose.date,
    slotTime: arabiziPropose.time,
    chatKey: arabiziChat,
  })
  assert.match(arabiziSent[0], /[\u0600-\u06FF]/)
  assert.match(arabiziSent[0], /Salim/)
  assert.ok(!/Bonjour/i.test(arabiziSent[0]))

  // "non" must not flip darija → fr; next proposal stays Arabic
  crmArabizi.smart.applyInboundLanguage({ chatId: arabiziChat, text: 'non' })
  assert.strictEqual(crmArabizi.smart.getActiveConversationLanguage(arabiziChat), 'darija')
  const convRow = crmArabizi.db.prepare(`
    SELECT language FROM conversations WHERE external_key = ?
  `).get(arabiziChat)
  assert.strictEqual(convRow.language, 'darija')
  arabiziSent.length = 0
  await crmArabizi.smart.createSlotProposal({
    customerId: arabiziCustomerId,
    appointmentId: arabiziAppt.lastInsertRowid,
    slotDate: arabiziPropose2.date,
    slotTime: arabiziPropose2.time,
    chatKey: arabiziChat,
  })
  assert.match(arabiziSent[0], /[\u0600-\u06FF]/)
  assert.ok(!/Un créneau est disponible/i.test(arabiziSent[0]))

  // Shared contact: Salim darija vs Think Test fr
  const tmpShared = path.join(os.tmpdir(), `hel-slot-shared-${Date.now()}.sqlite`)
  const crmShared = createCrmService({ dbPath: tmpShared })
  const sharedSent = []
  crmShared.smart.setAppointmentConfirmationSender(async ({ text }) => {
    sharedSent.push(text)
    return { messageId: 'shared-1', chatId: 'x@c.us' }
  })
  const sharedChat = '212612345681@c.us'
  const salim = crmShared.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Salim Zouhair', '+212612345681', 'Casablanca', 'darija', ?, datetime('now'))
  `).run(sharedChat)
  const think = crmShared.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Think Test', '+212612345681', 'Casablanca', 'fr', ?, datetime('now'))
  `).run(sharedChat)
  crmShared.smart.applyInboundLanguage({ chatId: sharedChat, text: 'bghit rendez vous' })
  crmShared.db.prepare('UPDATE customers SET preferred_language = ? WHERE id = ?').run('fr', think.lastInsertRowid)
  const salimCurrent = weekdayFuture(5, '11:00')
  const thinkCurrent = weekdayFuture(6, '11:30')
  const sharedProposeA = weekdayFuture(8, '11:00')
  const sharedProposeB = weekdayFuture(10, '12:00')
  const salimAppt = crmShared.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, 'non_confirme', ?, 30, datetime('now'))
  `).run(salim.lastInsertRowid, salimCurrent.date, salimCurrent.time, sharedChat)
  const thinkAppt = crmShared.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, 'non_confirme', ?, 30, datetime('now'))
  `).run(think.lastInsertRowid, thinkCurrent.date, thinkCurrent.time, sharedChat)
  sharedSent.length = 0
  await crmShared.smart.createSlotProposal({
    customerId: salim.lastInsertRowid,
    appointmentId: salimAppt.lastInsertRowid,
    slotDate: sharedProposeA.date,
    slotTime: sharedProposeA.time,
    chatKey: sharedChat,
  })
  assert.match(sharedSent[0], /[\u0600-\u06FF]/)
  sharedSent.length = 0
  await crmShared.smart.createSlotProposal({
    customerId: think.lastInsertRowid,
    appointmentId: thinkAppt.lastInsertRowid,
    slotDate: sharedProposeB.date,
    slotTime: sharedProposeB.time,
    chatKey: sharedChat,
  })
  assert.match(sharedSent[0], /Bonjour/)
  assert.match(sharedSent[0], /OUI/)

  // Persistence after restart (new service instance, same DB file)
  const tmpRestart = path.join(os.tmpdir(), `hel-slot-restart-${Date.now()}.sqlite`)
  const crmRestart1 = createCrmService({ dbPath: tmpRestart })
  const restartChat = '212612345682@c.us'
  const restartCust = crmRestart1.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Salim Zouhair', '+212612345682', 'Casablanca', 'fr', ?, datetime('now'))
  `).run(restartChat)
  crmRestart1.smart.applyInboundLanguage({ chatId: restartChat, text: 'بغيت نبدل الموعد' })
  const restartCurrent = weekdayFuture(5, '11:00')
  const restartPropose = weekdayFuture(9, '11:00')
  const restartAppt = crmRestart1.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, ?, ?, 'non_confirme', ?, 30, datetime('now'))
  `).run(restartCust.lastInsertRowid, restartCurrent.date, restartCurrent.time, restartChat)
  const restartApptId = restartAppt.lastInsertRowid
  const crmRestart2 = createCrmService({ dbPath: tmpRestart })
  const restartSent = []
  crmRestart2.smart.setAppointmentConfirmationSender(async ({ text }) => {
    restartSent.push(text)
    return { messageId: 'restart-1', chatId: restartChat }
  })
  await crmRestart2.smart.createSlotProposal({
    customerId: restartCust.lastInsertRowid,
    appointmentId: restartApptId,
    slotDate: restartPropose.date,
    slotTime: restartPropose.time,
    chatKey: restartChat,
  })
  assert.match(restartSent[0], /[\u0600-\u06FF]/)
  assert.ok(!/Bonjour/i.test(restartSent[0]))

  const tmp = path.join(os.tmpdir(), `hel-slot-prop-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `m-${sent.length}`, chatId: chatId || 'x@c.us' }
  })

  const current = weekdayFuture(5, '15:00')
  const free = weekdayFuture(2, '11:30')
  const { customerId, appointmentId, chat } = seedAppointment(crm, { slot: current })

  // Search finds patient with active RDV
  const hits = crm.smart.searchPatientsForSlot('Amine')
  assert.ok(hits.some((h) => h.customer_id === customerId && h.active_appointment?.id === appointmentId))

  // Patient without RDV
  crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, created_at)
    VALUES ('Karim SansRdv', '+212699999999', 'Rabat', datetime('now'))
  `).run()
  const noRdv = crm.smart.searchPatientsForSlot('Karim')
  assert.ok(noRdv.some((h) => h.full_name.includes('Karim') && !h.active_appointment))

  // Manual proposal — no auto-match
  const prop = await crm.smart.createSlotProposal({
    customerId,
    appointmentId,
    slotDate: free.date,
    slotTime: free.time,
    createdBy: 'Sarah A.',
    chatKey: chat,
  })
  assert.ok(prop.proposal?.id)
  assert.strictEqual(prop.proposal.status, 'pending')
  assert.ok(sent.length >= 1)
  assert.match(sent[0].text, /OUI/)

  // Appointment unchanged after proposal
  let appt = crm.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId)
  assert.strictEqual(appt.appointment_date, current.date)
  assert.strictEqual(String(appt.appointment_time).slice(0, 5), current.time)

  // Ambiguous — clarify, no move
  const ambig = await crm.smart.handleInboundSlotProposalReply({
    chatKey: chat,
    text: 'peut-être',
  })
  assert.ok(ambig?.handled)
  assert.strictEqual(ambig.action, 'clarify')
  assert.ok(!/الاسم|Nom complet/i.test(ambig.forceReply || ''))
  appt = crm.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId)
  assert.strictEqual(appt.appointment_date, current.date)

  // Decline
  const tmp2 = path.join(os.tmpdir(), `hel-slot-decline-${Date.now()}.sqlite`)
  const crm2 = createCrmService({ dbPath: tmp2 })
  crm2.smart.setAppointmentConfirmationSender(async ({ chatId, text }) => ({
    messageId: '1', chatId, text,
  }))
  const cur2 = weekdayFuture(6, '15:00')
  const free2 = weekdayFuture(3, '11:30')
  const a2 = seedAppointment(crm2, { slot: cur2, phone: '+212622222222', chat: '212622222222@c.us' })
  await crm2.smart.createSlotProposal({
    customerId: a2.customerId,
    appointmentId: a2.appointmentId,
    slotDate: free2.date,
    slotTime: free2.time,
    chatKey: a2.chat,
  })
  const declined = await crm2.smart.handleInboundSlotProposalReply({
    chatKey: a2.chat,
    text: 'NON',
  })
  assert.ok(declined?.handled)
  assert.strictEqual(declined.action, 'declined')
  const still = crm2.db.prepare('SELECT appointment_date FROM appointments WHERE id = ?').get(a2.appointmentId)
  assert.strictEqual(still.appointment_date, cur2.date)

  // Accept → move
  const accepted = await crm.smart.handleInboundSlotProposalReply({
    chatKey: chat,
    text: 'OUI',
  })
  assert.ok(accepted?.ok || accepted?.handled)
  appt = crm.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId)
  assert.strictEqual(appt.appointment_date, free.date)
  assert.strictEqual(String(appt.appointment_time).slice(0, 5), free.time)
  assert.strictEqual(appt.status, 'confirmed')
  assert.strictEqual(sent.length, 1, 'acceptance must not trigger a new confirmation WhatsApp')

  // Confirmed manual RDV — patient OUI on move keeps confirmed, no 24h re-ask
  const tmpConfirmed = path.join(os.tmpdir(), `hel-slot-conf-${Date.now()}.sqlite`)
  const crmC = createCrmService({ dbPath: tmpConfirmed })
  const sentC = []
  crmC.smart.setAppointmentConfirmationSender(async ({ text }) => {
    sentC.push(String(text || ''))
    return { messageId: 'c1', chatId: '212644444444@c.us' }
  })
  const curC = weekdayFuture(5, '11:00')
  const freeC = weekdayFuture(2, '10:30')
  const aC = seedAppointment(crmC, {
    slot: curC,
    phone: '+212644444444',
    chat: '212644444444@c.us',
    status: 'confirmed',
  })
  crmC.db.prepare(`
    INSERT INTO appointment_confirmation_requests (
      appointment_id, customer_id, status, confirmation_source,
      initial_sent_at, confirmed_at, created_at, updated_at
    ) VALUES (?, ?, 'confirmed', 'dashboard_manual', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
  `).run(aC.appointmentId, aC.customerId)
  await crmC.smart.createSlotProposal({
    customerId: aC.customerId,
    appointmentId: aC.appointmentId,
    slotDate: freeC.date,
    slotTime: freeC.time,
    chatKey: aC.chat,
  })
  const acceptC = await crmC.smart.handleInboundSlotProposalReply({
    chatKey: aC.chat,
    text: 'OUI',
  })
  assert.ok(acceptC?.ok || acceptC?.handled)
  const apptC = crmC.db.prepare('SELECT * FROM appointments WHERE id = ?').get(aC.appointmentId)
  assert.strictEqual(apptC.status, 'confirmed')
  assert.strictEqual(apptC.appointment_date, freeC.date)
  assert.strictEqual(sentC.length, 1, 'only slot proposal message, no confirmation re-ask')
  assert.ok(!/Merci de confirmer/i.test(sentC.join('\n')))
  await crmC.smart.runConfirmationTick()
  assert.strictEqual(sentC.length, 1, 'confirmation tick must not re-ask after slot accept')

  // Direct move
  const tmp3 = path.join(os.tmpdir(), `hel-slot-move-${Date.now()}.sqlite`)
  const crm3 = createCrmService({ dbPath: tmp3 })
  const cur3 = weekdayFuture(7, '15:00')
  const free3 = weekdayFuture(4, '11:30')
  const a3 = seedAppointment(crm3, {
    slot: cur3,
    phone: '+212633333333',
    chat: '212633333333@c.us',
    status: 'confirmed',
  })
  const moved = crm3.smart.moveAppointmentDirect({
    appointmentId: a3.appointmentId,
    slotDate: free3.date,
    slotTime: free3.time,
    actorName: 'Sarah A.',
  })
  assert.ok(moved.appointment)
  assert.strictEqual(moved.appointment.appointment_date, free3.date)
  assert.strictEqual(moved.appointment.status, 'non_confirme') // reset confirmation
  assert.strictEqual(moved.released_slot.slot_date, cur3.date)

  // Double booking — second accept expires
  const tmp4 = path.join(os.tmpdir(), `hel-slot-race-${Date.now()}.sqlite`)
  const crm4 = createCrmService({ dbPath: tmp4 })
  crm4.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const shared = weekdayFuture(2, '12:00')
  const aA = seedAppointment(crm4, {
    name: 'Patient A',
    phone: '+212641111111',
    chat: '212641111111@c.us',
    slot: weekdayFuture(8, '15:00'),
  })
  const aB = seedAppointment(crm4, {
    name: 'Patient B',
    phone: '+212642222222',
    chat: '212642222222@c.us',
    slot: weekdayFuture(9, '15:00'),
  })
  await crm4.smart.createSlotProposal({
    customerId: aA.customerId,
    appointmentId: aA.appointmentId,
    slotDate: shared.date,
    slotTime: shared.time,
    chatKey: aA.chat,
  })
  await crm4.smart.createSlotProposal({
    customerId: aB.customerId,
    appointmentId: aB.appointmentId,
    slotDate: shared.date,
    slotTime: shared.time,
    chatKey: aB.chat,
  })
  const win = await crm4.smart.handleInboundSlotProposalReply({ chatKey: aA.chat, text: 'OUI' })
  assert.ok(win?.ok || win?.handled)
  // B's proposal was expired when A took the slot — OUI no longer applies
  const lose = await crm4.smart.handleInboundSlotProposalReply({ chatKey: aB.chat, text: 'OUI' })
  assert.ok(!lose || !lose.ok)
  const bAppt = crm4.db.prepare('SELECT appointment_date FROM appointments WHERE id = ?').get(aB.appointmentId)
  assert.notStrictEqual(bAppt.appointment_date, shared.date)
  const bProp = crm4.db.prepare(`
    SELECT status FROM slot_proposals WHERE appointment_id = ? ORDER BY id DESC LIMIT 1
  `).get(aB.appointmentId)
  assert.ok(['expired', 'cancelled'].includes(bProp.status))

  // Idempotency: propose without patient fails via legacy path
  try {
    crm.smart.proposeSlotToWaitlist({
      slot_date: weekdayFuture(10).date,
      slot_time: '11:30',
      waiting_list_ids: [],
    })
    assert.fail('should require patient')
  } catch (error) {
    assert.ok(/manuellement|patient/i.test(error.message))
  }

  // Banner has no compatible_count messaging
  const board = crm.smart.getAgendaBoard({ view: 'week', from: free.date })
  assert.ok(board)
  if (board.banner) {
    assert.ok(!/compatibles?/i.test(board.banner.message?.detail || ''))
  }

  for (const p of [tmp, tmp2, tmp3, tmp4, tmpBug, tmpArabizi, tmpShared, tmpRestart]) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-wal`) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-shm`) } catch { /* ignore */ }
  }

  console.log('manual-slot-proposal-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
