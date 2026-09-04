/**
 * Darija NLU regression corpus (Arabizi + Arabic + FR mix).
 * Run: npm run test:darija-understanding
 */
const assert = require('assert')
const {
  classifyIntent,
  routePatientMessage,
  normalizeDarijaForNlu,
  isProtectedToken,
} = require('../src/voice-nlu')
const { hasExplicitBookingIntent: bookingHint } = require('../src/voice-nlu/intent-table')
const { parseBinaryConfirmation, parseYesNoReply } = require('../src/crm/binary-confirmation')
const { extractAppointment } = require('../src/crm/extract')
const { parseAvailabilityDate } = require('../src/crm/smart/availability-date')
const { parseAvailableSlotSelection } = require('../src/crm/smart/availability-slot-select')
const { detectAvailabilityIntent } = require('../src/crm/smart/availability-flow')

function expectIntent(text, intent, opts = {}) {
  const hit = classifyIntent(text, opts)
  assert.strictEqual(
    hit.intent,
    intent,
    `classifyIntent("${text}") => ${hit.intent} (expected ${intent}, conf=${hit.confidence}, matched=${hit.matched})`,
  )
  if (opts.minConfidence != null) {
    assert.ok(hit.confidence >= opts.minConfidence, `low conf for "${text}": ${hit.confidence}`)
  }
  return hit
}

function expectNotIntent(text, badIntent) {
  const hit = classifyIntent(text)
  assert.notStrictEqual(hit.intent, badIntent, `"${text}" must not be ${badIntent} (got ${hit.intent})`)
  return hit
}

