const assert = require('assert')
const { classifyIntent, buildIntentDirectReply } = require('../src/voice-nlu')

const askServicesCases = [
  '3afak chno homa les service li kaynin f had centre',
  'Bghit n3ref les service',
  'Ach katdirou',
  'Chno kayn 3andkom',
  'Chno kat9edmo',
  'Chno kaynin mn service',
  'Quels sont vos services',
  'Pouvez-vous me dire les soins disponibles',
  'شنو عندكم',
  'شنو الخدمات',
  'شنو كتقدمو',
]

function run() {
  for (const text of askServicesCases) {
    const hit = classifyIntent(text)
    assert.strictEqual(hit.intent, 'ASK_SERVICES', `expected ASK_SERVICES for: ${text} (got ${hit.intent})`)
    assert.ok(hit.confidence >= 0.7, `low confidence for: ${text} => ${hit.confidence}`)
    console.log(`ok  ASK_SERVICES ${(hit.confidence).toFixed(2)} <= ${text}`)
  }

  const replyFr = buildIntentDirectReply('ASK_SERVICES', 'fr')
  assert.ok(replyFr.includes('Orthodontie'))
  assert.ok(replyFr.includes('Blanchiment des dents'))

  const replyDarija = buildIntentDirectReply('ASK_SERVICES', 'darija')
  assert.ok(replyDarija.includes('تقويم'))
  assert.ok(/خدمات|كاينين|أهلا|نقدم/.test(replyDarija))

  const booking = classifyIntent('Bghit rendez-vous')
  assert.strictEqual(booking.intent, 'BOOK_APPOINTMENT')

  console.log('\nintent classifier tests: passed')
}

run()
