const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  assistantOfferedAppointment,
  normalizeBookingUnderstanding,
  resolveDate,
  resolveTime,
  understandBookingTurn,
} = require('../src/crm/booking-turn-understanding')
const { isReplyInStyle, resolveReplyStyle } = require('../src/ai/reply-style')
const {
  collectionBrief,
  phraseWorkflowReplies,
  rewordingProblem,
  withDeadline,
} = require('../src/ai/workflow-reply-phrasing')
const { claimsAppointmentRecorded, buildSafeFallback } = require('../src/ai/conversation-assistant')
const { parseAvailableSlotSelection } = require('../src/crm/smart/availability-slot-select')
const { createCrmService } = require('../src/crm')

// Wednesday 14 October 2026.
const NOW = new Date(2026, 9, 14, 12, 0, 0)

function futureWeekday(minDaysAhead) {
  const date = new Date()
  date.setDate(date.getDate() + minDaysAhead)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  const pad = (value) => String(value).padStart(2, '0')
  return {
    iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    display: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
  }
}

function testDatesAreResolvedByCodeNotByTheModel() {
  assert.equal(resolveDate({ day: 16, month: 10 }, NOW), '2026-10-16')
  assert.equal(resolveDate({ day: 16 }, NOW), '2026-10-16', 'a bare day later this month')
  assert.equal(resolveDate({ day: 14 }, NOW), '2026-10-14', 'today counts')
  assert.equal(resolveDate({ day: 10 }, NOW), '2026-11-10', 'a bare day already passed means next month')
  assert.equal(resolveDate({ day: 31 }, new Date(2026, 10, 2)), '2026-12-31', 'November has no 31st')
  assert.equal(resolveDate({ relative: 'tomorrow' }, NOW), '2026-10-15')
  assert.equal(resolveDate({ relative: 'day_after_tomorrow' }, NOW), '2026-10-16')
  assert.equal(resolveDate({ weekday: 'friday' }, NOW), '2026-10-16')
  assert.equal(resolveDate({ weekday: 'wednesday' }, NOW), '2026-10-21', 'the same weekday means next week')
  assert.equal(resolveDate({ day: 13, month: 10 }, NOW), '2026-10-13', 'a day just passed stays in the past so the workflow refuses it')
  assert.equal(resolveDate({ day: 5, month: 1 }, NOW), '2027-01-05', 'a date long passed rolls over to next year')
  assert.equal(resolveDate({ day: 31, month: 2 }, NOW), null)
  assert.equal(resolveDate({ day: 16, month: 10, year: 2027 }, NOW), '2027-10-16')
  assert.equal(resolveDate(null, NOW), null)

  assert.equal(resolveTime('11'), '11:00')
  assert.equal(resolveTime('15h30'), '15:30')
  assert.equal(resolveTime('9'), '09:00')
  assert.equal(resolveTime('25:00'), null)
  assert.equal(resolveTime('vers midi'), null)
}

function testModelOutputIsValidated() {
  const read = normalizeBookingUnderstanding({
    booking: 'accepted_offer',
    answer: 'YES',
    is_question: false,
    full_name: '  Salim   Zouhairi ',
    phone: '06 00 00 00 00',
    city: 'kenitra',
    service: 'urgences dentaires',
    reason: 'douleur à une molaire',
    date: { day: 16, month: 10 },
    time: '11',
    language: 'darija',
    script: 'latin',
  }, { now: NOW, assistantOfferedBooking: true })
  assert.deepStrictEqual(read.fields, {
    full_name: 'Salim Zouhairi',
    phone_number: '+212600000000',
    city: 'Kénitra',
    problem: 'Urgences dentaires',
    problem_details: 'douleur à une molaire',
    urgency: 'haute',
    appointment_date: '2026-10-16',
    appointment_time: '11:00',
  })
  assert.equal(read.answer, 'yes')
  assert.equal(read.bookingRequest, true)
  assert.equal(read.hasFields, true)

  const invented = normalizeBookingUnderstanding({
    full_name: 'Patient 123',
    phone: '12345',
    service: 'Chirurgie cardiaque',
    reason: null,
    time: '27:00',
    answer: 'maybe',
  }, { now: NOW })
  assert.deepStrictEqual(Object.values(invented.fields).filter(Boolean), [], 'invalid values are dropped, never stored')
  assert.equal(invented.answer, null)
  assert.equal(invented.hasFields, false)
}