function tomorrowIso(now = new Date()) {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const INTENT_CASES = [
  // Mandatory §19
  { text: '3afak bghit nakhod rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'bghit rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'wach kayn chi blassa ghdda', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chno kayn mn rendez-vous nhar 05/09', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chno les rdv dyali', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'wach 3ndi chi rdv', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'bghit nlghi rdv dyali', intent: 'CANCEL_APPOINTMENT' },
  { text: '3ndi wja3 f drssa', intent: 'DENTAL_PAIN' },
  { text: 'fin kaynin', intent: 'ASK_LOCATION' },
  { text: 'fo9ach kat7ello', intent: 'ASK_OPENING_HOURS' },
  { text: 'ch7al taman detartrage', intent: 'ASK_PRICE' },
  { text: 'wach katdiro implant', intent: 'ASK_SERVICES' },
  { text: 'je veux nchof chno kayn demain', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'wach disponible samedi', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'شنو كاين من موعد غدا', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'بغيت ناخد موعد', intent: 'BOOK_APPOINTMENT' },
  { text: 'شنو المواعيد ديالي', intent: 'LIST_MY_APPOINTMENTS' },

  // Orthographic variants
  { text: 'chno kayn ghdda', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chnou kayn ghdda', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chnoo kayn rdv', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'ach kayn mn rdv', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'شنو كاين غدا', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'bghiiit rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'brit rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'baghi rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'بغيت موعد', intent: 'BOOK_APPOINTMENT' },
  { text: '3afak bghit rendez vous', intent: 'BOOK_APPOINTMENT' },
  { text: 'khasni rdv', intent: 'BOOK_APPOINTMENT' },

  // FR + Darija
  { text: '3afak bghit rendez-vous demain', intent: 'BOOK_APPOINTMENT' },
  { text: 'bghit rdv pour détartrage', intent: 'BOOK_APPOINTMENT' },
  { text: 'chno les horaires dyalkom', intent: 'ASK_OPENING_HOURS' },
  { text: 'annuler lia rdv dyali', intent: 'CANCEL_APPOINTMENT' },
  { text: 'bghit nchof les disponibilités', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },

  // FAQ / pain / thanks / greeting
  { text: 'slm', intent: 'GREETING' },
  { text: 'salam 3likom', intent: 'GREETING' },
  { text: 'سلام عليكم', intent: 'GREETING' },
  { text: 'chokran', intent: 'THANKS' },
  { text: 'merci bzaf', intent: 'THANKS' },
  { text: 'darsa katwja3ni', intent: 'DENTAL_PAIN' },
  { text: 'عندي وجع فالضرس', intent: 'DENTAL_PAIN' },
  { text: '3tini localisation', intent: 'ASK_LOCATION' },
  { text: 'فين كاين المركز', intent: 'ASK_LOCATION' },
  { text: 'combien detartrage', intent: 'ASK_PRICE' },
  { text: 'بشحال', intent: 'ASK_PRICE' },
  { text: 'واش حالين السبت', intent: 'ASK_OPENING_HOURS' },
  { text: 'bghit nbdl lwa9t', intent: 'RESCHEDULE_APPOINTMENT' },
  { text: 'بغيت نبدل الموعد', intent: 'RESCHEDULE_APPOINTMENT' },
  { text: 'بغيت نلغي الموعد', intent: 'CANCEL_APPOINTMENT' },
  { text: 'wach 3andi chi rdv', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'bghit nchof rendez-vous dyali', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'mes rdv', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'Ach katdirou', intent: 'ASK_SERVICES' },
  { text: 'Chno kayn 3andkom', intent: 'ASK_SERVICES' },
  { text: 'Quels sont vos services', intent: 'ASK_SERVICES' },

  // More availability
  { text: 'wach kayn chi rdv ghdda', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'واش كاين شي موعد غدا', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chno kayn nhar sebt', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'bghit nchof chno kayn', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'horaires disponibles', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },

  // Extra natural WhatsApp
  { text: 'afak bghit rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'aafak bghit nakhod rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'wash kayn chi blassa ghedda', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chno kayn lyoum', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'fin jay cabinet', intent: 'ASK_LOCATION' },
  { text: 'lah y3tik sa7a', intent: 'THANKS' },
  { text: '3andi urgence', intent: 'DENTAL_EMERGENCY' },
  { text: 'momkin n7wel rdv l nhar akhor', intent: 'RESCHEDULE_APPOINTMENT' },
  { text: 'ma9darch nji bghit n annuler', intent: 'CANCEL_APPOINTMENT' },
  { text: 'rdv dyali', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'chno rdv dyali', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'je voudrais un rdv', intent: 'BOOK_APPOINTMENT' },
  { text: 'prendre rendez-vous', intent: 'BOOK_APPOINTMENT' },
  { text: 'quelles sont vos disponibilités', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'votre adresse', intent: 'ASK_LOCATION' },
  { text: 'quels sont vos horaires', intent: 'ASK_OPENING_HOURS' },
  { text: 'j ai mal aux dents', intent: 'DENTAL_PAIN' },
  { text: 'bonjour', intent: 'GREETING' },
  { text: 'merci beaucoup', intent: 'THANKS' },
  { text: 'bghit nalghi rdv', intent: 'CANCEL_APPOINTMENT' },
  { text: 'changer mon rdv', intent: 'RESCHEDULE_APPOINTMENT' },
  { text: '3afak chno 3andkom', intent: 'ASK_SERVICES' },
  { text: 'شنو الخدمات', intent: 'ASK_SERVICES' },
  { text: 'واش كتديرو', intent: 'ASK_SERVICES' },
  { text: 'bghit nchof les horaires disponibles', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'chno les rdv disponibles', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: '3andkom chi rdv disponible', intent: 'CHECK_APPOINTMENT_AVAILABILITY' },
  { text: 'مواعيدي', intent: 'LIST_MY_APPOINTMENTS' },
  { text: 'my appointments', intent: 'LIST_MY_APPOINTMENTS' },
]

function run() {
  let passed = 0
  const failures = []

  // --- Intent corpus ---
  for (const c of INTENT_CASES) {
    try {
      expectIntent(c.text, c.intent, { minConfidence: 0.45 })
      passed += 1
    } catch (err) {
      failures.push(err.message)
    }
  }

  // Critical distinctions
  try {
    expectNotIntent('chno les rdv dyali', 'CHECK_APPOINTMENT_AVAILABILITY')
    expectNotIntent('ch7al taman detartrage', 'BOOK_APPOINTMENT')
    expectNotIntent('wach katdiro implant', 'BOOK_APPOINTMENT')
    expectNotIntent('implant', 'BOOK_APPOINTMENT')
    passed += 4
  } catch (err) {
    failures.push(err.message)
  }

  // Router: booking flag
  try {
    const book = routePatientMessage('3afak bghit nakhod rdv')
    assert.strictEqual(book.intent, 'BOOK_APPOINTMENT')
    assert.strictEqual(book.bookAppointment, true)

    const price = routePatientMessage('ch7al taman detartrage')
    assert.strictEqual(price.intent, 'ASK_PRICE')
    assert.strictEqual(price.bookAppointment, false)

    const svc = routePatientMessage('wach katdiro implant')
    assert.strictEqual(svc.intent, 'ASK_SERVICES')
    assert.strictEqual(svc.bookAppointment, false)

    const avail = routePatientMessage('wach kayn chi blassa ghdda')
    assert.strictEqual(avail.intent, 'CHECK_APPOINTMENT_AVAILABILITY')
    assert.strictEqual(avail.bookAppointment, false)

    const mine = routePatientMessage('chno les rdv dyali')
    assert.strictEqual(mine.intent, 'LIST_MY_APPOINTMENTS')
    passed += 5
  } catch (err) {
    failures.push(`router: ${err.message}`)
  }

  // Protection: bare digits / phone / date / time
  try {
    assert.ok(isProtectedToken('3', { protectBareIndex: true }))
    assert.ok(isProtectedToken('11:30'))
    assert.ok(isProtectedToken('03/09'))
    assert.ok(isProtectedToken('+212612345678'))
    const n3 = normalizeDarijaForNlu('3', { stage: 'awaiting_available_slot_selection' })
    assert.strictEqual(n3.normalizedText, '3')
    const nPhone = normalizeDarijaForNlu('+212612345678')
    assert.ok(nPhone.normalizedText.includes('212612345678') || nPhone.normalizedText.includes('+212'))
    const nDate = normalizeDarijaForNlu('03/09')
    assert.ok(nDate.normalizedText.includes('03/09') || nDate.normalizedText.includes('03'))
    const nTime = normalizeDarijaForNlu('11:30')
    assert.ok(nTime.normalizedText.includes('11:30'))
    // Arabizi word still usable
    const nAfak = normalizeDarijaForNlu('3afak bghit rdv')
    assert.ok(nAfak.concepts.includes('please') || /3afak|afak/.test(nAfak.normalizedText))
    assert.ok(
      nAfak.concepts.includes('want')
      || nAfak.concepts.includes('appointment')
      || /bghit|vouloir|rdv|rendez/.test(nAfak.normalizedText),
    )
    passed += 9
  } catch (err) {
    failures.push(`protect: ${err.message}`)
  }

  // Slot selection context
  try {
    const slots = ['09:00', '10:00', '11:30', '15:00'].map((t, i) => ({ index: i + 1, time: t }))
    const sel3 = parseAvailableSlotSelection({ input: '3', candidateSlots: slots })
    assert.strictEqual(sel3.type, 'index')
    assert.strictEqual(sel3.index, 3)
    assert.strictEqual(sel3.selectedTime, '11:30')
    const selTime = parseAvailableSlotSelection({ input: '11:30', candidateSlots: slots })
    assert.ok(selTime.type === 'time' || selTime.type === 'index')
    assert.strictEqual(selTime.selectedTime, '11:30')
    passed += 2
  } catch (err) {
    failures.push(`slot: ${err.message}`)
  }

  // Binary confirmation
  try {
    assert.strictEqual(parseYesNoReply('ah').value, 'yes')
    assert.strictEqual(parseYesNoReply('wakha').value, 'yes')
    assert.strictEqual(parseYesNoReply('aah').value, 'yes')
    assert.strictEqual(parseYesNoReply('la').value, 'no')
    assert.strictEqual(parseYesNoReply('lla').value, 'no')
    assert.strictEqual(parseBinaryConfirmation({ text: 'واخا' }).value, 'yes')
    assert.strictEqual(parseBinaryConfirmation({ text: 'لا' }).value, 'no')
    assert.strictEqual(parseYesNoReply('ah walakin bghit nbdl lwa9t').value, 'unknown')
    passed += 8
  } catch (err) {
    failures.push(`binary: ${err.message}`)
  }

  // Relative dates
  try {
    const now = new Date(2026, 8, 3) // Wed 3 Sep 2026
    const tmr = tomorrowIso(now)
    const g1 = extractAppointment('ghdda', now)
    assert.strictEqual(g1.appointment_date, tmr)
    const g2 = extractAppointment('wach kayn chi blassa ghdda', now)
    assert.strictEqual(g2.appointment_date, tmr)
    const g3 = parseAvailabilityDate('ghdda', now)
    assert.ok(g3.valid)
    assert.strictEqual(g3.date, tmr)
    const g4 = parseAvailabilityDate('غدا', now)
    assert.ok(g4.valid)
    const named = extractAppointment('ana Yassine Amrani bghit rdv ghdda m3a 11:30', now)
    assert.strictEqual(named.appointment_date, tmr)
    assert.strictEqual(named.appointment_time, '11:30')
    const dmy = extractAppointment('rdv 05/09 m3a 11:30', now)
    assert.ok(dmy.appointment_date)
    assert.strictEqual(dmy.appointment_time, '11:30')
    passed += 6
  } catch (err) {
    failures.push(`dates: ${err.message}`)
  }

  // Entity preservation on complex booking sentence
  try {
    const hit = classifyIntent('3afak ana Yassine Amrani bghit rdv ghdda m3a 11:30')
    assert.strictEqual(hit.intent, 'BOOK_APPOINTMENT')
    const nlu = normalizeDarijaForNlu('3afak ana Yassine Amrani bghit rdv ghdda m3a 11:30')
    assert.ok(/yassine/i.test(nlu.rawText))
    assert.ok(nlu.rawText.includes('11:30'))
    assert.ok(bookingHint('3afak ana Yassine Amrani bghit rdv ghdda m3a 11:30'))
    passed += 3
  } catch (err) {
    failures.push(`entities: ${err.message}`)
  }

  // Availability detector alignment
  try {
    assert.ok(detectAvailabilityIntent('wach kayn chi blassa ghdda').matched)
    assert.ok(detectAvailabilityIntent('chno kayn mn rendez-vous nhar 05/09').matched)
    assert.ok(!detectAvailabilityIntent('chno les rdv dyali').matched)
    passed += 3
  } catch (err) {
    failures.push(`availDetect: ${err.message}`)
  }

  // Negative / ambiguous
  try {
    const bare3 = classifyIntent('3')
    assert.ok(bare3.intent === 'OTHER' || bare3.confidence < 0.7)
    const implantAlone = routePatientMessage('implant')
    assert.notStrictEqual(implantAlone.bookAppointment, true)
    passed += 2
  } catch (err) {
    failures.push(`neg: ${err.message}`)
  }

  // Explicit booking helper export sanity
  try {
    assert.ok(typeof bookingHint === 'function')
    assert.ok(bookingHint('bghit rdv'))
    assert.ok(!bookingHint('ch7al taman detartrage'))
    passed += 2
  } catch (err) {
    failures.push(`bookingHint: ${err.message}`)
  }

  console.log(`\nDarija understanding tests: ${passed} checks ok, ${INTENT_CASES.length} intent phrases`)
  if (failures.length) {
    console.error('\nFAILURES:')
    for (const f of failures) console.error(' -', f)
    process.exit(1)
  }
  console.log('darija understanding tests: passed')
}

run()
