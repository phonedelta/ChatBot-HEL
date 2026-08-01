const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createCrmService,
  checkCustomerData,
  extractCustomerSignals,
  validateFullName,
  validateAppointmentHours,
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
  assert.match(turn.forceReply || turn.templateReply || '', /Nom complet/i)
  assert.match(turn.forceReply || '', /un seul message/i)
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
  assert.match(turn.forceReply, /\*OUI\*/)
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
  // After confirmation, CRM lead must be wiped for a fresh booking
  assert.strictEqual(turn.lead.stage, 'discovery')
  assert.strictEqual(turn.lead.full_name, null)
  assert.strictEqual(turn.lead.phone_number, null)
  assert.strictEqual(turn.lead.city, null)
  assert.strictEqual(turn.lead.problem, null)
  assert.strictEqual(turn.lead.appointment_date, null)
  assert.strictEqual(turn.lead.appointment_time, null)

  // Direct service request → BOOK_APPOINTMENT, skip "quel problème ?"
  const conversationService = 'main:212644444444@c.us'
  turn = crm.processCrmTurn({
    conversationId: conversationService,
    chatId: '212644444444@c.us',
    userText: 'Bghit n7yed derssa',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.problem, 'Extraction dentaire')
  assert.match(turn.forceReply, /خلع السن/)
  assert.match(turn.forceReply, /الاسم الكامل/)
  assert.match(turn.forceReply, /المشكل ديال الأسنان/)
  assert.match(turn.forceReply, /رقم الهاتف/)
  assert.match(turn.forceReply, /المدينة/)
  assert.match(turn.forceReply, /اليوم والساعة/)
  // Order: name → problem → phone → city → datetime
  const form = turn.forceReply
  assert.ok(form.indexOf('الاسم الكامل') < form.indexOf('المشكل ديال الأسنان'))
  assert.ok(form.indexOf('المشكل ديال الأسنان') < form.indexOf('رقم الهاتف'))
  assert.ok(form.indexOf('رقم الهاتف') < form.indexOf('المدينة'))
  assert.ok(form.indexOf('المدينة') < form.indexOf('اليوم والساعة'))

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
  assert.match(turn.forceReply, /ملخص طلبكم|\*OUI\*/)
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
  assert.strictEqual(turn.lead.stage, 'discovery')
  assert.strictEqual(turn.lead.full_name, null)
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
  // Incomplete reply → full form again (never one field at a time)
  assert.match(turn.forceReply, /un seul message/i)
  assert.match(turn.forceReply, /Nom complet/i)
  assert.match(turn.forceReply, /numéro de téléphone/i)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.awaiting_field, 'bulk')

  // Single first name rejected → ask for nom + prénom; then full name + Tlat books
  const conversationHicham = 'main:212666666666@c.us'
  turn = crm.processCrmTurn({
    conversationId: conversationHicham,
    chatId: '212666666666@c.us',
    userText: 'Bghit nreserve nhar tlat m3a 12:00',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  turn = crm.processCrmTurn({
    conversationId: conversationHicham,
    chatId: '212666666666@c.us',
    userText: [
      'Hicham',
      '0696472040',
      'Salé',
      'Contrôle',
      'Tlat m3a 12:00',
    ].join('\n'),
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.full_name, null)
  assert.match(turn.forceReply, /الاسم الكامل|الاسم الشخصي/i)
  turn = crm.processCrmTurn({
    conversationId: conversationHicham,
    chatId: '212666666666@c.us',
    userText: [
      'Hicham Alaoui',
      '0696472040',
      'Salé',
      'Contrôle',
      'Tlat m3a 12:00',
    ].join('\n'),
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation', 'full name + Tlat must reach confirmation')
  assert.strictEqual(turn.lead.full_name, 'Hicham Alaoui')
  assert.strictEqual(turn.lead.city, 'Salé')
  assert.strictEqual(turn.lead.appointment_time, '12:00')
  assert.ok(turn.lead.appointment_date)
  assert.match(turn.forceReply, /\*OUI\*/)
  turn = crm.processCrmTurn({
    conversationId: conversationHicham,
    chatId: '212666666666@c.us',
    userText: 'نعم',
    languageHint: 'darija',
  })
  assert.ok(turn.booking, 'appointment must be saved after نعم')
  assert.strictEqual(turn.booking.appointment.status, 'non_confirme')

  // Working hours unit checks
  assert.strictEqual(validateAppointmentHours('2026-08-02', '11:00').ok, false) // Sunday
  assert.strictEqual(validateAppointmentHours('2026-08-02', '11:00').reason, 'closed_day')
  assert.strictEqual(validateAppointmentHours('2026-08-01', '13:00').ok, false) // Sat from 13:00
  assert.strictEqual(validateAppointmentHours('2026-08-01', '14:30').ok, false)
  assert.strictEqual(validateAppointmentHours('2026-08-01', '12:00').ok, true) // Sat morning OK
  assert.strictEqual(validateAppointmentHours('2026-07-30', '15:30').ok, true) // Thu OK
  assert.strictEqual(validateAppointmentHours('2026-07-30', '20:00').ok, false) // after 19:00
  assert.strictEqual(validateAppointmentHours('2026-07-30', '10:00').ok, false) // before 10:30

  // Bot refuses Sunday booking and asks again
  const conversationHours = 'main:212655555555@c.us'
  crm.processCrmTurn({
    conversationId: conversationHours,
    chatId: '212655555555@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = crm.processCrmTurn({
    conversationId: conversationHours,
    chatId: '212655555555@c.us',
    userText: [
      'Nom : Karim Benali',
      'Téléphone : 0611112233',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 02/08/2026 à 11:00',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.appointment_date, null)
  assert.match(turn.forceReply, /fermé|dimanche/i)
  assert.match(turn.forceReply, /Nom complet/i)

  // Saturday afternoon blocked
  turn = crm.processCrmTurn({
    conversationId: conversationHours,
    chatId: '212655555555@c.us',
    userText: [
      'Nom : Karim Benali',
      'Téléphone : 0611112233',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 01/08/2026 à 15:00',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.match(turn.forceReply, /samedi|13:00/i)

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
