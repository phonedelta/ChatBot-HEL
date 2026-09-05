/**
 * WhatsApp client state helpers (Railway unpaired_idle health-check fix).
 */
const assert = require('assert')
const {
  normalizeWhatsAppClientState,
  isWhatsAppWaitingForPairing,
  isWhatsAppConnectedState,
} = require('../src/whatsapp-client-state')

assert.equal(normalizeWhatsAppClientState('UNPAIRED_IDLE'), 'unpaired_idle')
assert.equal(isWhatsAppWaitingForPairing('UNPAIRED_IDLE'), true)
assert.equal(isWhatsAppWaitingForPairing('unpaired'), true)
assert.equal(isWhatsAppWaitingForPairing('pairing'), true)
assert.equal(isWhatsAppWaitingForPairing('CONNECTED'), false)
assert.equal(isWhatsAppConnectedState('CONNECTED'), true)
assert.equal(isWhatsAppConnectedState('ready'), true)
assert.equal(isWhatsAppConnectedState('unpaired_idle'), false)

console.log('whatsapp-client-state-test: passed')
