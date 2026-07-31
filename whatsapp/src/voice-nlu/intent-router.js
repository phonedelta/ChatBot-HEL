/**
 * Intent Router — runs BEFORE the LLM for every patient message.
 *
 * Pipeline:
 *   Message → Language → Intent → Service → structured route → LLM / CRM
 *
 * The LLM must consume this route and must NOT re-guess language/intent/service.
 */

const { detectLanguage, toReplyLanguageHint } = require('./language')
const { classifyIntent } = require('./intent-classifier')
const { detectService } = require('./services-dictionary')
const {
  detectServiceBookingIntent,
  hasExplicitBookingIntent,
  SERVICE_BOOKING_CONFIDENCE,
} = require('./intent-table')

/**
 * @typedef {object} IntentRoute
 * @property {string} text
 * @property {'fr'|'darija'|'auto'} language
 * @property {'fr'|'darija'|'mixed'|'auto'} languageRaw
 * @property {string} intent
 * @property {number} intentConfidence
 * @property {string|null} intentMatched
 * @property {string|null} service
 * @property {string|null} serviceId
 * @property {number} serviceConfidence
 * @property {string|null} serviceMatched
 * @property {boolean} bookAppointment
 * @property {boolean} skipProblemQuestion
 * @property {string} llmBlock
 */

/**
 * @param {string} rawText
 * @param {{
 *   languageHint?: string|null,
 *   voiceIntent?: string|null,
 *   interpreterIntent?: string|null,
 *   voiceService?: object|null,
 * }} [options]
 * @returns {IntentRoute}
 */
function routePatientMessage(rawText, options = {}) {
  const text = String(rawText || '').trim()
  const languageRaw = detectLanguage(text)
  const forced = String(options.languageHint || '').toLowerCase()
  const language = (forced === 'fr' || forced === 'darija')
    ? forced
    : toReplyLanguageHint(languageRaw)

  const intentHit = classifyIntent(text, {
    voiceIntent: options.voiceIntent || null,
    interpreterIntent: options.interpreterIntent || null,
  })

  const serviceBooking = detectServiceBookingIntent(text)
  /** @type {{ service: string, serviceId?: string|null, confidence: number, matched?: string|null }|null} */
  let serviceHit = serviceBooking.service
    ? {
      service: serviceBooking.service,
      serviceId: serviceBooking.serviceId,
      confidence: serviceBooking.confidence,
      matched: serviceBooking.matched,
    }
    : (detectService(text, { minConfidence: 0.72 }) || null)

  // Voice NLU service can reinforce text detection
  const voiceService = options.voiceService || null
  if (
    voiceService?.service
    && Number(voiceService.confidence || 0) >= SERVICE_BOOKING_CONFIDENCE
    && (!serviceHit || Number(voiceService.confidence) > Number(serviceHit.confidence || 0))
  ) {
    serviceHit = {
      service: voiceService.service,
      serviceId: voiceService.serviceId || serviceHit?.serviceId || null,
      confidence: Number(voiceService.confidence),
      matched: voiceService.matched || 'voice_service',
    }
  }

  let intent = intentHit.intent || 'OTHER'
  let intentConfidence = Number(intentHit.confidence || 0)
  const explicitBooking = hasExplicitBookingIntent(text)
    || serviceBooking.intent === 'BOOK_APPOINTMENT'

  // Classifier BOOK_APPOINTMENT alone is not enough (service keywords were too broad).
  // Open the CRM form only on explicit booking language.
  let bookAppointment = Boolean(explicitBooking)

  if (serviceBooking.intent === 'BOOK_APPOINTMENT' && serviceBooking.confidence >= SERVICE_BOOKING_CONFIDENCE) {
    intent = 'BOOK_APPOINTMENT'
    intentConfidence = Math.max(intentConfidence, serviceBooking.confidence)
    bookAppointment = true
  }

  // "Bonjour, je voudrais un rendez-vous" must not stay GREETING
  if (
    (intent === 'GREETING' || intent === 'OTHER' || intent === 'THANKS')
    && explicitBooking
  ) {
    intent = 'BOOK_APPOINTMENT'
    intentConfidence = Math.max(intentConfidence, 0.86)
    bookAppointment = true
  }

  // Weak classifier "BOOK_APPOINTMENT" without booking verbs → talk freely (no CRM form)
  if (intent === 'BOOK_APPOINTMENT' && !explicitBooking) {
    intent = 'OTHER'
    bookAppointment = false
  }

  const route = {
    text,
    language,
    languageRaw,
    intent,
    intentConfidence,
    intentMatched: intentHit.matched || serviceBooking.matched || null,
    service: serviceHit?.service || serviceBooking.service || null,
    serviceId: serviceHit?.serviceId || serviceBooking.serviceId || null,
    serviceConfidence: Number(serviceHit?.confidence || serviceBooking.confidence || 0),
    serviceMatched: serviceHit?.matched || serviceBooking.matched || null,
    bookAppointment,
    skipProblemQuestion: Boolean(
      serviceBooking.skipProblemQuestion
      || (serviceHit?.service && Number(serviceHit.confidence || 0) >= SERVICE_BOOKING_CONFIDENCE),
    ),
    llmBlock: '',
  }

  route.llmBlock = buildRouterLlmBlock(route)
  return route
}

/**
 * @param {IntentRoute} route
 * @returns {string}
 */
function buildRouterLlmBlock(route) {
  const lines = [
    'INTENT ROUTER RESULT (trusted — do NOT re-guess):',
    `language: ${route.language}`,
    `intent: ${route.intent}`,
    `intent_confidence: ${route.intentConfidence}`,
    route.intentMatched ? `intent_matched: ${route.intentMatched}` : null,
    route.service ? `service: ${route.service}` : 'service: none',
    route.service ? `service_confidence: ${route.serviceConfidence}` : null,
    route.serviceMatched ? `service_matched: ${route.serviceMatched}` : null,
    `book_appointment: ${route.bookAppointment ? 'yes' : 'no'}`,
    `skip_problem_question: ${route.skipProblemQuestion ? 'yes' : 'no'}`,
    '',
    'ROUTER RULES FOR YOUR REPLY:',
    '- Follow language strictly (fr → French only; darija → Arabic script only, never Latin Darija).',
    '- Treat intent/service above as already decided.',
    '- If book_appointment=yes and a CRM form/summary template is handled by CRM, do not invent a parallel booking flow.',
    '- If service is known with high confidence, do NOT ask "what is your dental problem?".',
    '- Never say you did not understand when intent_confidence >= 0.70.',
  ]

  return lines.filter((line) => line !== null).join('\n')
}

module.exports = {
  routePatientMessage,
  buildRouterLlmBlock,
}
