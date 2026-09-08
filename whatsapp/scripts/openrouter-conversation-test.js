const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { createAiProvider } = require('../src/ai/ai-provider')
const {
  buildConversationContext,
  generateAvailabilityReply,
  generateConversationReply,
  isReplyLanguageValid,
} = require('../src/ai/conversation-assistant')
const { detectReplyLanguageHint } = require('../src/voice-nlu/language')
const { routePatientMessage } = require('../src/voice-nlu')
const { classifyIntentSemanticFallback } = require('../src/voice-nlu/semantic-intent-fallback')

function createMockProvider(replyFactory) {
  const calls = []
  return {
    calls,
    isConfigured: () => true,
    async generateChatResponse(request) {
      calls.push(request)
      return {
        text: await replyFactory(request, calls.length),
        id: `mock-${calls.length}`,
        model: 'mock/openrouter',
        provider: 'openrouter',
        latencyMs: 1,
      }
    },
  }
}

async function testFaqUsesProviderAndKnowledge() {
  const provider = createMockProvider(() => 'أنا المساعد الافتراضي ديال مركز الأسنان HEL.')
  const knowledge = 'Nom du cabinet: Centre Dentaire HEL\nAdresse: El Oulfa, Casablanca'
  const result = await generateConversationReply({
    provider,
    userMessage: 'chkon nta',
    router: { intent: 'ASK_IDENTITY', intentConfidence: 0.99 },
    language: 'darija',
    knowledge,
    history: [{ role: 'user', content: 'Nom complet: Donnée Privée' }],
  })
  assert.equal(provider.calls.length, 1)
  assert.match(provider.calls[0].systemPrompt, /Centre Dentaire HEL/)
  assert.match(provider.calls[0].systemPrompt, /El Oulfa/)
  assert.match(provider.calls[0].systemPrompt, /Darija.*arabe script/s)
  assert.equal(provider.calls[0].messages.length, 2, 'FAQ must receive recent history for short contextual follow-ups')
  assert.deepStrictEqual(provider.calls[0].messages.map((message) => message.role), ['user', 'user'])
  assert.equal(result.source, 'ai')
  assert.match(result.reply, /المساعد/)
}

async function testLocationAndServicesUseProvider() {
  const provider = createMockProvider((request) => {
    if (request.intent === 'ASK_LOCATION') return 'العنوان موجود فالمعرفة الرسمية.'
    return 'نعم، كاين تقويم الأسنان فالمركز.'
  })
  await generateConversationReply({
    provider,
    userMessage: 'fin kaynin',
    router: { intent: 'ASK_LOCATION', intentConfidence: 0.95 },
    language: 'darija',
    knowledge: 'Adresse: El Oulfa, Casablanca',
  })
  await generateConversationReply({
    provider,
    userMessage: 'wach katdiro ta9wim ?',
    router: { intent: 'ASK_SERVICES', intentConfidence: 0.94, service: 'Orthodontie' },
    language: 'darija',
    knowledge: 'Services: Orthodontie',
  })
  assert.equal(provider.calls.length, 2)
  assert.equal(provider.calls[0].intent, 'ASK_LOCATION')
  assert.equal(provider.calls[1].intent, 'ASK_SERVICES')
}

async function testBookingInterruptDoesNotMutateDraft() {
  const provider = createMockProvider(() => 'حنا فالألفة فكازا. وبالنسبة للموعد باقي خاصني رقم الهاتف.')
  const lead = {
    stage: 'awaiting_form',
    awaiting_field: 'phone_number',
    full_name: 'Salim Zouhairi',
    city: 'Rabat',
    phone_number: null,
    problem: 'Orthodontie',
    appointment_date: '2026-09-10',
    appointment_time: '11:00',
  }
  const before = JSON.parse(JSON.stringify(lead))
  const result = await generateConversationReply({
    provider,
    userMessage: 'fin kaynin',
    router: { intent: 'ASK_LOCATION', intentConfidence: 0.98 },
    language: 'darija',
    lead,
    missingFields: ['phone_number'],
    knowledge: 'Adresse: El Oulfa, Casablanca',
  })
  assert.deepStrictEqual(lead, before)
  assert.equal(result.context.booking.awaiting_field, 'phone_number')
  assert.equal(result.context.booking.draft_fields_present.full_name, true)
  assert.equal(result.context.booking.draft_fields_present.phone_number, false)
}

async function testInventedSlotCannotEscape() {
  const provider = createMockProvider(() => 'ممكن تختار 10:30 أو 11:00 أو 14:00.')
  const result = await generateAvailabilityReply({
    provider,
    userMessage: 'chno kayn mardi',
    language: 'darija',
    date: '2026-09-15',
    availableSlots: ['10:30', '11:00'],
    knowledge: 'Horaires fournis par le backend.',
  })
  assert.match(result.reply, /10:30/)
  assert.match(result.reply, /11:00/)
  assert.match(result.reply, /15\/09\/2026/)
  assert.ok(!result.reply.includes('14:00'))
  assert.deepStrictEqual(result.exactSlots, ['10:30', '11:00'])
}

