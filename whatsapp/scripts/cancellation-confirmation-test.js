/**
 * Binary confirmation parser + Darija Latin cancel confirmation tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseBinaryConfirmation } = require('../src/crm/binary-confirmation')
const { createCrmService } = require('../src/crm')

function weekdayFuture(daysAhead = 5, time = '11:00') {
  for (let i = daysAhead; i < daysAhead + 21; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return { date: `${yyyy}-${mm}-${dd}`, time: d.getDay() === 6 ? '11:00' : time }
  }
  throw new Error('no weekday')
}

function book(crm, { name, phone, chat, slot }) {
  return crm.repo.saveConfirmedBooking({
    full_name: name,
    phone_number: phone,
    city: 'Casablanca',
    problem: 'douleur dentaire',
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
    urgency: 'moyenne',
  })
}

async function run() {
  const ctx = { context: 'cancel_confirmation' }

  // Parser unit tests — exact tokens & Darija Latin
  assert.strictEqual(parseBinaryConfirmation({ text: 'la', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'LA', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'laa', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'لا', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'non', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'oui', ...ctx }).value, 'yes')
  assert.strictEqual(parseBinaryConfirmation({ text: 'نعم', ...ctx }).value, 'yes')
  assert.strictEqual(parseBinaryConfirmation({ text: 'la bghit n9a f rendez vous', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'bghit nb9a f rendez vous', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'khalli rendez vous', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'ma bghitch n annuler', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'ma tlghich', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'wakha annuler', ...ctx }).value, 'yes')
  assert.strictEqual(parseBinaryConfirmation({ text: 'non je garde mon rendez-vous', ...ctx }).value, 'no')
  assert.strictEqual(parseBinaryConfirmation({ text: 'oui annulez-le', ...ctx }).value, 'yes')
  assert.strictEqual(parseBinaryConfirmation({ text: 'je sais pas', ...ctx }).value, 'unknown')
  assert.strictEqual(parseBinaryConfirmation({ text: 'la mais finalement annule', ...ctx }).value, 'ambiguous')

  // "la semaine prochaine" must NOT be NO outside cancel binary short token
  assert.strictEqual(
    parseBinaryConfirmation({ text: 'la semaine prochaine', context: 'generic' }).value,
    'unknown',
  )

  // Integration — exact bug scenario
  const tmp = path.join(os.tmpdir(), `hel-cancel-la-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  crm.smart.applyInboundLanguage({ chatId: '212612399010@c.us', text: 'bghit n annuler' })
  const cancel = crm.smart.whatsappCancel
  const chat = '212612399010@c.us'
  const slot = weekdayFuture(6, '11:00')
  const b = book(crm, {
    name: 'Salim Zouhair',
    phone: '+212612399010',
    chat,
    slot,
  })
  const apptId = b.appointment.id

  let turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'bghit n annuler',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'confirm')
  assert.match(turn.forceReply, /نعم/)

  turn = cancel.handleInboundCancel({ chatKey: chat, text: 'la', language: 'darija' })
  assert.equal(turn.action, 'kept')
  assert.match(turn.forceReply, /مزيان/)
  assert.match(turn.forceReply, /باقي كيف ما هو/)
  assert.ok(!/واش كتأكد/i.test(turn.forceReply))
  assert.equal(
    crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(apptId).status,
    'non_confirme',
  )
  assert.equal(cancel.getPending(chat), null, 'pending must be cleared after la')

  // Second flow — long keep phrase
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'bghit n annuler',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  assert.equal(turn.action, 'confirm')

  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'la bghit n9a f rendez vous',
    language: 'darija',
  })
  assert.equal(turn.action, 'kept')
  assert.match(turn.forceReply, /[\u0600-\u06FF]/)

  // Unknown → short clarify, not full repeat
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'bghit n annuler',
    language: 'darija',
    routerIntent: 'CANCEL_APPOINTMENT',
  })
  turn = cancel.handleInboundCancel({ chatKey: chat, text: 'je sais pas', language: 'darija' })
  assert.equal(turn.action, 'confirm_clarify')
  assert.match(turn.forceReply, /ما فهمتش|نعم/)
  assert.ok(!/بغيتي تلغي موعد/i.test(turn.forceReply))

  // After keep, new message is normal (no pending)
  turn = cancel.handleInboundCancel({
    chatKey: chat,
    text: 'bghit rendez-vous mercredi',
    language: 'darija',
  })
  assert.ok(!turn || turn.action !== 'kept')

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }

  console.log('cancellation-confirmation-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
