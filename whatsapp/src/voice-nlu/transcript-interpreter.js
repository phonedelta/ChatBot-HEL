/**
 * AI Transcript Interpreter
 *
 * Pipeline step between Speech-To-Text and Chatbot:
 *   raw ASR → LLM interpreter → clean structured JSON → chatbot
 *
 * Primary goal: recover patient meaning from noisy Moroccan Darija ASR.
 * Spelling correction is secondary to intent/service understanding.
 */

const { SERVICES, detectService } = require('./services-dictionary')
const { toReplyLanguageHint } = require('./language')

/** Canonical clinic services (exact labels returned in JSON). */
const CLINIC_SERVICES = [
  'Orthodontie',
  'Soins dentaires et traitement des caries',
  'Détartrage',
  'Soins des gencives',
  'Dentisterie pédiatrique',
  'Facettes dentaires',
  'Blanchiment des dents',
  'Implants dentaires',
  'Couronnes dentaires',
  'Extraction dentaire',
  'Consultation',
  'Urgence dentaire',
]

const INTERPRETER_INTENTS = [
  'appointment',
  'emergency',
  'pain',
  'treatment',
  'info',
  'ask_services',
  'hours',
  'location',
  'price',
  'greeting',
  'thanks',
  'cancel',
  'other',
]

const INTENT_TO_INTERNAL = {
  appointment: 'prise_rendez_vous',
  emergency: 'urgence',
  pain: 'douleur',
  treatment: 'traitement',
  info: 'consultation',
  ask_services: 'consultation',
  hours: 'horaires',
  location: 'localisation',
  price: 'prix',
  greeting: 'salutation',
  thanks: 'remerciement',
  cancel: 'annulation_rendez_vous',
  other: 'autre',
}

/**
 * Build system instructions for the Moroccan dental transcript interpreter.
 * @returns {string}
 */
function buildInterpreterInstructions() {
  return [
    'Tu es un assistant marocain spécialisé dans l\'interprétation de la darija marocaine.',
    '',
    'Tu reçois une transcription Whisper qui peut contenir beaucoup d\'erreurs.',
    '',
    'Les patients parlent naturellement en mélangeant :',
    '- darija',
    '- français',
    '- arabe',
    '- termes médicaux',
    '',
    'Ton travail n\'est PAS de corriger l\'orthographe.',
    'Ton travail est de retrouver ce que le patient voulait réellement dire.',
    '',
    'Tu dois reconnaître automatiquement les services dentaires suivants :',
    ...CLINIC_SERVICES.map((name) => `- ${name}`),
    '',
    'Le patient peut dire :',
    '"Bghit appareil"',
    '"Bghit ta9wim"',
    '"Kan bghi nettoyage"',
    '"3andi wje3"',
    '"Facette"',
    '"Blanchmon"',
    '"Ditartraj"',
    '"Traitmon carie"',
    '',
    'Tu dois retrouver automatiquement le bon service même si la transcription contient des fautes importantes.',
    '',
    'Ne réponds jamais "je ne comprends pas".',
    'Si tu as un doute, retourne le service le plus probable avec un niveau de confiance.',
    '',
    'INTENTS possibles:',
    INTERPRETER_INTENTS.join(', '),
    '',
    'Règles de mapping rapides :',
    '- chno homa les service / ach katdirou / chno kayn / quels sont vos services ⇒ intent ask_services (pas un service précis)',
    '- appareil / ta9wim / bagues / brisat ⇒ Orthodontie + intent appointment',
    '- nettoyage / ditartraj / jir ⇒ Détartrage + intent appointment',
    '- blanchmon / tabyid ⇒ Blanchiment des dents + intent appointment',
    '- facette / veneer ⇒ Facettes dentaires + intent appointment',
    '- traitmon carie / tsous / plombage ⇒ Soins dentaires et traitement des caries',
    '- 3andi wje3 / urgence / nafkha ⇒ Urgence dentaire + intent emergency',
    '- implant ⇒ Implants dentaires',
    '- couronne / crown ⇒ Couronnes dentaires',
    '- extraction / n9ala3 ⇒ Extraction dentaire',
    '- enfant / waldi / sghir ⇒ Dentisterie pédiatrique',
    '- lta / gencive ⇒ Soins des gencives',
    '- consultation / nssawal / bghit nchouf tbib ⇒ Consultation',
    '- Privilégie l\'intention globale de la phrase, jamais mot à mot.',
    '',
    'Réponds uniquement en JSON valide (aucun markdown, aucun texte autour) :',
    '{',
    '  "language": "darija",',
    '  "intent": "appointment",',
    '  "service": "Blanchiment des dents",',
    '  "corrected_text": "Bghit ndir blanchiment.",',
    '  "confidence": 0.97',
    '}',
    '',
    'Champs :',
    '- language: "darija" | "fr" | "mixed" | "ar"',
    '- intent: un des intents listés',
    '- service: nom EXACT d\'un service listé ci-dessus (jamais null si un service est probable)',
    '- corrected_text: reformulation courte du sens patient (darija latine OK), pas une traduction scolaire',
    '- confidence: nombre entre 0 et 1',
    '- Tu peux aussi ajouter "problem" (motif FR court) si utile, sinon omets-le.',
  ].join('\n')
}

