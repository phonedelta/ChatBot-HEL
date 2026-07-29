const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createCrmService,
  checkCustomerData,
  extractCustomerSignals,
  validateFullName,
} = require('../src/crm')
const { extractBulkBookingFields } = require('../src/crm/extract')

function run() {
  assert.strictEqual(validateFullName('Amine'), null)
  assert.strictEqual(validateFullName('Amine Benali'), 'Amine Benali')

  const freeform = extractBulkBookingFields([
    'Salim Zouhairi',
    'Casablanca',
    '0612345678',
    '7ri9 darssa',
    '29/07 11h',
  ].join('\n'), { now: new Date('2026-07-20T10:00:00Z') })

  assert.strictEqual(freeform.full_name, 'Salim Zouhairi')
  assert.strictEqual(freeform.city, 'Casablanca')
  assert.ok(freeform.phone_number)
  assert.strictEqual(freeform.problem, 'Urgences dentaires')
  assert.strictEqual(freeform.problem_details, '7ri9 darssa')
  assert.strictEqual(freeform.appointment_date, '2026-07-29')
  assert.strictEqual(freeform.appointment_time, '11:00')

  // Classic 5-line form: name must never become a service
  const classic = extractBulkBookingFields([
    'Anass zouhairi',
    '0629245604',
    'Ifrane',
    'Nettoyage des dents',
    '01/08 12:00',
  ].join('\n'), { now: new Date('2026-07-29T10:00:00Z') })
  assert.strictEqual(classic.full_name, 'Anass Zouhairi')
  assert.strictEqual(classic.city, 'Ifrane')
  assert.strictEqual(classic.problem, 'Détartrage')
  assert.strictEqual(classic.problem_details, 'Nettoyage des dents')
  assert.strictEqual(validateFullName('Nettoyage Des Dents Détartrage'), null)

  const signals = extractCustomerSignals('Bghit rendez-vous')
  assert.strictEqual(signals.booking_intent, true)

  const incomplete = checkCustomerData({
    full_name: 'Amine Benali',
    phone_number: '+212612345678',
    city: 'Casablanca',
    problem: 'Urgences dentaires',
  })
  assert.strictEqual(incomplete.ok, false)
  assert.strictEqual(incomplete.nextField, 'appointment')

  const tmpDb = path.join(os.tmpdir(), `hel-crm-test-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const conversationId = 'main:212600000000@c.us'

  let turn = crm.processCrmTurn({
    conversationId,
    chatId: '212600000000@c.us',
    userText: 'Bonjour, je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.shouldSkipLlm, true)
  assert.match(turn.forceReply, /Nom complet/i)
  assert.match(turn.forceReply, /un seul message/i)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')

  turn = crm.processCrmTurn({
    conversationId,
    chatId: '212600000000@c.us',
    userText: [
      'Nom : Amine Benali',
      'Téléphone : 0612345678',
      'Ville : Casablanca',
      'Problème : Douleur à la molaire droite',
      'Rendez-vous : 30/07/2026 à 15:30',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.match(turn.forceReply, /OUI/)
  assert.match(turn.forceReply, /Amine Benali/)
  assert.strictEqual(turn.lead.problem, 'Urgences dentaires')
  assert.strictEqual(turn.lead.problem_details, 'Douleur à la molaire droite')
  assert.strictEqual(crm.repo.getCrmStats().appointments, 0)

  turn = crm.processCrmTurn({
    conversationId,
    chatId: '212600000000@c.us',
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(turn.booking)
  assert.strictEqual(turn.booking.appointment.status, 'non_confirme')
  assert.match(turn.forceReply, /confirmé/i)
  assert.strictEqual(crm.repo.getCrmStats().appointments, 1)

  // Arabic نعم must confirm (JS \\b does not work after Arabic letters)
  const conversationIdAr = 'main:212633333333@c.us'
  crm.processCrmTurn({
    conversationId: conversationIdAr,
    chatId: '212633333333@c.us',
    userText: 'بغيت موعد',
    languageHint: 'darija',
  })
  turn = crm.processCrmTurn({
    conversationId: conversationIdAr,
    chatId: '212633333333@c.us',
    userText: [
      'Jihad Khayati',
      '0602269408',
      'Casablanca',
      'Bghit ndir détartrage',
      '28/08/2026 12:00',
    ].join('\n'),
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.match(turn.forceReply, /ملخص|نعم/)
  assert.ok(!/تم تسجيل طلب الموعد\./.test(turn.forceReply.split('\n')[0]))
  const problemBefore = turn.lead.problem
  const detailsBefore = turn.lead.problem_details
  turn = crm.processCrmTurn({
    conversationId: conversationIdAr,
    chatId: '212633333333@c.us',
    userText: 'نعم',
    languageHint: 'darija',
  })
  assert.ok(turn.booking, 'نعم should save the appointment')
  assert.strictEqual(turn.lead.stage, 'completed')
  assert.strictEqual(turn.booking.dentalCase.problem, problemBefore)
  assert.strictEqual(turn.booking.dentalCase.description, detailsBefore)
  assert.notStrictEqual(detailsBefore, 'نعم')
  assert.strictEqual(crm.repo.getCrmStats().appointments, 2)
  assert.ok(extractCustomerSignals('نعم').confirmation_yes)
  assert.ok(extractCustomerSignals('موافق').confirmation_yes)
  assert.ok(extractCustomerSignals('لا').confirmation_no)

  // Darija Latin → Arabic form
  const conversationId2 = 'main:212611111111@c.us'
  turn = crm.processCrmTurn({
    conversationId: conversationId2,
    chatId: '212611111111@c.us',
    userText: 'Bghit rendez-vous',
    languageHint: 'darija',
  })
  assert.match(turn.forceReply, /رسالة واحدة/)
  assert.match(turn.forceReply, /الاسم الكامل/)

  // Missing only phone
  const conversationId3 = 'main:212622222222@c.us'
  crm.processCrmTurn({
    conversationId: conversationId3,
    chatId: '212622222222@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = crm.processCrmTurn({
    conversationId: conversationId3,
    chatId: '212622222222@c.us',
    userText: [
      'Sara Alaoui',
      'Rabat',
      'douleur dentaire',
      '31/07/2026 à 10:30',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.match(turn.forceReply, /numéro de téléphone/i)

  try {
    fs.rmSync(tmpDb, { force: true })
    fs.rmSync(`${tmpDb}-wal`, { force: true })
    fs.rmSync(`${tmpDb}-shm`, { force: true })
  } catch {
    // ignore cleanup errors on Windows locks
  }

  console.log('crm test: ok')
}

run()