function testBookingOnlyStartsOnEvidenceFromTheConversation() {
  const request = (booking, options) => normalizeBookingUnderstanding({ booking }, options).bookingRequest
  assert.equal(request('accepted_offer', { assistantOfferedBooking: true }), true)
  assert.equal(request('accepted_offer', { assistantOfferedBooking: false }), false, 'no offer was made: "oui" is not a booking')
  assert.equal(request('explicit_request', { patientMentionsAppointment: true }), true)
  assert.equal(request('explicit_request', { patientMentionsAppointment: false }), false, 'a pain alone does not open the booking')
  assert.equal(request(null, { assistantOfferedBooking: true, patientMentionsAppointment: true }), false)

  const offered = (content) => assistantOfferedAppointment([{ role: 'assistant', content }])
  for (const offer of [
    'Wach bghiti nakhdo lik rendez-vous ?',
    'wach bghiti t7jez mwa3id m3a Dr Hamza ?',
    'واش بغيتي ناخدو ليك موعد؟',
    'Would you like to book an appointment?',
  ]) assert.equal(offered(offer), true, offer)
  assert.equal(offered('Lah ychafik.'), false)
  assert.equal(assistantOfferedAppointment([]), false)
}

async function testUnderstandingPromptCarriesContextButNoStoredDetails() {
  const calls = []
  const provider = {
    isConfigured: () => true,
    async generateStructured(request) {
      calls.push(request)
      return { data: { booking: null, answer: null, time: '11:00', language: 'darija', script: 'latin' } }
    },
  }
  const read = await understandBookingTurn({
    provider,
    userText: '11',
    now: NOW,
    stage: 'awaiting_form',
    awaitingField: 'bulk',
    missing: ['appointment'],
    lead: { full_name: 'Salim Zouhairi', phone_number: '+212600000000', city: 'Kénitra', appointment_date: '2026-10-16' },
    history: [{ role: 'assistant', content: 'M3a ch7al f sa3a ?' }],
  })
  assert.equal(read.fields.appointment_time, '11:00')
  const prompt = calls[0].messages[0].content
  assert.match(prompt, /mercredi 2026-10-14/)
  assert.match(prompt, /M3a ch7al f sa3a/)
  assert.match(prompt, /"date": true/)
  assert.ok(!prompt.includes('Salim Zouhairi') && !prompt.includes('212600000000'), 'the stored name and phone stay out of the prompt')

  const failing = { isConfigured: () => true, generateStructured: async () => { throw new Error('503') } }
  assert.equal((await understandBookingTurn({ provider: failing, userText: 'oui' })).ok, false)
  assert.equal((await understandBookingTurn({ provider: null, userText: 'oui' })).ok, false)
}

function testReplyStyleFollowsLanguageAndScript() {
  assert.equal(resolveReplyStyle({ language: 'darija', text: 'Darssa katderni' }), 'darija_latin')
  assert.equal(resolveReplyStyle({ language: 'darija', text: 'بغيت موعد' }), 'darija_arabic')
  assert.equal(
    resolveReplyStyle({ language: 'darija', text: '11', history: [{ role: 'user', content: 'salam bghit rdv' }] }),
    'darija_latin',
    'a number keeps the script used so far',
  )
  assert.equal(
    resolveReplyStyle({ language: 'darija', text: 'Oui', history: [{ role: 'user', content: 'dersa katderni' }] }),
    'darija_latin',
    '"Oui" does not turn a Darija conversation into French',
  )
  assert.equal(resolveReplyStyle({ language: 'fr', text: 'Bonjour, je voudrais un rendez-vous' }), 'fr')
  assert.equal(resolveReplyStyle({ language: 'fr', text: 'Hello, I want an appointment please' }), 'en')
  assert.equal(resolveReplyStyle({ language: 'fr', text: 'ok', previousStyle: 'en' }), 'en')
  assert.equal(resolveReplyStyle({ language: 'fr', text: 'Merci, je vous remercie', previousStyle: 'en' }), 'fr')

  assert.equal(isReplyInStyle('Chno smitek ?', 'darija_latin'), true)
  assert.equal(isReplyInStyle('شنو سميتك؟', 'darija_latin'), false)
  assert.equal(isReplyInStyle('شنو سميتك؟', 'darija_arabic'), true)
  assert.equal(isReplyInStyle('Chno smitek ?', 'darija_arabic'), false)

  assert.doesNotMatch(buildSafeFallback({ language: 'darija', style: 'darija_latin' }), /[؀-ۿ]/)
  assert.match(buildSafeFallback({ language: 'darija' }), /[؀-ۿ]/)
}

