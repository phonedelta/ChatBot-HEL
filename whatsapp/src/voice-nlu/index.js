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
const {
  detectService,
  detectServices,
  upsertService,
  SERVICES,
} = require('./services-dictionary')
const {
  interpretTranscriptWithAi,
  normalizeInterpreterResult,
  extractJsonObject,
} = require('./transcript-interpreter')
const {
  classifyIntent,
  buildIntentDirectReply,
  INTENT_NAMES,
  INTENT_DICTIONARY,
} = require('./intent-classifier')
const {
  detectServiceBookingIntent,
  SERVICE_BOOKING_CONFIDENCE,
} = require('./intent-table')
const { routePatientMessage, buildRouterLlmBlock } = require('./intent-router')

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
  detectService,
  detectServices,
  upsertService,
  SERVICES,
  interpretTranscriptWithAi,
  normalizeInterpreterResult,
  extractJsonObject,
  classifyIntent,
  buildIntentDirectReply,
  INTENT_NAMES,
  INTENT_DICTIONARY,
  detectServiceBookingIntent,
  SERVICE_BOOKING_CONFIDENCE,
  routePatientMessage,
  buildRouterLlmBlock,
}
