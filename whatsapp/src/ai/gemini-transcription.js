/**
 * Voice-note transcription through the Gemini Interactions API.
 * Gemini's OpenAI-compatible layer has no /audio/transcriptions route, so audio goes here.
 */

const axios = require('axios')
const { GEMINI_API_BASE_URL } = require('./provider-config')

const AUDIO_MIME_TYPES = {
  ogg: 'audio/ogg',
  mp3: 'audio/mp3',
  m4a: 'audio/m4a',
  webm: 'audio/webm',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
}

const TRANSCRIBE_INSTRUCTION = 'Transcris fidèlement cet audio. Réponds uniquement avec la transcription, sans traduction ni commentaire.'

/** Dedicated speech-to-text models take audio only; general models need a text instruction. */
function isSpeechToTextModel(model) {
  return /transcribe/i.test(String(model || ''))
}

function buildGeminiTranscriptionRequest({ model, audioBytes, format, prompt = '', language = '' }) {
  const audio = {
    type: 'audio',
    data: audioBytes.toString('base64'),
    mime_type: AUDIO_MIME_TYPES[format] || 'audio/ogg',
  }
  // store:false keeps patient voice notes out of Gemini's stored interaction history.
  const body = { model, store: false }

  if (isSpeechToTextModel(model)) {
    body.input = [audio]
    if (language) {
      body.generation_config = { transcription_config: { language_codes: [language] } }
    }
    return body
  }

  body.input = [
    { type: 'text', text: [TRANSCRIBE_INSTRUCTION, prompt].filter(Boolean).join('\n') },
    audio,
  ]
  return body
}

function extractInteractionText(interaction) {
  const texts = []
  for (const step of Array.isArray(interaction?.steps) ? interaction.steps : []) {
    if (step?.type !== 'model_output') continue
    for (const item of Array.isArray(step.content) ? step.content : []) {
      if (item?.type === 'text' && typeof item.text === 'string') texts.push(item.text.trim())
    }
  }
  return texts.filter(Boolean).join(' ')
}

async function requestGeminiTranscription(options = {}) {
  const http = options.http || axios
  const response = await http.post(
    `${GEMINI_API_BASE_URL}/interactions`,
    buildGeminiTranscriptionRequest(options),
    {
      headers: {
        'x-goog-api-key': options.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: options.timeoutMs || 90000,
    },
  )

  const text = extractInteractionText(response.data)
  const status = response.data?.status
  if (!text && status && status !== 'completed') {
    const error = new Error(`Gemini transcription ended with status "${status}"`)
    error.code = 'GEMINI_TRANSCRIPTION_INCOMPLETE'
    throw error
  }
  return text
}

module.exports = {
  buildGeminiTranscriptionRequest,
  extractInteractionText,
  isSpeechToTextModel,
  requestGeminiTranscription,
}