function testOneQuestionAtATime() {
  const template = 'Il me manque :\n• téléphone\n• ville\n• jour et heure\nHoraires : lun–ven 10:30→19:00.'
  assert.equal(
    collectionBrief({ missing: ['full_name', 'phone_number', 'city'], entry: true }, {}, template),
    'Très bien, je prépare votre rendez-vous. Quel est votre nom complet (prénom et nom) ?',
  )
  assert.equal(
    collectionBrief({ missing: ['phone_number', 'city'], justFilled: ['full_name'] }, {}, template),
    'Merci, c’est noté. Quel est votre numéro de téléphone ?',
  )
  const askTime = collectionBrief({ missing: ['appointment'], justFilled: ['city'] }, { appointment_date: '2026-10-16' }, template)
  assert.match(askTime, /À quelle heure souhaitez-vous venir \?/)
  assert.match(askTime, /10:30→19:00/, 'opening hours come with the question about the time')
  assert.equal(collectionBrief({ missing: ['full_name'], rejectedName: true }, {}, template), null, 'a refused name keeps its explanation')
  assert.equal(collectionBrief(null, {}, template), null)
}

function testRewordingGuard() {
  const recap = 'Nom: Salim Zouhairi\nTéléphone: +212 6 00 00 00 00\nDate: 16/10/2026\nHeure: 11:00'
  const facts = { date: '16/10/2026', time: '11:00' }
  const problem = (rewritten, extra = {}) => rewordingProblem({ original: recap, rewritten, style: 'darija_latin', facts, ...extra })
  assert.equal(problem('Smya: Salim Zouhairi\nTel: +212 6 00 00 00 00\nNhar: 16/10/2026\nSa3a: 11:00'), null)
  assert.equal(problem('Smya: Salim Zouhairi\nTel: +212 6 00 00 00 00\nNhar: 16/10/2026\nSa3a: 11:30'), 'time_invented')
  assert.equal(problem('Smya: Salim Zouhairi\nTel: +212 6 00 00 00 00\nNhar: 17/10/2026\nSa3a: 11:00'), 'date_dropped')
  assert.equal(problem('Smya: Salim Zouhairi\nNhar: 16/10/2026\nSa3a: 11:00'), 'phone_dropped')
  assert.equal(problem('Smya: Salim Zouhairi\nTel: +212 6 00 00 00 00\nNhar: 16/10/2026'), 'time_dropped')
  assert.equal(problem('الاسم: سليم\n+212 6 00 00 00 00\n16/10/2026\n11:00'), 'wrong_script')

  // The appointment's own date may be mentioned even when the message to reword omits it.
  assert.equal(rewordingProblem({
    original: 'Merci, c’est noté. À quelle heure souhaitez-vous venir ?',
    rewritten: 'Chokran, nhar 16/10 mzyan. M3a ch7al f sa3a ?',
    style: 'darija_latin',
    facts: { date: '16/10/2026' },
  }), null)

  const menu = '1. Salim Zouhairi\n2. Nouvelle personne'
  assert.equal(rewordingProblem({ original: menu, rewritten: '1. Salim Zouhairi\n2. Chi wa7ed jdid', style: 'darija_latin' }), null)
  assert.equal(rewordingProblem({ original: menu, rewritten: 'Salim Zouhairi wla chi wa7ed jdid ?', style: 'darija_latin' }), 'menu_changed')

  const slots = 'Créneau pris. Disponibles : 11:30, 12:30'
  assert.equal(rewordingProblem({ original: slots, rewritten: 'Had lw9t mchdoud. Kayn 11:30', style: 'darija_latin', requireAllTimes: true }), 'time_dropped')
}

