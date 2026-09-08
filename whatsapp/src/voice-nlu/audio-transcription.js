const fs = require('fs')
const path = require('path')

const LEGITIMATE_SHORT_TRANSCRIPTS = new Set([
  'ok', 'okay', 'oui', 'non', 'merci', 'rabat', 'casa', 'casablanca', 'wakha', 'safi',
])

const JUNK_PATTERNS = [
  /^thanks for watching/i,
  /^sous-titres?\b/i,
  /^subtitles?\b/i,
  /^amara\.org/i,
  /^www\./i,
  /^https?:\/\//i,
  /^je ne suis pas disponible\b/i,
  /^i(?:'m| am) not available\b/i,
  /^\[.*(?:music|musique).*\]$/i,
]

const CONTEXT_MARKERS = /\b(?:salam|bghit|brit|baghit|wach|wash|chno|chnou|kifash|fin|3ndi|m3a|nhar|lyoum|ghda|rendez(?:-?vous)?|rdv|disponib\w*|horaire\w*|ta9wim|taqwim|orthodont\w*|detar\w*|détar\w*|carie\w*|implant\w*|consult\w*|douleur\w*|urgence\w*|tbib|ders|sennan|oui|non|merci|rabat|casa|casablanca)\b|(?:بغيت|واش|شنو|فين|موعد|متاح|متوفر|تقويم|تسوس|ضرس|وجع|طبيب|اليوم|غدا)/i
const ENGLISH_MARKERS = /\b(?:i've|i have|the|with|for|from|this|that|day|actioned|watching|subtitles)\b/gi

function normalizeTranscriptText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function repeatedTokenRatio(words) {
  if (words.length < 4) return 0
  const counts = new Map()
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1)
  return Math.max(...counts.values()) / words.length
}

function assessTranscriptQuality(text, options = {}) {
  const normalized = normalizeTranscriptText(text)
  const lower = normalized.toLowerCase()
  const words = lower.match(/[\p{L}\p{N}]+/gu) || []
  const letters = (normalized.match(/\p{L}/gu) || []).length
  const arabicChars = (normalized.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (normalized.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const reasons = []
  const durationSeconds = Number(options.durationSeconds || 0)
  const compactShort = lower.replace(/[.!?؟]/g, '').trim()
  const legitimateShort = LEGITIMATE_SHORT_TRANSCRIPTS.has(compactShort)
    || /^\d{1,2}(?::|h)\d{0,2}$/i.test(compactShort)

  if (!normalized) reasons.push('empty')
  if (normalized && letters < 2 && !legitimateShort) reasons.push('too_few_letters')
  if (JUNK_PATTERNS.some((pattern) => pattern.test(normalized))) reasons.push('known_hallucination')
  if (repeatedTokenRatio(words) >= 0.5) reasons.push('abnormal_repetition')
  if (durationSeconds >= 8 && words.length <= 1 && !legitimateShort) reasons.push('too_short_for_duration')

  const contextMatches = normalized.match(new RegExp(CONTEXT_MARKERS.source, 'gi')) || []
  const contextMatch = contextMatches.length > 0
  const englishCount = (lower.match(ENGLISH_MARKERS) || []).length
  if (englishCount >= 3 && !/\b(?:darija|morocco)\b/i.test(lower)) {
    reasons.push('unexpected_english')
  }
  if (arabicChars >= 8 && !contextMatch) {
    reasons.push('unrecognized_arabic_sequence')
  }
  if (letters >= 4 && (arabicChars + latinChars) / letters < 0.65) {
    reasons.push('unexpected_script')
  }

  const unusableReasons = new Set([
    'empty',
    'too_few_letters',
    'known_hallucination',
    'abnormal_repetition',
    'too_short_for_duration',
    'unexpected_script',
    'unrecognized_arabic_sequence',
  ])
  const usable = Boolean(normalized)
    && !reasons.some((reason) => unusableReasons.has(reason))

  let score = Math.min(70, letters + words.length * 4)
  if (contextMatch) score += Math.min(36, contextMatches.length * 12)
  if (legitimateShort) score += 30
  score -= reasons.length * 35

  return {
    text: normalized,
    score,
    suspicious: reasons.length > 0,
    usable,
    reasons,
    metrics: {
      characters: normalized.length,
      letters,
      words: words.length,
      arabicCharacters: arabicChars,
      durationSeconds: durationSeconds || null,
    },
  }
}

function scoreTranscriptQuality(text, options = {}) {
  return assessTranscriptQuality(text, options).score
}

function isWeakTranscript(text, options = {}) {
  const assessment = assessTranscriptQuality(text, options)
  return !assessment.usable
}

function parseFfmpegInputMetadata(stderr = '') {
  const raw = String(stderr || '')
  const duration = raw.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i)
  const stream = raw.match(/Audio:\s*([^,\r\n]+),\s*(\d+)\s*Hz,\s*([^,\r\n]+)/i)
  const seconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null
  return {
    durationSeconds: Number.isFinite(seconds) ? Number(seconds.toFixed(3)) : null,
    codec: stream?.[1]?.trim() || null,
    sampleRate: stream?.[2] ? Number(stream[2]) : null,
    channels: stream?.[3]?.trim() || null,
  }
}

async function preprocessAudio(options = {}) {
  const {
    inputPath,
    outputDir,
    ffmpegBinary,
    execFileAsync,
    strategy = 'primary',
  } = options
  if (!inputPath || !fs.existsSync(inputPath) || !ffmpegBinary || typeof execFileAsync !== 'function') {
    return null
  }

  const outputPath = path.join(
    outputDir || path.dirname(inputPath),
    `voice-${strategy}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`,
  )
  const filter = strategy === 'fallback'
    ? 'highpass=f=70,lowpass=f=7600,loudnorm=I=-20:LRA=7:TP=-2,atempo=0.95'
    : null
  const args = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    ...(filter ? ['-af', filter] : []),
    outputPath,
  ]

  try {
    const result = await execFileAsync(ffmpegBinary, args, { timeout: 60000, windowsHide: true })
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) return null
    return {
      filePath: outputPath,
      format: 'wav',
      strategy,
      filter,
      command: [ffmpegBinary, ...args],
      metadata: parseFfmpegInputMetadata(result?.stderr),
    }
  } catch (error) {
    try { fs.unlinkSync(outputPath) } catch { /* best effort */ }
    error.audioStrategy = strategy
    throw error
  }
}

