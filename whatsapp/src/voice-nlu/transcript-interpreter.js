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
  'availability',
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
  availability: 'disponibilites',
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
    'Ton travail est de corriger prudemment les erreurs phonétiques évidentes sans réécrire le sens.',
    'Chaque intention, service, date, heure, téléphone, ville ou nom doit être soutenu par des mots réellement présents dans la transcription.',
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
    'Tu peux retrouver un service malgré une faute phonétique proche, mais tu ne dois jamais choisir un service seulement parce que la conversation concerne un cabinet dentaire.',
    'Si le sens est incertain, utilise intent "other", service null, conserve corrected_text proche du transcript et baisse confidence.',
    '',
    'INTENTS possibles:',
    INTERPRETER_INTENTS.join(', '),
    '',
    'Règles de mapping rapides :',
    '- Patients écrivent souvent en Arabizi (3=ع, 7=ح, 9=ق), alphabet arabe, ou FR+Darija mélangés.',
    '- chno homa les service / ach katdirou / wach katdiro implant / quels sont vos services ⇒ intent ask_services (PAS appointment)',
    '- ch7al taman / combien ⇒ intent price (PAS appointment)',
    '- wach kayn chi blassa ghdda / chno kayn mn rdv / je veux nchof chno kayn ⇒ availability (pas appointment)',
    '- chno les rdv dyali / wach 3ndi chi rdv / شنو المواعيد ديالي ⇒ info sur MES rendez-vous',
    '- bghit nakhod rdv / بغيت ناخد موعد ⇒ appointment',
    '- bghit nlghi / annuler lia rdv ⇒ cancel',
    '- appareil / ta9wim / bagues / brisat ⇒ Orthodontie + intent appointment SEULEMENT si demande de RDV claire',
    '- nettoyage / ditartraj / jir ⇒ Détartrage',
    '- blanchmon / tabyid ⇒ Blanchiment des dents',
    '- facette / veneer ⇒ Facettes dentaires',
    '- traitmon carie / tsous / plombage ⇒ Soins dentaires et traitement des caries',
    '- 3andi wje3 / urgence / nafkha ⇒ Urgence dentaire + intent emergency',
    '- implant seul / "wach katdiro implant" ⇒ ask_services ou info, PAS forcer appointment',
    '- couronne / crown ⇒ Couronnes dentaires',
    '- extraction / n9ala3 ⇒ Extraction dentaire',
    '- enfant / waldi / sghir ⇒ Dentisterie pédiatrique',
    '- lta / gencive ⇒ Soins des gencives',
    '- consultation / nssawal / bghit nchouf tbib ⇒ Consultation',
    '- fo9ach kat7ello / chno les horaires ⇒ hours',
    '- fin kaynin / فين كاين ⇒ location',
    '- Privilégie l\'intention globale de la phrase, jamais mot à mot.',
    '',
    'Réponds uniquement en JSON valide (aucun markdown, aucun texte autour) :',
    '{',
    '  "language": "darija",',
    '  "intent": "appointment",',
    '  "service": "Blanchiment des dents",',
    '  "corrected_text": "Bghit ndir blanchiment.",',
    '  "confidence": 0.70,',
    '  "evidence": ["blanchiment"]',
    '}',
    '',
    'Champs :',
    '- language: "darija" | "fr" | "mixed" | "ar"',
    '- intent: un des intents listés',
    '- service: nom EXACT d\'un service listé, ou null si aucun terme du transcript ne le soutient',
    '- corrected_text: correction minimale et fidèle; ne transforme jamais une disponibilité en création/modification de rendez-vous',
    '- confidence: nombre entre 0 et 1',
    '- evidence: liste de courts extraits exacts du transcript qui justifient intent/service',
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
    'Corrige uniquement ce qui est soutenu par les mots entendus.',
    'Si le transcript ne permet pas une conclusion fiable, retourne intent other, service null et une faible confiance.',
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

function comparableTokens(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []
}

