/**
 * Dental problem / service classification tests (FR, Darija AR, Arabizi, mixed).
 */
const assert = require('assert')
const { classifyDentalProblem } = require('../src/voice-nlu/dental-problem-classifier')
const { routePatientMessage } = require('../src/voice-nlu/intent-router')

/**
 * @param {string} text
 * @param {{ problem?: string|null, service?: string|null, minConfidence?: number, maxConfidence?: number, notService?: string }} expected
 */
function expectClassification(text, expected) {
  const result = classifyDentalProblem(text)
  if (expected.problem !== undefined) {
    assert.strictEqual(result.dentalProblem, expected.problem, `"${text}" → problem`)
  }
  if (expected.service !== undefined) {
    assert.strictEqual(result.service, expected.service, `"${text}" → service`)
  }
  if (expected.minConfidence !== undefined) {
    assert.ok(result.confidence >= expected.minConfidence, `"${text}" confidence ${result.confidence} < ${expected.minConfidence}`)
  }
  if (expected.maxConfidence !== undefined) {
    assert.ok(result.confidence <= expected.maxConfidence, `"${text}" confidence ${result.confidence} > ${expected.maxConfidence}`)
  }
  if (expected.notService) {
    assert.notStrictEqual(result.service, expected.notService, `"${text}" must not be ${expected.notService}`)
  }
}

