/**
 * Conversation language memory + 2-message switch tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  detectLanguage,
  detectLanguageWithConfidence,
  detectExplicitLanguageRequest,
  isLanguageNeutral,
} = require('../src/voice-nlu/language')
const { updateConversationLanguageState } = require('../src/crm/smart/conversation-language')

function assertState(actual, expected) {
  assert.strictEqual(actual.activeLanguage, expected.activeLanguage)
  assert.strictEqual(actual.candidateLanguage, expected.candidateLanguage)
  assert.strictEqual(actual.candidateLanguageCount, expected.candidateLanguageCount)
  assert.strictEqual(actual.switched, expected.switched)
  assert.strictEqual(actual.responseLanguage, expected.responseLanguage)
}

async function run() {
  // Detection — Darija latin / arabic / FR
  assert.strictEqual(detectLanguage('salam khoya'), 'darija')
  assert.strictEqual(detectLanguage('بغيت ناخد موعد'), 'darija')
  assert.strictEqual(detectLanguage('Bonjour, je voudrais un rendez-vous.'), 'fr')
  assert.strictEqual(detectLanguage('bghit rendez-vous ghdda'), 'darija')

  assert.strictEqual(detectExplicitLanguageRequest('Je préfère continuer en français.'), 'fr')
  assert.strictEqual(detectExplicitLanguageRequest('parlez-moi en français'), 'fr')
  assert.strictEqual(detectExplicitLanguageRequest('جاوبني بالدارجة'), 'darija')
  assert.strictEqual(detectExplicitLanguageRequest('هضر معايا بالدارجة'), 'darija')

  assert.strictEqual(isLanguageNeutral('ok'), true)
  assert.strictEqual(isLanguageNeutral('?'), true)
  assert.strictEqual(isLanguageNeutral('👍'), true)
  assert.strictEqual(isLanguageNeutral('oui'), true)
  assert.strictEqual(isLanguageNeutral('Je veux connaître vos horaires.'), false)

  const d1 = detectLanguageWithConfidence('salam khoya')
  assert.strictEqual(d1.language, 'darija')
  assert.ok(d1.reliable)

  const fr1 = detectLanguageWithConfidence('Je veux connaître vos horaires.')
  assert.strictEqual(fr1.language, 'fr')
  assert.ok(fr1.reliable)

  const ok = detectLanguageWithConfidence('ok')
  assert.strictEqual(ok.reliable, false)
  assert.strictEqual(ok.language, 'unknown')

  // Pure state machine
  let state = updateConversationLanguageState({
    activeLanguage: null,
    detectedLanguage: 'darija',
    confidence: 0.9,
    reliable: true,
  })
  assertState(state, {
    activeLanguage: 'darija',
    candidateLanguage: null,
    candidateLanguageCount: 0,
    switched: true,
    responseLanguage: 'darija',
  })

  state = updateConversationLanguageState({
    ...state,
    detectedLanguage: 'fr',
    confidence: 0.94,
    reliable: true,
  })
  assertState(state, {
    activeLanguage: 'darija',
    candidateLanguage: 'fr',
    candidateLanguageCount: 1,
    switched: false,
    responseLanguage: 'darija',
  })

  state = updateConversationLanguageState({
    ...state,
    detectedLanguage: 'fr',
    confidence: 0.95,
    reliable: true,
  })
  assertState(state, {
    activeLanguage: 'fr',
    candidateLanguage: null,
    candidateLanguageCount: 0,
    switched: true,
    responseLanguage: 'fr',
  })

  // Interruption resets candidate
  state = updateConversationLanguageState({
    activeLanguage: 'darija',
    candidateLanguage: 'fr',
    candidateLanguageCount: 1,
    detectedLanguage: 'darija',
    reliable: true,
    confidence: 0.9,
  })
  assertState(state, {
    activeLanguage: 'darija',
    candidateLanguage: null,
    candidateLanguageCount: 0,
    switched: false,
    responseLanguage: 'darija',
  })

  // Neutral leaves candidate intact
  state = updateConversationLanguageState({
    activeLanguage: 'darija',
    candidateLanguage: 'fr',
    candidateLanguageCount: 1,
    detectedLanguage: 'unknown',
    reliable: false,
    confidence: 0.2,
  })
  assertState(state, {
    activeLanguage: 'darija',
    candidateLanguage: 'fr',
    candidateLanguageCount: 1,
    switched: false,
    responseLanguage: 'darija',
  })

  // Persistence via Smart CRM
  const tmpDb = path.join(os.tmpdir(), `hel-lang-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const chat = '212611122233@c.us'

  let s = crm.smart.applyInboundLanguage({ chatId: chat, text: 'salam khoya' })
  assert.strictEqual(s.activeLanguage, 'darija')
  assert.strictEqual(s.responseLanguage, 'darija')

  s = crm.smart.applyInboundLanguage({
    chatId: chat,
    text: 'Je veux connaître vos horaires.',
  })
  assert.strictEqual(s.activeLanguage, 'darija')
  assert.strictEqual(s.candidateLanguage, 'fr')
  assert.strictEqual(s.candidateLanguageCount, 1)
  assert.strictEqual(s.responseLanguage, 'darija')

  s = crm.smart.applyInboundLanguage({ chatId: chat, text: 'ok' })
  assert.strictEqual(s.activeLanguage, 'darija')
  assert.strictEqual(s.candidateLanguage, 'fr')
  assert.strictEqual(s.candidateLanguageCount, 1)

  s = crm.smart.applyInboundLanguage({
    chatId: chat,
    text: 'Est-ce que vous êtes ouverts samedi ?',
  })
  assert.strictEqual(s.activeLanguage, 'fr')
  assert.strictEqual(s.switched, true)
  assert.strictEqual(s.responseLanguage, 'fr')

  const conv = crm.smart.listConversations({ limit: 5 })
    .find((c) => c.external_key === chat)
  assert.ok(conv)
  assert.strictEqual(conv.language, 'fr')
  assert.strictEqual(conv.active_language, 'fr')

  // Restart persistence
  const crm2 = createCrmService({ dbPath: tmpDb })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat), 'fr')

  // FR → Darija switch
  const chat2 = '212644455566@c.us'
  crm2.smart.applyInboundLanguage({ chatId: chat2, text: 'Bonjour, je voudrais un rendez-vous.' })
  let t = crm2.smart.applyInboundLanguage({ chatId: chat2, text: 'wach kayn chi place ghdda' })
  assert.strictEqual(t.activeLanguage, 'fr')
  assert.strictEqual(t.candidateLanguageCount, 1)
  assert.strictEqual(t.responseLanguage, 'fr')
  t = crm2.smart.applyInboundLanguage({ chatId: chat2, text: 'bghit nakhod rendez-vous' })
  assert.strictEqual(t.activeLanguage, 'darija')
  assert.strictEqual(t.responseLanguage, 'darija')

  // Explicit language switch overrides memory immediately
  const chat4 = '212699988877@c.us'
  crm2.smart.applyInboundLanguage({ chatId: chat4, text: 'salam khoya' })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat4), 'darija')
  crm2.smart.applyInboundLanguage({ chatId: chat4, text: 'Je préfère continuer en français.' })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat4), 'fr')

  // Short "Oui" does not flip darija conversation
  const chat5 = '212611133344@c.us'
  crm2.smart.applyInboundLanguage({ chatId: chat5, text: 'bghit nbdl lmo3id' })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat5), 'darija')
  crm2.smart.applyInboundLanguage({ chatId: chat5, text: 'Oui' })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat5), 'darija')

  // Voice does not increment switch counter
  const chat3 = '212677788899@c.us'
  crm2.smart.applyInboundLanguage({ chatId: chat3, text: 'salam khoya' })
  let v = crm2.smart.applyInboundLanguage({
    chatId: chat3,
    text: 'Je voudrais vos horaires s il vous plait',
    isVoice: true,
  })
  assert.strictEqual(v.activeLanguage, 'darija')
  assert.strictEqual(v.candidateLanguageCount, 0)
  assert.strictEqual(v.reason, 'voice_ignored_for_switch')

  // Booking draft not reset by language switch (lead fields kept)
  const conversationId = `main:${chat2}`
  await crm2.processCrmTurn({
    conversationId,
    chatId: chat2,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  let turn = await crm2.processCrmTurn({
    conversationId,
    chatId: chat2,
    userText: [
      'Nom : Amine Benali',
      'Téléphone : 0611223344',
      'Ville : Rabat',
      'Problème : contrôle',
      'Rendez-vous : 10/09/2026 à 11:00',
    ].join('\n'),
    languageHint: 'darija',
  })
  assert.ok(turn.lead.full_name)
  assert.strictEqual(turn.lead.full_name, 'Amine Benali')
  // Switch language while booking open
  crm2.smart.applyInboundLanguage({
    chatId: chat2,
    text: 'Je confirme mon rendez-vous pour jeudi.',
  })
  crm2.smart.applyInboundLanguage({
    chatId: chat2,
    text: 'Est-ce que 11 heures vous convient bien ?',
  })
  assert.strictEqual(crm2.smart.getActiveConversationLanguage(chat2), 'fr')
  const leadAfter = crm2.repo.getLead(conversationId)
  assert.strictEqual(leadAfter.full_name, 'Amine Benali')
  assert.ok(leadAfter.phone_number)

  try {
    fs.unlinkSync(tmpDb)
    fs.unlinkSync(`${tmpDb}-wal`)
    fs.unlinkSync(`${tmpDb}-shm`)
  } catch { /* ignore */ }

  console.log('conversation-language tests OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