async function testProviderDownKeepsSafeFallback() {
  const lead = { stage: 'awaiting_form', awaiting_field: 'phone_number', full_name: 'Salim Zouhairi' }
  const before = JSON.parse(JSON.stringify(lead))
  const result = await generateConversationReply({
    provider: { isConfigured: () => false },
    userMessage: 'fin kaynin',
    language: 'darija',
    lead,
  })
  assert.equal(result.source, 'safe_fallback')
  assert.match(result.reply, /محفوظة/)
  assert.deepStrictEqual(lead, before)
}

async function testMissingKnowledgeGuardIsInjected() {
  const provider = createMockProvider(() => 'Le tarif précis ne figure pas dans les informations disponibles.')
  const result = await generateConversationReply({
    provider,
    userMessage: 'Combien coûte un implant ?',
    router: { intent: 'ASK_PRICE', intentConfidence: 0.96 },
    language: 'fr',
    knowledge: 'Services: Orthodontie. Aucun tarif publié.',
  })
  assert.match(provider.calls[0].systemPrompt, /absente/i)
  assert.match(provider.calls[0].systemPrompt, /N’invente jamais.*prix/s)
  assert.ok(!/\\b\\d+[.,]?\\d*\\s*(dh|mad|dirham)/i.test(result.reply))
}

async function testProviderTransportIsCentralized() {
  const calls = []
  const provider = createAiProvider({
    apiKey: 'mock-key',
    model: 'mock/model',
    providerName: 'openrouter',
    logger: { log() {}, warn() {} },
    client: {
      chat: {
        completions: {
          async create(request) {
            calls.push(request)
            return { id: 'r1', model: request.model, choices: [{ message: { content: 'Bonjour.' } }] }
          },
        },
      },
    },
  })
  const response = await provider.generateChatResponse({
    systemPrompt: 'Règles',
    messages: [{ role: 'user', content: 'Bonjour' }],
  })
  assert.equal(response.text, 'Bonjour.')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].messages[0].role, 'system')
}

async function testOtherIntentStillUsesProviderAndHistory() {
  const provider = createMockProvider(() => 'المشكل كان مؤقت، ودابا نقدر نجاوبك.')
  const result = await generateConversationReply({
    provider,
    userMessage: 'Dialach problème ?',
    router: { intent: 'OTHER', intentConfidence: 0.3 },
    language: 'darija',
    knowledge: 'Centre Dentaire HEL',
    history: [
      { role: 'user', content: 'Chkon kaydwi m3aya ?' },
      { role: 'assistant', content: 'أنا المساعد الافتراضي ديال المركز.' },
      { role: 'user', content: 'Gol ?' },
      { role: 'assistant', content: 'مرحبا، كيف نقدر نعاونك؟' },
    ],
  })
  assert.equal(provider.calls.length, 1)
  assert.equal(provider.calls[0].intent, 'OTHER')
  assert.equal(provider.calls[0].messages.length, 5)
  assert.deepStrictEqual(
    provider.calls[0].messages.slice(0, 4).map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant'],
  )
  assert.equal(result.source, 'ai')
}

async function testProviderAuthAndEmptyOutputErrorsAreObservable() {
  const logs = []
  const authProvider = createAiProvider({
    apiKey: 'mock-key',
    model: 'mock/model',
    providerName: 'openrouter',
    debug: true,
    logger: { log(label, data) { logs.push({ label, data }) }, warn(label, data) { logs.push({ label, data }) } },
    client: {
      chat: {
        completions: {
          async create() {
            const error = new Error('Invalid API key')
            error.status = 401
            error.code = 'invalid_api_key'
            error.error = { message: 'Invalid API key', authorization: 'Bearer secret-for-test' }
            throw error
          },
        },
      },
    },
  })
  await assert.rejects(() => authProvider.generateChatResponse({
    messages: [{ role: 'user', content: 'Bonjour' }],
  }), (error) => error.status === 401)
  const errorLog = logs.find((entry) => entry.label === '[AI ERROR]')
  assert.equal(errorLog.data.status, 401)
  assert.ok(!errorLog.data.responseBody.includes('secret-for-test'))

  const emptyProvider = createAiProvider({
    apiKey: 'mock-key',
    model: 'mock/model',
    logger: { log() {}, warn() {} },
    client: {
      chat: {
        completions: {
          async create() {
            return { choices: [{ message: { content: '' } }] }
          },
        },
      },
    },
  })
  await assert.rejects(
    () => emptyProvider.generateChatResponse({ messages: [{ role: 'user', content: 'Bonjour' }] }),
    (error) => error.code === 'AI_EMPTY_OUTPUT',
  )
}

