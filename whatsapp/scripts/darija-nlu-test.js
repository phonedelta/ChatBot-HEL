const assert = require('assert')
const {
  analyzeVoiceTranscript,
  detectIntent,
  detectLanguage,
  detectService,
  normalizeTranscript,
} = require('../src/voice-nlu')

const cases = [
  {
    text: 'Salam docteur.',
    expectLanguage: 'darija',
    expectIntent: 'salutation',
  },
  {
    text: '3andi darssa kadarni',
    expectLanguage: 'darija',
    expectIntent: 'douleur',
    expectMeaning: /douleur/i,
  },
  {
    text: 'Bghit rendez-vous.',
    expectLanguage: 'darija',
    expectIntent: 'prise_rendez_vous',
  },
  {
    text: '3endi nafkha.',
    expectLanguage: 'darija',
    expectIntent: 'urgence',
  },
  {
    text: 'Bghit n9ala3 ders.',
    expectLanguage: 'darija',
    expectIntent: 'extraction',
  },
  {
    text: 'Fin kayn cabinet ?',
    expectLanguage: 'darija',
    expectIntent: 'localisation',
  },
  {
    text: 'Ch7al taman dyal implant ?',
    expectLanguage: 'darija',
    expectIntent: 'prix',
  },
  {
    text: 'N9dar nji ghdda ?',
    expectLanguage: 'darija',
    expectIntent: 'prise_rendez_vous',
  },
  {
    text: 'Bghit nbddl rendez-vous.',
    expectLanguage: 'darija',
    expectIntent: 'annulation_rendez_vous',
  },
  {
    text: 'Kayn chi blassa l parking ?',
    expectLanguage: 'darija',
    expectIntent: 'localisation',
  },
  {
    text: 'euh kan wje3ni dersi hmm',
    expectLanguage: 'darija',
    expectIntent: 'douleur',
  },
  {
    text: 'Bonjour, quels sont vos horaires ?',
    expectLanguage: 'fr',
    expectIntent: 'horaires',
  },
  {
    // Noisy ASR — must still understand booking intent
    text: 'Bghit ndir had serviss w baghit nakhod randivo bach nji',
    expectLanguage: 'darija',
    expectIntent: 'prise_rendez_vous',
    expectMeaning: /rendez-vous/i,
    expectNotLow: true,
  },
  {
    text: 'baghit randivo',
    expectLanguage: 'darija',
    expectIntent: 'prise_rendez_vous',
  },
  {
    text: 'Bghit tabyit snan',
    expectLanguage: 'darija',
    expectIntent: 'blanchiment',
    expectService: 'Blanchiment des dents',
  },
  {
    text: '3andi ortodonti',
    expectLanguage: 'darija',
    expectIntent: 'appareil_dentaire',
    expectService: 'Orthodontie',
  },
  {
    text: 'bghit tn9iya dial snan',
    expectLanguage: 'darija',
    expectService: 'Détartrage',
  },
  {
    text: 'wje3 f lta',
    expectLanguage: 'darija',
    expectService: 'Soins des gencives',
  },
  {
    text: 'blanshmon',
    expectLanguage: 'fr',
    expectService: 'Blanchiment des dents',
  },
]

async function run() {
  let passed = 0

  const normalizedSample = normalizeTranscript('baghit nkhod randivo')
  assert.match(normalizedSample.correctedText, /bghit|vouloir|rendez-vous|prendre/i)

  for (const testCase of cases) {
    const analysis = await analyzeVoiceTranscript({
      rawTranscript: testCase.text,
      asrScore: 40,
      asrWeak: false,
    })

    assert.strictEqual(
      analysis.language,
      testCase.expectLanguage,
      `language mismatch for "${testCase.text}": got ${analysis.language}`,
    )
    if (testCase.expectIntent) {
      assert.strictEqual(
        analysis.intent,
        testCase.expectIntent,
        `intent mismatch for "${testCase.text}": got ${analysis.intent}`,
      )
    }

    if (testCase.expectService) {
      assert.ok(analysis.serviceDetection, `missing service for "${testCase.text}"`)
      assert.strictEqual(
        analysis.serviceDetection.service,
        testCase.expectService,
        `service mismatch for "${testCase.text}": got ${analysis.serviceDetection?.service}`,
      )
      assert.ok(
        analysis.serviceDetection.confidence >= 0.72,
        `low service confidence for "${testCase.text}"`,
      )
    }

    if (testCase.expectMeaning) {
      assert.match(
        analysis.meaningHint || '',
        testCase.expectMeaning,
        `meaning mismatch for "${testCase.text}"`,
      )
    }

    if (testCase.expectNotLow) {
      assert.strictEqual(
        analysis.lowConfidence,
        false,
        `should not be low confidence for "${testCase.text}"`,
      )
    }

    assert.ok(analysis.correctedText, `missing corrected text for "${testCase.text}"`)
    assert.ok(analysis.llmBlock.includes('Intent:'), 'llm block incomplete')
    passed += 1
    const label = testCase.expectService || testCase.expectIntent || 'ok'
    console.log(`ok  ${String(label).padEnd(36)} <= ${testCase.text}`)
  }

  assert.strictEqual(detectIntent('bghit nji').intent, 'prise_rendez_vous')
  assert.strictEqual(detectLanguage('الله يشافيكم').startsWith('d') || detectLanguage('الله يشافيكم') === 'darija', true)

  // Absolute language adaptation rule
  const { toReplyLanguageHint } = require('../src/voice-nlu/language')
  const langCases = [
    ['Bonjour, je voudrais prendre un rendez-vous.', 'fr'],
    ['Quels sont vos services ?', 'fr'],
    ['Bghit rendez-vous.', 'darija'],
    ['Bghit un rendez-vous.', 'darija'],
    ['3andi wje3 f dersi.', 'darija'],
    ['3andi douleur.', 'darija'],
    ['Chno homa les services li kaynin ?', 'darija'],
    ['Kanbghi nettoyage.', 'darija'],
    ['Chno taman dyal implant ?', 'darija'],
    ['بغيت موعد.', 'darija'],
    ['Bghit ndir blanchiment.', 'darija'],
    ['3andi urgence.', 'darija'],
  ]
  for (const [sample, expected] of langCases) {
    const detected = detectLanguage(sample)
    const reply = toReplyLanguageHint(detected)
    assert.strictEqual(
      reply,
      expected,
      `language rule failed for "${sample}": detected=${detected} reply=${reply} expected=${expected}`,
    )
  }

  const fuzzyBlanchiment = detectService('tabyit')
  assert.ok(fuzzyBlanchiment)
  assert.strictEqual(fuzzyBlanchiment.service, 'Blanchiment des dents')

  const fuzzyOrtho = detectService('ortodonti')
  assert.ok(fuzzyOrtho)
  assert.strictEqual(fuzzyOrtho.service, 'Orthodontie')

  console.log(`\ndarija nlu tests: ${passed}/${cases.length} passed`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
