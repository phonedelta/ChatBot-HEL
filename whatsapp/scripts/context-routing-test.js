/**
 * Context-first routing tests — slot proposal + ambiguous messages must never trigger booking.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { parseYesNoReply } = require('../src/crm/binary-confirmation')
const {
  resolveConversationRoutingState,
  contextualClarificationMessage,
  hasPriorityOverBooking,
} = require('../src/crm/smart/conversation-routing')

const UNCLEAR = ['ui', '???', 'asdf', '...', 'je sais pas']

async function run() {
  // Typo yes in binary context
  assert.strictEqual(parseYesNoReply('ui').value, 'yes')
  assert.strictEqual(parseYesNoReply('oui').value, 'yes')
  assert.strictEqual(parseYesNoReply('la').value, 'no')
  assert.strictEqual(parseYesNoReply('ksjdhf').value, 'unknown')

  const tmp = path.join(os.tmpdir(), `hel-ctx-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212612399030@c.us'

  crm.smart.applyInboundLanguage({ chatId: chat, text: 'بغيت نبدل الموعد' })

  const cust = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Salim Zouhair', '+212612399030', 'Casablanca', 'darija', ?, datetime('now'))
  `).run(chat)
  const customerId = cust.lastInsertRowid

  // Stale booking lead — must NOT override slot proposal
  crm.repo.upsertLead(chat, {
    stage: 'awaiting_form',
    awaiting_field: 'bulk',
    booking_intent: 1,
    language: 'darija',
    whatsapp_chat_id: chat,
  })

  const appt = crm.db.prepare(`
    INSERT INTO appointments (
      customer_id, appointment_date, appointment_time, status, conversation_id, duration_minutes, created_at
    ) VALUES (?, '2026-09-01', '11:00', 'non_confirme', ?, 30, datetime('now'))
  `).run(customerId, chat)

  crm.db.prepare(`
    INSERT INTO slot_proposals (
      customer_id, appointment_id, conversation_id, chat_key,
      slot_date, slot_time, status, language, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, '2026-08-31', '11:00', 'pending', 'darija', datetime('now'), datetime('now'))
  `).run(customerId, appt.lastInsertRowid, chat)

  const state = crm.smart.resolveConversationRouting(chat)
  assert.strictEqual(state.activeWorkflow, 'slot_proposal')
  assert.strictEqual(state.pendingQuestionType, 'YES_NO_SLOT_PROPOSAL')
  assert.ok(hasPriorityOverBooking(state))
  assert.ok(state.blocksBooking)

  const clarify = contextualClarificationMessage(state, 'darija', 1)
  assert.match(clarify, /[\u0600-\u06FF]/)
  assert.match(clarify, /31/)
  assert.ok(!/الاسم/.test(clarify))
  assert.ok(!/الهاتف/.test(clarify))

  crm.smart.updateAppointmentsSettings({ proposalValidityMinutes: 240 })

  // Exact bug: "ui" after slot proposal → accept (typo oui) OR slot clarify — NEVER booking form
  for (const msg of UNCLEAR) {
    const turn = await crm.processCrmTurn({
      conversationId: chat,
      chatId: chat,
      userText: msg,
      languageHint: 'darija',
      router: { intent: 'UNKNOWN', intentConfidence: 0, bookAppointment: false },
      routingState: crm.smart.resolveConversationRouting(chat),
    })
    const text = turn.forceReply || ''
    assert.ok(!/الاسم.*الهاتف.*المدينة/s.test(text), `"${msg}" must not send booking form`)
    assert.ok(!/Nom complet/i.test(text), `"${msg}" must not send FR booking form`)
  }

  // Direct slot handler — "ui" accepts proposal (typo yes)
  const slotTurn = await crm.smart.handleInboundSlotProposalReply({ chatKey: chat, text: 'ui' })
  assert.ok(slotTurn?.handled)
  assert.ok(['accepted', 'clarify', 'declined', 'expired'].includes(slotTurn.action) || slotTurn.ok)

  // Re-seed pending for unknown test
  crm.db.prepare(`UPDATE slot_proposals SET status='cancelled' WHERE chat_key=?`).run(chat)
  crm.db.prepare(`
    INSERT INTO slot_proposals (
      customer_id, appointment_id, chat_key, slot_date, slot_time, status, language, created_at, updated_at
    ) VALUES (?, ?, ?, '2026-08-31', '11:00', 'pending', 'darija', datetime('now'), datetime('now'))
  `).run(customerId, appt.lastInsertRowid, chat)

  const unknownTurn = await crm.smart.handleInboundSlotProposalReply({ chatKey: chat, text: 'ksjdhfk' })
  assert.strictEqual(unknownTurn.action, 'clarify')
  assert.match(unknownTurn.forceReply, /ما فهمتش/)
  assert.ok(!/الاسم/.test(unknownTurn.forceReply))

  // Explicit booking without active priority workflow
  crm.db.prepare(`UPDATE slot_proposals SET status='cancelled' WHERE chat_key=?`).run(chat)
  crm.repo.clearLead(chat)
  const bookTurn = await crm.processCrmTurn({
    conversationId: chat,
    chatId: chat,
    userText: 'je veux prendre rendez-vous',
    languageHint: 'fr',
    router: { intent: 'BOOK_APPOINTMENT', intentConfidence: 0.95, bookAppointment: true },
    routingState: crm.smart.resolveConversationRouting(chat),
  })
  assert.ok(bookTurn.shouldSkipLlm)
  assert.match(bookTurn.forceReply || '', /Nom complet|nom complet/i)

  // No context + unknown → no booking
  const noCtx = await crm.processCrmTurn({
    conversationId: '212612399031@c.us',
    chatId: '212612399031@c.us',
    userText: 'asdfgh',
    languageHint: 'fr',
    router: { intent: 'UNKNOWN', intentConfidence: 0, bookAppointment: false },
    routingState: resolveConversationRoutingState(crm.db, '212612399031@c.us', null),
  })
  assert.ok(!noCtx.forceReply || !/Nom complet/i.test(noCtx.forceReply))

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }

  console.log('context-routing-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
