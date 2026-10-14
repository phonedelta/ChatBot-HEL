const OpenAI = require('openai')

function safeErrorBody(error) {
  const value = error?.error || error?.response?.data || null
  if (!value) return null
  try {
    return JSON.stringify(value)
      .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/(AIza|AQ\.)[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .slice(0, 1200)
  } catch {
    return '[unserializable error body]'
  }
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && ['system', 'user', 'assistant', 'tool'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').trim(),
    }))
    .filter((message) => message.content)
}

function extractChatText(response) {
  const content = response?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return ''
}

function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

// How long a model that just failed is skipped before it is tried again.
const MODEL_COOLDOWN_MS = 2 * 60 * 1000

/** Overload, rate limit, timeout, network failure or empty answer: worth trying another model. */
function isRetryableProviderError(error) {
  const status = Number(error?.status || 0)
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true
  if (error?.code === 'AI_EMPTY_OUTPUT') return true
  return /timeout|timed out|connection|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i
    .test(`${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`)
}

function createAiProvider(options = {}) {
  const apiKey = String(options.apiKey || '').trim()
  const baseURL = String(options.baseURL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const model = String(options.model || '').trim()
  const timeout = Number(options.timeoutMs || 45000)
  const maxRetries = Math.max(0, Math.min(1, Number(options.maxRetries ?? 1)))
  const providerName = String(options.providerName || (baseURL.includes('openrouter.ai') ? 'openrouter' : 'openai-compatible'))
  const logger = options.logger || console
  const debug = options.debug === true || options.debug === '1'
  const reasoningEffort = String(options.reasoningEffort || '').trim()
  const maxTokensHeadroom = Math.max(0, Number(options.maxTokensHeadroom) || 0)
  const omitTemperature = options.omitTemperature === true
  const fallbackModels = (Array.isArray(options.fallbackModels) ? options.fallbackModels : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && item !== model)
  const attemptTimeoutMs = Math.max(0, Number(options.attemptTimeoutMs) || 0)
  const modelUnavailableUntil = new Map()
  const defaultHeaders = {
    ...(options.siteUrl ? { 'HTTP-Referer': String(options.siteUrl) } : {}),
    ...(options.appName ? { 'X-Title': String(options.appName) } : {}),
  }
  const client = options.client || (apiKey
    ? new OpenAI({
        apiKey,
        baseURL,
        timeout,
        maxRetries,
        defaultHeaders,
      })
    : null)
  const health = {
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastStatus: null,
  }

  function isConfigured() {
    return Boolean(client && model)
  }

  /**
   * Sends the request to the configured model, then to each fallback model when the model is
   * overloaded, rate limited, too slow or returns nothing. Every model but the last gets the
   * short attempt timeout, so a degraded model does not hold the patient for a minute.
   */
  async function createWithFallback(request, args) {
    const configured = args.model ? [request.model] : [request.model, ...fallbackModels]
    // A model that just failed is set aside for a while, unless every model is in that state.
    const healthy = configured.filter((item) => !(modelUnavailableUntil.get(item) > Date.now()))
    const models = healthy.length ? healthy : configured
    for (let index = 0; index < models.length; index += 1) {
      const isLast = index === models.length - 1
      try {
        const response = await client.chat.completions.create(
          { ...request, model: models[index] },
          isLast ? undefined : { timeout: attemptTimeoutMs || timeout, maxRetries: 0 },
        )
        const text = extractChatText(response)
        if (text) return { response: { ...response, model: response?.model || models[index] }, text }
        const error = new Error('AI provider returned an empty response')
        error.code = 'AI_EMPTY_OUTPUT'
        throw error
      } catch (error) {
        const retryable = isRetryableProviderError(error)
        if (retryable && configured.length > 1) {
          modelUnavailableUntil.set(models[index], Date.now() + MODEL_COOLDOWN_MS)
        }
        if (isLast || !retryable) throw error
        logger.warn?.('[ai-provider] model unavailable, using fallback', {
          provider: providerName,
          model: models[index],
          fallback: models[index + 1],
          status: error?.status || null,
          code: error?.code || error?.name || null,
        })
      }
    }
    throw new Error('AI provider has no model to try')
  }

  async function generateChatResponse(args = {}) {
    if (!isConfigured()) {
      const error = new Error('AI provider is not configured')
      error.code = 'AI_PROVIDER_NOT_CONFIGURED'
      throw error
    }

    const messages = normalizeMessages([
      args.systemPrompt ? { role: 'system', content: args.systemPrompt } : null,
      ...(args.messages || []),
    ])
    if (!messages.length) {
      const error = new Error('AI request has no messages')
      error.code = 'AI_INVALID_REQUEST'
      throw error
    }

    const startedAt = Date.now()
    const request = {
      model: String(args.model || model),
      messages,
      max_tokens: Math.max(64, Number(args.maxOutputTokens || 500)) + maxTokensHeadroom,
      temperature: Number.isFinite(Number(args.temperature)) ? Number(args.temperature) : 0.35,
    }
    if (args.responseFormat === 'json') {
      request.response_format = { type: 'json_object' }
      request.temperature = 0
    }
    if (omitTemperature) delete request.temperature
    if (reasoningEffort) request.reasoning_effort = reasoningEffort

    if (debug) {
      logger.log?.('[AI REQUEST]', {
        provider: providerName,
        model: request.model,
        baseUrl: baseURL,
        messageCount: messages.length,
        systemPromptLength: String(args.systemPrompt || '').length,
        historyCount: Number(args.debugContext?.historyCount || 0),
        knowledgeLoaded: Boolean(args.debugContext?.knowledgeLoaded),
        knowledgeLength: Number(args.debugContext?.knowledgeLength || 0),
        bookingActive: Boolean(args.debugContext?.bookingActive),
      })
    }

    try {
      const { response, text } = await createWithFallback(request, args)
      request.model = response?.model || request.model
      logger.log?.('[ai-response]', {
        provider: providerName,
        model: request.model,
        response_mode: args.responseMode || 'ai',
        intent: args.intent || null,
        latency_ms: Date.now() - startedAt,
      })
      if (debug) {
        logger.log?.('[AI RESPONSE]', {
          provider: providerName,
          model: response?.model || request.model,
          status: 200,
          latency: Date.now() - startedAt,
          finishReason: response?.choices?.[0]?.finish_reason || null,
          responseId: response?.id || null,
          contentLength: text.length,
        })
      }
      health.lastSuccessAt = new Date().toISOString()
      health.lastStatus = 200
      health.lastError = null
      return {
        text,
        id: response?.id || null,
        model: response?.model || request.model,
        provider: providerName,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      const errorLog = {
        provider: providerName,
        model: request.model,
        intent: args.intent || null,
        name: error?.name || 'Error',
        status: error?.status || null,
        code: error?.code || null,
        message: error?.message || String(error),
        latency_ms: Date.now() - startedAt,
      }
      health.lastErrorAt = new Date().toISOString()
      health.lastStatus = errorLog.status
      health.lastError = {
        name: errorLog.name,
        status: errorLog.status,
        code: errorLog.code,
        message: errorLog.message,
      }
      logger.warn?.('[ai-provider] request failed', errorLog)
      if (debug) {
        logger.warn?.('[AI ERROR]', {
          ...errorLog,
          responseBody: safeErrorBody(error),
        })
      }
      if (!error.code) error.code = 'AI_PROVIDER_ERROR'
      throw error
    }
  }

  async function generateStructured(args = {}) {
    const result = await generateChatResponse({
      ...args,
      responseFormat: 'json',
      responseMode: args.responseMode || 'ai_structured',
    })
    const data = extractJsonObject(result.text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('AI provider returned invalid JSON')
      error.code = 'AI_INVALID_JSON'
      throw error
    }
    return { ...result, data }
  }

  return {
    providerName,
    model,
    baseURL,
    isConfigured,
    getStatus: () => ({
      configured: isConfigured(),
      provider: providerName,
      model,
      ...health,
    }),
    generateChatResponse,
    generateStructured,
  }
}

module.exports = {
  createAiProvider,
  extractChatText,
  extractJsonObject,
  normalizeMessages,
}
