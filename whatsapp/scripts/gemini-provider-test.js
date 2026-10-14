const assert = require('assert')
const { createAiProvider } = require('../src/ai/ai-provider')
const {
  GEMINI_API_BASE_URL,
  GEMINI_OPENAI_BASE_URL,
  GEMINI_THINKING_HEADROOM_TOKENS,
  resolveAiConfig,
} = require('../src/ai/provider-config')
const {
  buildGeminiTranscriptionRequest,
  extractInteractionText,
  requestGeminiTranscription,
} = require('../src/ai/gemini-transcription')

// Variables used by the OpenRouter deployment before the switch to Gemini.
const OPENROUTER_ENV = {
  OPENAI_API_KEY: 'sk-or-v1-test',
  OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENAI_MODEL: 'openai/gpt-5.6-luna',
  OPENAI_TRANSCRIBE_MODEL: 'openai/whisper-large-v3',
}

function createRecordingClient(reply = 'ok') {
  const requests = []
  return {
    requests,
    chat: {
      completions: {
        async create(request) {
          requests.push(request)
          return { id: 'mock-1', model: request.model, choices: [{ message: { content: reply } }] }
        },
      },
    },
  }
}

function testGeminiKeySelectsGemini() {
  const { chat, transcription } = resolveAiConfig({ GEMINI_API_KEY: ' gemini-key ' })
  assert.equal(chat.provider, 'gemini')
  assert.equal(chat.apiKey, 'gemini-key')
  assert.equal(chat.baseUrl, GEMINI_OPENAI_BASE_URL)
  assert.equal(chat.model, 'gemini-3.5-flash-lite')
  assert.equal(chat.maxTokensHeadroom, GEMINI_THINKING_HEADROOM_TOKENS)
  assert.equal(chat.omitTemperature, true)
  assert.equal(chat.reasoningEffort, '')
  assert.equal(transcription.provider, 'gemini')
  assert.equal(transcription.apiKey, 'gemini-key')
  assert.equal(transcription.baseUrl, GEMINI_API_BASE_URL)
  assert.equal(transcription.model, 'gemini-3.5-transcribe')
}

function testGeminiWinsOverLeftoverOpenRouterVariables() {
  const { chat, transcription } = resolveAiConfig({
    ...OPENROUTER_ENV,
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_REASONING_EFFORT: 'LOW',
  })
  assert.equal(chat.provider, 'gemini')
  assert.equal(chat.apiKey, 'gemini-key')
  assert.equal(chat.model, 'gemini-3.8-flash')
  assert.equal(chat.reasoningEffort, 'low')
  assert.equal(transcription.provider, 'gemini')
  assert.equal(transcription.model, 'gemini-3.5-transcribe', 'a leftover Whisper model must not be sent to Gemini')
}

function testVoiceTranscriptionModelOverridesGeminiDefault() {
  const { transcription } = resolveAiConfig({
    GEMINI_API_KEY: 'gemini-key',
    VOICE_TRANSCRIPTION_MODEL: 'gemini-3.5-flash-lite',
  })
  assert.equal(transcription.model, 'gemini-3.5-flash-lite')
}

function testExplicitTranscriptionProviderIsKept() {
  const { chat, transcription } = resolveAiConfig({
    GEMINI_API_KEY: 'gemini-key',
    OPENAI_TRANSCRIBE_API_KEY: 'sk-whisper',
    OPENAI_TRANSCRIBE_BASE_URL: 'https://api.openai.com/v1/',
  })
  assert.equal(chat.provider, 'gemini')
  assert.equal(transcription.provider, 'openai')
  assert.equal(transcription.apiKey, 'sk-whisper')
  assert.equal(transcription.baseUrl, 'https://api.openai.com/v1')
  assert.equal(transcription.model, 'gpt-4o-transcribe')
}

