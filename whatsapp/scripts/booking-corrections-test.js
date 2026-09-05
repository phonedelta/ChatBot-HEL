/**
 * Booking field correction tests — name clip + field-specific patches.
 */
const assert = require('assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const {
  extractBulkBookingFields,
  extractTargetPersonName,
} = require('../src/crm/extract')
const { validateFullName } = require('../src/crm/name-validator')
const {
  detectCorrectionIntent,
  buildCorrectionPatch,
  detectInlineNameCorrection,
  looksLikeAvailabilityAsk,
} = require('../src/crm/booking-corrections')
const { createCrmService } = require('../src/crm')
const { checkCustomerData } = require('../src/crm/checkCustomerData')

function weekdayFuture(daysAhead, time = '10:30') {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  const iso = d.toISOString().slice(0, 10)
  return { date: iso, time }
}

async function main() {
  console.log('--- initial name clip ---')
  const long = 'Khoya smito yassine zouhairi bgha ydir tabyid l asnan bghit hta howa mn kenitra bghit nakhod lih rendez vous momkin nakhod rendez-vous 02/09 10:30'
  assert.strictEqual(extractTargetPersonName(long), 'Yassine Zouhairi')
  const bulk = extractBulkBookingFields(long)
  assert.strictEqual(bulk.full_name, 'Yassine Zouhairi')
  assert.strictEqual(bulk.problem, 'Blanchiment des dents')
  assert.strictEqual(bulk.city, 'Kénitra')
  assert.ok(!/Bgha|Ydir|Smiya|Dialo/i.test(bulk.full_name))

  console.log('--- correction intents ---')
  assert.deepStrictEqual(
    detectCorrectionIntent('Smiya dialo yassine zouhairi').fields,
    { full_name: 'Yassine Zouhairi' },
  )
  assert.deepStrictEqual(
    detectCorrectionIntent('Changer smiya : yassine zouhairi').fields,
    { full_name: 'Yassine Zouhairi' },
  )
  assert.deepStrictEqual(
    detectCorrectionIntent('بدل الاسم لياسين زهيري').fields,
    { full_name: 'ياسين زهيري' },
  )
  assert.ok(detectCorrectionIntent('le nom est faux').cleared.full_name)
  assert.strictEqual(
    detectCorrectionIntent('changer numéro : 0602269408').fields.phone_number,
    '+212602269408',
  )
  assert.strictEqual(
    detectCorrectionIntent('la ville hiya kenitra').fields.city,
    'Kénitra',
  )

  const multi = detectCorrectionIntent('nom Yassine Zouhairi ville Kenitra')
  assert.strictEqual(multi.fields.full_name, 'Yassine Zouhairi')
  assert.strictEqual(multi.fields.city, 'Kénitra')

  console.log('--- darija name corrections ---')
  assert.strictEqual(
    detectCorrectionIntent('bdell smiya ana smiti adam mait').fields.full_name,
    'Adam Mait',
  )
  assert.strictEqual(
    detectCorrectionIntent('nom dyali adam mait').fields.full_name,
    'Adam Mait',
  )
  assert.ok(detectCorrectionIntent('bdal smiya smiti adam').incompleteName)
  assert.strictEqual(detectCorrectionIntent('bdal smiya smiti adam').nameCandidate, 'adam')
  assert.strictEqual(detectInlineNameCorrection('nom dyali adam').type, 'incomplete')
  assert.strictEqual(detectInlineNameCorrection('bdell smiya ana smiti adam mait').fullName, 'Adam Mait')
  assert.ok(looksLikeAvailabilityAsk('bghit maw3id nhar tlat 3tini l mawa3id li motaha dak nhar'))
  assert.ok(!detectCorrectionIntent('bghit maw3id nhar tlat 3tini l mawa3id li motaha dak nhar').isCorrection)

  console.log('--- service immutable on name correction (workflow) ---')
  const tmp = path.join(os.tmpdir(), `hel-booking-corrections-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212600000888@c.us'
  const conv = `main:${chat}`
  const slot = weekdayFuture(5, '10:30')

  let turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: [
      'Yassine Zouhairi Bgha Ydir',
      '0602269408',
      'Kenitra',
      'tabyid',
      `${slot.date.slice(8, 10)}/${slot.date.slice(5, 7)}/${slot.date.slice(0, 4)} ${slot.time}`,
    ].join('\n'),
    languageHint: 'darija',
  })
  // Force a bad name into the lead if the validator already rejected it
  if (turn.lead.full_name !== 'Yassine Zouhairi Bgha Ydir') {
    crm.repo.upsertLead(conv, {
      full_name: 'Yassine Zouhairi Bgha Ydir',
      phone_number: '+212602269408',
      city: 'Kénitra',
      problem: 'Blanchiment des dents',
      problem_details: 'tabyid',
      appointment_date: slot.date,
      appointment_time: slot.time,
      stage: 'confirmation',
      awaiting_field: 'confirmation',
      booking_target: 'new_patient',
      booking_intent: 1,
    })
  }

  const before = crm.repo.getLead(conv)
  assert.strictEqual(before.problem, 'Blanchiment des dents')
  assert.strictEqual(before.city, 'Kénitra')
  assert.strictEqual(before.phone_number, '+212602269408')
  assert.strictEqual(before.appointment_date, slot.date)
  assert.strictEqual(before.appointment_time, slot.time)

  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Changer smiya : yassine zouhairi',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.problem, 'Blanchiment des dents')
  assert.strictEqual(turn.lead.city, 'Kénitra')
  assert.strictEqual(turn.lead.phone_number, '+212602269408')
  assert.strictEqual(turn.lead.appointment_date, slot.date)
  assert.strictEqual(turn.lead.appointment_time, slot.time)
  assert.ok(
    turn.lead.stage === 'confirmation' || checkCustomerData(turn.lead).ok,
    'should return to confirmation when complete',
  )
  const replies = [turn.forceReply, ...(turn.forceReplies || [])].filter(Boolean).join('\n')
  assert.match(replies, /تم تصحيح الاسم|ملخص طلبكم/)

  console.log('--- smiya dialo correction ---')
  crm.repo.upsertLead(conv, { full_name: 'Yassine Zouhairi Bgha Ydir', stage: 'awaiting_form', awaiting_field: 'bulk' })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Smiya dialo yassine zouhairi',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.problem, 'Blanchiment des dents')

  console.log('--- complaint correction recalculates service ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'la machi tabyid, 3andi darssa kadarni',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.problem, 'Urgences dentaires')
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.city, 'Kénitra')

  console.log('--- clear name without value ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'le nom est faux',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.full_name, null)
  assert.ok(checkCustomerData(turn.lead).missing.includes('full_name'))

  console.log('--- phone-only correction ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Yassine Zouhairi',
    phone_number: '+212611111111',
    city: 'Kénitra',
    problem: 'Blanchiment des dents',
    problem_details: 'tabyid',
    appointment_date: slot.date,
    appointment_time: slot.time,
    stage: 'confirmation',
    awaiting_field: 'confirmation',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'changer numéro : 0602269408',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.phone_number, '+212602269408')
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.problem, 'Blanchiment des dents')
  assert.strictEqual(turn.lead.city, 'Kénitra')

  assert.strictEqual(validateFullName('Yassine Zouhairi Bgha Ydir'), null)

  try {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}-wal`, { force: true })
    fs.rmSync(`${tmp}-shm`, { force: true })
  } catch { /* ignore */ }

  console.log('OK booking-corrections-test')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