function chooseBestTranscript(attempts) {
  const candidates = (attempts || []).filter((attempt) => attempt?.assessment?.text)
  if (!candidates.length) return null
  return candidates
    .slice()
    .sort((a, b) => {
      if (a.assessment.usable !== b.assessment.usable) {
        return a.assessment.usable ? -1 : 1
      }
      if (a.assessment.suspicious !== b.assessment.suspicious) {
        return a.assessment.suspicious ? 1 : -1
      }
      return b.assessment.score - a.assessment.score
    })[0]
}

function transcriptAgreement(firstText, secondText) {
  const words = (value) => new Set(
    (normalizeTranscriptText(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .filter((word) => word.length > 1),
  )
  const first = words(firstText)
  const second = words(secondText)
  if (!first.size || !second.size) return 0
  const intersection = [...first].filter((word) => second.has(word)).length
  const union = new Set([...first, ...second]).size
  return union ? intersection / union : 0
}

async function transcribeWithFallback(options = {}) {
  const attempts = []
  const runAttempt = async (source, label, model) => {
    const startedAt = Date.now()
    try {
      const text = await options.requestTranscription(source, {
        model,
        language: '',
        prompt: label.startsWith('fallback') ? (options.fallbackPrompt || '') : options.prompt,
      })
      const assessment = assessTranscriptQuality(text, {
        durationSeconds: source?.metadata?.durationSeconds || options.durationSeconds,
      })
      attempts.push({
        label,
        model,
        sourceFormat: source?.format || null,
        sourceStrategy: source?.strategy || null,
        language: '',
        promptUsed: Boolean(label.startsWith('fallback') ? options.fallbackPrompt : options.prompt),
        text: assessment.text,
        assessment,
        latencyMs: Date.now() - startedAt,
      })
      return attempts[attempts.length - 1]
    } catch (error) {
      attempts.push({
        label,
        model,
        sourceFormat: source?.format || null,
        sourceStrategy: source?.strategy || null,
        error: {
          name: error?.name || 'Error',
          status: error?.status || error?.response?.status || null,
          code: error?.code || null,
          message: error?.message || String(error),
        },
        latencyMs: Date.now() - startedAt,
      })
      return attempts[attempts.length - 1]
    }
  }

  const primary = await runAttempt(options.primarySource, 'primary:auto', options.model)
  if (!primary.assessment || primary.assessment.suspicious) {
    const fallbackSource = typeof options.buildFallbackSource === 'function'
      ? await options.buildFallbackSource()
      : options.fallbackSource
    if (fallbackSource) {
      await runAttempt(
        fallbackSource,
        'fallback:auto-slow',
        options.fallbackModel || options.model,
      )
    }
  }

  const best = chooseBestTranscript(attempts)
  if (!best) {
    const error = new Error('No transcription attempt returned text')
    error.code = 'EMPTY_TRANSCRIPTION'
    error.attempts = attempts
    throw error
  }
  const textAttempts = attempts.filter((attempt) => attempt?.assessment?.text)
  const other = textAttempts.find((attempt) => attempt !== best) || null
  const agreement = other ? transcriptAgreement(best.text, other.text) : null
  const scoreGap = other
    ? Math.abs(Number(best.assessment.score || 0) - Number(other.assessment.score || 0))
    : null
  const attemptsDisagree = Boolean(
    other
    && best.assessment.usable
    && other.assessment.usable
    && best.assessment.suspicious === other.assessment.suspicious
    && agreement < 0.18
    && scoreGap < 24,
  )
  return {
    text: best.text,
    score: best.assessment.score,
    label: best.label,
    weak: !best.assessment.usable || attemptsDisagree,
    suspicious: best.assessment.suspicious,
    suspiciousReasons: [
      ...best.assessment.reasons,
      ...(attemptsDisagree ? ['attempts_disagree'] : []),
    ],
    attemptsDisagree,
    attemptAgreement: agreement,
    retryUsed: attempts.length > 1,
    attempts,
  }
}

module.exports = {
  assessTranscriptQuality,
  chooseBestTranscript,
  isWeakTranscript,
  normalizeTranscriptText,
  parseFfmpegInputMetadata,
  preprocessAudio,
  scoreTranscriptQuality,
  transcriptAgreement,
  transcribeWithFallback,
}
