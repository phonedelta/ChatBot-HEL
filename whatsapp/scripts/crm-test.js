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
const {
  extractBulkBookingFields,
  looksLikeClinicLocationQuestion,
  looksLikeAvailabilityProbe,
  extractIntroducedName,
} = require('../src/crm/extract')

async function run() {
  assert.strictEqual(validateFullName('Amine'), null)
  assert.strictEqual(validateFullName('Amine Benali'), 'Amine Benali')

  assert.strictEqual(extractIntroducedName('Bonjour je m\'appelle Salim Zouhairi').full_name, 'Salim Zouhairi')
  assert.strictEqual(extractIntroducedName('Je m\'appelle Salim').name_incomplete, true)
  assert.strictEqual(extractIntroducedName('Moi c\'est Salim').name_incomplete, true)
  assert.ok(looksLikeClinicLocationQuestion('Vous êtes à Casablanca ?'))
  assert.ok(looksLikeAvailabilityProbe('Vous avez quelque chose mardi ?'))
  assert.strictEqual(extractBulkBookingFields('Vous êtes à Casablanca ?').city, null)
  assert.strictEqual(extractBulkBookingFields('Vous avez quelque chose mardi ?').appointment_date, null)
  assert.strictEqual(extractBulkBookingFields('je suis à Casablanca').city, 'Casablanca')
  assert.strictEqual(extractBulkBookingFields('Non je suis à Rabat, pas Casablanca').city, 'Rabat')
  assert.strictEqual(extractBulkBookingFields('200940212715738@lid').phone_number, null)

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

  const darijaLatinMotif = extractBulkBookingFields('3andi darssa kadarni')
  assert.strictEqual(darijaLatinMotif.problem, 'Urgences dentaires')
  assert.strictEqual(darijaLatinMotif.problem_details, '3andi darssa kadarni')
  const phoneAndMotif = extractBulkBookingFields('0602269407\nDarssa kadarni')
  assert.ok(phoneAndMotif.phone_number)
  assert.ok(String(phoneAndMotif.phone_number).includes('602269407'))
  assert.strictEqual(phoneAndMotif.problem, 'Urgences dentaires')
  assert.strictEqual(extractBulkBookingFields('ch7al taman dyal implant').problem, null)

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

  let turn = await crm.processCrmTurn({
    conversationId,
    chatId: '212600000000@c.us',
    userText: 'Bonjour, je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.shouldSkipLlm, true)
  assert.match(turn.forceReply || turn.templateReply || '', /Nom complet/i)
  assert.match(turn.forceReply || '', /plusieurs messages/i)
  assert.ok(!/un seul message/i.test(turn.forceReply || ''))
  assert.strictEqual(turn.lead.stage, 'awaiting_form')

  turn = await crm.processCrmTurn({
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

  turn = await crm.processCrmTurn({
    conversationId,
    chatId: '212600000000@c.us',
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(turn.booking)
  assert.strictEqual(turn.booking.appointment.status, 'non_confirme')
  assert.match(turn.forceReply, /enregistrée|en attente|confirmer/i)
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
  turn = await crm.processCrmTurn({
    conversationId: conversationService,
    chatId: '212644444444@c.us',
    userText: 'Bghit n7yed derssa',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.problem, 'Extraction dentaire')
  const serviceReplies = (turn.forceReplies && turn.forceReplies.length)
    ? turn.forceReplies
    : [turn.forceReply]
  const serviceAll = serviceReplies.join('\n')
  assert.match(serviceAll, /خلع السن/)
  assert.match(serviceAll, /الاسم الكامل/)
  assert.match(serviceAll, /رقم الهاتف/)
  assert.match(serviceAll, /المدينة/)
  assert.match(serviceAll, /النهار والساعة|اليوم والساعة/)
  const missingService = serviceReplies[serviceReplies.length - 1]
  assert.ok(missingService.indexOf('الاسم الكامل') < missingService.indexOf('رقم الهاتف'))
  assert.ok(missingService.indexOf('رقم الهاتف') < missingService.indexOf('المدينة'))
  assert.ok(missingService.indexOf('المدينة') < missingService.search(/النهار والساعة|اليوم والساعة/))

  // Arabic نعم must confirm (JS \\b does not work after Arabic letters)
  const conversationIdAr = 'main:212633333333@c.us'
  await crm.processCrmTurn({
    conversationId: conversationIdAr,
    chatId: '212633333333@c.us',
    userText: 'بغيت موعد',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
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
  turn = await crm.processCrmTurn({
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
  turn = await crm.processCrmTurn({
    conversationId: conversationId2,
    chatId: '212611111111@c.us',
    userText: 'Bghit rendez-vous',
    languageHint: 'darija',
  })
  assert.match(turn.forceReply, /كثر من مساج|المعلومات/)
  assert.match(turn.forceReply, /الاسم الكامل/)
  assert.ok(!/رسالة واحدة/.test(turn.forceReply))

  // Missing only phone
  const conversationId3 = 'main:212622222222@c.us'
  await crm.processCrmTurn({
    conversationId: conversationId3,
    chatId: '212622222222@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
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
  // Incomplete reply → ask only the missing field(s)
  assert.match(turn.forceReply, /numéro de téléphone|Numéro de téléphone/i)
  assert.ok(!/un seul message/i.test(turn.forceReply))
  const missingOnly = (turn.forceReplies || [turn.forceReply]).join('\n')
  assert.ok(!/• Nom complet/i.test(turn.forceReplies?.[turn.forceReplies.length - 1] || turn.forceReply))
  assert.match(missingOnly, /téléphone/i)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.strictEqual(turn.lead.awaiting_field, 'bulk')

  // Single first name rejected → ask for nom + prénom; then full name + Tlat books
  const conversationHicham = 'main:212666666666@c.us'
  turn = await crm.processCrmTurn({
    conversationId: conversationHicham,
    chatId: '212666666666@c.us',
    userText: 'Bghit nreserve nhar tlat m3a 12:00',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  turn = await crm.processCrmTurn({
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
  turn = await crm.processCrmTurn({
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
  assert.match(turn.forceReply, /\*OUI\*|\*نعم\*/)
  turn = await crm.processCrmTurn({
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
  await crm.processCrmTurn({
    conversationId: conversationHours,
    chatId: '212655555555@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
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
  assert.match(turn.forceReply, /jour et heure|Jour et heure/i)
  assert.ok(!/• Nom complet/i.test(turn.forceReply))

  // Saturday afternoon blocked
  turn = await crm.processCrmTurn({
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

  // Human handoff: inbound still persists, AI auto-reply blocked
  assert.ok(crm.smart, 'smart CRM required for handoff tests')
  const handoffChat = '212699988877@c.us'
  crm.smart.trackWhatsAppTurn({
    chatId: handoffChat,
    inboundText: 'Bonjour avant handoff',
    inboundMessageId: 'wa-in-1',
    outboundText: 'Réponse IA',
    outboundAuthor: 'ai',
  })
  const convBefore = crm.smart.getOrCreateConversation({ external_key: handoffChat })
  assert.strictEqual(crm.smart.canAiAutoReply(handoffChat), true)
  crm.smart.setHandoff(convBefore.id, { owner: 'HUMAN', owner_user: 'admin' })
  const convHuman = crm.smart.getConversation(convBefore.id)
  assert.strictEqual(convHuman.owner, 'HUMAN')
  assert.strictEqual(convHuman.status, 'HUMAN_CONTROLLED')
  assert.strictEqual(crm.smart.canAiAutoReply(handoffChat), false)

  crm.smart.trackWhatsAppTurn({
    chatId: handoffChat,
    inboundText: 'Message pendant HUMAN',
    inboundMessageId: 'wa-in-2',
  })
  const msgs = crm.smart.listMessages(convBefore.id)
  assert.ok(msgs.some((m) => m.author_type === 'patient' && String(m.body).includes('pendant HUMAN')))

  crm.smart.setHandoff(convBefore.id, { owner: 'AI', owner_user: 'admin' })
  assert.strictEqual(crm.smart.getConversation(convBefore.id).owner, 'AI')

  // --- Progressive booking (several messages, seed, corrections) ---
  const joinReplies = (result) => (result.forceReplies && result.forceReplies.length
    ? result.forceReplies
    : [result.forceReply].filter(Boolean))

  // CAS 1 — fields before explicit RDV
  const convSeed = 'main:212677700001@c.us'
  await crm.processCrmTurn({
    conversationId: convSeed,
    chatId: '212677700001@c.us',
    userText: 'Je m\'appelle Salim Zouhairi',
    languageHint: 'fr',
  })
  await crm.processCrmTurn({
    conversationId: convSeed,
    chatId: '212677700001@c.us',
    userText: 'J\'ai une douleur à une molaire',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convSeed,
    chatId: '212677700001@c.us',
    userText: 'Je voudrais prendre rendez-vous',
    languageHint: 'fr',
  })
  const seedReplies = joinReplies(turn)
  assert.ok(seedReplies.length >= 2, 'known + missing must be two WhatsApp messages')
  assert.match(seedReplies[0], /Salim Zouhairi/)
  assert.match(seedReplies[0], /molaire|Urgences|douleur/i)
  assert.match(seedReplies[1], /Numéro de téléphone/i)
  assert.match(seedReplies[1], /Ville/i)
  assert.match(seedReplies[1], /Jour et heure/i)
  assert.ok(!/• Nom complet/i.test(seedReplies[1]))
  assert.ok(!/un seul message/i.test(seedReplies.join('\n')))

  // CAS 2 — no fields before intent
  const convEmpty = 'main:212677700002@c.us'
  turn = await crm.processCrmTurn({
    conversationId: convEmpty,
    chatId: '212677700002@c.us',
    userText: 'Je veux prendre rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(joinReplies(turn).length, 1)
  assert.match(turn.forceReply, /Nom complet/i)
  assert.match(turn.forceReply, /plusieurs messages/i)

  // CAS 3 + 4 — progressive merge, any order
  const convProg = 'main:212677700003@c.us'
  await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: '0612345678',
    languageHint: 'fr',
  })
  assert.ok(turn.lead.phone_number)
  turn = await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: 'Casablanca',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.city, 'Casablanca')
  turn = await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: 'Salim Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  turn = await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: 'douleur molaire',
    languageHint: 'fr',
  })
  assert.ok(turn.lead.problem)
  turn = await crm.processCrmTurn({
    conversationId: convProg,
    chatId: '212677700003@c.us',
    userText: 'mardi 15h',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.match(turn.forceReply, /\*OUI\*/)

  // CAS 5 — city correction
  const convCity = 'main:212677700005@c.us'
  await crm.processCrmTurn({
    conversationId: convCity,
    chatId: '212677700005@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  await crm.processCrmTurn({
    conversationId: convCity,
    chatId: '212677700005@c.us',
    userText: 'Je suis à Casablanca',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convCity,
    chatId: '212677700005@c.us',
    userText: 'Non je suis à Rabat, pas Casablanca',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.city, 'Rabat')

  // CAS 6 — date correction
  const convDate = 'main:212677700006@c.us'
  await crm.processCrmTurn({
    conversationId: convDate,
    chatId: '212677700006@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convDate,
    chatId: '212677700006@c.us',
    userText: 'mardi 15h',
    languageHint: 'fr',
  })
  const firstDate = turn.lead.appointment_date
  const firstTime = turn.lead.appointment_time
  turn = await crm.processCrmTurn({
    conversationId: convDate,
    chatId: '212677700006@c.us',
    userText: 'finalement mercredi 16h',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.appointment_time, '16:00')
  assert.ok(turn.lead.appointment_date)
  assert.notStrictEqual(turn.lead.appointment_date, firstDate)
  assert.notStrictEqual(turn.lead.appointment_time, firstTime)

  // CAS 7 / 8 — first name vs full name
  const convName = 'main:212677700007@c.us'
  await crm.processCrmTurn({
    conversationId: convName,
    chatId: '212677700007@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convName,
    chatId: '212677700007@c.us',
    userText: 'Je m\'appelle Salim',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.full_name, null)
  turn = await crm.processCrmTurn({
    conversationId: convName,
    chatId: '212677700007@c.us',
    userText: 'Je m\'appelle Salim Zouhairi',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')

  // CAS 9 — @lid must not invent a phone
  const convLid = 'main:200940212715738@lid'
  turn = await crm.processCrmTurn({
    conversationId: convLid,
    chatId: '200940212715738@lid',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, null)
  turn = await crm.processCrmTurn({
    conversationId: convLid,
    chatId: '200940212715738@lid',
    userText: '200940212715738@lid',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.phone_number, null)

  // CAS 10 — clinic city question is not patient city
  const convQ = 'main:212677700010@c.us'
  await crm.processCrmTurn({
    conversationId: convQ,
    chatId: '212677700010@c.us',
    userText: 'Vous êtes à Casablanca ?',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convQ,
    chatId: '212677700010@c.us',
    userText: 'je veux prendre rendez-vous',
    languageHint: 'fr',
  })
  assert.notStrictEqual(turn.lead.city, 'Casablanca')

  // CAS 12 — correction after summary
  const convFix = 'main:212677700012@c.us'
  await crm.processCrmTurn({
    conversationId: convFix,
    chatId: '212677700012@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convFix,
    chatId: '212677700012@c.us',
    userText: [
      'Nom : Karim Alaoui',
      'Téléphone : 0611112233',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 30/07/2026 à 15:30',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  turn = await crm.processCrmTurn({
    conversationId: convFix,
    chatId: '212677700012@c.us',
    userText: 'Le numéro est plutôt 0622223344',
    languageHint: 'fr',
  })
  assert.match(String(turn.lead.phone_number), /22223344/)
  assert.strictEqual(turn.lead.stage, 'confirmation')
  assert.match(turn.forceReply, /\*OUI\*/)
  assert.match(turn.forceReply, /Karim Alaoui/)

  // CAS 13 — OUI with missing fields does not create
  const convOui = 'main:212677700013@c.us'
  await crm.processCrmTurn({
    conversationId: convOui,
    chatId: '212677700013@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  const apptBeforeOui = crm.repo.getCrmStats().appointments
  turn = await crm.processCrmTurn({
    conversationId: convOui,
    chatId: '212677700013@c.us',
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(!turn.booking)
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptBeforeOui)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')

  // CAS 14 — all fields already known
  const convAll = 'main:212677700014@c.us'
  await crm.processCrmTurn({
    conversationId: convAll,
    chatId: '212677700014@c.us',
    userText: 'Je m\'appelle Sara Benali',
    languageHint: 'fr',
  })
  await crm.processCrmTurn({
    conversationId: convAll,
    chatId: '212677700014@c.us',
    userText: 'j\'ai une douleur à une molaire',
    languageHint: 'fr',
  })
  await crm.processCrmTurn({
    conversationId: convAll,
    chatId: '212677700014@c.us',
    userText: 'mon numéro est 0612345678, je suis à Casablanca, jeudi 30/07/2026 à 11h00',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: convAll,
    chatId: '212677700014@c.us',
    userText: 'Ok je veux prendre rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation', 'all known fields must go to summary')
  assert.match(turn.forceReply, /\*OUI\*/)
  assert.match(turn.forceReply, /Sara Benali/)
  assert.ok(!/Il me manque/i.test(turn.forceReply))

  // CAS 15 — Darija Arabic script only
  const convDar = 'main:212677700015@c.us'
  await crm.processCrmTurn({
    conversationId: convDar,
    chatId: '212677700015@c.us',
    userText: 'سميتي سليم الزوهيري',
    languageHint: 'darija',
  })
  await crm.processCrmTurn({
    conversationId: convDar,
    chatId: '212677700015@c.us',
    userText: 'عندي وجع فالضرس',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: convDar,
    chatId: '212677700015@c.us',
    userText: 'بغيت موعد',
    languageHint: 'darija',
  })
  const darText = joinReplies(turn).join('\n')
  assert.match(darText, /[\u0600-\u06FF]/)
  assert.ok(!/\bbghit\b/i.test(darText))
  assert.ok(!/un seul message/i.test(darText))
  assert.match(darText, /كثر من مساج|المعلومات/)

  // CAS 17 — HUMAN_CONTROLLED silences booking
  const humanBookChat = '212677700017@c.us'
  crm.smart.trackWhatsAppTurn({
    chatId: humanBookChat,
    inboundText: 'hello',
    inboundMessageId: 'wa-human-book-1',
  })
  const humanConv = crm.smart.getOrCreateConversation({ external_key: humanBookChat })
  crm.smart.setHandoff(humanConv.id, { owner: 'HUMAN', owner_user: 'admin' })
  turn = await crm.processCrmTurn({
    conversationId: `main:${humanBookChat}`,
    chatId: humanBookChat,
    userText: 'je veux prendre rendez-vous',
    languageHint: 'fr',
  })
  assert.strictEqual(turn.forceReply, null)
  assert.ok(!(turn.forceReplies || []).length)
  crm.smart.setHandoff(humanConv.id, { owner: 'AI', owner_user: 'admin' })

  // CAS 18 — no audit on collect, one after confirm
  const convAudit = 'main:212677700018@c.us'
  const apptBeforeCollect = crm.repo.getCrmStats().appointments
  const timelineBefore = crm.db.prepare(`
    SELECT COUNT(*) AS n FROM timeline_events WHERE event_type = 'APPOINTMENT_CREATED'
  `).get()?.n || 0
  await crm.processCrmTurn({
    conversationId: convAudit,
    chatId: '212677700018@c.us',
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  await crm.processCrmTurn({
    conversationId: convAudit,
    chatId: '212677700018@c.us',
    userText: [
      'Nom : Lina Mansouri',
      'Téléphone : 0688889999',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 30/07/2026 à 16:00',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptBeforeCollect)
  assert.strictEqual(
    crm.db.prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE event_type = 'APPOINTMENT_CREATED'`).get()?.n || 0,
    timelineBefore,
  )
  turn = await crm.processCrmTurn({
    conversationId: convAudit,
    chatId: '212677700018@c.us',
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(turn.booking)
  assert.strictEqual(crm.repo.getCrmStats().appointments, apptBeforeCollect + 1)

  // CAS 19 — two outbound messages persisted
  const convTwo = '212677700019@c.us'
  crm.smart.trackWhatsAppTurn({
    chatId: convTwo,
    inboundText: 'Je m\'appelle Salim Zouhairi',
    inboundMessageId: 'wa-two-1',
  })
  crm.repo.logConversation({
    conversation_id: `main:${convTwo}`,
    whatsapp_chat_id: convTwo,
    direction: 'inbound',
    message_text: 'Je m\'appelle Salim Zouhairi',
  })
  crm.repo.logConversation({
    conversation_id: `main:${convTwo}`,
    whatsapp_chat_id: convTwo,
    direction: 'inbound',
    message_text: 'J\'ai une douleur à une molaire',
  })
  turn = await crm.processCrmTurn({
    conversationId: `main:${convTwo}`,
    chatId: convTwo,
    userText: 'Je voudrais prendre rendez-vous',
    languageHint: 'fr',
  })
  const two = joinReplies(turn)
  assert.ok(two.length >= 2)
  for (const body of two) {
    crm.smart.trackWhatsAppTurn({
      chatId: convTwo,
      outboundText: body,
      outboundAuthor: 'ai',
    })
    crm.repo.logConversation({
      conversation_id: `main:${convTwo}`,
      whatsapp_chat_id: convTwo,
      direction: 'outbound',
      message_text: body,
    })
  }
  const listed = crm.smart.listMessages(crm.smart.getOrCreateConversation({ external_key: convTwo }).id)
  const outbound = listed.filter((m) => m.direction === 'outbound' && m.author_type === 'ai')
  assert.ok(outbound.length >= 2)
  assert.match(outbound[outbound.length - 2].body, /Salim Zouhairi/)
  assert.match(outbound[outbound.length - 1].body, /téléphone|Ville|Jour/i)

  try {
    fs.rmSync(tmpDb, { force: true })
    fs.rmSync(`${tmpDb}-wal`, { force: true })
    fs.rmSync(`${tmpDb}-shm`, { force: true })
  } catch {
    // ignore cleanup errors on Windows locks
  }

  console.log('crm test: ok')
}

run().catch((err) => { console.error(err); process.exit(1) })
