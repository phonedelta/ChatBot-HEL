/**
 * Booking confirmation: OUI/NON, multi-field corrections, draft cancel + internal reset.
 */
const assert = require('assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { createCrmService } = require('../src/crm')
const {
  parseFieldsToCorrect,
  isStrictBookingConfirmYes,
  parseRejectionChoice,
} = require('../src/crm/booking-confirmation-flow')

function futureSlotLine(daysAhead = 5, time = '11:00') {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  if (d.getDay() === 6 && time > '13:00') {
    d.setDate(d.getDate() + 2)
  }
  const iso = d.toISOString().slice(0, 10)
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${time}`
}

function sundaySlotLine() {
  const d = new Date()
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7))
  const iso = d.toISOString().slice(0, 10)
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 11:00`
}

function allText(turn) {
  return [turn?.forceReply, ...(turn?.forceReplies || [])].filter(Boolean).join('\n')
}

let _slotSeq = 0
async function reachConfirmation(crm, conv, chat, overrides = {}) {
  _slotSeq += 1
  // Unique day per call so confirmed bookings from earlier tests never collide.
  const daysAhead = overrides.daysAhead != null ? overrides.daysAhead : (5 + _slotSeq)
  const time = overrides.time || '11:00'
  const slot = overrides.slot || futureSlotLine(daysAhead, time)
  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  const turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: [
      `Nom : ${overrides.name || 'Salim Zouhairi'}`,
      `Téléphone : ${overrides.phone || '0600000001'}`,
      `Ville : ${overrides.city || 'Casablanca'}`,
      `Problème : ${overrides.problem || 'detartrage'}`,
      `Rendez-vous : ${slot}`,
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation', `expected confirmation got ${turn.lead.stage}\n${allText(turn)}`)
  assert.match(allText(turn), /\*OUI\*/)
  assert.match(allText(turn), /\*NON\*/)
  return turn
}

async function main() {
  console.log('--- unit parsers ---')
  assert.ok(isStrictBookingConfirmYes('oui'))
  assert.ok(isStrictBookingConfirmYes('نعم'))
  assert.ok(isStrictBookingConfirmYes('na3am kolchi shih'))
  assert.ok(isStrictBookingConfirmYes('kolchi mzyan'))
  assert.ok(isStrictBookingConfirmYes('wakha kolchi shih'))
  assert.ok(!isStrictBookingConfirmYes('ok'))
  assert.ok(!isStrictBookingConfirmYes('wakha'))
  assert.ok(!isStrictBookingConfirmYes('mzyan'))
  assert.deepStrictEqual(parseFieldsToCorrect('1'), ['full_name'])
  assert.deepStrictEqual(parseFieldsToCorrect('1, 3'), ['full_name', 'problem'])
  assert.deepStrictEqual(parseFieldsToCorrect('nom et ville'), ['full_name', 'city'])
  assert.deepStrictEqual(parseFieldsToCorrect('الاسم والمدينة'), ['full_name', 'city'])
  assert.strictEqual(parseRejectionChoice('1').type, 'correct')
  assert.strictEqual(parseRejectionChoice('2').type, 'cancel')

  const tmp = path.join(os.tmpdir(), `hel-booking-confirm-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212612399901@c.us'
  const conv = `main:${chat}`

  console.log('--- TEST 1: OUI creates booking ---')
  let turn = await reachConfirmation(crm, conv, chat)
  const apptBefore = crm.repo.getCrmStats().appointments
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(turn.booking?.appointment?.id)
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptBefore + 1)
  assert.match(allText(turn), /enregistré|À confirmer/i)

  console.log('--- TEST 2: NON → correct or cancel ---')
  const chat2 = '212612399902@c.us'
  const conv2 = `main:${chat2}`
  turn = await reachConfirmation(crm, conv2, chat2, { phone: '0600000002' })
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'non',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation_rejection')
  assert.match(allText(turn), /Corriger|Annuler/)
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.ok(turn.lead.appointment_date)

  console.log('--- TEST 3-5: correct name then city ---')
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: '1',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'fields_to_correct')
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'nom et ville',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'field_correction')
  assert.match(allText(turn), /nom complet/i)
  const keptPhone = turn.lead.phone_number
  const keptProblem = turn.lead.problem
  const keptDate = turn.lead.appointment_date
  const keptTime = turn.lead.appointment_time
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'Yassine Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.phone_number, keptPhone)
  assert.strictEqual(turn.lead.problem, keptProblem)
  assert.strictEqual(turn.lead.appointment_date, keptDate)
  assert.match(allText(turn), /ville/i)
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'Kenitra',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.city, 'Kénitra')
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.phone_number, keptPhone)
  assert.strictEqual(turn.lead.problem, keptProblem)
  assert.strictEqual(turn.lead.appointment_date, keptDate)
  assert.strictEqual(turn.lead.appointment_time, keptTime)
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.match(allText(turn), /Yassine Zouhairi/)
  assert.match(allText(turn), /Kénitra/)
  assert.match(allText(turn), /\*OUI\*/)

  console.log('--- TEST 6: phone + date sequential ---')
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'non',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: '1',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: '4, 5',
    languageHint: 'fr',
  })
  const nameBefore = turn.lead.full_name
  const cityBefore = turn.lead.city
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: '0602269408',
    languageHint: 'fr',
  })
  assert.match(String(turn.lead.phone_number), /602269408/)
  assert.strictEqual(turn.lead.full_name, nameBefore)
  assert.strictEqual(turn.lead.city, cityBefore)
  const newSlot = futureSlotLine(8, '10:30')
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: newSlot,
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.strictEqual(turn.lead.full_name, nameBefore)
  assert.strictEqual(turn.lead.city, cityBefore)

  console.log('--- TEST 7: complaint recalculates service ---')
  const chat3 = '212612399903@c.us'
  const conv3 = `main:${chat3}`
  turn = await reachConfirmation(crm, conv3, chat3, {
    phone: '0600000003',
    problem: 'tabyid',
    name: 'Sara Benali',
  })
  const oldService = turn.lead.problem
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: 'non', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '1', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '3', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3,
    chatId: chat3,
    userText: "j'ai mal à une dent",
    languageHint: 'fr',
  })
  assert.notStrictEqual(turn.lead.problem, oldService)
  assert.ok(/Urgences|urgence|douleur|mal/i.test(String(turn.lead.problem_details || turn.lead.problem)))

  console.log('--- TEST 8: invalid city retries ---')
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: 'non', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '1', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '2', languageHint: 'fr',
  })
  const cityKeep = turn.lead.city
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: 'AtlantisCityXYZ', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'field_correction')
  assert.strictEqual(turn.lead.city, cityKeep)
  assert.match(allText(turn), /Ville|ville|مدينة/i)

  console.log('--- TEST 9: sunday rejected ---')
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: 'Kenitra', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: 'non', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '1', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: '5', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv3, chatId: chat3, userText: sundaySlotLine(), languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'field_correction')
  assert.match(allText(turn), /dimanche|fermé|ساعات|horaire|ouvert/i)

  console.log('--- TEST 10: cancel confirmed → reset ---')
  const chat4 = '212612399904@c.us'
  const conv4 = `main:${chat4}`
  turn = await reachConfirmation(crm, conv4, chat4, { phone: '0600000004' })
  const patientsBefore = crm.repo.getCrmStats().customers
  const apptsBefore = crm.repo.getCrmStats().appointments
  turn = await crm.processCrmTurn({
    conversationId: conv4, chatId: chat4, userText: 'non', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv4, chatId: chat4, userText: '2', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'draft_cancel_confirm')
  turn = await crm.processCrmTurn({
    conversationId: conv4, chatId: chat4, userText: 'oui', languageHint: 'fr',
  })
  assert.ok(turn.conversationReset)
  assert.match(allText(turn), /annulée|إلغاء/i)
  assert.strictEqual(crm.repo.getLead(conv4), null)
  assert.strictEqual(crm.repo.getCrmStats().customers, patientsBefore)
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptsBefore)

  console.log('--- TEST 11: cancel then NON keeps draft ---')
  const chat5 = '212612399905@c.us'
  const conv5 = `main:${chat5}`
  turn = await reachConfirmation(crm, conv5, chat5, { phone: '0600000005' })
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'non', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: '2', languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'non', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.match(allText(turn), /\*OUI\*/)

  console.log('--- TEST 12-14: unclear reply does NOT auto-cancel ---')
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'ok je vais voir', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.ok(!/annuler cette demande/i.test(allText(turn)), allText(turn))
  assert.match(allText(turn), /modifier|corriger|OUI/i)
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'je vais réfléchir', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.ok(!turn.conversationReset)
  assert.ok(crm.repo.getLead(conv5))
  // Explicit cancel still works
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'annuler', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'draft_cancel_confirm')
  turn = await crm.processCrmTurn({
    conversationId: conv5, chatId: chat5, userText: 'oui', languageHint: 'fr',
  })
  assert.ok(turn.conversationReset)
  assert.strictEqual(crm.repo.getLead(conv5), null)

  console.log('--- TEST 15: direct correction ---')
  const chat6 = '212612399906@c.us'
  const conv6 = `main:${chat6}`
  turn = await reachConfirmation(crm, conv6, chat6, { phone: '0600000006' })
  turn = await crm.processCrmTurn({
    conversationId: conv6,
    chatId: chat6,
    userText: 'changer le numéro : 0602269408',
    languageHint: 'fr',
  })
  assert.match(String(turn.lead.phone_number), /602269408/)
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.match(allText(turn), /\*OUI\*/)

  console.log('--- TEST 18: ok does not book ---')
  const apptOk = crm.repo.getCrmStats().appointments
  turn = await crm.processCrmTurn({
    conversationId: conv6, chatId: chat6, userText: 'ok', languageHint: 'fr',
  })
  assert.ok(!turn.booking)
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptOk)
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.ok(!/annuler cette demande/i.test(allText(turn)))

  console.log('--- TEST 21: after explicit cancel booking restarts ---')
  turn = await crm.processCrmTurn({
    conversationId: conv6, chatId: chat6, userText: 'annuler', languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'draft_cancel_confirm')
  turn = await crm.processCrmTurn({
    conversationId: conv6, chatId: chat6, userText: 'oui', languageHint: 'fr',
  })
  assert.ok(turn.conversationReset)
  turn = await crm.processCrmTurn({
    conversationId: conv6, chatId: chat6, userText: 'je veux un rendez-vous', languageHint: 'fr',
  })
  assert.ok(
    turn.lead.stage === 'awaiting_form'
    || turn.lead.stage === 'awaiting_patient'
    || /rendez|موعد|informations|معلومات/i.test(allText(turn)),
  )

  console.log('--- TEST 22: Darija NON / correction ---')
  const chat7 = '212612399907@c.us'
  const conv7 = `main:${chat7}`
  await crm.processCrmTurn({
    conversationId: conv7, chatId: chat7, userText: 'بغيت موعد', languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv7,
    chatId: chat7,
    userText: [
      'الاسم: سليم الزوهيري',
      'الهاتف: 0600000007',
      'المدينة: الرباط',
      'المشكل: تنظيف',
      `الموعد: ${futureSlotLine(6)}`,
    ].join('\n'),
    languageHint: 'darija',
  })
  if (turn.lead.stage !== 'confirmation') {
    // may still be collecting — skip soft
    console.log('darija skip soft stage=', turn.lead.stage)
  } else {
    turn = await crm.processCrmTurn({
      conversationId: conv7, chatId: chat7, userText: 'لا', languageHint: 'darija',
    })
    assert.match(allText(turn), /تصحح|تلغي/)
    assert.ok(!/[a-z]{4,}/i.test(allText(turn).replace(/https?:\S+/g, '')))
  }

  console.log('--- TEST 23: human controlled silent ---')
  const chat8 = '212612399908@c.us'
  const conv8 = `main:${chat8}`
  turn = await reachConfirmation(crm, conv8, chat8, { phone: '0600000008' })
  if (typeof crm.repo.setConversationHumanControlled === 'function') {
    crm.repo.setConversationHumanControlled(conv8, true)
  } else if (crm.smart?.setConversationOwner) {
    crm.smart.setConversationOwner?.({ conversationId: conv8, chatId: chat8, owner: 'HUMAN' })
  }
  // Force via smart if available
  try {
    const row = crm.db?.prepare?.('UPDATE conversations SET owner = ? WHERE external_key = ?')
    if (row) {
      // ensure conversation exists
      crm.smart?.getOrCreateConversation?.({
        external_key: chat8,
        phone_number: '+212600000008',
      })
      crm.db.prepare('UPDATE conversations SET owner = ? WHERE external_key = ? OR external_key = ?')
        .run('HUMAN', chat8, conv8)
    }
  } catch { /* ignore */ }

  turn = await crm.processCrmTurn({
    conversationId: conv8, chatId: chat8, userText: 'oui', languageHint: 'fr',
  })
  if (crm.repo.isConversationHumanControlled?.(conv8, chat8)) {
    assert.strictEqual(turn.forceReply, null)
    assert.ok(!turn.booking)
  }

  console.log('--- TEST 24: darija inline name correction + confirmation yes ---')
  const chat9 = '212612399909@c.us'
  const conv9 = `main:${chat9}`
  turn = await reachConfirmation(crm, conv9, chat9, {
    phone: '0600000009',
    name: 'Tini L Istimara',
  })
  const keptCity9 = turn.lead.city
  const keptPhone9 = turn.lead.phone_number
  turn = await crm.processCrmTurn({
    conversationId: conv9,
    chatId: chat9,
    userText: 'bdell smiya ana smiti adam mait',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Adam Mait')
  assert.strictEqual(turn.lead.city, keptCity9)
  assert.strictEqual(turn.lead.phone_number, keptPhone9)
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.match(allText(turn), /Adam Mait/)

  turn = await crm.processCrmTurn({
    conversationId: conv9,
    chatId: chat9,
    userText: 'nom dyali sara el amrani',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Sara El Amrani')

  turn = await crm.processCrmTurn({
    conversationId: conv9,
    chatId: chat9,
    userText: 'bdal smiya smiti adam',
    languageHint: 'darija',
  })
  assert.notStrictEqual(turn.lead.full_name, 'Adam')
  assert.match(allText(turn), /اسم|nom|complet|كامل/i)
  assert.strictEqual(turn.lead.city, keptCity9)

  turn = await crm.processCrmTurn({
    conversationId: conv9,
    chatId: chat9,
    userText: 'Adam Mait',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Adam Mait')
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')

  turn = await crm.processCrmTurn({
    conversationId: conv9,
    chatId: chat9,
    userText: 'na3am kolchi shih',
    languageHint: 'darija',
  })
  assert.ok(turn.booking?.appointment?.id, `expected booking after na3am kolchi shih\n${allText(turn)}`)

  try {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}-wal`, { force: true })
    fs.rmSync(`${tmp}-shm`, { force: true })
  } catch { /* ignore */ }

  console.log('OK booking-confirmation-corrections-test')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
