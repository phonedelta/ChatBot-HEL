/**
 * Conversation context panel — unit checks (no live server).
 * Run: npm run test:context
 */

const assert = require('assert')
const path = require('path')
const { openCrmDatabase } = require('../src/crm/db')
const { createSmartCrm } = require('../src/crm/smart/index')
const {
  deriveContactReason,
  deriveActionTaken,
  deriveNextAction,
  formatAppointmentDisplay,
  formatLastContactDisplay,
  buildLanguageSubtitle,
} = require('../src/crm/smart/conversation-context')

const dbPath = path.join(__dirname, '..', 'storage', 'test-conversation-context.db')
const fs = require('fs')
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

const db = openCrmDatabase(dbPath)
const smart = createSmartCrm(db)

const customer = db.prepare(`
  INSERT INTO customers (full_name, phone_number, source, preferred_language, last_contact_at, created_at)
  VALUES ('Amine Benali', '+212661248803', 'website_form', 'fr', datetime('now'), datetime('now'))
`).run()

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

db.prepare(`
  INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, created_at)
  VALUES (?, ?, '14:30', 'non_confirme', datetime('now'))
`).run(customer.lastInsertRowid, tomorrowIso)

const convInsert = db.prepare(`
  INSERT INTO conversations (
    external_key, customer_id, channel, status, owner, language,
    last_message_preview, last_message_at, ai_summary, next_action, phone_e164, created_at, updated_at
  ) VALUES ('212661248803@c.us', ?, 'whatsapp', 'WAITING_PATIENT', 'AI', 'darija',
    'bghit nbeddel rdv', datetime('now'), 'Motif: déplacement rendez-vous', 'Proposer des créneaux', '+212661248803', datetime('now'), datetime('now'))
`).run(customer.lastInsertRowid)

const conversationId = convInsert.lastInsertRowid

db.prepare(`
  INSERT INTO ai_actions (conversation_id, customer_id, action_type, reason, created_at)
  VALUES (?, ?, 'proposed_slots', 'Proposition de 3 créneaux', datetime('now'))
`).run(conversationId, customer.lastInsertRowid)

db.prepare(`
  INSERT INTO waiting_list_entries (
    customer_id, priority, preferred_date_to, preferred_time_ranges, status, created_at, updated_at
  ) VALUES (?, 'haute', ?, ?, 'active', datetime('now'), datetime('now'))
`).run(customer.lastInsertRowid, tomorrowIso, JSON.stringify(['Après-midi']))

const context = smart.getConversationContext(conversationId)
assert.ok(context, 'context should exist')
assert.strictEqual(context.patient.display_name, 'Amine Benali')
assert.ok(context.patient.phone_display.includes('212'), 'phone formatted')
assert.strictEqual(context.patient.source_label, 'Formulaire du site')
assert.ok(context.next_appointment.display.includes('Demain'), 'next appt tomorrow')
assert.ok(context.summary.reason.label.toLowerCase().includes('déplacement'), 'reason label human')
assert.strictEqual(context.summary.status.label, 'En attente du patient')
assert.ok(context.waitlist?.description.includes('Amine'), 'waitlist text')
assert.ok(context.patient.language_subtitle.includes('Patient existant'), 'existing patient subtitle')

// Helpers
assert.strictEqual(
  buildLanguageSubtitle({ existing: false, activeLanguage: 'darija' }),
  'Nouveau contact WhatsApp · Darija',
)
assert.ok(formatAppointmentDisplay(tomorrowIso, '14:30').includes('14:30'))
assert.ok(formatLastContactDisplay(new Date().toISOString(), 'whatsapp').includes('WhatsApp'))

const mockConv = { ai_summary: 'Motif: annulation', last_message_preview: 'je veux annuler' }
const reason = deriveContactReason(mockConv, null)
assert.ok(reason.label.toLowerCase().includes('annul'), 'infer cancel')

const action = deriveActionTaken(
  { action_type: 'proposed_slots', reason: 'Proposition de 3 créneaux' },
  null,
)
assert.ok(action.label.includes('3'), 'action slots')

const next = deriveNextAction({ next_action: 'Confirmer le rendez-vous' }, null)
assert.strictEqual(next.label, 'Confirmer le rendez-vous')

console.log('conversation-context-test: OK')
try {
  db.close()
} catch {
  // ignore
}
try {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
} catch {
  // Windows WAL lock — test still passed
}
