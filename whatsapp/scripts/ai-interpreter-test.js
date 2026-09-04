const assert = require('assert')
const {
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
  assert.strictEqual(blanchiment.intent, 'prise_rendez_vous')
  assert.strictEqual(blanchiment.serviceDetection.service, 'Blanchiment des dents')
  assert.match(blanchiment.correctedText, /blanchiment/i)

  const urgence = normalizeInterpreterResult({
    language: 'darija',
    intent: 'emergency',
    service: 'Urgence dentaire',
    problem: 'Douleur dentaire',
    corrected_text: '3andi wje3 f dersi.',
    confidence: 0.91,
  }, '3andi wje3 f drsa')
  assert.strictEqual(urgence.intent, 'urgence')
  assert.strictEqual(urgence.interpreter.problem, 'Douleur dentaire')
  assert.strictEqual(urgence.serviceDetection.service, 'Urgences dentaires')

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
  assert.strictEqual(mocked.intent, 'prise_rendez_vous')

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
    intent: 'emergency',
    service: 'Urgence dentaire',
    corrected_text: '3andi wje3.',
    confidence: 0.94,
  }, '3andi wje3')
  assert.strictEqual(wje3.intent, 'urgence')
  assert.strictEqual(wje3.confidence.recoverable, true)

  console.log('ai interpreter tests: passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
