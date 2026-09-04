/**
 * WhatsApp identity / routing unit tests (phone JID vs LID).
 * No live QR. Fixtures match whatsapp-web.js 1.34 structures.
 */
const assert = require('assert')
const {
  classifyJid,
  sanitizeAccountPhone,
  resolveMessageDirection,
  resolveReplyDestination,
  normalizeIncomingWhatsAppMessage,
  jidsEqual,
} = require('../src/whatsapp-identity')
const { parseWhatsAppId, extractPhoneFromWaContact } = require('../src/crm/smart/contact-resolver')

async function run() {
  const phoneJid = classifyJid('212612345678@c.us')
  assert.strictEqual(phoneJid.jidType, 'phone')
  assert.strictEqual(phoneJid.phoneNumber, '+212612345678')
  assert.strictEqual(phoneJid.isPrivate, true)

  const lidJid = classifyJid('200940212715738@lid')
  assert.strictEqual(lidJid.jidType, 'lid')
  assert.strictEqual(lidJid.phoneNumber, null)
  assert.strictEqual(lidJid.isPrivate, true)
  assert.ok(!String(lidJid.jid).includes('@c.us'))

  assert.strictEqual(sanitizeAccountPhone('200940212715738@lid'), null)
  assert.strictEqual(sanitizeAccountPhone('200940212715738'), null)
  assert.strictEqual(sanitizeAccountPhone('212612345678'), '+212612345678')
  assert.strictEqual(sanitizeAccountPhone('212612345678@c.us'), '+212612345678')

  const group = classifyJid('120363426272388530@g.us')
  assert.strictEqual(group.jidType, 'group')
  assert.strictEqual(group.isPrivate, false)

  const status = classifyJid('status@broadcast')
  assert.strictEqual(status.jidType, 'broadcast')

  const ownLid = '111222333444555@lid'
  const patientLid = '200940212715738@lid'

  const inboundMislabeled = resolveMessageDirection({
    fromMe: true,
    from: patientLid,
    to: ownLid,
    body: 'Salam',
  }, ownLid)
  assert.strictEqual(inboundMislabeled.fromMe, false)
  assert.strictEqual(inboundMislabeled.chatJid, patientLid)

  const outbound = resolveMessageDirection({
    fromMe: true,
    from: ownLid,
    to: patientLid,
    body: 'ok',
  }, ownLid)
  assert.strictEqual(outbound.fromMe, true)
  assert.strictEqual(outbound.chatJid, patientLid)

  const classicInbound = resolveMessageDirection({
    fromMe: false,
    from: '212698765432@c.us',
    to: '212612345678@c.us',
    body: 'Salam',
  }, '212612345678@c.us')
  assert.strictEqual(classicInbound.fromMe, false)
  assert.strictEqual(classicInbound.chatJid, '212698765432@c.us')

  const destLid = resolveReplyDestination({
    chatJid: patientLid,
    phoneNumber: '+212698765432',
  })
  assert.strictEqual(destLid.destinationJid, patientLid)

  const destPhone = resolveReplyDestination({
    chatJid: '212698765432@c.us',
  })
  assert.strictEqual(destPhone.destinationJid, '212698765432@c.us')

  const normalized = normalizeIncomingWhatsAppMessage({
    fromMe: false,
    from: patientLid,
    to: ownLid,
    body: 'Salam',
  }, ownLid)
  assert.strictEqual(normalized.isPrivate, true)
  assert.strictEqual(normalized.fromMe, false)
  assert.strictEqual(normalized.identityType, 'lid')
  assert.strictEqual(normalized.phoneNumber, null)

  assert.ok(jidsEqual('212612345678@c.us', { _serialized: '212612345678@c.us' }))
  assert.ok(!jidsEqual(patientLid, '212612345678@c.us'))

  assert.strictEqual(parseWhatsAppId(patientLid).e164, '')
  assert.strictEqual(extractPhoneFromWaContact({
    id: { _serialized: patientLid, user: '200940212715738' },
    number: '200940212715738',
  }), null)

  console.log('whatsapp-identity-test: OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
