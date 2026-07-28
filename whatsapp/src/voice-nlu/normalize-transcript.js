/**
 * Intermediate step after ASR: never send raw Whisper text directly to the bot.
 * normalizeTranscript() = cleanup + ASR fixes + Darija canonical rebuild.
 */

const { cleanupTranscript } = require('./preprocess')
const { normalizeDarijaText } = require('./normalize')
const { ASR_CORRECTIONS, normalizeKey } = require('./dictionary')

/**
 * Extra fuzzy phrase fixes common in Moroccan dental ASR.
 * Applied after token-level ASR_CORRECTIONS.
 * @param {string} text
 * @returns {string}
 */
function applyPhraseFixes(text) {
  let output = ` ${String(text || '')} `

  const phrases = [
    [/baghit/gi, 'bghit'],
    [/bagheti/gi, 'bghiti'],
    [/ba8i/gi, 'bghit'],
    [/baghi/gi, 'bghit'],
    [/nkhod/gi, 'nakhod'],
    [/nakhoud/gi, 'nakhod'],
    [/randivo(?:u|s)?/gi, 'rendez-vous'],
    [/randivou/gi, 'rendez-vous'],
    [/randevous/gi, 'rendez-vous'],
    [/rendezvou/gi, 'rendez-vous'],
    [/rendez vous/gi, 'rendez-vous'],
    [/serviss/gi, 'service'],
    [/servis\b/gi, 'service'],
    [/drassa/gi, 'ders'],
    [/darssa/gi, 'ders'],
    [/had service/gi, 'had service'],
    [/bach nji/gi, 'bach nji'],
    [/bash nji/gi, 'bach nji'],
    [/ndir had/gi, 'ndir had'],
    [/wje3ni/gi, 'wje3ni'],
    [/oujaani/gi, 'wje3ni'],
  ]

  for (const [pattern, replacement] of phrases) {
    output = output.replace(pattern, replacement)
  }

  // Multi-word ASR_CORRECTIONS already handled in preprocess; reinforce here.
  const multi = Object.entries(ASR_CORRECTIONS)
    .filter(([from]) => from.includes(' '))
    .sort((a, b) => b[0].length - a[0].length)
  for (const [from, to] of multi) {
    const pattern = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    output = output.replace(pattern, to)
  }

  return output.replace(/\s+/g, ' ').trim()
}

/**
 * Normalize an imperfect ASR transcript into a usable Darija/FR text.
 * @param {string} rawTranscript
 * @returns {{
 *   rawTranscript: string,
 *   cleanedText: string,
 *   correctedText: string,
 *   normalizedText: string,
 *   canonicalTokens: string[],
 *   tokens: string[],
 * }}
 */
function normalizeTranscript(rawTranscript) {
  const raw = String(rawTranscript || '').trim()
  const cleanedText = cleanupTranscript(raw)
  const phraseFixed = applyPhraseFixes(cleanedText)
  const normalized = normalizeDarijaText(phraseFixed)

  // Prefer a readable corrected surface: phrase-fixed text with canonical swaps already applied in normalizeDarijaText
  const correctedText = normalized.normalizedText || phraseFixed || cleanedText || raw

  return {
    rawTranscript: raw,
    cleanedText,
    correctedText,
    normalizedText: normalized.normalizedText,
    canonicalTokens: normalized.canonicalTokens,
    tokens: normalized.tokens,
    normalizeKey: normalizeKey(correctedText),
  }
}

module.exports = {
  normalizeTranscript,
  applyPhraseFixes,
}