async function testUnfaithfulRewordingFallsBackToTheTemplate() {
  const template = ['Date : 16/10/2026\nHeure : 11:00']
  const providerReturning = (...texts) => {
    let call = 0
    const prompts = []
    return {
      calls: () => call,
      prompts: () => prompts,
      isConfigured: () => true,
      async generateChatResponse(request) {
        prompts.push(request.messages[0].content)
        const text = texts[Math.min(call, texts.length - 1)]
        call += 1
        if (text instanceof Error) throw text
        return { text }
      },
    }
  }
  const args = { replies: template, style: 'darija_latin', facts: { date: '16/10/2026', time: '11:00' } }

  const good = providerReturning('Nhar : 16/10/2026\nSa3a : 11:00')
  assert.deepStrictEqual(await phraseWorkflowReplies({ ...args, provider: good }), { replies: ['Nhar : 16/10/2026\nSa3a : 11:00'], phrased: true, reason: null })

  const corrected = providerReturning('Nhar : 16/10/2026\nSa3a : 12:00', 'Nhar : 16/10/2026\nSa3a : 11:00')
  assert.equal((await phraseWorkflowReplies({ ...args, provider: corrected })).phrased, true, 'a second attempt may fix the rewording')
  assert.equal(corrected.calls(), 2)
  assert.doesNotMatch(corrected.prompts()[0], /REMARQUE/)
  assert.match(corrected.prompts()[1], /REMARQUE : ta réponse précédente a été refusée car elle contenait une heure absente du MESSAGE/)

  const wrong = providerReturning('Nhar : 16/10/2026\nSa3a : 12:00')
  assert.deepStrictEqual(await phraseWorkflowReplies({ ...args, provider: wrong }), { replies: template, phrased: false, reason: 'time_invented' })

  const down = providerReturning(new Error('503'))
  assert.deepStrictEqual(await phraseWorkflowReplies({ ...args, provider: down }), { replies: template, phrased: false, reason: 'provider_error' })
  assert.equal((await phraseWorkflowReplies({ ...args, provider: null })).phrased, false)
}

function testUnbackedConfirmationsAreDetected() {
  for (const claim of [
    'Votre rendez-vous est confirmé pour vendredi.',
    'Votre rendez-vous a bien été enregistré.',
    'J\'ai enregistré votre rendez-vous.',
    'Your appointment is confirmed.',
    'تم تسجيل الموعد ديالك.',
    'rdv dyalek tsjjel',
  ]) assert.equal(claimsAppointmentRecorded(claim), true, claim)
  for (const harmless of [
    'Souhaitez-vous prendre rendez-vous ?',
    'Votre rendez-vous sera confirmé par le cabinet.',
    'Wach bghiti nakhdo lik rendez-vous ?',
    'واش بغيتي ناخدو ليك موعد؟',
    'Would you like to book an appointment?',
  ]) assert.equal(claimsAppointmentRecorded(harmless), false, harmless)
}

function testAnHourIsNotAListNumber() {
  const slots = ['10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']
  const pick = (input) => parseAvailableSlotSelection({ input, candidateSlots: slots }).selectedTime
  assert.equal(pick('11'), '11:00', '"11" means eleven o\'clock when 11:00 is offered, not the eleventh line')
  assert.equal(pick('15'), '15:00')
  assert.equal(pick('2'), '11:00', 'a small number is still the line number')
  assert.equal(pick('3'), '11:30')
  assert.equal(pick('11:30'), '11:30')
}

