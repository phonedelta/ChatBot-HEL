/**
 * Voice NLU public API for WhatsApp dental chatbot.
 */

const { analyzeVoiceTranscript, buildLowConfidenceVoiceReply } = require('./pipeline')
const { detectLanguage, toReplyLanguageHint } = require('./language')
const { cleanupTranscript } = require('./preprocess')
const { normalizeDarijaText, buildMeaningHint } = require('./normalize')
const { normalizeTranscript } = require('./normalize-transcript')
const { detectIntent } = require('./intent')
const { extractEntities } = require('./entities')
const { computeVoiceConfidence } = require('./confidence')
const { updateVoiceNluLog } = require('./logger')

module.exports = {
  analyzeVoiceTranscript,
  buildLowConfidenceVoiceReply,
  detectLanguage,
  toReplyLanguageHint,
  cleanupTranscript,
  normalizeTranscript,
  normalizeDarijaText,
  buildMeaningHint,
  detectIntent,
  extractEntities,
  computeVoiceConfidence,
  updateVoiceNluLog,
}
