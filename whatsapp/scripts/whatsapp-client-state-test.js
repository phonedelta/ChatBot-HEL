/**
 * WhatsApp client state helpers (Railway unpaired_idle health-check fix).
 */
const assert = require('assert')
const {
  normalizeWhatsAppClientState,
  isWhatsAppWaitingForPairing,
  isWhatsAppConnectedState,
  keepsReadySession,
  shouldRestoreReadyState,
} = require('../src/whatsapp-client-state')

assert.equal(normalizeWhatsAppClientState('UNPAIRED_IDLE'), 'unpaired_idle')
assert.equal(isWhatsAppWaitingForPairing('UNPAIRED_IDLE'), true)
assert.equal(isWhatsAppWaitingForPairing('unpaired'), true)
assert.equal(isWhatsAppWaitingForPairing('pairing'), true)
assert.equal(isWhatsAppWaitingForPairing('CONNECTED'), false)
assert.equal(isWhatsAppConnectedState('CONNECTED'), true)
assert.equal(isWhatsAppConnectedState('ready'), true)
assert.equal(isWhatsAppConnectedState('unpaired_idle'), false)

// A ready session survives a brief drop ("connecting"), nothing else.
assert.equal(keepsReadySession(false, 'ready'), true)
assert.equal(keepsReadySession(true, 'connecting'), true)
assert.equal(keepsReadySession(undefined, 'connecting'), false)
for (const state of ['initializing', 'qr', 'code', 'authenticated', 'recovering', 'disconnected', 'auth_failure']) {
  assert.equal(keepsReadySession(true, state), false, state)
}

assert.equal(shouldRestoreReadyState('connecting', 'CONNECTED', true), true)
assert.equal(shouldRestoreReadyState('connecting', 'CONNECTED', false), false, 'never ready: still starting')
assert.equal(shouldRestoreReadyState('connecting', 'OPENING', true), false)
assert.equal(shouldRestoreReadyState('connecting', '', true), false, 'an unknown client state proves nothing')
assert.equal(shouldRestoreReadyState('qr', 'CONNECTED', true), false)
assert.equal(shouldRestoreReadyState('authenticated', 'CONNECTED', true), false)

console.log('whatsapp-client-state-test: passed')
