const assert = require('assert')
const {
  analyzeVoiceTranscript,
  detectIntent,
  detectLanguage,
  normalizeTranscript,
} = require('../src/voice-nlu')

const cases = [
  {
    text: 'Salam docteur.',
    expectLanguage: 'darija',
    expectIntent: 'salutation',
  },
  {
    text: 'Kan wje3ni dersi.',
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
    assert.strictEqual(
      analysis.intent,
      testCase.expectIntent,
      `intent mismatch for "${testCase.text}": got ${analysis.intent}`,
    )

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
    console.log(`ok  ${testCase.expectIntent.padEnd(28)} <= ${testCase.text}`)
  }

  assert.strictEqual(detectIntent('bghit nji').intent, 'prise_rendez_vous')
  assert.strictEqual(detectLanguage('الله يشافيكم').startsWith('d') || detectLanguage('الله يشافيكم') === 'darija', true)

  console.log(`\ndarija nlu tests: ${passed}/${cases.length} passed`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
