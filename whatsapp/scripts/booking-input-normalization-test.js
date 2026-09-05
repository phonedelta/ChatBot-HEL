/**
 * Regression: booking time alternatives, Darija datetime, summary name corrections.
 * Run: npm run test:booking-input-normalization
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { createCrmService } = require('../src/crm')
const {
  normalizeTimeExpression,
  extractEmbeddedTime,
  listAvailableSlotTimes,
  checkSlotAvailability,
} = require('../src/crm/appointment-slots')
const { extractAppointment } = require('../src/crm/extract')
const { parseAvailableSlotSelection } = require('../src/crm/smart/availability-slot-select')
const {
  detectCorrectionIntent,
  detectInlineNameCorrection,
} = require('../src/crm/booking-corrections')
const { extractCustomerSignals } = require('../src/crm/extract')
const {
  unclearSummaryClarifyMessage,
  askFullNameAfterPartialCorrection,
} = require('../src/crm/booking-confirmation-flow')

function tomorrowIso(now) {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function assertTime(input, expected) {
  const hit = normalizeTimeExpression(input)
  assert.ok(hit, `expected time for "${input}"`)
  assert.strictEqual(hit.normalized, expected, `"${input}" => ${hit.normalized}`)
}

async function run() {
  let passed = 0

  // --- Bulk Darija latin: exact production message ---
  const bulkMsg = 'Ok bghit ndir ta9wim f nhar 07/09 11:30 smiti Salim Zouhairi w sakn f Casa nemra dial tele : 0602269407'
  const bulkSig = extractCustomerSignals(bulkMsg, { now: new Date('2026-09-05T10:00:00') })
  assert.strictEqual(bulkSig.full_name, 'Salim Zouhairi', 'bulk name')
  assert.strictEqual(bulkSig.city, 'Casablanca', 'bulk city sakn f Casa')
  assert.ok(bulkSig.phone_number && /602269407/.test(bulkSig.phone_number), 'bulk phone')
  assert.strictEqual(bulkSig.problem, 'Orthodontie', 'bulk ta9wim → Orthodontie')
  assert.strictEqual(bulkSig.appointment_date, '2026-09-07', 'bulk date 07/09')
  assert.strictEqual(bulkSig.appointment_time, '11:30', 'bulk time')
  assert.strictEqual(detectCorrectionIntent(bulkMsg).isCorrection, false, 'bulk must not be correction')
  passed += 7

  assert.strictEqual(extractCustomerSignals('sakn f Casa').city, 'Casablanca')
  assert.strictEqual(extractCustomerSignals('smiti Salim Zouhairi').full_name, 'Salim Zouhairi')
  assert.ok(/602269407/.test(extractCustomerSignals('nemra dial tele : 0602269407').phone_number || ''))
  assert.strictEqual(extractCustomerSignals('bghit ndir ta9wim').problem, 'Orthodontie')
  assert.strictEqual(extractCustomerSignals('Ta9wim').problem, 'Orthodontie')
  passed += 5

  // --- Time normalizer ---
  for (const [raw, expected] of [
    ['12h30', '12:30'],
    ['12 h 30', '12:30'],
    ['12:30', '12:30'],
    ['12H30', '12:30'],
    ['14h', '14:00'],
    ['14 h', '14:00'],
    ['11h', '11:00'],
    ['m3a 14h', '14:00'],
    ['à 11h', '11:00'],
  ]) {
    assertTime(raw, expected)
    passed += 1
  }
  assert.strictEqual(normalizeTimeExpression('3'), null)
  assert.strictEqual(normalizeTimeExpression('+212612345678'), null)
  assert.strictEqual(normalizeTimeExpression('03/09'), null)
  assert.strictEqual(normalizeTimeExpression('05/09/2026'), null)
  passed += 4

  // --- Slot selection formats ---
  const candidates = ['10:30', '12:00', '12:30']
  for (const input of ['12h30', '12 h 30', '12:30', '12H30']) {
    const sel = parseAvailableSlotSelection({ input, candidateSlots: candidates })
    assert.strictEqual(sel.selectedTime, '12:30', input)
    assert.notStrictEqual(sel.type, 'invalid')
    passed += 1
  }
  const byIndex = parseAvailableSlotSelection({ input: '3', candidateSlots: candidates })
  assert.strictEqual(byIndex.type, 'index')
  assert.strictEqual(byIndex.selectedTime, '12:30')
  passed += 1

  // --- Darija relative dates ---
  const now = new Date('2026-09-03T10:00:00')
  const tmr = tomorrowIso(now)
  for (const text of [
    'Ghda m3a 14h',
    'ghdda m3a 14h',
    'gheda 14h',
    'غدا مع 14',
    'غدا مع 14:00',
    'Demain à 11h',
  ]) {
    const appt = extractAppointment(text, now)
    assert.strictEqual(appt?.appointment_date, tmr, `date for "${text}"`)
    assert.ok(appt?.appointment_time, `time for "${text}"`)
    passed += 1
  }
  assert.strictEqual(extractAppointment('Ghda m3a 14h', now).appointment_time, '14:00')
  assert.strictEqual(extractAppointment('Demain à 11h', now).appointment_time, '11:00')
  assert.strictEqual(extractAppointment('gheda 14h', now).appointment_time, '14:00')
  passed += 3

  // --- Name corrections ---
  const full = detectCorrectionIntent('Smyti Issam Alaoui')
  assert.ok(full.isCorrection)
  assert.strictEqual(full.fields.full_name, 'Issam Alaoui')
  passed += 1

  const full2 = detectInlineNameCorrection("Mon nom c'est Issam Alaoui")
  assert.strictEqual(full2.type, 'complete')
  assert.strictEqual(full2.fullName, 'Issam Alaoui')
  passed += 1

  const inc = detectInlineNameCorrection('Smyti issam')
  assert.strictEqual(inc.type, 'incomplete')
  assert.ok(inc.candidate)
  passed += 1

  const inc2 = detectInlineNameCorrection("Mon nom c'est Issam")
  assert.strictEqual(inc2.type, 'incomplete')
  passed += 1

  assert.ok(!/annul/i.test(unclearSummaryClarifyMessage('fr')))
  assert.ok(/OUI|oui/i.test(unclearSummaryClarifyMessage('fr')))
  assert.ok(/اسم|نسب/.test(askFullNameAfterPartialCorrection('darija')))
  passed += 2

  // --- End-to-end CRM: slot alternative "12h30" ---
  const dbPath = path.join(os.tmpdir(), `booking-norm-${Date.now()}.sqlite`)
  try { fs.unlinkSync(dbPath) } catch { /* */ }
  const crm = createCrmService({ dbPath })
  const chatId = '212677700901@c.us'
  const conversationId = `main:${chatId}`

  // Find a bookable weekday within horizon
  const base = new Date('2026-09-08T09:00:00') // Tuesday
  const dateIso = '2026-09-17' // Thu within horizon from ~Sep 4-8
  const times = listAvailableSlotTimes(crm.db, dateIso, { limit: 12, now: base })
  assert.ok(times.length >= 3, `need free slots on ${dateIso}, got ${times.length}`)
  const busy = times[0]
  const altA = times[1]
  // Occupy first slot with a real customer row
  const blockerId = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, created_at)
    VALUES ('Blocker Slot', '+212600000001', 'Rabat', datetime('now'))
  `).run().lastInsertRowid
  crm.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, created_at
    ) VALUES (?, ?, ?, 'confirmed', datetime('now'))
  `).run(blockerId, dateIso, busy)

  let turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: [
      'Nom : Ndi Dersa Kadrni',
      'Téléphone : 0611223344',
      'Ville : Rabat',
      'Problème : Bghit ndir nettoyage',
      `Rendez-vous : ${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}/2026 à ${busy}`,
    ].join('\n'),
    languageHint: 'fr',
  })
  // Should propose alternatives and keep date
  assert.ok(
    /Créneaux possibles|plus disponible|déjà réservé/i.test(turn.forceReply || ''),
    turn.forceReply,
  )
  assert.strictEqual(turn.lead.appointment_date, dateIso)
  assert.strictEqual(turn.lead.awaiting_field, 'slot_alternative')
  assert.ok(!/uniquement[\s\S]*Jour et heure/i.test(turn.forceReply || ''))
  passed += 3

  // Pick alternative with 12h-style if altB is HH:30, else use HH:mm of altA as "XhYY"
  const pick = altA
  const [hh, mm] = pick.split(':')
  const natural = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`
  turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: natural,
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.appointment_date, dateIso, 'date preserved after alt pick')
  assert.strictEqual(turn.lead.appointment_time, pick)
  assert.notStrictEqual(turn.lead.awaiting_field, 'slot_alternative')
  assert.ok(
    turn.lead.stage === 'confirmation' || turn.lead.full_name,
    'draft preserved / advanced',
  )
  assert.ok(!/Pour compléter votre demande[\s\S]*Jour et heure/i.test(turn.forceReply || ''))
  passed += 4

  // Summary name correction: incomplete then complete
  // Ensure we are on confirmation
  if (turn.lead.stage !== 'confirmation') {
    // force summary if still collecting somehow
    const checkLead = turn.lead
    if (checkLead.appointment_date && checkLead.appointment_time && checkLead.full_name) {
      /* ok */
    }
  }

  // Create a clean confirmation lead path
  const chat2 = '212677700902@c.us'
  const conv2 = `main:${chat2}`
  const freeTimes = listAvailableSlotTimes(crm.db, dateIso, { limit: 12, now: base })
    .filter((t) => t !== busy && t !== pick)
  assert.ok(freeTimes.length, 'need another free slot')
  const free = freeTimes[0]

  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: [
      'Nom : Ndi Dersa Kadrni',
      'Téléphone : 0611334455',
      'Ville : Rabat',
      'Problème : détartrage',
      `Rendez-vous : ${dateIso.slice(8, 10)}/${dateIso.slice(5, 7)}/2026 à ${free}`,
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.strictEqual(turn.lead.stage, 'confirmation')
  const phoneBefore = turn.lead.phone_number
  const dateBefore = turn.lead.appointment_date
  const timeBefore = turn.lead.appointment_time

  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'Smyti issam',
    languageHint: 'fr',
  })
  assert.ok(!/annuler cette demande/i.test(turn.forceReply || ''), turn.forceReply)
  assert.ok(
    /prénom et votre nom|الاسم الكامل|الاسم والنسب/i.test(turn.forceReply || ''),
    turn.forceReply,
  )
  assert.strictEqual(turn.lead.phone_number, phoneBefore)
  assert.strictEqual(turn.lead.appointment_date, dateBefore)
  assert.strictEqual(turn.lead.appointment_time, timeBefore)
  passed += 4

  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'Issam Alaoui',
    languageHint: 'fr',
  })
  assert.ok(/Issam Alaoui/i.test(turn.forceReply || turn.lead.full_name || ''))
  assert.strictEqual(turn.lead.full_name, 'Issam Alaoui')
  assert.strictEqual(turn.lead.phone_number, phoneBefore)
  assert.strictEqual(turn.lead.appointment_date, dateBefore)
  assert.strictEqual(turn.lead.appointment_time, timeBefore)
  assert.ok(!/annuler cette demande/i.test(turn.forceReply || ''))
  passed += 5

  // Unknown input must not auto-cancel
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'att',
    languageHint: 'fr',
  })
  assert.ok(!/annuler cette demande/i.test(turn.forceReply || ''), turn.forceReply)
  assert.ok(/modifier|corriger|اسم|صحيح/i.test(turn.forceReply || ''), turn.forceReply)
  passed += 2

  // Explicit cancel
  turn = await crm.processCrmTurn({
    conversationId: conv2,
    chatId: chat2,
    userText: 'bghit nlghi had rdv',
    languageHint: 'darija',
  })
  assert.ok(/تلغي|annul/i.test(turn.forceReply || ''), turn.forceReply)
  assert.strictEqual(turn.lead.awaiting_field, 'draft_cancel_confirm')
  passed += 2

  // --- Exact production bulk message through workflow ---
  const chatBulk = '212677700903@c.us'
  const convBulk = `main:${chatBulk}`
  turn = await crm.processCrmTurn({
    conversationId: convBulk,
    chatId: chatBulk,
    userText: 'Bghit rendez vous',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: convBulk,
    chatId: chatBulk,
    userText: bulkMsg,
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi', turn.lead.full_name)
  assert.strictEqual(turn.lead.city, 'Casablanca', turn.lead.city)
  assert.ok(turn.lead.phone_number && /602269407/.test(turn.lead.phone_number))
  assert.strictEqual(turn.lead.problem, 'Orthodontie')
  assert.strictEqual(turn.lead.appointment_date, '2026-09-07')
  assert.strictEqual(turn.lead.appointment_time, '11:30')
  assert.ok(
    turn.lead.stage === 'confirmation' || turn.lead.awaiting_field === 'slot_alternative',
    `expected confirmation or alternatives, got stage=${turn.lead.stage} awaiting=${turn.lead.awaiting_field}`,
  )
  const bulkReply = (turn.replies || [turn.forceReply]).filter(Boolean).join(' ')
  assert.ok(!/باقي خاصني|il me manque|still need/i.test(bulkReply), 'must not re-ask missing fields')
  assert.ok(/ملخص|récapitulatif|Résumé|واش هاد المعلومات|ces informations/i.test(bulkReply), bulkReply.slice(0, 200))
  passed += 8

  // Ta9wim alone while collecting must set Orthodontie (not services catalogue)
  const chatTa9 = '212677700904@c.us'
  turn = await crm.processCrmTurn({
    conversationId: `main:${chatTa9}`,
    chatId: chatTa9,
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  turn = await crm.processCrmTurn({
    conversationId: `main:${chatTa9}`,
    chatId: chatTa9,
    userText: 'Ta9wim',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.problem, 'Orthodontie')
  assert.ok(!/services disponibles|الخدمات المتوفرة/i.test(
    (turn.replies || [turn.forceReply]).join(' '),
  ))
  passed += 2

  // "Shkon nta" then booking must NOT seed fullName
  const chatShkon = '212677700905@c.us'
  turn = await crm.processCrmTurn({
    conversationId: `main:${chatShkon}`,
    chatId: chatShkon,
    userText: 'Shkon nta',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: `main:${chatShkon}`,
    chatId: chatShkon,
    userText: 'Bghit maw3id',
    languageHint: 'darija',
    voiceIntent: 'BOOK_APPOINTMENT',
    router: { intent: 'BOOK_APPOINTMENT', bookAppointment: true, intentConfidence: 0.93 },
  })
  assert.ok(!turn.lead.full_name, `fullName must stay empty, got ${turn.lead.full_name}`)
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  assert.ok(/الاسم الكامل|nom complet/i.test((turn.replies || [turn.forceReply]).join(' ')))
  passed += 3

  // Date/time natural forms
  const nowDt = new Date('2026-09-05T12:00:00')
  assert.strictEqual(extractAppointment('nhar tlat m3a 11:30', nowDt).appointment_date, '2026-09-08')
  assert.strictEqual(extractAppointment('nhar tlat m3a 11:30', nowDt).appointment_time, '11:30')
  assert.strictEqual(extractAppointment('ghda m3a 14h', nowDt).appointment_date, '2026-09-06')
  assert.strictEqual(extractAppointment('ghda m3a 14h', nowDt).appointment_time, '14:00')
  assert.strictEqual(extractAppointment('07/09 11h30', nowDt).appointment_time, '11:30')
  assert.ok(extractAppointment('mardi 09/09', nowDt)?.date_weekday_mismatch)
  assert.strictEqual(extractEmbeddedTime('3 pm'), '15:00')
  assert.strictEqual(extractEmbeddedTime('11 w noss'), '11:30')
  passed += 8

  try { fs.unlinkSync(dbPath) } catch { /* */ }

  console.log(`\nbooking-input-normalization: ${passed} checks passed`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