function runClassifierTests() {
  // --- French ---
  expectClassification('Mes gencives saignent.', {
    problem: 'BLEEDING_GUMS',
    service: 'Soins des gencives',
    minConfidence: 0.8,
    notService: 'Soins dentaires et traitement des caries',
  })
  expectClassification('Je veux faire un détartrage.', {
    problem: 'SCALING_REQUEST',
    service: 'Détartrage',
    minConfidence: 0.8,
  })
  expectClassification("J'ai beaucoup de tartre.", {
    problem: 'TARTAR',
    service: 'Détartrage',
    minConfidence: 0.8,
    notService: 'Urgences dentaires',
  })
  expectClassification("J'ai une carie.", { problem: 'CAVITY', service: 'Soins dentaires et traitement des caries', minConfidence: 0.8 })
  expectClassification('Mes dents sont jaunes.', {
    problem: 'YELLOW_TEETH',
    service: 'Blanchiment des dents',
    minConfidence: 0.8,
    notService: 'Facettes dentaires',
  })
  expectClassification('Je veux faire un blanchiment.', {
    problem: 'WHITENING_REQUEST',
    service: 'Blanchiment des dents',
    minConfidence: 0.8,
  })
  expectClassification('Mes dents se chevauchent.', {
    problem: 'OVERLAPPING_TEETH',
    service: 'Orthodontie',
    minConfidence: 0.8,
  })
  expectClassification('Je veux des gouttières transparentes.', {
    problem: 'BRACES_REQUEST',
    service: 'Orthodontie',
    minConfidence: 0.8,
  })
  expectClassification("J'ai des espaces entre mes dents.", {
    problem: 'GAPS_BETWEEN_TEETH',
    notService: 'Facettes dentaires',
    maxConfidence: 0.85,
  })
  expectClassification('Je veux des facettes.', { problem: 'VENEERS_REQUEST', service: 'Facettes dentaires', minConfidence: 0.8 })
  expectClassification('Je veux un Hollywood Smile.', { problem: 'HOLLYWOOD_SMILE', service: 'Facettes dentaires', minConfidence: 0.8 })
  expectClassification("J'ai très mal à une dent, c'est urgent.", {
    problem: 'EMERGENCY_REQUEST',
    service: 'Urgences dentaires',
    minConfidence: 0.8,
  })
  expectClassification("J'ai mal aux gencives.", { problem: 'GUM_PAIN', service: 'Soins des gencives', minConfidence: 0.8 })
  expectClassification("J'ai mal.", { problem: 'UNKNOWN_DENTAL_PROBLEM', service: null, maxConfidence: 0.55 })
  expectClassification("J'ai un problème à une dent.", {
    problem: 'UNKNOWN_DENTAL_PROBLEM',
    service: null,
    maxConfidence: 0.55,
    notService: 'Soins dentaires et traitement des caries',
  })

  // --- Darija Arabic ---
  expectClassification('اللثة ديالي كتدمي', { problem: 'BLEEDING_GUMS', service: 'Soins des gencives', minConfidence: 0.8 })
  expectClassification('عندي الجير فسناني', { problem: 'TARTAR', service: 'Détartrage', minConfidence: 0.8 })
  expectClassification('بغيت ندير الديتارتراج', { problem: 'SCALING_REQUEST', service: 'Détartrage', minConfidence: 0.8 })
  expectClassification('عندي تسوس', { problem: 'CAVITY', service: 'Soins dentaires et traitement des caries', minConfidence: 0.8 })
  expectClassification('بغيت نبيض سناني', { problem: 'WHITENING_REQUEST', service: 'Blanchiment des dents', minConfidence: 0.8 })
  expectClassification('سناني صفرين', { problem: 'YELLOW_TEETH', service: 'Blanchiment des dents', minConfidence: 0.8 })
  expectClassification('بغيت ندير تقويم الأسنان', { problem: 'BRACES_REQUEST', service: 'Orthodontie', minConfidence: 0.8 })
  expectClassification('سناني ماشي مرصوصين مزيان', { problem: 'OVERLAPPING_TEETH', service: 'Orthodontie', minConfidence: 0.8 })
  expectClassification('بغيت الفينير', { problem: 'VENEERS_REQUEST', service: 'Facettes dentaires', minConfidence: 0.8 })
  expectClassification('بغيت Hollywood Smile', { problem: 'HOLLYWOOD_SMILE', service: 'Facettes dentaires', minConfidence: 0.8 })
  expectClassification('سني كيضرني بزاف و مستعجل', { problem: 'EMERGENCY_REQUEST', service: 'Urgences dentaires', minConfidence: 0.8 })

  // --- Darija Latin ---
  expectClassification('ltha dyali katdmi', { problem: 'BLEEDING_GUMS', service: 'Soins des gencives', minConfidence: 0.8 })
  expectClassification('3ndi jerr f snani', { problem: 'TARTAR', service: 'Détartrage', minConfidence: 0.8 })
  expectClassification('bghit ndir detartrage', { problem: 'SCALING_REQUEST', service: 'Détartrage', minConfidence: 0.8 })
  expectClassification('3ndi tsaws', { problem: 'CAVITY', service: 'Soins dentaires et traitement des caries', minConfidence: 0.8 })
  expectClassification('bghit nbyed snani', { problem: 'WHITENING_REQUEST', service: 'Blanchiment des dents', minConfidence: 0.8 })
  expectClassification('snani sfar', { problem: 'YELLOW_TEETH', service: 'Blanchiment des dents', minConfidence: 0.8 })
  expectClassification('bghit appareil', { problem: 'BRACES_REQUEST', service: 'Orthodontie', minConfidence: 0.8 })
  expectClassification('snani machi mratbin', { problem: 'OVERLAPPING_TEETH', service: 'Orthodontie', minConfidence: 0.8 })
  expectClassification('3ndi faragh bin snani', { problem: 'GAPS_BETWEEN_TEETH', notService: 'Facettes dentaires' })
  expectClassification('bghit veneers', { problem: 'VENEERS_REQUEST', service: 'Facettes dentaires', minConfidence: 0.8 })
  expectClassification('dersi kaydrni bzaf', {
    notService: 'Soins dentaires et traitement des caries',
    minConfidence: 0.55,
  })
  expectClassification('3andi darssa kadarni', {
    problem: 'TOOTH_PAIN',
    service: 'Urgences dentaires',
    minConfidence: 0.55,
    notService: 'Soins dentaires et traitement des caries',
  })
  expectClassification('Darssa kadarni', {
    problem: 'TOOTH_PAIN',
    service: 'Urgences dentaires',
    minConfidence: 0.55,
  })

  // --- Mixed ---
  expectClassification('J\'ai ltha katdmi', { problem: 'BLEEDING_GUMS', service: 'Soins des gencives', minConfidence: 0.8 })
  expectClassification('Je veux appareil hit snani machi mratbin', { problem: 'OVERLAPPING_TEETH', service: 'Orthodontie', minConfidence: 0.8 })

  // Multi-problem
  const multi = classifyDentalProblem('J\'ai du tartre et mes gencives saignent.')
  assert.ok(multi.dentalProblems.includes('BLEEDING_GUMS'))
  assert.ok(multi.dentalProblems.includes('TARTAR') || multi.secondaryProblem === 'TARTAR')

  console.log('dental problem classifier: ok')
}

function runRouterIntegrationTests() {
  const gums = routePatientMessage('Mes gencives saignent.')
  assert.strictEqual(gums.dentalProblem, 'BLEEDING_GUMS')
  assert.strictEqual(gums.service, 'Soins des gencives')
  assert.notStrictEqual(gums.service, 'Soins dentaires et traitement des caries')

  const vague = routePatientMessage("J'ai un problème à une dent.")
  assert.ok(!vague.service || vague.dentalProblem === 'UNKNOWN_DENTAL_PROBLEM')

  const bookingScaling = routePatientMessage('bghit rendez-vous pour détartrage')
  assert.strictEqual(bookingScaling.intent, 'BOOK_APPOINTMENT')
  assert.strictEqual(bookingScaling.service, 'Détartrage')

  const hello = routePatientMessage('Bonjour')
  assert.strictEqual(hello.service, null)

  const rdvOnly = routePatientMessage('Je veux rendez-vous')
  assert.strictEqual(rdvOnly.intent, 'BOOK_APPOINTMENT')
  assert.strictEqual(rdvOnly.service, null)

  const thanks = routePatientMessage('Merci')
  assert.strictEqual(thanks.service, null)

  console.log('dental problem router integration: ok')
}

runClassifierTests()
runRouterIntegrationTests()
