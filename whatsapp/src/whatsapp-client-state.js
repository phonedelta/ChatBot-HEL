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

module.exports = {
  normalizeWhatsAppClientState,
  isWhatsAppWaitingForPairing,
  isWhatsAppConnectedState,
}
