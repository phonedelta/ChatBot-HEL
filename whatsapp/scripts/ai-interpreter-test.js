const assert = require('assert')
const {
  analyzeVoiceTranscript,
  extractJsonObject,
  normalizeInterpreterResult,
  interpretTranscriptWithAi,
} = require('../src/voice-nlu')

async function run() {
  const parsed = extractJsonObject(`
    Voici le résultat:
    \`\`\`json
    {
      "language": "darija",
      "intent": "appointment",
      "service": "Blanchiment des dents",
      "corrected_text": "Bghit ndir blanchiment des dents.",
      "confidence": 0.95
    }
    \`\`\`
  `)
  assert.ok(parsed)
  assert.strictEqual(parsed.service, 'Blanchiment des dents')

  const blanchiment = normalizeInterpreterResult(parsed, 'Bghit ndir blanchmon')
  assert.strictEqual(blanchiment.intent, 'autre', 'service request without RDV evidence must not start booking')
  assert.strictEqual(blanchiment.serviceDetection.service, 'Blanchiment des dents')
  assert.match(blanchiment.correctedText, /blanchiment/i)

  const urgence = normalizeInterpreterResult({
    language: 'darija',
    intent: 'pain',
    service: null,
    problem: 'Douleur dentaire',
    corrected_text: '3andi wje3 f dersi.',
    confidence: 0.91,
  }, '3andi wje3 f drsa')
  assert.strictEqual(urgence.intent, 'douleur')
  assert.strictEqual(urgence.interpreter.problem, 'Douleur dentaire')
  assert.strictEqual(urgence.serviceDetection, null)

  const appareil = normalizeInterpreterResult({
    language: 'darija',
    intent: 'appointment',
    service: 'Orthodontie',
    corrected_text: 'Bghit appareil dentaire.',
    confidence: 0.9,
  }, 'Bghit apareil')
  assert.strictEqual(appareil.serviceDetection.service, 'Orthodontie')

  // Mocked AI interpreter path
  const mocked = await interpretTranscriptWithAi({
    rawTranscript: 'Kan bghi nettoyage',
    callLlm: async () => JSON.stringify({
      language: 'darija',
      intent: 'appointment',
      service: 'Détartrage',
      corrected_text: 'Kan bghit nettoyage / détartrage.',
      confidence: 0.93,
    }),
  })
  assert.ok(mocked)
  assert.strictEqual(mocked.serviceDetection.service, 'Détartrage')
  assert.strictEqual(mocked.intent, 'autre')

  const ditartraj = normalizeInterpreterResult({
    language: 'darija',
    intent: 'appointment',
    service: 'Détartrage',
    corrected_text: 'Bghit détartrage.',
    confidence: 0.9,
  }, 'Ditartraj')
  assert.strictEqual(ditartraj.serviceDetection.service, 'Détartrage')

  const wje3 = normalizeInterpreterResult({
    language: 'darija',
    intent: 'pain',
    service: null,
    corrected_text: '3andi wje3.',
    confidence: 0.94,
  }, '3andi wje3')
  assert.strictEqual(wje3.intent, 'douleur')
  assert.strictEqual(wje3.confidence.recoverable, true)

  const hallucinatedReschedule = normalizeInterpreterResult({
    language: 'mixed',
    intent: 'appointment',
    service: 'Consultation',
    corrected_text: 'بغيت نبدل الرونديفو ديالي لنهار آخر.',
    confidence: 0.78,
  }, 'أفكشنا أم أبدل راندي فوليد ستكون يبوستيك نهار؟')
  assert.strictEqual(hallucinatedReschedule.intent, 'autre')
  assert.strictEqual(hallucinatedReschedule.serviceDetection, null)
  assert.strictEqual(hallucinatedReschedule.correctedText, 'أفكشنا أم أبدل راندي فوليد ستكون يبوستيك نهار؟')
  assert.strictEqual(hallucinatedReschedule.confidence.lowConfidence, true)
  assert.strictEqual(hallucinatedReschedule.confidence.recoverable, false)

  const availability = normalizeInterpreterResult({
    language: 'mixed',
    intent: 'availability',
    service: null,
    corrected_text: 'Chno l aw9at li disponible f dak nhar',
    confidence: 0.94,
    evidence: ['aw9at', 'disponible'],
  }, 'Chno l aw9at li disponible f dak nhar')
  assert.strictEqual(availability.intent, 'disponibilites')
  assert.strictEqual(availability.interpreter.intent, 'availability')
  assert.strictEqual(availability.confidence.lowConfidence, false)

  let interpreterCalls = 0
  const weakAnalysis = await analyzeVoiceTranscript({
    rawTranscript: "I've actioned a rendezvous with the disponible for the day.",
    asrScore: -20,
    asrWeak: true,
    transcriptInterpreter: async () => {
      interpreterCalls += 1
      return '{}'
    },
  })
  assert.strictEqual(interpreterCalls, 0, 'suspicious ASR must not be semantically rewritten by AI')
  assert.strictEqual(weakAnalysis.pipelineMode, 'rules_fallback')
  assert.strictEqual(weakAnalysis.lowConfidence, true)
  assert.strictEqual(weakAnalysis.recoverable, false)

  interpreterCalls = 0
  const imperfectButUsable = await analyzeVoiceTranscript({
    rawTranscript: 'brit mawid tlat',
    asrScore: 20,
    asrWeak: false,
    asrSuspicious: true,
    transcriptInterpreter: async () => {
      interpreterCalls += 1
      return JSON.stringify({
        language: 'darija',
        intent: 'other',
        service: null,
        corrected_text: 'brit mawid tlat',
        confidence: 0.45,
      })
    },
  })
  assert.strictEqual(interpreterCalls, 1, 'usable imperfect transcript must reach OpenRouter interpreter')
  assert.strictEqual(imperfectButUsable.pipelineMode, 'ai_transcript_interpreter')

  console.log('ai interpreter tests: passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