/**
 * @param {string} rawTranscript
 * @returns {string}
 */
function buildInterpreterUserPrompt(rawTranscript) {
  return [
    'Interprète cette transcription Whisper d\'un patient marocain.',
    'Retrouve le sens réel, le service dentaire et l\'intention.',
    'Ne dis jamais que tu ne comprends pas.',
    'Réponds uniquement en JSON.',
    '',
    `Transcription: ${String(rawTranscript || '').trim()}`,
  ].join('\n')
}

/**
 * Extract first JSON object from model output.
 * @param {string} text
 * @returns {object|null}
 */
function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Map free-form service label to catalog entry.
 * @param {string|null|undefined} serviceName
 * @param {string} correctedText
 */
function resolveService(serviceName, correctedText = '') {
  const wanted = String(serviceName || '').trim().toLowerCase()

  if (wanted) {
    const exactClinic = CLINIC_SERVICES.find((name) => name.toLowerCase() === wanted)
    const exact = SERVICES.find((item) => item.service.toLowerCase() === wanted)
      || (exactClinic ? SERVICES.find((item) => item.service === exactClinic) : null)

    if (exact) {
      return {
        service: exact.service,
        serviceId: exact.id,
        crmProblem: exact.crmProblem,
        urgency: exact.urgency || 'moyenne',
        intent: exact.intent,
      }
    }

    const fuzzy = SERVICES.find((item) => (
      item.service.toLowerCase().includes(wanted)
      || wanted.includes(item.service.toLowerCase())
      || item.crmProblem.toLowerCase() === wanted
      || item.id === wanted.replace(/\s+/g, '_')
    ))
    if (fuzzy) {
      return {
        service: fuzzy.service,
        serviceId: fuzzy.id,
        crmProblem: fuzzy.crmProblem,
        urgency: fuzzy.urgency || 'moyenne',
        intent: fuzzy.intent,
      }
    }

    if (/implant/i.test(wanted)) {
      return {
        service: 'Implants dentaires',
        serviceId: 'implants',
        crmProblem: 'implant',
        urgency: 'basse',
        intent: 'implant',
      }
    }
    if (/couronne|crown/i.test(wanted)) {
      return {
        service: 'Couronnes dentaires',
        serviceId: 'couronnes',
        crmProblem: 'couronne dentaire',
        urgency: 'basse',
        intent: 'traitement',
      }
    }
    if (/extraction|arracher|قلع/i.test(wanted)) {
      return {
        service: 'Extraction dentaire',
        serviceId: 'extraction',
        crmProblem: 'extraction',
        urgency: 'moyenne',
        intent: 'extraction',
      }
    }
    if (/consult/i.test(wanted)) {
      return {
        service: 'Consultation',
        serviceId: 'consultation',
        crmProblem: 'consultation générale',
        urgency: 'basse',
        intent: 'consultation',
      }
    }
  }

  const dictionaryHit = detectService(`${serviceName || ''} ${correctedText || ''}`)
  if (dictionaryHit) {
    return {
      service: dictionaryHit.service,
      serviceId: dictionaryHit.serviceId,
      crmProblem: dictionaryHit.crmProblem,
      urgency: dictionaryHit.urgency,
      intent: dictionaryHit.intent,
      confidence: dictionaryHit.confidence,
      matched: dictionaryHit.matched,
      matchType: dictionaryHit.matchType,
    }
  }

  return null
}

/**
 * Normalize interpreter JSON into internal voice-nlu analysis fields.
 * @param {object} parsed
 * @param {string} rawTranscript
 */
