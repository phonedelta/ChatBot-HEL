const assert = require('assert')
const { routePatientMessage } = require('../src/voice-nlu/intent-router')

function run() {
  const extraction = routePatientMessage('Bghit n7yed derssa')
  assert.strictEqual(extraction.language, 'darija')
  assert.strictEqual(extraction.intent, 'BOOK_APPOINTMENT')
  assert.strictEqual(extraction.service, 'Extraction dentaire')
  assert.ok(extraction.serviceConfidence >= 0.8)
  assert.strictEqual(extraction.bookAppointment, true)
  assert.strictEqual(extraction.skipProblemQuestion, true)
  assert.match(extraction.llmBlock, /INTENT ROUTER RESULT/)
  assert.match(extraction.llmBlock, /Extraction dentaire/)

  const services = routePatientMessage('Chno homa les services li kaynin ?')
  assert.strictEqual(services.language, 'darija')
  assert.strictEqual(services.intent, 'ASK_SERVICES')

  const french = routePatientMessage('Bonjour, je voudrais prendre un rendez-vous')
  assert.strictEqual(french.language, 'fr')
  assert.strictEqual(french.intent, 'BOOK_APPOINTMENT')

  const clean = routePatientMessage('Bghit nettoyage des dents')
  assert.strictEqual(clean.service, 'Détartrage')
  assert.strictEqual(clean.bookAppointment, true)

  // Service mention alone must NOT open the booking form
  const consultOnly = routePatientMessage('consultation')
  assert.strictEqual(consultOnly.bookAppointment, false)

  const randomChat = routePatientMessage('salam 3andi wje3 f ders')
  assert.strictEqual(randomChat.bookAppointment, false)

  console.log('intent router test: ok')
}

run()