async function testWorkflowUsesTheAiReading() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-booking-understanding-'))
  const silenced = console.log
  console.log = () => {}
  try {
    const day = futureWeekday(3)
    const crm = createCrmService({ dbPath: path.join(tempDir, 'crm.sqlite') })
    const conversationId = 'main:212600000050@c.us'
    const send = (userText, aiTurn = null) => crm.processCrmTurn({
      conversationId,
      chatId: '212600000050@c.us',
      userText,
      languageHint: 'fr',
      aiTurn,
    })
    const reading = (overrides) => ({
      ok: true, bookingRequest: false, answer: null, isQuestion: false, hasFields: false, fields: {}, ...overrides,
    })

    // "Oui" to the assistant's offer opens the booking and brings the reason given earlier.
    let turn = await send('Oui', reading({
      bookingRequest: true,
      answer: 'yes',
      hasFields: true,
      fields: { problem: 'Urgences dentaires', problem_details: 'douleur dentaire', urgency: 'haute' },
    }))
    assert.equal(turn.lead.stage, 'awaiting_form')
    assert.equal(turn.lead.problem, 'Urgences dentaires')
    assert.equal(turn.collection.missing[0], 'full_name')
    assert.equal(turn.collection.entry, true)

    turn = await send('Salim Zouhairi', reading({ hasFields: true, fields: { full_name: 'Salim Zouhairi' } }))
    assert.equal(turn.lead.full_name, 'Salim Zouhairi')

    // A bare "oui" during the collection is an answer, not an incomplete name: with or without AI.
    for (const aiTurn of [null, reading({ answer: 'yes' })]) {
      turn = await send('oui', aiTurn)
      assert.equal(turn.lead.full_name, 'Salim Zouhairi')
      assert.doesNotMatch(turn.forceReply, /nom complet \(prénom \+ nom de famille\)/, 'no "send your full name" error on "oui"')
      assert.equal(turn.collection.rejectedName, false)
    }

    turn = await send('0600000000')
    turn = await send('Kenitra', reading({ hasFields: true, fields: { city: 'Kénitra' } }))
    assert.equal(turn.lead.city, 'Kénitra')
    assert.deepStrictEqual(turn.collection.missing, ['appointment'])

    turn = await send(day.display.slice(0, 5), reading({ hasFields: true, fields: { appointment_date: day.iso } }))
    assert.equal(turn.lead.appointment_date, day.iso)
    assert.equal(turn.lead.stage, 'awaiting_form')

    // "11" alone is unreadable for the regexes; the AI reading supplies the time.
    turn = await send('11', reading({ hasFields: true, fields: { appointment_time: '11:00' } }))
    assert.equal(turn.lead.appointment_time, '11:00')
    assert.equal(turn.lead.stage, 'confirmation')
    assert.equal(crm.repo.getCrmStats().appointments, 0)

    // A yes with a detail attached is not a bare confirmation.
    turn = await send('wakha walakin m3a 12', reading({ answer: 'yes', hasFields: true, fields: { appointment_time: '12:00' } }))
    assert.equal(turn.booking, null, 'a "yes, but…" never saves the appointment as it stands')

    // A plain yes in the patient's own words confirms the summary.
    turn = await send('wakha', reading({ answer: 'yes' }))
    assert.ok(turn.booking, 'the appointment is saved on a plain yes read by the AI')
    assert.equal(crm.repo.getCrmStats().appointments, 1)
  } finally {
    console.log = silenced
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

async function testAfternoonHourComesFromTheContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-booking-afternoon-'))
  const silenced = console.log
  console.log = () => {}
  try {
    const day = futureWeekday(3)
    const crm = createCrmService({ dbPath: path.join(tempDir, 'crm.sqlite') })
    // The regexes read "m3a 3" as 03:00; in "3 dyal l3chiya" the AI reads three in the afternoon.
    const turn = await crm.processCrmTurn({
      conversationId: 'main:212600000051@c.us',
      chatId: '212600000051@c.us',
      userText: `bghit rdv nhar ${day.display.slice(0, 5)} m3a 3 dyal l3chiya`,
      languageHint: 'darija',
      aiTurn: {
        ok: true,
        bookingRequest: true,
        answer: null,
        isQuestion: false,
        hasFields: true,
        fields: { appointment_date: day.iso, appointment_time: '15:00' },
      },
    })
    assert.equal(turn.lead.appointment_time, '15:00')
    assert.equal(turn.lead.appointment_date, day.iso)
  } finally {
    console.log = silenced
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

async function testASlowAiNeverHoldsTheTurn() {
  const never = new Promise(() => {})
  await assert.rejects(withDeadline(never, 20), (error) => error.code === 'AI_DEADLINE_EXCEEDED')
  assert.equal(await withDeadline(Promise.resolve('fast'), 1000), 'fast')

  const stuck = { isConfigured: () => true, generateChatResponse: () => never, generateStructured: () => never }
  const reworded = await phraseWorkflowReplies({ provider: stuck, replies: ['Quel est votre nom ?'], style: 'fr', deadlineMs: 30 })
  assert.deepStrictEqual(reworded, { replies: ['Quel est votre nom ?'], phrased: false, reason: 'provider_error' })
  assert.equal((await understandBookingTurn({ provider: stuck, userText: 'oui', deadlineMs: 30 })).ok, false)
}

async function run() {
  testDatesAreResolvedByCodeNotByTheModel()
  testModelOutputIsValidated()
  testBookingOnlyStartsOnEvidenceFromTheConversation()
  await testUnderstandingPromptCarriesContextButNoStoredDetails()
  testReplyStyleFollowsLanguageAndScript()
  testOneQuestionAtATime()
  testRewordingGuard()
  await testUnfaithfulRewordingFallsBackToTheTemplate()
  testUnbackedConfirmationsAreDetected()
  testAnHourIsNotAListNumber()
  await testWorkflowUsesTheAiReading()
  await testAfternoonHourComesFromTheContext()
  await testASlowAiNeverHoldsTheTurn()

  console.log('booking-understanding-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
