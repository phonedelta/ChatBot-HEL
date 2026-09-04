/**
 * Multi-appointment / multi-patient confirmation selection tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  parseAppointmentSelection,
  toSelectionCandidate,
} = require('../src/crm/smart/appointment-selection')

function futureSlot(hoursFromNow, time = '11:00') {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  // Prefer weekday
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time }
}

function setupTwoPending(crm, chat, {
  name1 = 'Salim Zouhairi',
  name2 = 'Hasnae Zouhairi',
  time1 = '11:00',
  time2 = '11:30',
  hours1 = 20,
  hours2 = 20,
  language = 'darija',
} = {}) {
  const phone = '+212612345678'
  const c1 = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES (?, ?, 'Casablanca', ?, ?, datetime('now'))
  `).run(name1, phone, language, chat)
  const c2 = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES (?, ?, 'Casablanca', ?, ?, datetime('now'))
  `).run(name2, phone, language, chat)
  const id1 = c1.lastInsertRowid
  const id2 = c2.lastInsertRowid

  const s1 = futureSlot(hours1, time1)
  const s2 = futureSlot(hours2, time2)
  // Same calendar day for display stability
  s2.date = s1.date
  s1.time = time1
  s2.time = time2

  const a1 = crm.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, conversation_id, created_at)
    VALUES (?, ?, ?, 'non_confirme', ?, datetime('now'))
  `).run(id1, s1.date, s1.time, chat)
  const a2 = crm.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, conversation_id, created_at)
    VALUES (?, ?, ?, 'non_confirme', ?, datetime('now'))
  `).run(id2, s2.date, s2.time, chat)

  const appt1 = a1.lastInsertRowid
  const appt2 = a2.lastInsertRowid

  crm.smart.registerBookingCreated(appt1, { chatKey: chat, language })
  crm.smart.registerBookingCreated(appt2, { chatKey: chat, language })
  crm.db.prepare(`
    UPDATE appointment_confirmation_requests
    SET initial_sent_at = datetime('now'), status = 'pending', chat_key = ?, language = ?
    WHERE appointment_id IN (?, ?)
  `).run(chat, language, appt1, appt2)

  return {
    patient1: id1,
    patient2: id2,
    appointment1: appt1,
    appointment2: appt2,
    slot1: s1,
    slot2: s2,
  }
}

function statusOf(crm, id) {
  return crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(id).status
}

async function run() {
  // --- Unit: parseAppointmentSelection ---
  const candidates = [
    toSelectionCandidate({
      appointment_id: 101,
      customer_id: 1,
      full_name: 'Salim Zouhairi',
      appointment_date: '2026-09-03',
      appointment_time: '11:00',
    }),
    toSelectionCandidate({
      appointment_id: 202,
      customer_id: 2,
      full_name: 'Hasnae Zouhairi',
      appointment_date: '2026-09-03',
      appointment_time: '11:30',
    }),
  ]

  assert.deepStrictEqual(parseAppointmentSelection({ message: '1', candidates }).appointmentIds, [101])
  assert.equal(parseAppointmentSelection({ message: '1', candidates }).matchedBy, 'index')
  assert.deepStrictEqual(parseAppointmentSelection({ message: '2', candidates }).appointmentIds, [202])
  assert.deepStrictEqual(parseAppointmentSelection({ message: ' 1 ', candidates }).appointmentIds, [101])
  assert.deepStrictEqual(parseAppointmentSelection({ message: '1.', candidates }).appointmentIds, [101])
  assert.deepStrictEqual(parseAppointmentSelection({ message: '1)', candidates }).appointmentIds, [101])
  assert.deepStrictEqual(parseAppointmentSelection({ message: '#1', candidates }).appointmentIds, [101])
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: 'Salim Zouhairi', candidates }).appointmentIds,
    [101],
  )
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: 'SALIM ZOUHAIRI', candidates }).appointmentIds,
    [101],
  )
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: '  salim   zouhairi ', candidates }).appointmentIds,
    [101],
  )
  assert.deepStrictEqual(parseAppointmentSelection({ message: 'Salim', candidates }).appointmentIds, [101])
  assert.deepStrictEqual(parseAppointmentSelection({ message: 'Hasnae', candidates }).appointmentIds, [202])
  assert.equal(parseAppointmentSelection({ message: '3', candidates }).type, 'invalid')
  assert.equal(parseAppointmentSelection({ message: 'Yassine', candidates }).type, 'invalid')
  assert.equal(parseAppointmentSelection({ message: '1 2', candidates }).type, 'multiple')
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: '1 2', candidates }).appointmentIds.sort(),
    [101, 202],
  )
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: '1,2', candidates }).appointmentIds.sort(),
    [101, 202],
  )
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: '1 et 2', candidates }).appointmentIds.sort(),
    [101, 202],
  )
  assert.deepStrictEqual(
    parseAppointmentSelection({ message: '1 و 2', candidates }).appointmentIds.sort(),
    [101, 202],
  )
  assert.equal(parseAppointmentSelection({ message: 'بجوج', candidates }).type, 'multiple')
  assert.equal(parseAppointmentSelection({ message: 'les deux', candidates }).type, 'multiple')

  // Ambiguous first name
  const twin = [
    ...candidates,
    toSelectionCandidate({
      appointment_id: 303,
      customer_id: 3,
      full_name: 'Salim Benali',
      appointment_date: '2026-09-04',
      appointment_time: '10:00',
    }),
  ]
  assert.equal(parseAppointmentSelection({ message: 'Salim', candidates: twin }).type, 'ambiguous')

  // --- Integration DB ---
  const tmp = path.join(os.tmpdir(), `hel-multi-appt-sel-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  crm.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({
    messageId: `m-${Date.now()}`,
    chatId,
  }))

  const chat = '212600000001@c.us'
  const setup = setupTwoPending(crm, chat)

  // Oui → list (disambiguate), nothing confirmed
  const oui = await crm.smart.handleInboundConfirmationReply({ chatKey: chat, text: 'Oui' })
  assert.equal(oui?.action, 'disambiguate')
  assert.match(oui.forceReply, /Salim Zouhairi/)
  assert.match(oui.forceReply, /Hasnae Zouhairi/)
  assert.equal(statusOf(crm, setup.appointment1), 'non_confirme')
  assert.equal(statusOf(crm, setup.appointment2), 'non_confirme')

  // Screenshot scenario: "1" selects Salim — no list loop
  const sel1 = await crm.smart.handleInboundConfirmationReply({ chatKey: chat, text: '1' })
  assert.equal(sel1?.action, 'selected')
  assert.equal(sel1.appointmentId, setup.appointment1)
  assert.match(sel1.forceReply, /Salim Zouhairi/)
  assert.ok(!/عندك جوج مواعيد|عندك عدة مواعيد|plusieurs rendez-vous/i.test(sel1.forceReply))
  assert.ok(!/مرحبا Hasnae/i.test(sel1.forceReply))

  // Repeated "1" while awaiting confirm must NOT re-show list
  const again1 = await crm.smart.handleInboundConfirmationReply({ chatKey: chat, text: '1' })
  assert.notEqual(again1?.action, 'disambiguate')
  assert.ok(again1?.handled)

  // Oui confirms Salim only
  const conf1 = await crm.smart.handleInboundConfirmationReply({ chatKey: chat, text: 'نعم' })
  assert.equal(conf1?.action, 'confirmed')
  assert.equal(conf1.appointmentId, setup.appointment1)
  assert.equal(statusOf(crm, setup.appointment1), 'confirmed')
  assert.equal(statusOf(crm, setup.appointment2), 'non_confirme')
  assert.match(conf1.forceReply, /Salim Zouhairi/)
  assert.ok(!/Hasnae/i.test(conf1.forceReply) || /Salim/.test(conf1.forceReply))

  // Late "1" after done — only Hasnae pending → single flow or null/handled without Salim confirm
  const late = await crm.smart.handleInboundConfirmationReply({ chatKey: chat, text: '1' })
  // Hasnae alone: "1" is unknown in yes/no → clarify, OR if somehow selection cleared, single confirm path
  if (late?.handled && late.action === 'confirmed') {
    assert.equal(late.appointmentId, setup.appointment2)
  } else if (late?.handled) {
    assert.notEqual(late.action, 'disambiguate')
  }

  // --- Select by 2 then confirm Hasnae ---
  const tmp2 = path.join(os.tmpdir(), `hel-multi-appt-sel2-${Date.now()}.sqlite`)
  const crm2 = createCrmService({ dbPath: tmp2 })
  crm2.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const chat2 = '212600000002@c.us'
  const s2 = setupTwoPending(crm2, chat2)
  await crm2.smart.handleInboundConfirmationReply({ chatKey: chat2, text: 'Oui' })
  const sel2 = await crm2.smart.handleInboundConfirmationReply({ chatKey: chat2, text: '2' })
  assert.equal(sel2.appointmentId, s2.appointment2)
  assert.match(sel2.forceReply, /Hasnae Zouhairi/)
  const conf2 = await crm2.smart.handleInboundConfirmationReply({ chatKey: chat2, text: 'Oui' })
  assert.equal(conf2.action, 'confirmed')
  assert.equal(statusOf(crm2, s2.appointment2), 'confirmed')
  assert.equal(statusOf(crm2, s2.appointment1), 'non_confirme')

  // --- Select by full name ---
  const tmp3 = path.join(os.tmpdir(), `hel-multi-appt-sel3-${Date.now()}.sqlite`)
  const crm3 = createCrmService({ dbPath: tmp3 })
  crm3.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const chat3 = '212600000003@c.us'
  const s3 = setupTwoPending(crm3, chat3)
  await crm3.smart.handleInboundConfirmationReply({ chatKey: chat3, text: 'Oui' })
  const byName = await crm3.smart.handleInboundConfirmationReply({
    chatKey: chat3,
    text: 'Salim Zouhairi',
  })
  assert.equal(byName.action, 'selected')
  assert.equal(byName.appointmentId, s3.appointment1)
  assert.ok(!/مرحبا Hasnae/i.test(byName.forceReply))
  await crm3.smart.handleInboundConfirmationReply({ chatKey: chat3, text: 'نعم' })
  assert.equal(statusOf(crm3, s3.appointment1), 'confirmed')
  assert.equal(statusOf(crm3, s3.appointment2), 'non_confirme')

  // --- Multi 1 2 ---
  const tmp4 = path.join(os.tmpdir(), `hel-multi-appt-sel4-${Date.now()}.sqlite`)
  const crm4 = createCrmService({ dbPath: tmp4 })
  crm4.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const chat4 = '212600000004@c.us'
  const s4 = setupTwoPending(crm4, chat4)
  await crm4.smart.handleInboundConfirmationReply({ chatKey: chat4, text: 'Oui' })
  const both = await crm4.smart.handleInboundConfirmationReply({ chatKey: chat4, text: '1 2' })
  assert.equal(both.action, 'selected_multiple')
  assert.match(both.forceReply, /بجوج|deux|Salim|Hasnae/i)
  const confBoth = await crm4.smart.handleInboundConfirmationReply({ chatKey: chat4, text: 'نعم' })
  assert.equal(confBoth.action, 'confirmed_multiple')
  assert.equal(statusOf(crm4, s4.appointment1), 'confirmed')
  assert.equal(statusOf(crm4, s4.appointment2), 'confirmed')

  // --- Invalid index ---
  const tmp5 = path.join(os.tmpdir(), `hel-multi-appt-sel5-${Date.now()}.sqlite`)
  const crm5 = createCrmService({ dbPath: tmp5 })
  crm5.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const chat5 = '212600000005@c.us'
  setupTwoPending(crm5, chat5)
  await crm5.smart.handleInboundConfirmationReply({ chatKey: chat5, text: 'Oui' })
  const bad = await crm5.smart.handleInboundConfirmationReply({ chatKey: chat5, text: '3' })
  assert.equal(bad.action, 'invalid_selection')
  assert.match(bad.forceReply, /3/)

  // --- Unknown name ---
  const unk = await crm5.smart.handleInboundConfirmationReply({ chatKey: chat5, text: 'Yassine' })
  assert.equal(unk.action, 'invalid_selection')
  assert.match(unk.forceReply, /Yassine/)

  // --- Stable numbering: persist state across "handler" calls (DB) ---
  const tmp6 = path.join(os.tmpdir(), `hel-multi-appt-sel6-${Date.now()}.sqlite`)
  const crm6a = createCrmService({ dbPath: tmp6 })
  crm6a.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const chat6 = '212600000006@c.us'
  const s6 = setupTwoPending(crm6a, chat6)
  await crm6a.smart.handleInboundConfirmationReply({ chatKey: chat6, text: 'Oui' })
  const state = crm6a.smart.appointmentConfirmation.getSelectionState(chat6)
  assert.ok(state)
  assert.equal(state.stage, 'awaiting_selection')
  assert.equal(state.candidates[0].appointmentId, s6.appointment1)
  assert.equal(state.candidates[1].appointmentId, s6.appointment2)

  // Reopen CRM on same DB — snapshot preserved
  const crm6b = createCrmService({ dbPath: tmp6 })
  crm6b.smart.setAppointmentConfirmationSender(async ({ chatId }) => ({ messageId: 'x', chatId }))
  const afterRestart = await crm6b.smart.handleInboundConfirmationReply({ chatKey: chat6, text: '1' })
  assert.equal(afterRestart.action, 'selected')
  assert.equal(afterRestart.appointmentId, s6.appointment1)

  // History / patient id from appointment (ai_actions audit)
  await crm6b.smart.handleInboundConfirmationReply({ chatKey: chat6, text: 'Oui' })
  const hist = crm6b.db.prepare(`
    SELECT customer_id, action_type, result FROM ai_actions
    WHERE action_type = 'appointment_confirmed'
    ORDER BY id DESC LIMIT 1
  `).get()
  assert.ok(hist, 'expected appointment_confirmed history row')
  assert.equal(Number(hist.customer_id), Number(s6.patient1))
  assert.equal(String(hist.result), String(s6.appointment1))

  for (const p of [tmp, tmp2, tmp3, tmp4, tmp5, tmp6]) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-wal`) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-shm`) } catch { /* ignore */ }
  }

  console.log('multi-appointment-selection-test: OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