function isConservativeCorrection(rawTranscript, correctedText) {
  const raw = String(rawTranscript || '').trim()
  const corrected = String(correctedText || '').trim()
  if (!corrected || corrected === raw) return true
  const rawTokens = new Set(comparableTokens(raw))
  const correctedTokens = comparableTokens(corrected)
  if (!rawTokens.size || !correctedTokens.length) return false
  const overlap = correctedTokens.filter((token) => rawTokens.has(token)).length
  return overlap / Math.max(rawTokens.size, correctedTokens.length) >= 0.34
}

function hasIntentEvidence(intent, rawTranscript) {
  const raw = String(rawTranscript || '')
  const rules = {
    appointment: /\b(?:rdv|rendez|appointment|mow3id|maw3id|nakhod\s+(?:chi\s+)?(?:rdv|rendez))\b|موعد/i,
    availability: /\b(?:disponib|créneau|creneau|aw9at|wa9t|blassa|chno\s+kayn|wach\s+kayn)\b|متاح|متوفر|الأوقات/i,
    cancel: /\b(?:annul|cancel|nlghi)\b|نلغي/i,
    emergency: /\b(?:urgence|urgent|mosta3jel|nafkha)\b|مستعجل|ورم/i,
    pain: /\b(?:douleur|wje3|waj3|kay?dorni|mal)\b|وجع|كيضر/i,
    hours: /\b(?:horaires?|ouvert|ouverture|kat7ell|fo9ach)\b|وقتاش|حالين/i,
    location: /\b(?:adresse|localisation|fin\s+kayn|parking)\b|فين/i,
    price: /\b(?:prix|taman|ch7al|combien|cout)\b|ثمن|بشحال/i,
    greeting: /\b(?:salam|bonjour|bonsoir|hello)\b|سلام/i,
    thanks: /\b(?:merci|choukran|thanks)\b|شكرا/i,
    ask_services: /\b(?:services?|soins?|ach\s+katdir|chno\s+kat9edm)\b|خدمات/i,
    treatment: /\b(?:ta9wim|orthodont|detar|détar|carie|implant|couronne|extraction|blanchiment|facette)\b|تقويم|تسوس|خلع/i,
    info: /\b(?:info|question|nssawal|wach)\b|سؤال/i,
    other: true,
  }
  const rule = rules[intent]
  return rule === true || (rule instanceof RegExp && rule.test(raw))
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

  const requestedIntent = String(parsed?.intent || 'other').toLowerCase().trim()
  const intentSupported = INTERPRETER_INTENTS.includes(requestedIntent)
    && hasIntentEvidence(requestedIntent, rawTranscript)
  const interpreterIntent = intentSupported ? requestedIntent : 'other'
  let internalIntent = INTENT_TO_INTERNAL[interpreterIntent] || 'autre'

  const proposedCorrection = String(parsed?.corrected_text || parsed?.correctedText || '').trim()
  const correctionAccepted = isConservativeCorrection(rawTranscript, proposedCorrection)
  const correctedText = correctionAccepted && proposedCorrection
    ? proposedCorrection
    : String(rawTranscript || '').trim()

  const rawService = detectService(rawTranscript)
  const proposedService = resolveService(parsed?.service, correctedText)
  const serviceResolved = rawService && proposedService?.serviceId === rawService.serviceId
    ? proposedService
    : (rawService || null)
  const problemSupported = ['pain', 'emergency'].includes(interpreterIntent)
  const problem = problemSupported && String(parsed?.problem || '').trim()
    ? String(parsed.problem).trim()
    : null
  let confidence = Math.max(0, Math.min(1, Number(parsed?.confidence ?? 0.35)))
  if (!correctionAccepted || !intentSupported) confidence = Math.min(confidence, 0.35)

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
      correctionAccepted,
      intentEvidence: intentSupported,
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
      recoverable: confidence >= 0.5,
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
  hasIntentEvidence,
  isConservativeCorrection,
  interpretTranscriptWithAi,
}
