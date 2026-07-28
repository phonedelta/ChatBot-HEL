/**
 * End-to-end voice NLU pre-analysis pipeline.
 *
 * Audio ASR text
 *   → normalizeTranscript()
 *   → language
 *   → intent / entities / confidence
 *   → (optional) LLM correction if still weak
 *   → LLM payload + logs
 */

const { detectLanguage, toReplyLanguageHint } = require('./language')
const { normalizeTranscript } = require('./normalize-transcript')
const { buildMeaningHint } = require('./normalize')
const { detectIntent } = require('./intent')
const { extractEntities } = require('./entities')
const { computeVoiceConfidence } = require('./confidence')
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

  return [
    'VOICE PRE-ANALYSIS (trusted structured understanding):',
    `Language: ${analysis.language}`,
    `Reply language: ${analysis.replyLanguageHint}`,
    `Corrected text: ${analysis.correctedText}`,
    analysis.normalizedText ? `Normalized text: ${analysis.normalizedText}` : null,
    analysis.llmCorrectedText ? `LLM-corrected text: ${analysis.llmCorrectedText}` : null,
    analysis.meaningHint ? `Meaning hint (FR): ${analysis.meaningHint}` : null,
    `Intent: ${analysis.intent}`,
    `Intent confidence: ${analysis.intentConfidence}`,
    `ASR/NLU confidence: ${analysis.confidence.score}`,
    'Entities:',
    entityLines,
    '',
    'Instructions for this turn:',
    '- Answer the patient intent above directly.',
    '- Use the corrected/normalized meaning; do not invent facts not supported by clinic knowledge.',
    '- Reply in the reply language indicated (Darija ⇒ Arabic script only).',
    '- Prefer interpreting imperfect Darija ASR over saying you did not understand.',
  ].filter((line) => line !== null).join('\n')
}

/**
 * Core sync analysis on one transcript string.
 * @param {string} rawTranscript
 * @param {object} meta
 */
function runVoiceAnalysis(rawTranscript, meta = {}) {
  const normalized = normalizeTranscript(rawTranscript)
  const workingText = normalized.correctedText || normalized.cleanedText || rawTranscript
  // Detect language on the original ASR + cleaned text (before canonical FR glosses like "vouloir").
  const language = detectLanguage(`${rawTranscript} ${normalized.cleanedText}`)
  const replyLanguageHint = toReplyLanguageHint(language)
  const meaningHint = buildMeaningHint(normalized.normalizedText, normalized.canonicalTokens)
  const intentSource = [
    rawTranscript,
    normalized.cleanedText,
    workingText,
    normalized.normalizedText,
  ].filter(Boolean).join(' ')

  const intentResult = detectIntent(intentSource, normalized.canonicalTokens, {
    primaryText: workingText || normalized.cleanedText || rawTranscript,
  })
  const entities = extractEntities(intentSource, normalized.canonicalTokens)
  const confidence = computeVoiceConfidence({
    asrScore: meta.asrScore,
    asrWeak: meta.asrWeak,
    rawText: rawTranscript,
    correctedText: workingText,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    meaningHint,
    canonicalTokens: normalized.canonicalTokens,
  })

  const analysis = {
    language,
    replyLanguageHint,
    rawTranscript: String(rawTranscript || '').trim(),
    cleanedText: normalized.cleanedText,
    correctedText: workingText,
    normalizedText: normalized.normalizedText,
    canonicalTokens: normalized.canonicalTokens,
    meaningHint,
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
  }

  analysis.llmBlock = buildLlmPreanalysisBlock(analysis)
  return analysis
}

/**
 * Run full pre-analysis. Optionally calls llmCorrector when confidence is low.
 * @param {object} input
 * @returns {Promise<object>|object}
 */
async function analyzeVoiceTranscript(input = {}) {
  const rawTranscript = String(input.rawTranscript || '').trim()
  let analysis = runVoiceAnalysis(rawTranscript, {
    asrScore: input.asrScore,
    asrWeak: input.asrWeak,
  })

  // Second pass: LLM repair for imperfect Darija ASR — never give up too early.
  const needsLlmPass = Boolean(
    typeof input.llmCorrector === 'function'
    && rawTranscript
    && (
      analysis.lowConfidence
      || analysis.intent === 'autre'
      || analysis.confidence.score < 0.55
      || input.asrWeak
    )
  )

  if (needsLlmPass) {
    try {
      const llmCorrected = String(await input.llmCorrector({
        rawTranscript,
        correctedText: analysis.correctedText,
        language: analysis.language,
        intent: analysis.intent,
      }) || '').trim()

      if (llmCorrected && llmCorrected.length >= 3) {
        const second = runVoiceAnalysis(llmCorrected, {
          asrScore: input.asrScore,
          asrWeak: false,
          llmCorrectedText: llmCorrected,
          llmCorrectionUsed: true,
        })
        // Keep original raw ASR for logs.
        second.rawTranscript = rawTranscript
        second.cleanedText = analysis.cleanedText
        // Prefer second pass if intent improved or confidence rose.
        if (
          second.intent !== 'autre'
          || second.confidence.score >= analysis.confidence.score
          || second.meaningHint
        ) {
          analysis = second
        } else {
          analysis.llmCorrectedText = llmCorrected
          analysis.llmCorrectionUsed = true
        }
      }
    } catch (error) {
      analysis.llmCorrectionError = error.message || String(error)
    }
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
      normalized_text: analysis.normalizedText,
      langue_detectee: analysis.language,
      reply_language_hint: analysis.replyLanguageHint,
      score_confiance: analysis.confidence.score,
      confiance_faible: analysis.lowConfidence,
      confidence_reasons: analysis.confidence.reasons,
      intention: analysis.intent,
      intention_confidence: analysis.intentConfidence,
      entites: analysis.entities,
      meaning_hint: analysis.meaningHint,
      asr_score: input.asrScore ?? null,
      asr_weak: Boolean(input.asrWeak),
      asr_label: input.asrLabel || null,
      pipeline: [
        'audio',
        'speech_to_text',
        'normalizeTranscript',
        analysis.llmCorrectionUsed ? 'llm_correction' : null,
        'language_detection',
        'intent',
        'response',
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
