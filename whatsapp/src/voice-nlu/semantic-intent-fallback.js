/**
 * Controlled OpenAI semantic intent fallback for unknown Darija formulations.
 * Deterministic state machines / classifiers stay primary — call only when confidence is low.
 * Reuses the existing OpenAI provider (responses API, same as transcript interpreter).
 */

const ALLOWED_INTENTS = [
  'ASK_SERVICES',
  'BOOK_APPOINTMENT',
  'CANCEL_APPOINTMENT',
  'RESCHEDULE_APPOINTMENT',
  'CHECK_APPOINTMENT_AVAILABILITY',
  'LIST_MY_APPOINTMENTS',
  'ASK_PRICE',
  'ASK_LOCATION',
  'ASK_OPENING_HOURS',
  'ASK_IDENTITY',
  'ASK_PHONE',
  'DENTAL_PAIN',
  'DENTAL_EMERGENCY',
  'GREETING',
  'THANKS',
  'OTHER',
]

function buildSemanticIntentSystemPrompt() {
  return [
    'Tu classifies l\'intention d\'un patient du Centre Dentaire HEL (Maroc).',
    'Les messages peuvent être en darija marocaine (Latin/Arabizi), arabe, français, ou mélange.',
    'Arabizi courant: 3→ع, 7→ح, 9→ق (dans les mots seulement, pas les dates/heures/téléphones).',
    '',
    'Intents autorisés UNIQUEMENT:',
    ALLOWED_INTENTS.join(', '),
    '',
    'Règles critiques:',
    '- chno les rdv dyali / wach 3ndi chi rdv → LIST_MY_APPOINTMENTS (pas CHECK_APPOINTMENT_AVAILABILITY)',
    '- wach kayn chi blassa / chno kayn mn rdv / disponibilités → CHECK_APPOINTMENT_AVAILABILITY',
    '- ch7al taman / prix → ASK_PRICE (ne démarre PAS BOOK_APPOINTMENT)',
    '- wach katdiro implant / services → ASK_SERVICES (pas BOOK)',
    '- bghit rdv / بغيت موعد → BOOK_APPOINTMENT',
    '- chkon nta / qui es-tu → ASK_IDENTITY (jamais un nom patient)',
    '- 3tini nmra dyalkom → ASK_PHONE (téléphone du cabinet)',
    '- Ne jamais inventer de créneau disponible.',
    '',
    'Exemples:',
    'bghit nakhod rdv → BOOK_APPOINTMENT',
    'wach kayn chi blassa ghdda → CHECK_APPOINTMENT_AVAILABILITY',
    'chno les rdv dyali → LIST_MY_APPOINTMENTS',
    'bghit nlghi rdv → CANCEL_APPOINTMENT',
    '3ndi wja3 f drssa → DENTAL_PAIN',
    'fin kaynin → ASK_LOCATION',
    'fo9ach kat7ello → ASK_OPENING_HOURS',
    'ch7al taman detartrage → ASK_PRICE',
    'شنو كاين من موعد غدا → CHECK_APPOINTMENT_AVAILABILITY',
    'بغيت ناخد موعد → BOOK_APPOINTMENT',
    '',
    'Réponds UNIQUEMENT en JSON:',
    '{"language":"darija","intent":"BOOK_APPOINTMENT","confidence":0.96,"entities":{"date":null,"time":null}}',
  ].join('\n')
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
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
    }
    return null
  }
}

function extractOpenAiOutputText(response) {
  if (!response) return ''
  if (typeof response.output_text === 'string') return response.output_text
  const parts = []
  for (const item of response.output || []) {
    for (const c of item.content || []) {
      if (typeof c.text === 'string') parts.push(c.text)
      else if (typeof c === 'string') parts.push(c)
    }
  }
  return parts.join('\n').trim()
}

/**
 * @param {{
 *   openai: object,
 *   model: string,
 *   rawText: string,
 *   normalizedText?: string|null,
 *   stage?: string|null,
 * }} args
 */
async function classifyIntentSemanticFallback(args = {}) {
  const openai = args.openai
  const model = String(args.model || '').trim()
  const rawText = String(args.rawText || '').trim()
  if (!openai || !model || !rawText) {
    return { intent: 'OTHER', confidence: 0, source: 'missing_client', language: null, entities: {} }
  }

  // Never use LLM to reinterpret selection indices / times in active workflows
  const stage = String(args.stage || '')
  if (/selection|slot|confirm|awaiting_/i.test(stage) && /^#?\d{1,2}([:h.]\d{2})?$/.test(rawText)) {
    return { intent: 'OTHER', confidence: 0, source: 'protected_state', language: null, entities: {} }
  }

  const prompt = [
    `message_original: ${rawText}`,
    args.normalizedText ? `message_normalize: ${args.normalizedText}` : null,
    stage ? `conversation_stage: ${stage}` : null,
    'Classifie l\'intent parmi la liste autorisée. JSON uniquement.',
  ].filter(Boolean).join('\n')

  let content = ''
  try {
    if (openai.responses?.create) {
      const response = await openai.responses.create({
        model,
        instructions: buildSemanticIntentSystemPrompt(),
        input: [{ role: 'user', content: prompt }],
        max_output_tokens: 220,
        store: false,
      })
      content = extractOpenAiOutputText(response)
    } else if (openai.chat?.completions?.create) {
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSemanticIntentSystemPrompt() },
          { role: 'user', content: prompt },
        ],
      })
      content = completion?.choices?.[0]?.message?.content || ''
    } else {
      return { intent: 'OTHER', confidence: 0, source: 'unsupported_client', language: null, entities: {} }
    }
  } catch (err) {
    return {
      intent: 'OTHER',
      confidence: 0,
      source: 'llm_error',
      language: null,
      entities: {},
      error: err?.message || String(err),
    }
  }

  const parsed = extractJsonObject(content)
  const intent = String(parsed?.intent || 'OTHER').toUpperCase()
  const allowed = ALLOWED_INTENTS.includes(intent) ? intent : 'OTHER'
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || 0))

  return {
    language: parsed?.language || null,
    intent: allowed,
    confidence,
    entities: parsed?.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
    source: 'llm_semantic',
  }
}

module.exports = {
  ALLOWED_INTENTS,
  buildSemanticIntentSystemPrompt,
  classifyIntentSemanticFallback,
}