function testOpenRouterConfigurationIsUnchangedWithoutGeminiKey() {
  const { chat, transcription } = resolveAiConfig(OPENROUTER_ENV)
  assert.deepStrictEqual(chat, {
    apiKey: 'sk-or-v1-test',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.6-luna',
    provider: 'openrouter',
    reasoningEffort: '',
    maxTokensHeadroom: 0,
    omitTemperature: false,
  })
  assert.deepStrictEqual(transcription, {
    apiKey: 'sk-or-v1-test',
    baseUrl: 'https://openrouter.ai/api/v1',
    provider: 'openrouter',
    model: 'openai/whisper-large-v3',
  })

  const openRouterKeyOnly = resolveAiConfig({ OPENROUTER_API_KEY: 'sk-or-v1-other' })
  assert.equal(openRouterKeyOnly.chat.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(openRouterKeyOnly.chat.model, 'openai/gpt-5.6-luna')

  const nothing = resolveAiConfig({})
  assert.equal(nothing.chat.apiKey, '')
  assert.equal(nothing.chat.provider, 'openai-compatible')
  assert.equal(nothing.chat.model, 'gpt-5.6-luna')
  assert.equal(nothing.transcription.model, 'gpt-4o-transcribe')
}

function testGeminiCompatibleBaseUrlIsDetectedWithoutGeminiKey() {
  const { chat, transcription } = resolveAiConfig({
    OPENAI_API_KEY: 'gemini-key',
    OPENAI_BASE_URL: GEMINI_OPENAI_BASE_URL,
    OPENAI_MODEL: 'gemini-3.5-flash-lite',
  })
  assert.equal(chat.provider, 'gemini')
  assert.equal(chat.maxTokensHeadroom, GEMINI_THINKING_HEADROOM_TOKENS)
  assert.equal(transcription.provider, 'gemini')
  assert.equal(transcription.model, 'gemini-3.5-transcribe')
}

async function testGeminiChatRequestLeavesRoomForThinking() {
  const { chat } = resolveAiConfig({ GEMINI_API_KEY: 'gemini-key', GEMINI_REASONING_EFFORT: 'low' })
  const client = createRecordingClient('douleur dentaire')
  const provider = createAiProvider({
    providerName: chat.provider,
    baseURL: chat.baseUrl,
    model: chat.model,
    reasoningEffort: chat.reasoningEffort,
    maxTokensHeadroom: chat.maxTokensHeadroom,
    omitTemperature: chat.omitTemperature,
    client,
    logger: {},
  })

  const result = await provider.generateChatResponse({
    systemPrompt: 'Réponds avec le motif.',
    messages: [{ role: 'user', content: 'dersa katderni' }],
    maxOutputTokens: 40,
    temperature: 0,
  })
  assert.equal(result.text, 'douleur dentaire')
  assert.equal(result.provider, 'gemini')
  const [request] = client.requests
  assert.equal(request.model, 'gemini-3.5-flash-lite')
  assert.equal(request.max_tokens, 64 + GEMINI_THINKING_HEADROOM_TOKENS)
  assert.equal(request.reasoning_effort, 'low')
  assert.ok(!('temperature' in request), 'temperature must not be sent to Gemini')

  const jsonClient = createRecordingClient('{"intent":"BOOK_APPOINTMENT"}')
  const jsonProvider = createAiProvider({
    providerName: chat.provider,
    model: chat.model,
    omitTemperature: chat.omitTemperature,
    client: jsonClient,
    logger: {},
  })
  const structured = await jsonProvider.generateStructured({ messages: [{ role: 'user', content: 'bghit maw3id' }] })
  assert.deepStrictEqual(structured.data, { intent: 'BOOK_APPOINTMENT' })
  assert.deepStrictEqual(jsonClient.requests[0].response_format, { type: 'json_object' })
  assert.ok(!('temperature' in jsonClient.requests[0]), 'JSON mode must not re-add temperature for Gemini')
}

async function testDefaultProviderRequestIsUnchanged() {
  const client = createRecordingClient()
  const provider = createAiProvider({
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.6-luna',
    client,
    logger: {},
  })
  await provider.generateChatResponse({ messages: [{ role: 'user', content: 'salam' }], maxOutputTokens: 40 })
  assert.deepStrictEqual(client.requests[0], {
    model: 'openai/gpt-5.6-luna',
    messages: [{ role: 'user', content: 'salam' }],
    max_tokens: 64,
    temperature: 0.35,
  })
}

function testTranscriptionRequestShapes() {
  const audioBytes = Buffer.from('voice-note')
  const speechToText = buildGeminiTranscriptionRequest({
    model: 'gemini-3.5-transcribe',
    audioBytes,
    format: 'ogg',
    prompt: 'Vocabulaire: bghit, maw3id',
  })
  assert.deepStrictEqual(speechToText, {
    model: 'gemini-3.5-transcribe',
    store: false,
    input: [{ type: 'audio', data: audioBytes.toString('base64'), mime_type: 'audio/ogg' }],
  })

  const withLanguage = buildGeminiTranscriptionRequest({
    model: 'gemini-3.5-transcribe',
    audioBytes,
    format: 'wav',
    language: 'ar',
  })
  assert.equal(withLanguage.input[0].mime_type, 'audio/wav')
  assert.deepStrictEqual(withLanguage.generation_config, { transcription_config: { language_codes: ['ar'] } })

  const generalModel = buildGeminiTranscriptionRequest({
    model: 'gemini-3.5-flash-lite',
    audioBytes,
    format: 'unknown',
    prompt: 'Vocabulaire: bghit, maw3id',
  })
  assert.equal(generalModel.input.length, 2)
  assert.equal(generalModel.input[0].type, 'text')
  assert.match(generalModel.input[0].text, /Transcris fidèlement/)
  assert.match(generalModel.input[0].text, /bghit, maw3id/)
  assert.equal(generalModel.input[1].mime_type, 'audio/ogg', 'WhatsApp voice notes default to OGG')
}

function testInteractionTextExtraction() {
  assert.equal(extractInteractionText({
    status: 'completed',
    steps: [
      { type: 'thought', content: [{ type: 'text', text: 'réflexion interne' }] },
      { type: 'model_output', content: [{ type: 'text', text: ' بغيت موعد ' }, { type: 'text', text: 'ghda' }] },
    ],
  }), 'بغيت موعد ghda')
  assert.equal(extractInteractionText({ status: 'completed', steps: [] }), '')
  assert.equal(extractInteractionText(null), '')
}

async function testTranscriptionTransport() {
  const calls = []
  const http = {
    async post(url, body, config) {
      calls.push({ url, body, config })
      return {
        data: {
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: 'bghit maw3id' }] }],
        },
      }
    },
  }
  const text = await requestGeminiTranscription({
    http,
    apiKey: 'gemini-key',
    model: 'gemini-3.5-transcribe',
    audioBytes: Buffer.from('voice-note'),
    format: 'ogg',
    timeoutMs: 1234,
  })
  assert.equal(text, 'bghit maw3id')
  assert.equal(calls[0].url, `${GEMINI_API_BASE_URL}/interactions`)
  assert.equal(calls[0].config.headers['x-goog-api-key'], 'gemini-key')
  assert.equal(calls[0].config.timeout, 1234)
  assert.equal(calls[0].body.store, false)

  await assert.rejects(
    requestGeminiTranscription({
      http: { post: async () => ({ data: { status: 'incomplete', steps: [] } }) },
      apiKey: 'gemini-key',
      model: 'gemini-3.5-transcribe',
      audioBytes: Buffer.from('voice-note'),
      format: 'ogg',
    }),
    (error) => error.code === 'GEMINI_TRANSCRIPTION_INCOMPLETE',
  )
}

async function run() {
  testGeminiKeySelectsGemini()
  testGeminiWinsOverLeftoverOpenRouterVariables()
  testVoiceTranscriptionModelOverridesGeminiDefault()
  testExplicitTranscriptionProviderIsKept()
  testOpenRouterConfigurationIsUnchangedWithoutGeminiKey()
  testGeminiCompatibleBaseUrlIsDetectedWithoutGeminiKey()
  await testGeminiChatRequestLeavesRoomForThinking()
  await testDefaultProviderRequestIsUnchanged()
  testTranscriptionRequestShapes()
  testInteractionTextExtraction()
  await testTranscriptionTransport()

  console.log('gemini-provider-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
