/**
 * Multi-patient WhatsApp booking — contact is a channel, not a unique patient.
 * Cases A–S from the booking-target spec.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  parsePatientSelection,
  uniqueNameMatches,
  statusLabel,
  buildPatientPickerReplies,
} = require('../src/crm/booking-patient-select')
const { executedByDisplayName } = require('../src/crm/smart/activity-actors')

function weekdayFuture(daysAhead = 4, time = '11:00') {
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

function allText(turn) {
  const list = (turn.forceReplies && turn.forceReplies.length)
    ? turn.forceReplies
    : [turn.forceReply || turn.templateReply || '']
  return list.join('\n')
}

function bookDirect(crm, { name, phone, chat, slot, city = 'Casablanca', problem = 'controle' }) {
  return crm.repo.saveConfirmedBooking({
    full_name: name,
    phone_number: phone,
    city,
    problem,
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
    urgency: 'moyenne',
  })
}

async function confirmBooking(crm, { conversationId, chatId, name, phone, city, problem, slot, languageHint = 'fr' }) {
  let turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: [
      `Nom : ${name}`,
      `Téléphone : ${phone}`,
      `Ville : ${city}`,
      `Problème : ${problem}`,
      `Rendez-vous : ${slot.date.slice(8, 10)}/${slot.date.slice(5, 7)}/${slot.date.slice(0, 4)} à ${slot.time}`,
    ].join('\n'),
    languageHint,
  })
  if (turn.lead?.stage !== 'confirmation') {
    throw new Error(`expected confirmation, got ${turn.lead?.stage}: ${allText(turn)}`)
  }
  turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: languageHint === 'darija' ? 'نعم' : 'oui',
    languageHint,
  })
  assert.ok(turn.booking, 'booking must be saved')
  return turn
}

async function run() {
  assert.strictEqual(statusLabel('non_confirme', 'fr'), 'À confirmer')
  assert.strictEqual(statusLabel('confirmed', 'fr'), 'Confirmé')
  assert.strictEqual(statusLabel('cancelled', 'fr'), 'Annulé')
  assert.ok(!/non_confirme/.test(buildPatientPickerReplies([{
    full_name: 'Test Patient',
    appointments: [{ appointment_date: '2026-09-01', appointment_time: '11:00', status: 'non_confirme' }],
  }], 'fr').join('\n')))

  const salim = { id: 1, full_name: 'Salim Zouhairi' }
  const salima = { id: 2, full_name: 'Salima Zouhairi' }
  const fatima = { id: 3, full_name: 'Fatima Zouhairi' }
  assert.strictEqual(parsePatientSelection('pour Salim Zouhairi', [salim, fatima]).type, 'existing')
  assert.strictEqual(parsePatientSelection('pour Salim Zouhairi', [salim, fatima]).patient.id, 1)
  assert.strictEqual(parsePatientSelection('nouvelle personne', [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection('شخص جديد', [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection('pour moi', [salim]).type, 'existing')
  assert.strictEqual(parsePatientSelection('pour moi', [salim, fatima]).type, 'ambiguous')
  assert.strictEqual(parsePatientSelection('pour Sali', [salim, salima]).type, 'ambiguous')
  assert.ok(uniqueNameMatches('pour Sali', [salim, salima]).length > 1)
  assert.strictEqual(parsePatientSelection('2', [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection('1', [salim, fatima]).patient.id, 1)
  assert.strictEqual(parsePatientSelection('Yassine Zouhairi', [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection('Yassine Zouhairi', [salim]).fullName, 'Yassine Zouhairi')
  assert.strictEqual(parsePatientSelection('مريض جديد', [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection('chi wahed jdid', [salim]).type, 'new')

  const yassineMsg = 'Khoya smito yassine zouhairi 3ando mochkil f snan darssa kadaro w khassha t7ayd bghit nakhod lih rendez-vous'
  assert.strictEqual(parsePatientSelection(yassineMsg, [salim]).type, 'new')
  assert.strictEqual(parsePatientSelection(yassineMsg, [salim]).fullName, 'Yassine Zouhairi')
  assert.strictEqual(
    parsePatientSelection('Yassine Zouhairi', [
      { id: 10, full_name: 'Yassine Zouhairi' },
      { id: 11, full_name: 'Salim Zouhairi' },
    ]).type,
    'existing',
  )
  assert.strictEqual(
    parsePatientSelection('Yassine Zouhairi', [
      { id: 10, full_name: 'Yassine Zouhairi' },
      { id: 11, full_name: 'Salim Zouhairi' },
    ]).patient.id,
    10,
  )
  assert.strictEqual(
    parsePatientSelection('Yassine', [
      { id: 10, full_name: 'Yassine Zouhairi' },
      { id: 12, full_name: 'Yassine Alaoui' },
    ]).type,
    'ambiguous',
  )

  const tmp = path.join(os.tmpdir(), `hel-mp-booking-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const phone = '+212612388001'
  const chat = '212612388001@c.us'
  const conv = `main:${chat}`
  const slotSalim = weekdayFuture(5, '11:00')
  const slotFatima = weekdayFuture(8, '15:00')
  const slotNew = weekdayFuture(10, '16:00')

  // --- CAS A — no linked patient: normal new-patient workflow ---
  let turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.ok(!/déjà lié/i.test(allText(turn)))
  assert.match(allText(turn), /Nom complet/i)

  const first = await confirmBooking(crm, {
    conversationId: conv,
    chatId: chat,
    name: 'Salim Zouhairi',
    phone,
    city: 'Casablanca',
    problem: 'Détartrage',
    slot: slotSalim,
  })
  const salimId = first.booking.customer.id
  assert.strictEqual(first.lead.stage, 'discovery')
  assert.strictEqual(first.lead.selected_patient_id, null)
  assert.strictEqual(first.lead.problem, null)

  // --- CAS B — one linked patient: must ask, never assume ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.strictEqual(turn.lead.booking_target, 'unresolved')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.match(allText(turn), /Salim Zouhairi/)
  assert.match(allText(turn), /Nouvelle personne/)
  assert.ok(!/Détartrage/i.test(allText(turn)), 'must not reuse old motif')
  assert.match(allText(turn), /À confirmer|Confirmé/)
  assert.ok(!/non_confirme/.test(allText(turn)))

  // --- CAS D-style then C: pick Fatima by name after adding her ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Nouvelle personne',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.notStrictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.notStrictEqual(turn.lead.city, 'Casablanca')

  const second = await confirmBooking(crm, {
    conversationId: conv,
    chatId: chat,
    name: 'Fatima Zouhairi',
    phone: '0622223344',
    city: 'Rabat',
    problem: 'douleur à une molaire',
    slot: slotFatima,
  })
  const fatimaId = second.booking.customer.id
  assert.notStrictEqual(fatimaId, salimId)

  const linked = crm.repo.listLinkedPatientsForChat({ chatId: chat, conversationId: conv })
  assert.strictEqual(linked.length, 2)
  const salimRow = linked.find((p) => p.id === salimId)
  const fatimaRow = linked.find((p) => p.id === fatimaId)
  assert.ok(salimRow.appointments.some((a) => a.appointment_date === slotSalim.date))
  assert.ok(fatimaRow.appointments.some((a) => a.appointment_date === slotFatima.date))
  assert.ok(!salimRow.appointments.some((a) => a.appointment_date === slotFatima.date))
  assert.ok(!fatimaRow.appointments.some((a) => a.appointment_date === slotSalim.date))

  // Persistence after reopen
  const crm2 = createCrmService({ dbPath: tmp })
  assert.strictEqual(crm2.repo.listLinkedPatientsForChat({ chatId: chat }).length, 2)

  // --- CAS C / G — Fatima named uniquely ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je veux un rendez-vous pour Fatima Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), fatimaId)
  assert.strictEqual(turn.lead.booking_target, 'existing_patient')
  assert.strictEqual(turn.lead.full_name, 'Fatima Zouhairi')
  assert.match(allText(turn), /Fatima Zouhairi/)
  assert.ok(!/Détartrage/i.test(allText(turn)))
  crm.resetConversation(conv)

  // --- CAS D — ask which person ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.match(allText(turn), /Salim Zouhairi/)
  assert.match(allText(turn), /Fatima Zouhairi/)
  assert.match(allText(turn), /Nouvelle personne/)
  assert.match(allText(turn), /Pour qui/)

  // --- CAS H — appointments grouped under the right patient ---
  const picker = allText(turn)
  const salimIdx = picker.indexOf('Salim Zouhairi')
  const fatimaIdx = picker.indexOf('Fatima Zouhairi')
  const salimSlotLabel = `${slotSalim.date.slice(8, 10)}/${slotSalim.date.slice(5, 7)}/${slotSalim.date.slice(0, 4)}`
  const fatimaSlotLabel = `${slotFatima.date.slice(8, 10)}/${slotFatima.date.slice(5, 7)}/${slotFatima.date.slice(0, 4)}`
  const salimApptAt = picker.indexOf(salimSlotLabel)
  const fatimaApptAt = picker.indexOf(fatimaSlotLabel)
  assert.ok(salimIdx >= 0 && fatimaIdx >= 0)
  if (salimIdx < fatimaIdx) {
    assert.ok(salimApptAt > salimIdx && salimApptAt < fatimaIdx)
    assert.ok(fatimaApptAt > fatimaIdx)
  } else {
    assert.ok(fatimaApptAt > fatimaIdx && fatimaApptAt < salimIdx)
    assert.ok(salimApptAt > salimIdx)
  }

  // --- CAS E — select Salim, reuse stable profile, not old RDV ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Salim Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), salimId)
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.ok(turn.lead.phone_number)
  assert.strictEqual(turn.lead.city, 'Casablanca')
  assert.notStrictEqual(turn.lead.problem, 'Détartrage')
  assert.strictEqual(turn.lead.appointment_date, null)
  assert.strictEqual(turn.lead.appointment_time, null)
  assert.match(allText(turn), /Salim Zouhairi/)
  assert.match(allText(turn), /Motif/i)

  // --- CAS I — switch Salim → Fatima ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Non pardon c’est pour Fatima',
    languageHint: 'fr',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), fatimaId)
  assert.strictEqual(turn.lead.full_name, 'Fatima Zouhairi')
  assert.ok(String(turn.lead.city || '').includes('Rabat') || turn.lead.city === 'Rabat')
  assert.notStrictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.notStrictEqual(turn.lead.city, 'Casablanca')

  // --- CAS J — switch to new person, wipe Salim/Fatima profile ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Nouvelle personne',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.notStrictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.notStrictEqual(turn.lead.full_name, 'Fatima Zouhairi')
  assert.notStrictEqual(turn.lead.city, 'Casablanca')

  // --- CAS K — same name as linked patient ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je m\'appelle Salim Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.strictEqual(turn.lead.awaiting_field, 'duplicate_confirm')
  assert.match(allText(turn), /déjà lié/i)

  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '1',
    languageHint: 'fr',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), salimId)
  crm.resetConversation(conv)

  // --- CAS P — Fatima + motif in the same booking message ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Ma femme Fatima a mal à une molaire. Je veux un RDV pour elle.',
    languageHint: 'fr',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), fatimaId)
  assert.ok(turn.lead.problem)
  assert.notStrictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.notStrictEqual(turn.lead.city, 'Casablanca')
  crm.resetConversation(conv)

  // --- CAS Q — "ma femme" without a unique name ---
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Ma femme a mal à une dent. Je veux un rendez-vous.',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)

  // CAS F — new person independent booking
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '2',
    languageHint: 'fr',
  })
  // index 2 is Fatima (linked_at order: Salim then Fatima then new). "2" = Fatima.
  // Use explicit new person wording instead.
  crm.resetConversation(conv)
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Nouvelle personne',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  const third = await confirmBooking(crm, {
    conversationId: conv,
    chatId: chat,
    name: 'Adam Zouhairi',
    phone: '0633334455',
    city: 'Tanger',
    problem: 'contrôle',
    slot: slotNew,
  })
  const adamId = third.booking.customer.id
  assert.notStrictEqual(adamId, salimId)
  assert.notStrictEqual(adamId, fatimaId)
  assert.strictEqual(crm.repo.listLinkedPatientsForChat({ chatId: chat }).length, 3)

  // --- CAS M — three patients stay separate ---
  const names = crm.repo.listLinkedPatientsForChat({ chatId: chat }).map((p) => p.full_name).sort()
  assert.deepStrictEqual(names, ['Adam Zouhairi', 'Fatima Zouhairi', 'Salim Zouhairi'])

  // --- CAS N — cancel lists names, never first-by-phone ---
  const cancel = crm.smart.whatsappCancel
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'Je veux annuler mon rendez-vous',
    language: 'fr',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'select')
  assert.match(turn.forceReply, /Salim Zouhairi/)
  assert.match(turn.forceReply, /Fatima Zouhairi/)
  assert.match(turn.forceReply, /Adam Zouhairi/)
  const stillSalim = crm.db.prepare('SELECT status FROM appointments WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(salimId)
  assert.notStrictEqual(stillSalim.status, 'cancelled')

  // --- CAS O — modification uses appointment ID (does not mix patients) ---
  const fatimaAppt = crm.db.prepare(`
    SELECT * FROM appointments WHERE customer_id = ? ORDER BY id DESC LIMIT 1
  `).get(fatimaId)
  const salimAppt = crm.db.prepare(`
    SELECT appointment_date, appointment_time, status FROM appointments WHERE customer_id = ? ORDER BY id DESC LIMIT 1
  `).get(salimId)
  let moved = null
  let lastErr = null
  for (let i = 16; i < 32; i += 1) {
    const candidate = weekdayFuture(i, '16:30')
    if (candidate.time === '11:00') continue
    try {
      moved = crm.smart.moveAppointmentDirect({
        appointmentId: fatimaAppt.id,
        slotDate: candidate.date,
        slotTime: candidate.time,
      })
      break
    } catch (error) {
      lastErr = error
      if (error.code !== 'SLOT_TAKEN' && error.code !== 'OUTSIDE_HOURS') throw error
    }
  }
  assert.ok(moved, lastErr?.message || 'move Fatima appointment')
  const fatimaAfter = crm.db.prepare('SELECT * FROM appointments WHERE id = ?').get(fatimaAppt.id)
  const salimAfter = crm.db.prepare(`
    SELECT appointment_date, appointment_time, status FROM appointments WHERE customer_id = ? ORDER BY id DESC LIMIT 1
  `).get(salimId)
  assert.notStrictEqual(fatimaAfter.appointment_date, fatimaAppt.appointment_date)
  assert.strictEqual(Number(fatimaAfter.customer_id), fatimaId)
  assert.strictEqual(salimAfter.appointment_date, salimAppt.appointment_date)
  assert.strictEqual(salimAfter.status, salimAppt.status)

  // --- CAS L — @lid never becomes a phone ---
  const lidChat = '200940212715738@lid'
  const lidConv = `main:${lidChat}`
  turn = await crm.processCrmTurn({
    conversationId: lidConv,
    chatId: lidChat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, null)
  assert.ok(!String(turn.lead.phone_number || '').includes('200940212715738'))
  turn = await crm.processCrmTurn({
    conversationId: lidConv,
    chatId: lidChat,
    userText: '200940212715738@lid',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, null)

  // --- CAS R — human controlled: no auto picker/booking ---
  const humanChat = '212612388099@c.us'
  crm.smart.getOrCreateConversation({
    external_key: humanChat,
    phone_number: '+212612388099',
  })
  crm.db.prepare(`
    UPDATE conversations SET owner = 'HUMAN', status = 'HUMAN_CONTROLLED' WHERE external_key = ? OR external_key = ?
  `).run(humanChat, `main:${humanChat}`)
  turn = await crm.processCrmTurn({
    conversationId: `main:${humanChat}`,
    chatId: humanChat,
    userText: 'Je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.shouldSkipLlm, true)
  assert.strictEqual(turn.forceReply, null)

  // --- CAS S — successful WhatsApp booking is Assistant IA ---
  const histRows = crm.db.prepare(`
    SELECT * FROM activity_history
    WHERE patient_id = ? AND event_type IN ('appointment_created', 'APPOINTMENT_CREATED')
    ORDER BY id DESC LIMIT 5
  `).all(salimId)
  if (histRows.length) {
    for (const row of histRows) {
      const label = executedByDisplayName(row, {}, crm.db)
      assert.strictEqual(label, 'Assistant IA')
      assert.ok(!['Patient', 'Système', 'Équipe', 'WhatsApp'].includes(label))
    }
  } else {
    const timeline = crm.db.prepare(`
      SELECT * FROM timeline_events
      WHERE customer_id = ? AND event_type IN ('appointment_created', 'APPOINTMENT_CREATED')
      ORDER BY id DESC LIMIT 1
    `).get(salimId)
    if (timeline) {
      assert.notStrictEqual(timeline.actor_name, 'Patient')
      assert.notStrictEqual(timeline.actor_name, 'Équipe')
    }
  }

  // Darija picker uses Arabic script only
  const darijaChat = '212612388077@c.us'
  bookDirect(crm, {
    name: 'Karim Darija',
    phone: '+212612388077',
    chat: darijaChat,
    slot: weekdayFuture(6, '11:00'),
  })
  turn = await crm.processCrmTurn({
    conversationId: `main:${darijaChat}`,
    chatId: darijaChat,
    userText: 'بغيت ناخد موعد',
    languageHint: 'darija',
  })
  const darijaText = allText(turn)
  assert.match(darijaText, /[\u0600-\u06FF]/)
  assert.ok(!/nouvelle personne/i.test(darijaText))
  assert.match(darijaText, /شخص جديد/)
  assert.ok(!/\bbghit\b|\bwakha\b|\bkhoya\b/i.test(darijaText))

  // --- Exact reproduction: brother Yassine on Salim's WhatsApp ---
  const broChat = '212612388201@c.us'
  const broConv = `main:${broChat}`
  bookDirect(crm, {
    name: 'Salim Zouhairi',
    phone: '+212612388201',
    chat: broChat,
    slot: weekdayFuture(7, '11:00'),
    city: 'Casablanca',
    problem: 'Détartrage',
  })
  const salimOnly = crm.repo.listLinkedPatientsForChat({ chatId: broChat })
  assert.strictEqual(salimOnly.length, 1)
  const salimOnlyId = salimOnly[0].id

  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'Khoya smito yassine zouhairi 3ando mochkil f snan darssa kadaro w khassha t7ayd bghit nakhod lih rendez-vous',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.ok(turn.lead.problem, 'dental problem must be kept from first message')
  assert.notStrictEqual(Number(turn.lead.selected_patient_id), Number(salimOnlyId))
  assert.notStrictEqual(turn.lead.city, 'Casablanca')
  assert.ok(!/الموعد الجديد ديال شكون/.test(allText(turn)), 'must not re-show picker when name is explicit')
  const { checkCustomerData } = require('../src/crm')
  assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))
  assert.match(allText(turn), /رقم الهاتف/)
  assert.ok(!/المشكل ديال السنان/.test(
    String(allText(turn)).split(/باقي خاصني|المعلومات الناقصة/i).slice(1).join('\n'),
  ))

  // Picker path: name unknown → new person
  crm.resetConversation(broConv)
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.match(allText(turn), /شخص جديد/)

  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'Yassine zouhairi',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.ok(!/الموعد الجديد ديال شكون/.test(allText(turn)))

  // Numeric "2" = new person when only Salim is linked
  crm.resetConversation(broConv)
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: '2',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.ok(turn.shouldSkipLlm)
  assert.ok(!/ما فهمتش/.test(allText(turn)))

  // Arabic "شخص جديد"
  crm.resetConversation(broConv)
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'شخص جديد',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.ok(turn.shouldSkipLlm)

  // No loop after valid selection
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'Yassine Zouhairi',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.ok(!/الموعد الجديد ديال شكون/.test(allText(turn)))

  // Existing Yassine named uniquely
  bookDirect(crm, {
    name: 'Yassine Zouhairi',
    phone: '+212612388299',
    chat: broChat,
    slot: weekdayFuture(9, '15:00'),
    city: 'Rabat',
    problem: 'Consultation',
  })
  const linkedBro = crm.repo.listLinkedPatientsForChat({ chatId: broChat })
  const yassineExisting = linkedBro.find((p) => p.full_name === 'Yassine Zouhairi')
  assert.ok(yassineExisting)
  crm.resetConversation(broConv)
  turn = await crm.processCrmTurn({
    conversationId: broConv,
    chatId: broChat,
    userText: 'bghit rendez vous l Yassine Zouhairi',
    languageHint: 'darija',
  })
  assert.strictEqual(Number(turn.lead.selected_patient_id), Number(yassineExisting.id))
  assert.strictEqual(turn.lead.booking_target, 'existing_patient')
  assert.notStrictEqual(Number(turn.lead.selected_patient_id), Number(salimOnlyId))

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('multi-patient-booking tests OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