function normalizeInterpreterResult(parsed, rawTranscript) {
  const languageRaw = String(parsed?.language || 'darija').toLowerCase()
  const language = ['fr', 'darija', 'mixed', 'ar', 'auto'].includes(languageRaw)
    ? (languageRaw === 'ar' ? 'darija' : languageRaw)
    : 'darija'

  const interpreterIntent = String(parsed?.intent || 'other').toLowerCase().trim()
  let internalIntent = INTENT_TO_INTERNAL[interpreterIntent] || 'autre'

  const correctedText = String(parsed?.corrected_text || parsed?.correctedText || '').trim()
    || String(rawTranscript || '').trim()

  const serviceResolved = resolveService(parsed?.service, correctedText)
  const problem = String(parsed?.problem || '').trim() || null
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.85)))

  if (serviceResolved?.intent === 'urgence' || interpreterIntent === 'emergency') {
    internalIntent = 'urgence'
  } else if (
    serviceResolved
    && ['autre', 'traitement', 'consultation'].includes(internalIntent)
    && interpreterIntent === 'appointment'
  ) {
    internalIntent = 'prise_rendez_vous'
  } else if (serviceResolved?.intent === 'blanchiment' && internalIntent === 'autre') {
    internalIntent = 'blanchiment'
  } else if (serviceResolved?.intent === 'appareil_dentaire' && internalIntent === 'autre') {
    internalIntent = 'appareil_dentaire'
  } else if (serviceResolved?.intent === 'implant') {
    internalIntent = internalIntent === 'autre' ? 'implant' : internalIntent
  } else if (serviceResolved?.intent === 'extraction') {
    internalIntent = internalIntent === 'autre' ? 'extraction' : internalIntent
  }

  const meaningHint = [
    problem ? `Problème: ${problem}.` : null,
    serviceResolved ? `Service demandé: ${serviceResolved.service}.` : null,
    interpreterIntent === 'appointment' ? 'Le patient veut un rendez-vous / ce soin.' : null,
    interpreterIntent === 'emergency' ? 'Le patient signale une urgence.' : null,
  ].filter(Boolean).join(' ') || null

  const serviceDetection = serviceResolved
    ? {
        service: serviceResolved.service,
        serviceId: serviceResolved.serviceId,
        confidence: Number(serviceResolved.confidence || confidence || 0.9),
        matched: serviceResolved.matched || 'ai_interpreter',
        matchType: serviceResolved.matchType || 'ai',
        intent: serviceResolved.intent,
        crmProblem: serviceResolved.crmProblem || problem || serviceResolved.service,
        urgency: serviceResolved.urgency || (internalIntent === 'urgence' ? 'haute' : 'moyenne'),
      }
    : null

  return {
    interpreter: {
      language: languageRaw,
      intent: interpreterIntent,
      service: serviceResolved?.service || parsed?.service || null,
      problem,
      corrected_text: correctedText,
      confidence,
      raw: parsed,
    },
    language,
    replyLanguageHint: toReplyLanguageHint(language),
    correctedText,
    llmCorrectedText: correctedText,
    llmCorrectionUsed: true,
    intent: internalIntent,
    intentConfidence: confidence,
    intentMatchedBy: `ai_interpreter:${interpreterIntent}`,
    meaningHint,
    problem,
    serviceDetection,
    service: serviceResolved
      ? { service: serviceResolved.service, confidence: serviceDetection.confidence }
      : null,
    entities: {
      ...(problem ? { problem } : {}),
      ...(serviceResolved ? {
        service: serviceResolved.service,
        service_id: serviceResolved.serviceId,
        service_confidence: serviceDetection.confidence,
        traitement_demande: serviceResolved.crmProblem,
      } : {}),
      ...(internalIntent === 'urgence' ? { urgence: true } : {}),
      ...(internalIntent === 'prise_rendez_vous' ? { demande_rdv: true } : {}),
      ...(internalIntent === 'douleur' || /douleur/i.test(problem || '') ? { douleur: true } : {}),
    },
    confidence: {
      score: confidence,
      lowConfidence: confidence < 0.42,
      reasons: ['ai_transcript_interpreter'],
      recoverable: true,
    },
  }
}

/**
 * Run AI Transcript Interpreter.
 * @param {object} input
 * @returns {Promise<object|null>}
 */
async function interpretTranscriptWithAi(input = {}) {
  const rawTranscript = String(input.rawTranscript || '').trim()
  if (!rawTranscript || typeof input.callLlm !== 'function') {
    return null
  }

  const llmText = await input.callLlm({
    instructions: buildInterpreterInstructions(),
    prompt: buildInterpreterUserPrompt(rawTranscript),
  })

  const parsed = extractJsonObject(llmText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  return normalizeInterpreterResult(parsed, rawTranscript)
}

module.exports = {
  CLINIC_SERVICES,
  INTERPRETER_INTENTS,
  INTENT_TO_INTERNAL,
  buildInterpreterInstructions,
  buildInterpreterUserPrompt,
  extractJsonObject,
  resolveService,
  normalizeInterpreterResult,
  interpretTranscriptWithAi,
}
