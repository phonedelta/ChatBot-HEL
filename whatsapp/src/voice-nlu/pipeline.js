/**
 * End-to-end voice NLU pipeline.
 *
 * Preferred path:
 *   Audio ASR text
 *     → AI Transcript Interpreter (structured JSON)
 *     → Chatbot
 *
 * Fallback (only if interpreter unavailable/fails):
 *   normalizeTranscript → dictionary/intent rules
 */

const { detectLanguage, toReplyLanguageHint } = require('./language')
const { normalizeTranscript } = require('./normalize-transcript')
const { buildMeaningHint } = require('./normalize')
const { detectIntent } = require('./intent')
const { extractEntities } = require('./entities')
const { computeVoiceConfidence } = require('./confidence')
const { detectService } = require('./services-dictionary')
const { interpretTranscriptWithAi } = require('./transcript-interpreter')
const { saveVoiceNluLog, archiveOriginalAudio, updateVoiceNluLog } = require('./logger')

/**
 * @param {object} analysis
 * @returns {string}
 */
function buildLlmPreanalysisBlock(analysis) {
  const entities = analysis.entities || {}
  const entityLines = Object.keys(entities).length
    ? Object.entries(entities).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`).join('\n')
    : '- aucune'

  const interpreter = analysis.interpreter || null

  return [
    'VOICE PRE-ANALYSIS (trusted structured understanding from AI Transcript Interpreter):',
    `Language: ${analysis.language}`,
    `Reply language: ${analysis.replyLanguageHint}`,
    `Corrected text: ${analysis.correctedText}`,
    analysis.normalizedText ? `Normalized text: ${analysis.normalizedText}` : null,
    analysis.llmCorrectedText ? `AI-interpreted text: ${analysis.llmCorrectedText}` : null,
    analysis.meaningHint ? `Meaning hint (FR): ${analysis.meaningHint}` : null,
    interpreter?.problem ? `Clinical problem: ${interpreter.problem}` : null,
    analysis.serviceDetection
      ? `Detected clinic service: ${analysis.serviceDetection.service} (confidence ${analysis.serviceDetection.confidence})`
      : null,
    `Intent: ${analysis.intent}`,
    `Intent confidence: ${analysis.intentConfidence}`,
    `ASR/NLU confidence: ${analysis.confidence.score}`,
    interpreter ? `Interpreter intent (raw): ${interpreter.intent}` : null,
    'Entities:',
    entityLines,
    '',
    'Instructions for this turn:',
    '- Trust the AI Transcript Interpreter output above as the patient meaning.',
    '- Answer using the corrected text and detected service/intent.',
    '- If a clinic service was detected, acknowledge that service and guide toward WhatsApp booking when relevant.',
    '- Do not invent facts not supported by clinic knowledge.',
    '- Reply in the reply language indicated (Darija ⇒ Arabic script only).',
    '- Prefer interpreting imperfect Darija ASR over saying you did not understand.',
  ].filter((line) => line !== null).join('\n')
}

/**
 * Legacy/local rule-based analysis (fallback only).
 * @param {string} rawTranscript
 * @param {object} meta
 */
function runVoiceAnalysis(rawTranscript, meta = {}) {
  const normalized = normalizeTranscript(rawTranscript)
  const workingText = normalized.correctedText || normalized.cleanedText || rawTranscript
  const language = detectLanguage(`${rawTranscript} ${normalized.cleanedText}`)
  const replyLanguageHint = toReplyLanguageHint(language)
  const meaningHint = buildMeaningHint(normalized.normalizedText, normalized.canonicalTokens)
  const intentSource = [
    rawTranscript,
    normalized.cleanedText,
    workingText,
    normalized.normalizedText,
  ].filter(Boolean).join(' ')

  const serviceDetection = detectService(intentSource)
  let intentResult = detectIntent(intentSource, normalized.canonicalTokens, {
    primaryText: workingText || normalized.cleanedText || rawTranscript,
  })

  if (
    serviceDetection
    && serviceDetection.confidence >= 0.8
    && (intentResult.intent === 'autre' || intentResult.intent === 'traitement' || intentResult.intent === 'consultation')
  ) {
    intentResult = {
      intent: serviceDetection.intent,
      confidence: Math.max(intentResult.confidence, serviceDetection.confidence),
      matchedBy: `service:${serviceDetection.serviceId}`,
    }
  } else if (
    serviceDetection
    && serviceDetection.confidence >= 0.88
    && serviceDetection.intent === 'urgence'
    && intentResult.intent !== 'prise_rendez_vous'
  ) {
    intentResult = {
      intent: 'urgence',
      confidence: Math.max(intentResult.confidence, serviceDetection.confidence),
      matchedBy: `service:${serviceDetection.serviceId}`,
    }
  }

  const entities = extractEntities(intentSource, normalized.canonicalTokens, {
    serviceDetection,
  })

  let resolvedMeaningHint = meaningHint
  if (serviceDetection && !resolvedMeaningHint) {
    resolvedMeaningHint = `Je demande le service: ${serviceDetection.service}.`
  } else if (serviceDetection && resolvedMeaningHint && !/service|orthodont|blanchiment|carie|détartrage|gencive|facette|urgence|pediat/i.test(resolvedMeaningHint)) {
    resolvedMeaningHint = `${resolvedMeaningHint} Service détecté: ${serviceDetection.service}.`
  }

  const confidence = computeVoiceConfidence({
    asrScore: meta.asrScore,
    asrWeak: meta.asrWeak,
    rawText: rawTranscript,
    correctedText: workingText,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    meaningHint: resolvedMeaningHint,
    canonicalTokens: normalized.canonicalTokens,
  })

  if (serviceDetection && serviceDetection.confidence >= 0.8) {
    confidence.recoverable = true
    if (confidence.lowConfidence && confidence.score < 0.55) {
      confidence.score = Math.max(confidence.score, 0.58)
      confidence.lowConfidence = false
      confidence.reasons = [...(confidence.reasons || []), 'service_dictionary_match']
    }
  }

  const analysis = {
    language,
    replyLanguageHint,
    rawTranscript: String(rawTranscript || '').trim(),
    cleanedText: normalized.cleanedText,
    correctedText: workingText,
    normalizedText: normalized.normalizedText,
    canonicalTokens: normalized.canonicalTokens,
    meaningHint: resolvedMeaningHint,
    interpreter: null,
    serviceDetection,
    service: serviceDetection
      ? {
          service: serviceDetection.service,
          confidence: serviceDetection.confidence,
        }
      : null,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    intentMatchedBy: intentResult.matchedBy,
    entities,
    confidence,
    lowConfidence: confidence.lowConfidence,
    recoverable: Boolean(confidence.recoverable),
    llmCorrectedText: meta.llmCorrectedText || null,
    llmCorrectionUsed: Boolean(meta.llmCorrectionUsed),
    llmBlock: '',
    pipelineMode: 'rules_fallback',
  }

  analysis.llmBlock = buildLlmPreanalysisBlock(analysis)
  return analysis
}

/**
 * Build analysis object from AI Transcript Interpreter result.
 * @param {string} rawTranscript
 * @param {object} interpreted
 * @param {object} meta
 */
function analysisFromInterpreter(rawTranscript, interpreted, meta = {}) {
  const normalized = normalizeTranscript(interpreted.correctedText || rawTranscript)

  const analysis = {
    language: interpreted.language,
    replyLanguageHint: interpreted.replyLanguageHint,
    rawTranscript: String(rawTranscript || '').trim(),
    cleanedText: normalized.cleanedText,
    correctedText: interpreted.correctedText,
    normalizedText: normalized.normalizedText,
    canonicalTokens: normalized.canonicalTokens,
    meaningHint: interpreted.meaningHint,
    interpreter: interpreted.interpreter,
    serviceDetection: interpreted.serviceDetection,
    service: interpreted.service,
    intent: interpreted.intent,
    intentConfidence: interpreted.intentConfidence,
    intentMatchedBy: interpreted.intentMatchedBy,
    entities: {
      ...extractEntities(interpreted.correctedText, normalized.canonicalTokens, {
        serviceDetection: interpreted.serviceDetection,
      }),
      ...interpreted.entities,
    },
    confidence: interpreted.confidence,
    lowConfidence: interpreted.confidence.lowConfidence,
    recoverable: Boolean(interpreted.confidence.recoverable),
    llmCorrectedText: interpreted.llmCorrectedText,
    llmCorrectionUsed: true,
    llmBlock: '',
    pipelineMode: 'ai_transcript_interpreter',
    asrScore: meta.asrScore ?? null,
    asrWeak: Boolean(meta.asrWeak),
  }

  analysis.llmBlock = buildLlmPreanalysisBlock(analysis)
  return analysis
}

/**
 * Run full pre-analysis with AI Transcript Interpreter as primary path.
 * @param {object} input
 * @returns {Promise<object>}
 */
async function analyzeVoiceTranscript(input = {}) {
  const rawTranscript = String(input.rawTranscript || '').trim()

  /** @type {object|null} */
  let analysis = null
  let interpreterError = null

  // Primary path: AI Transcript Interpreter (always, when available)
  if (rawTranscript && typeof input.transcriptInterpreter === 'function') {
    try {
      const interpreted = await interpretTranscriptWithAi({
        rawTranscript,
        callLlm: input.transcriptInterpreter,
      })
      if (interpreted?.correctedText) {
        analysis = analysisFromInterpreter(rawTranscript, interpreted, {
          asrScore: input.asrScore,
          asrWeak: input.asrWeak,
        })
      }
    } catch (error) {
      interpreterError = error.message || String(error)
    }
  }

  // Optional legacy llmCorrector path if no dedicated interpreter was provided
  if (!analysis && rawTranscript && typeof input.llmCorrector === 'function') {
    try {
      const llmCorrected = String(await input.llmCorrector({
        rawTranscript,
        correctedText: rawTranscript,
        language: detectLanguage(rawTranscript),
      }) || '').trim()
      if (llmCorrected.length >= 3) {
        analysis = runVoiceAnalysis(llmCorrected, {
          asrScore: input.asrScore,
          asrWeak: false,
          llmCorrectedText: llmCorrected,
          llmCorrectionUsed: true,
        })
        analysis.rawTranscript = rawTranscript
        analysis.pipelineMode = 'llm_correction_fallback'
      }
    } catch (error) {
      interpreterError = interpreterError || error.message || String(error)
    }
  }

  // Final fallback: local rules (never preferred)
  if (!analysis) {
    analysis = runVoiceAnalysis(rawTranscript, {
      asrScore: input.asrScore,
      asrWeak: input.asrWeak,
    })
    analysis.pipelineMode = analysis.pipelineMode || 'rules_fallback'
  }

  if (interpreterError) {
    analysis.interpreterError = interpreterError
  }

  analysis.llmBlock = buildLlmPreanalysisBlock(analysis)

  let archivedAudioPath = null
  if (input.archiveAudio && input.logDir && input.audioPath) {
    archivedAudioPath = archiveOriginalAudio(input.logDir, input.audioPath, input.messageId)
  }

  let logPath = null
  if (input.logDir) {
    logPath = saveVoiceNluLog(input.logDir, {
      message_id: input.messageId || null,
      chat_id: input.chatId || null,
      audio_original_path: archivedAudioPath || input.audioPath || null,
      transcription_brute: analysis.rawTranscript,
      transcription_corrigee: analysis.correctedText,
      transcription_llm: analysis.llmCorrectedText || null,
      llm_correction_used: Boolean(analysis.llmCorrectionUsed),
      ai_transcript_interpreter: analysis.interpreter || null,
      pipeline_mode: analysis.pipelineMode || null,
      normalized_text: analysis.normalizedText,
      langue_detectee: analysis.language,
      reply_language_hint: analysis.replyLanguageHint,
      score_confiance: analysis.confidence.score,
      confiance_faible: analysis.lowConfidence,
      confidence_reasons: analysis.confidence.reasons,
      intention: analysis.intent,
      intention_confidence: analysis.intentConfidence,
      service_detecte: analysis.serviceDetection
        ? {
            service: analysis.serviceDetection.service,
            confidence: analysis.serviceDetection.confidence,
            matched: analysis.serviceDetection.matched,
            match_type: analysis.serviceDetection.matchType,
          }
        : null,
      problem: analysis.interpreter?.problem || analysis.entities?.problem || null,
      entites: analysis.entities,
      meaning_hint: analysis.meaningHint,
      asr_score: input.asrScore ?? null,
      asr_weak: Boolean(input.asrWeak),
      asr_label: input.asrLabel || null,
      interpreter_error: analysis.interpreterError || null,
      pipeline: [
        'audio',
        'speech_to_text',
        analysis.pipelineMode === 'ai_transcript_interpreter' ? 'ai_transcript_interpreter' : null,
        analysis.pipelineMode === 'rules_fallback' ? 'rules_fallback' : null,
        'chatbot',
      ].filter(Boolean),
    })
  }

  analysis.logPath = logPath
  analysis.archivedAudioPath = archivedAudioPath
  return analysis
}

/**
 * Clarification reply — last resort only.
 * @param {'fr'|'darija'|'mixed'|'auto'} language
 * @returns {string}
 */
function buildLowConfidenceVoiceReply(language) {
  if (language === 'darija' || language === 'mixed') {
    return 'سمح ليا، الصوت ما توضحش مزيان. واش تقدر تعاود الميساج الصوتي بشوية، ولا تكتب ليا شنو بغيتي؟'
  }
  return 'Désolé, le message vocal n\'est pas assez clair. Pouvez-vous le répéter un peu plus lentement, ou écrire votre demande ?'
}

module.exports = {
  analyzeVoiceTranscript,
  runVoiceAnalysis,
  buildLlmPreanalysisBlock,
  buildLowConfidenceVoiceReply,
  updateVoiceNluLog,
}
