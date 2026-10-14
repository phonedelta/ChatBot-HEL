/**
 * Normalize WhatsApp Web.js client.getState() values for health checks.
 */
function normalizeWhatsAppClientState(state) {
  return String(state || '').trim().toLowerCase()
}

/**
 * States that mean "browser up, waiting for phone link / QR" — not a crash.
 */
function isWhatsAppWaitingForPairing(state) {
  const s = normalizeWhatsAppClientState(state)
  return s === 'unpaired'
    || s === 'unpaired_idle'
    || s === 'opening'
    || s === 'pairing'
    || s === 'timeout'
    || s === 'conflict'
}

/**
 * States that mean the session is usable for sending.
 */
function isWhatsAppConnectedState(state) {
  const s = normalizeWhatsAppClientState(state)
  return !s || s === 'connected' || s === 'open' || s === 'ready'
}

/**
 * whatsapp-web.js emits "ready" once per session. The flag stays true while the service record
 * has only moved between "ready" and "connecting" since then (a brief socket drop).
 */
function keepsReadySession(wasReady, recordState) {
  const s = normalizeWhatsAppClientState(recordState)
  if (s === 'ready') return true
  return s === 'connecting' && wasReady === true
}

/**
 * After a brief OPENING / TIMEOUT, CONNECTED is the only signal that a ready session is back.
 */
function shouldRestoreReadyState(recordState, clientState, wasReady) {
  return wasReady === true
    && normalizeWhatsAppClientState(recordState) === 'connecting'
    && normalizeWhatsAppClientState(clientState) === 'connected'
}

module.exports = {
  normalizeWhatsAppClientState,
  isWhatsAppWaitingForPairing,
  isWhatsAppConnectedState,
  keepsReadySession,
  shouldRestoreReadyState,
}
