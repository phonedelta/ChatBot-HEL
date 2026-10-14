/**
 * Resolves the AI provider (chat + voice transcription) from environment variables.
 * Gemini is used when GEMINI_API_KEY is set; OpenRouter and any other
 * OpenAI-compatible API remain supported through the OPENROUTER_* / OPENAI_* variables.
 */

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_OPENAI_BASE_URL = `${GEMINI_API_BASE_URL}/openai`
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
const DEFAULT_GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe'
const DEFAULT_GEMINI_FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.6-flash']
const GEMINI_ATTEMPT_TIMEOUT_MS = 8000
// Gemini counts thinking tokens inside max_tokens and thinking cannot be switched off,
// so the short budgets used here (40–500 tokens) would otherwise come back empty.
const GEMINI_THINKING_HEADROOM_TOKENS = 2048

function isGeminiBaseUrl(baseUrl) {
  return String(baseUrl || '').includes('generativelanguage.googleapis.com')
}

function chatProviderName(baseUrl) {
  if (isGeminiBaseUrl(baseUrl)) return 'gemini'
  return String(baseUrl || '').includes('openrouter.ai') ? 'openrouter' : 'openai-compatible'
}

function transcriptionProviderName(baseUrl) {
  if (isGeminiBaseUrl(baseUrl)) return 'gemini'
  return String(baseUrl || '').includes('openrouter.ai') ? 'openrouter' : 'openai'
}

function resolveAiConfig(env = process.env) {
  const value = (name) => String(env[name] || '').trim()
  const trimUrl = (url) => String(url || '').trim().replace(/\/$/, '')

  const geminiApiKey = value('GEMINI_API_KEY')
  const openAiApiKey = value('OPENAI_API_KEY')
  const openAiBaseUrl = trimUrl(value('OPENAI_BASE_URL') || 'https://api.openai.com/v1')
  const openAiModel = value('OPENAI_MODEL') || 'gpt-5.6-luna'

  const chat = {}
  if (geminiApiKey) {
    chat.apiKey = geminiApiKey
    chat.baseUrl = GEMINI_OPENAI_BASE_URL
    chat.model = value('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL
  } else {
    chat.apiKey = value('OPENROUTER_API_KEY') || openAiApiKey
    chat.baseUrl = trimUrl(
      value('OPENROUTER_BASE_URL')
        || (value('OPENROUTER_API_KEY') ? 'https://openrouter.ai/api/v1' : openAiBaseUrl),
    )
    chat.model = value('OPENROUTER_MODEL')
      || (chat.baseUrl.includes('openrouter.ai')
        ? (value('OPENAI_MODEL') || 'openai/gpt-5.6-luna')
        : openAiModel)
  }
  chat.provider = chatProviderName(chat.baseUrl)
  const geminiChat = chat.provider === 'gemini'
  chat.reasoningEffort = geminiChat ? value('GEMINI_REASONING_EFFORT').toLowerCase() : ''
  chat.maxTokensHeadroom = geminiChat ? GEMINI_THINKING_HEADROOM_TOKENS : 0
  // temperature is deprecated on current Gemini models (ignored today, rejected later).
  chat.omitTemperature = geminiChat
  // Free-tier models are regularly overloaded (HTTP 503 or very slow): fail over to a sibling
  // model quickly. GEMINI_FALLBACK_MODELS= (empty) disables the fallback.
  chat.fallbackModels = !geminiChat
    ? []
    : (env.GEMINI_FALLBACK_MODELS === undefined ? DEFAULT_GEMINI_FALLBACK_MODELS : value('GEMINI_FALLBACK_MODELS').split(','))
      .map((item) => item.trim())
      .filter((item) => item && item !== chat.model)
  chat.attemptTimeoutMs = chat.fallbackModels.length ? GEMINI_ATTEMPT_TIMEOUT_MS : 0

  // An explicit OPENAI_TRANSCRIBE_* setting still wins, so voice can stay on another provider.
  const explicitTranscribeKey = value('OPENAI_TRANSCRIBE_API_KEY')
  const explicitTranscribeBaseUrl = value('OPENAI_TRANSCRIBE_BASE_URL')
  const geminiTranscription = Boolean(geminiApiKey) && !explicitTranscribeKey && !explicitTranscribeBaseUrl
  const transcription = {
    apiKey: geminiTranscription ? geminiApiKey : (explicitTranscribeKey || openAiApiKey),
    baseUrl: geminiTranscription ? GEMINI_API_BASE_URL : trimUrl(explicitTranscribeBaseUrl || openAiBaseUrl),
  }
  transcription.provider = transcriptionProviderName(transcription.baseUrl)
  if (transcription.provider === 'gemini') {
    transcription.model = value('VOICE_TRANSCRIPTION_MODEL') || DEFAULT_GEMINI_TRANSCRIBE_MODEL
  } else {
    transcription.model = value('VOICE_TRANSCRIPTION_MODEL')
      || value('OPENAI_TRANSCRIBE_MODEL')
      || (transcription.provider === 'openrouter' ? 'openai/whisper-large-v3' : 'gpt-4o-transcribe')
  }

  return { chat, transcription }
}

module.exports = {
  GEMINI_API_BASE_URL,
  GEMINI_OPENAI_BASE_URL,
  GEMINI_THINKING_HEADROOM_TOKENS,
  isGeminiBaseUrl,
  resolveAiConfig,
}
