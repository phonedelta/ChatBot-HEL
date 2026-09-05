/**
 * Non-regression: booking field corrections (Mdina rabat, contrasts, general fix flow).
 */
const assert = require('assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { createCrmService } = require('../src/crm')
const {
  detectCorrectionIntent,
  buildCorrectionPatch,
  detectGeneralCorrectionRequest,
} = require('../src/crm/booking-corrections')
const { checkCustomerData } = require('../src/crm/checkCustomerData')

function allText(turn) {
  return [turn?.forceReply, ...(turn?.forceReplies || [])].filter(Boolean).join('\n')
}

function weekdayFuture(daysAhead = 5, time = '14:00') {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  if (d.getDay() === 6 && time > '13:00') {
    d.setDate(d.getDate() + 2)
    while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  }
  return { date: d.toISOString().slice(0, 10), time }
}

async function main() {
  console.log('--- unit: Mdina / city markers ---')
  for (const text of [
    'Mdina rabat',
    'mdina rabat',
    'lmdina Rabat',
    'mdinti Rabat',
    "La ville c'est Rabat",
    'المدينة هي الرباط',
    'Rabat machi Safi',
  ]) {
    const hit = detectCorrectionIntent(text, { draft: { city: 'Safi' }, now: new Date() })
    assert.strictEqual(hit.isCorrection, true, `expected correction for: ${text}`)
    assert.strictEqual(hit.fields.city, 'Rabat', `city for: ${text}`)
    assert.deepStrictEqual(Object.keys(hit.fields), ['city'])
  }

  console.log('--- unit: phone / time / date ---')
  assert.strictEqual(
    detectCorrectionIntent('le bon numéro est 0612345678').fields.phone_number,
    '+212612345678',
  )
  assert.strictEqual(
    detectCorrectionIntent('sa3a 14h', { now: new Date() }).fields.appointment_time,
    '14:00',
  )
  const ghda = detectCorrectionIntent('ghda machi lyoum', { now: new Date('2026-09-05T12:00:00') })
  assert.strictEqual(ghda.fields.appointment_date, '2026-09-06')
  const both = detectCorrectionIntent('ghda m3a 14h', { now: new Date('2026-09-05T12:00:00') })
  assert.strictEqual(both.fields.appointment_date, '2026-09-06')
  assert.strictEqual(both.fields.appointment_time, '14:00')

  const invalid = detectCorrectionIntent('telephone abc', {
    draft: { phone_number: '+212612345678' },
  })
  assert.ok(invalid.invalidPhone)
  assert.ok(!buildCorrectionPatch(invalid).phone_number)

  assert.ok(detectGeneralCorrectionRequest('bghit ns7e7 wahed lma3louma'))
  assert.ok(!detectCorrectionIntent('Rabat', { draft: { city: 'Safi' } }).isCorrection)
  assert.ok(!detectCorrectionIntent('Bonjour Rabat comment ca va', { draft: { city: 'Safi' } }).isCorrection)

  const tmp = path.join(os.tmpdir(), `hel-mdina-corrections-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212699900111@c.us'
  const conv = `main:${chat}`

  console.log('--- TEST 1: Mdina rabat while collecting (phone missing) ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Safi',
    phone_number: null,
    problem: null,
    appointment_date: null,
    appointment_time: null,
    stage: 'awaiting_form',
    awaiting_field: 'bulk',
    booking_intent: 1,
    booking_target: 'new_patient',
    language: 'darija',
  })
  let turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Mdina rabat',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.strictEqual(turn.lead.city, 'Rabat')
  assert.strictEqual(turn.lead.phone_number, null)
  assert.ok(checkCustomerData(turn.lead).missing.includes('phone_number'))
  assert.ok(!checkCustomerData(turn.lead).missing.includes('city'))
  assert.match(allText(turn), /تم تصحيح المدينة|رقم الهاتف/)

  console.log('--- TEST 15: persistence after city correction ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '0611111111',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.city, 'Rabat')
  assert.strictEqual(turn.lead.phone_number, '+212611111111')

  console.log('--- TEST 2: Mdina rabat at confirmation ---')
  const slot = weekdayFuture(6, '14:00')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Safi',
    phone_number: '+212612345678',
    problem: 'Consultation',
    problem_details: 'douleur',
    appointment_date: slot.date,
    appointment_time: slot.time,
    stage: 'confirmation',
    awaiting_field: 'confirmation',
    booking_intent: 1,
    booking_target: 'new_patient',
    language: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Mdina rabat',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.city, 'Rabat')
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.strictEqual(turn.lead.phone_number, '+212612345678')
  assert.strictEqual(turn.lead.appointment_time, slot.time)
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.strictEqual(turn.lead.awaiting_field, 'confirmation')
  assert.match(allText(turn), /تم تصحيح المدينة|ملخص|Rabat|الرباط/)

  console.log('--- TEST 5+6+10: successive phone then time ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'le bon numéro est 0612345678',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, '+212612345678')
  assert.strictEqual(turn.lead.city, 'Rabat')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'sa3a 14h',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.appointment_time, '14:00')
  assert.strictEqual(turn.lead.city, 'Rabat')

  console.log('--- TEST 9: incomplete name keeps other fields ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Rabat',
    phone_number: '+212612345678',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: '14:00',
    stage: 'awaiting_form',
    awaiting_field: 'bulk',
    language: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Smyti Salim',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.city, 'Rabat')
  assert.strictEqual(turn.lead.phone_number, '+212612345678')
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.match(allText(turn), /الاسم الكامل|الاسم والنسب|prénom|nom complet/i)

  console.log('--- TEST 12: general correction then mdina then Rabat ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Safi',
    phone_number: '+212612345678',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: '14:00',
    stage: 'confirmation',
    awaiting_field: 'confirmation',
    language: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit ns7e7 wahed lma3louma',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'fields_to_correct')
  assert.match(allText(turn), /شنو هي المعلومات|المدينة/)
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'mdina',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.awaiting_field, 'field_correction')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Rabat',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.city, 'Rabat')
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')

  console.log('--- TEST 13: invalid phone does not wipe ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Rabat',
    phone_number: '+212612345678',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: '14:00',
    stage: 'confirmation',
    awaiting_field: 'confirmation',
    language: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'telephone abc',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, '+212612345678')
  assert.match(allText(turn), /Numéro invalide|numéro/i)

  console.log('--- TEST 14: false positive does not overwrite city ---')
  crm.repo.upsertLead(conv, {
    full_name: 'Salim Zouhairi',
    city: 'Safi',
    phone_number: '+212612345678',
    problem: 'Consultation',
    appointment_date: slot.date,
    appointment_time: '14:00',
    stage: 'awaiting_form',
    awaiting_field: 'bulk',
    language: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Bonjour Rabat comment ca va',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.city, 'Safi')

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('\nbooking mdina corrections tests: passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
