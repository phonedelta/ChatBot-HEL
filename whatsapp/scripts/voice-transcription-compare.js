require('dotenv').config()

const axios = require('axios')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { promisify } = require('util')
const { execFile } = require('child_process')
const { assessTranscriptQuality, preprocessAudio } = require('../src/voice-nlu/audio-transcription')

const execFileAsync = promisify(execFile)

function formatFromPath(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (extension === 'opus') return 'ogg'
  return extension || 'ogg'
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || '')
  if (!process.argv[2] || !fs.existsSync(inputPath)) {
    throw new Error('Usage: node scripts/voice-transcription-compare.js <audio.ogg>')
  }

  const apiKey = String(process.env.OPENAI_TRANSCRIBE_API_KEY
    || process.env.OPENROUTER_API_KEY
    || process.env.OPENAI_API_KEY
    || '').trim()
  const baseURL = String(process.env.OPENAI_TRANSCRIBE_BASE_URL
    || process.env.OPENROUTER_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const model = String(process.env.VOICE_TRANSCRIPTION_MODEL
    || process.env.OPENAI_TRANSCRIBE_MODEL
    || 'openai/whisper-large-v3').trim()
  if (!apiKey) throw new Error('Transcription API key is not configured')

  const lexicalPrompt = [
    'Conversation WhatsApp en darija marocaine et français.',
    'Vocabulaire possible: bghit, maw3id, ghda, ta9wim, rendez-vous, orthodontie, consultation.',
    'Transcription fidèle uniquement, sans traduction ni complétion.',
  ].join(' ')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-voice-compare-'))
  let converted = null

  try {
    const ffmpegBinary = require('ffmpeg-static')
    converted = await preprocessAudio({
      inputPath,
      outputDir: tempDir,
      ffmpegBinary,
      execFileAsync,
      strategy: 'primary',
    })
    const sources = [
      { name: 'original', format: formatFromPath(inputPath), bytes: fs.readFileSync(inputPath) },
      { name: 'wav16k', format: 'wav', bytes: fs.readFileSync(converted.filePath) },
    ]
    const configurations = [
      { language: '', prompt: lexicalPrompt, name: 'auto+prompt' },
      { language: '', prompt: '', name: 'auto-no-prompt' },
      { language: 'ar', prompt: '', name: 'ar-no-prompt' },
      { language: 'fr', prompt: '', name: 'fr-no-prompt' },
    ]
    const rows = []

    for (const source of sources) {
      for (const configuration of configurations) {
        const startedAt = Date.now()
        try {
          const response = await axios.post(`${baseURL}/audio/transcriptions`, {
            model,
            temperature: 0,
            response_format: 'json',
            input_audio: {
              data: source.bytes.toString('base64'),
              format: source.format,
            },
            ...(configuration.language ? { language: configuration.language } : {}),
            ...(configuration.prompt ? { prompt: configuration.prompt } : {}),
          }, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 90000,
          })
          const transcript = String(response.data?.text || '').trim()
          const quality = assessTranscriptQuality(transcript, {
            durationSeconds: converted.metadata?.durationSeconds,
          })
          rows.push({
            variant: `${source.name}:${configuration.name}`,
            latencyMs: Date.now() - startedAt,
            score: quality.score,
            usable: quality.usable,
            reasons: quality.reasons.join(',') || '-',
            transcript,
          })
        } catch (error) {
          rows.push({
            variant: `${source.name}:${configuration.name}`,
            latencyMs: Date.now() - startedAt,
            score: '-',
            usable: false,
            reasons: `HTTP ${error.response?.status || error.code || 'error'}`,
            transcript: '',
          })
        }
      }
    }

    console.log({
      file: path.basename(inputPath),
      model,
      duration: converted.metadata?.durationSeconds || null,
      inputFormat: formatFromPath(inputPath),
      convertedFormat: 'wav/pcm_s16le/16kHz/mono',
    })
    console.table(rows)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
