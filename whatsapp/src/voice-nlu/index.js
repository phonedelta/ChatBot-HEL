/**
 * Voice NLU public API for WhatsApp dental chatbot.
 */

const { analyzeVoiceTranscript, buildLowConfidenceVoiceReply } = require('./pipeline')
const { detectLanguage, detectLanguageWithConfidence, isLanguageNeutral, toReplyLanguageHint } = require('./language')
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
const {
  shouldUseNluFallback,
  clarificationMessage,
  formAwaitingClarifyMessage,
  CONFIDENCE_EXECUTE,
  CONFIDENCE_UNKNOWN_MAX,
} = require('./nlu-fallback')
const {
  classifyDentalProblem,
  DENTAL_PROBLEMS,
  shouldPreferClassification,
} = require('./dental-problem-classifier')

module.exports = {
  analyzeVoiceTranscript,
  buildLowConfidenceVoiceReply,
  detectLanguage,
  detectLanguageWithConfidence,
  isLanguageNeutral,
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
  shouldUseNluFallback,
  clarificationMessage,
  formAwaitingClarifyMessage,
  CONFIDENCE_EXECUTE,
  CONFIDENCE_UNKNOWN_MAX,
  classifyDentalProblem,
  DENTAL_PROBLEMS,
  shouldPreferClassification,
}
