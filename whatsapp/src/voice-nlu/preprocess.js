/**
 * ASR cleanup: hesitations, repetitions, frequent mishearings, incomplete tokens.
 */

const { ASR_CORRECTIONS, HESITATION_TOKENS, normalizeKey } = require('./dictionary')

/**
 * @param {string} text
 * @returns {string}
 */
function removeHesitations(text) {
  let output = ` ${String(text || '')} `
  for (const token of HESITATION_TOKENS) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi')
    output = output.replace(pattern, ' ')
  }
  // elongated vowels: aaa, eee, hmmmm
  output = output.replace(/\b[aeiouyh]{3,}\b/gi, ' ')
  return output.replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} text
 * @returns {string}
 */
function removeRepeatedWords(text) {
  return String(text || '')
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {string}
 */
function applyAsrCorrections(text) {
  let output = String(text || '')

  // Longer phrases first.
  const entries = Object.entries(ASR_CORRECTIONS)
    .sort((a, b) => b[0].length - a[0].length)

  for (const [from, to] of entries) {
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi')
    output = output.replace(pattern, to)
  }

  return output.replace(/\s+/g, ' ').trim()
}

/**
 * Light cleanup of punctuation noise from ASR.
 * @param {string} text
 * @returns {string}
 */
function cleanupPunctuation(text) {
  return String(text || '')
    .replace(/[“”«»]/g, '"')
    .replace(/[…]/g, ' ')
    .replace(/[!]{2,}/g, '!')
    .replace(/[?]{2,}/g, '?')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Full transcript cleanup before normalization.
 * @param {string} rawTranscript
 * @returns {string}
 */
function cleanupTranscript(rawTranscript) {
  let text = String(rawTranscript || '').trim()
  if (!text) {
    return ''
  }

  text = cleanupPunctuation(text)
  text = removeHesitations(text)
  text = removeRepeatedWords(text)
  text = applyAsrCorrections(text)
  text = removeRepeatedWords(text)
  return text.trim()
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  cleanupTranscript,
  removeHesitations,
  removeRepeatedWords,
  applyAsrCorrections,
  cleanupPunctuation,
  normalizeKey,
}