function testDarijaScenarioLanguageDetection() {
  assert.equal(detectReplyLanguageHint('Chkon kaydwi m3aya'), 'darija')
  assert.equal(detectReplyLanguageHint('Dialach problème ?'), 'darija')
}

async function testExactContextualScenarioUsesAi() {
  const provider = createMockProvider((_request, callNumber) => [
    'وعليكم السلام، مرحبا بك.',
    'معاك المساعد الافتراضي ديال مركز الأسنان HEL.',
    'أكيد، أنا هنا باش نجاوبك ونعاونك.',
    'المشكل اللي وقع قبل كان مؤقت، ودابا نقدر نجاوبك.',
  ][callNumber - 1])
  const turns = [
    { text: 'Salam', intent: 'GREETING' },
    { text: 'Chkon kaydwi m3aya', intent: 'ASK_IDENTITY' },
    { text: 'Gol ?', intent: 'UNKNOWN' },
    { text: 'Dialach problème ?', intent: 'OTHER' },
  ]
  let history = []

  for (const turn of turns) {
    const result = await generateConversationReply({
      provider,
      userMessage: turn.text,
      language: 'darija',
      router: { intent: turn.intent, intentConfidence: 0.8 },
      knowledge: 'Centre Dentaire HEL',
      history,
    })
    assert.equal(result.source, 'ai')
    history = [...history, { role: 'user', content: turn.text }, { role: 'assistant', content: result.reply }]
  }

  assert.equal(provider.calls.length, 4)
  assert.deepStrictEqual(provider.calls.map((call) => call.messages.length), [1, 3, 5, 7])
  assert.equal(routePatientMessage('Bghit rendez-vous').bookAppointment, true)
}

async function testStructuredSemanticIntentUsesProvider() {
  let calls = 0
  const provider = {
    isConfigured: () => true,
    async generateStructured(request) {
      calls += 1
      assert.equal(request.intent, 'SEMANTIC_CLASSIFICATION')
      return {
        data: {
          language: 'darija',
          intent: 'ASK_LOCATION',
          confidence: 0.97,
          entities: {},
        },
      }
    },
  }
  const result = await classifyIntentSemanticFallback({
    provider,
    rawText: 'fin jay had centre',
    stage: 'awaiting_form:phone_number',
  })
  assert.equal(calls, 1)
  assert.equal(result.intent, 'ASK_LOCATION')
  assert.equal(result.confidence, 0.97)
}

function testNoFaqDirectReplyInMainPipeline() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
  assert.ok(!/buildIntentDirectReply\s*\(/.test(source), 'index.js must not directly send canned FAQ replies')
  const handoffGuard = source.indexOf('AI auto-reply blocked (handoff or assistant paused)')
  const semanticCall = source.indexOf('classifyIntentSemanticFallback({', handoffGuard)
  assert.ok(handoffGuard >= 0 && semanticCall > handoffGuard, 'HUMAN_CONTROLLED guard must run before AI routing')
  const protectedSilent = source.indexOf("reason: 'protected_deterministic_workflow'")
  const freeformGeneration = source.indexOf('const generated = await generateConversationReply', protectedSilent)
  assert.ok(
    protectedSilent >= 0 && freeformGeneration > protectedSilent,
    'protected workflows without a reply must return before free-form AI generation',
  )
  assert.match(
    source,
    /const languageHint = rememberedLanguage\s*\|\|/,
    'active conversation language must win over a weak per-turn router guess',
  )
  const context = buildConversationContext({
    language: 'darija',
    intent: 'ASK_LOCATION',
    lead: { stage: 'awaiting_form', awaiting_field: 'phone_number' },
  })
  assert.equal(context.booking.active, true)
  assert.equal(isReplyLanguageValid('العنوان ديالنا فالألفة.', 'darija'), true)
  assert.equal(isReplyLanguageValid('rah kaynin f Oulfa', 'darija'), false)
  assert.equal(isReplyLanguageValid('Nous sommes à El Oulfa.', 'fr'), true)
}

async function run() {
  await testFaqUsesProviderAndKnowledge()
  await testLocationAndServicesUseProvider()
  await testBookingInterruptDoesNotMutateDraft()
  await testInventedSlotCannotEscape()
  await testProviderDownKeepsSafeFallback()
  await testMissingKnowledgeGuardIsInjected()
  await testProviderTransportIsCentralized()
  await testOtherIntentStillUsesProviderAndHistory()
  await testProviderAuthAndEmptyOutputErrorsAreObservable()
  await testExactContextualScenarioUsesAi()
  await testStructuredSemanticIntentUsesProvider()
  testDarijaScenarioLanguageDetection()
  testNoFaqDirectReplyInMainPipeline()
  console.log('openrouter-conversation-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
