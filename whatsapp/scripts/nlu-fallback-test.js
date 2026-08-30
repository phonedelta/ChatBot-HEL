/**
 * NLU fallback tests — unclear messages must never auto-start booking.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  shouldUseNluFallback,
  clarificationMessage,
  isGibberishMessage,
} = require('../src/voice-nlu/nlu-fallback')
const { routePatientMessage } = require('../src/voice-nlu/intent-router')
const { parseBinaryConfirmation } = require('../src/crm/binary-confirmation')
const { createCrmService } = require('../src/crm')

function route(text, lang = 'fr') {
  return routePatientMessage(text, { languageHint: lang })
}

async function run() {
  // --- Router UNKNOWN for gibberish ---
  assert.strictEqual(route('ui').intent, 'UNKNOWN')
  assert.strictEqual(route('asdf').intent, 'UNKNOWN')
  assert.strictEqual(route('???').intent, 'UNKNOWN')
  assert.strictEqual(route('je sais pas').intent, 'UNKNOWN')
  assert.strictEqual(route('bghit rendez vous').intent, 'BOOK_APPOINTMENT')
  assert.strictEqual(route('je veux prendre rendez-vous').intent, 'BOOK_APPOINTMENT')
  assert.ok(route('bghit rendez vous').bookAppointment)

  // --- Fallback gate ---
  assert.ok(shouldUseNluFallback(route('ui'), 'ui'))
  assert.ok(shouldUseNluFallback(route('asdfgh'), 'asdfgh'))
  assert.ok(shouldUseNluFallback(route('???'), '???'))
  assert.ok(shouldUseNluFallback(route('je comprends pas'), 'je comprends pas'))
  assert.ok(!shouldUseNluFallback(route('bghit rendez vous'), 'bghit rendez vous'))
  assert.ok(!shouldUseNluFallback(route('je veux prendre rendez-vous'), 'je veux prendre rendez-vous'))
  assert.ok(!shouldUseNluFallback(route('wach kat7lou nhar sebt', 'darija'), 'wach kat7lou nhar sebt'))

  // --- Clarification templates ---
  assert.match(clarificationMessage('fr', 1), /Je n’ai pas bien compris/)
  assert.match(clarificationMessage('fr', 1), /rendez-vous/)
  assert.match(clarificationMessage('darija', 1), /[\u0600-\u06FF]/)
  assert.match(clarificationMessage('darija', 1), /موعد/)
  assert.match(clarificationMessage('fr', 2), /Je n’arrive toujours pas/)
  assert.ok(!/Nom complet/i.test(clarificationMessage('fr', 1)))

  // --- "la semaine prochaine" not gibberish ---
  assert.ok(!isGibberishMessage('la semaine prochaine'))

  // --- CRM workflow: stale booking_intent + "ui" must NOT open form ---
  const tmp = path.join(os.tmpdir(), `hel-nlu-fallback-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212612399020@c.us'
  crm.repo.upsertLead(chat, {
    stage: 'discovery',
    booking_intent: 1,
    language: 'fr',
    whatsapp_chat_id: chat,
  })
  const turn = await crm.processCrmTurn({
    conversationId: chat,
    chatId: chat,
    userText: 'ui',
    languageHint: 'fr',
    router: route('ui'),
  })
  assert.ok(!turn.shouldSkipLlm || !turn.forceReply?.includes('Nom complet'), 'must not send booking form')
  assert.ok(!turn.forceReply || !/Numéro de téléphone/i.test(turn.forceReply))

  // --- Explicit booking still works ---
  const turn2 = await crm.processCrmTurn({
    conversationId: chat,
    chatId: chat,
    userText: 'je veux prendre rendez-vous',
    languageHint: 'fr',
    router: route('je veux prendre rendez-vous'),
  })
  assert.ok(turn2.shouldSkipLlm)
  assert.match(turn2.forceReply || '', /Nom complet|nom complet/i)

  // --- Cancel pending: "ui" not treated as booking; binary context separate ---
  crm.smart.applyInboundLanguage({ chatId: chat, text: 'bghit n annuler' })
  const cancel = crm.smart.whatsappCancel
  let cancelTurn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'bghit n annuler',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(cancelTurn?.action, 'none') // no appt in test DB — still must not booking

  // With pending confirmation, "oui" works in cancel context
  const tmp2 = path.join(os.tmpdir(), `hel-nlu-ui-cancel-${Date.now()}.sqlite`)
  const crm2 = createCrmService({ dbPath: tmp2 })
  const chat2 = '212612399021@c.us'
  const slot = { date: '2026-09-15', time: '11:00' }
  const booking = crm2.repo.saveConfirmedBooking({
    full_name: 'Test Patient',
    phone_number: '+212612399021',
    city: 'Casablanca',
    problem: 'douleur dentaire',
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: chat2,
    whatsapp_chat_id: chat2,
  })
  assert.ok(booking.appointment.id)
  cancelTurn = crm2.smart.whatsappCancel.handleInboundCancel({
    chatKey: chat2,
    text: 'bghit n annuler',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(cancelTurn.action, 'confirm')
  cancelTurn = crm2.smart.whatsappCancel.handleInboundCancel({
    chatKey: chat2,
    text: 'ui',
    language: 'darija',
  })
  assert.notEqual(cancelTurn?.action, 'cancelled')
  assert.ok(['confirm_clarify', 'kept', 'clarify_ambiguous'].includes(cancelTurn?.action) || cancelTurn?.action === 'confirm_clarify')

  // Parser: ui alone is NOT yes outside cancel (generic unknown)
  assert.strictEqual(parseBinaryConfirmation({ text: 'ui', context: 'generic' }).value, 'unknown')

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  try { fs.unlinkSync(tmp2) } catch { /* ignore */ }

  console.log('nlu-fallback-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
