/**
 * WhatsApp identity resolution tests — @lid must never become a phone.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService, toE164, isValidPhone, formatPhoneDisplay } = require('../src/crm')
const {
  parseWhatsAppId,
  extractPhoneFromWaContact,
  resolveDisplayIdentity,
} = require('../src/crm/smart/contact-resolver')

async function run() {
  // --- Pure parsers ---
  const lid = parseWhatsAppId('200940212715738@lid')
  assert.strictEqual(lid.isLid, true)
  assert.strictEqual(lid.e164, '', '@lid must never produce e164')
  assert.strictEqual(lid.isPhoneJid, false)

  const cus = parseWhatsAppId('212612345678@c.us')
  assert.strictEqual(cus.isPhoneJid, true)
  assert.strictEqual(cus.e164, '+212612345678')

  assert.strictEqual(extractPhoneFromWaContact({
    id: { _serialized: '999888777666555@lid', user: '999888777666555' },
    number: '999888777666555',
  }), null, 'must not invent phone from LID digits')

  assert.strictEqual(extractPhoneFromWaContact({
    id: { _serialized: '212612345678@c.us', user: '212612345678' },
    number: '212612345678',
  }), '+212612345678')

  assert.strictEqual(isValidPhone('+200940212715738'), false)
  assert.strictEqual(isValidPhone('0612345678'), true)
  assert.strictEqual(toE164('0612345678'), '+212612345678')
  assert.ok(formatPhoneDisplay('+212612345678').includes('212'))

  const unknown = resolveDisplayIdentity({
    whatsapp_chat_id: '123@lid',
  })
  assert.strictEqual(unknown.display_name, 'Contact WhatsApp')
  assert.strictEqual(unknown.phone_display, null)

  const withPhone = resolveDisplayIdentity({
    phone_number: '+212612345678',
    whatsapp_chat_id: '123@lid',
  })
  assert.strictEqual(withPhone.display_name, 'Contact WhatsApp')
  assert.ok(withPhone.phone_display)

  const named = resolveDisplayIdentity({
    full_name: 'Salim Zouhairi',
    phone_number: '+212612345678',
  })
  assert.strictEqual(named.display_name, 'Salim Zouhairi')
  assert.ok(named.phone_display)

  // --- Persistence ---
  const tmpDb = path.join(os.tmpdir(), `hel-identity-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const lidKey = '111222333444555@lid'

  // Track without phone → unknown
  let conv = crm.smart.trackWhatsAppTurn({
    chatId: lidKey,
    inboundText: 'Salut',
  })
  assert.ok(conv)
  assert.strictEqual(conv.phone_e164, null)
  assert.strictEqual(conv.phone_display, null)
  assert.match(conv.display_name, /Contact WhatsApp|Salut/i)

  // Form phone on LID conversation → persist mapping
  crm.smart.linkConversationIdentity({
    whatsapp_id: lidKey,
    phone_number: '0612345678',
    source: 'crm_form',
  })
  conv = crm.smart.getConversation(conv.id)
  assert.strictEqual(conv.phone_e164, '+212612345678')
  assert.ok(conv.phone_display)
  assert.strictEqual(conv.display_name, 'Contact WhatsApp')

  // Existing customer match — no duplicate
  crm.repo.createOrUpdateCustomer({
    full_name: 'Salim Zouhairi',
    phone_number: '+212612345678',
    city: 'Casablanca',
    whatsapp_chat_id: null,
  })
  crm.smart.linkConversationIdentity({
    whatsapp_id: lidKey,
    phone_number: '0612345678',
    source: 'crm_form',
  })
  conv = crm.smart.getConversation(conv.id)
  assert.strictEqual(conv.display_name, 'Salim Zouhairi')
  assert.ok(conv.customer_id)
  const customers = crm.db.prepare('SELECT COUNT(*) AS c FROM customers WHERE phone_number = ?')
    .get('+212612345678')
  assert.strictEqual(customers.c, 1, 'must not duplicate customer by phone')

  // Booking flow on LID links identity
  const lid2 = '999888777666111@lid'
  let turn = await crm.processCrmTurn({
    conversationId: `main:${lid2}`,
    chatId: lid2,
    userText: 'Bghit rendez-vous',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.shouldSkipLlm, true)
  turn = await crm.processCrmTurn({
    conversationId: `main:${lid2}`,
    chatId: lid2,
    userText: [
      'Nom : Amine Benali',
      'Téléphone : 0622223344',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 10/09/2026 à 11:00',
    ].join('\n'),
    languageHint: 'fr',
  })
  assert.ok(turn.lead.phone_number)
  const identity = crm.smart.contacts.findIdentity(lid2)
  assert.ok(identity, 'whatsapp_identities row required')
  assert.strictEqual(identity.phone_e164, '+212622223344')

  // @c.us conversation resolves phone from JID
  const phoneJid = '212633344455@c.us'
  conv = crm.smart.trackWhatsAppTurn({
    chatId: phoneJid,
    inboundText: 'Hello',
  })
  assert.strictEqual(conv.phone_e164, '+212633344455')

  // Restart simulation: reopen DB
  const crm2 = createCrmService({ dbPath: tmpDb })
  const listed = crm2.smart.listConversations({ limit: 50 })
  const found = listed.find((c) => c.external_key === lidKey || c.whatsapp_lid === lidKey)
  assert.ok(found)
  assert.strictEqual(found.phone_e164, '+212612345678')
  assert.strictEqual(found.display_name, 'Salim Zouhairi')

  try { fs.unlinkSync(tmpDb) } catch { /* ignore */ }
  try { fs.unlinkSync(`${tmpDb}-wal`) } catch { /* ignore */ }
  try { fs.unlinkSync(`${tmpDb}-shm`) } catch { /* ignore */ }

  console.log('identity-resolution tests OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
