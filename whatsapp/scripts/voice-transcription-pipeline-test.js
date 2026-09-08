const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  assessTranscriptQuality,
  parseFfmpegInputMetadata,
  preprocessAudio,
  transcribeWithFallback,
} = require('../src/voice-nlu/audio-transcription')

async function run() {
  const wrongArabic = assessTranscriptQuality('أفكشنا أم أبدل راندي فوليد ستكون يبوستيك نهار؟', {
    durationSeconds: 3.47,
  })
  assert.equal(wrongArabic.suspicious, true)
  assert.equal(wrongArabic.usable, false)
  assert.ok(wrongArabic.reasons.includes('unrecognized_arabic_sequence'))

  const faithfulArabic = assessTranscriptQuality('بغيت موعد', { durationSeconds: 2 })
  assert.equal(faithfulArabic.suspicious, false)
  assert.equal(faithfulArabic.usable, true)

  const wrongEnglish = assessTranscriptQuality("I've actioned a rendezvous with the disponible for the day.", {
    durationSeconds: 4.49,
  })
  assert.equal(wrongEnglish.suspicious, true)
  assert.equal(wrongEnglish.usable, true, 'imperfect transcript with business words must remain usable')
  assert.ok(wrongEnglish.reasons.includes('unexpected_english'))

  const falseAvailability = assessTranscriptQuality('Je ne suis pas disponible ce soir.', {
    durationSeconds: 3.47,
  })
  assert.equal(falseAvailability.suspicious, true)
  assert.ok(falseAvailability.reasons.includes('known_hallucination'))

  const wrongScript = assessTranscriptQuality('Ավաքշնահում մա բետելի առանդիվոլից պանի։', {
    durationSeconds: 3.47,
  })
  assert.equal(wrongScript.suspicious, true)
  assert.ok(wrongScript.reasons.includes('unexpected_script'))

  for (const short of ['bghit maw3id', 'chkon nta', 'fin kaynin', 'ta9wim', 'Rabat', '11h30', 'ghda', 'wakha', 'gol']) {
    const quality = assessTranscriptQuality(short, { durationSeconds: 3 })
    assert.equal(quality.usable, true, short)
  }

  let calls = 0
  const suspiciousThenGood = await transcribeWithFallback({
    primarySource: { format: 'wav', bytes: Buffer.from('one'), metadata: { durationSeconds: 4.49 } },
    model: 'primary-model',
    fallbackModel: 'fallback-model',
    prompt: 'Darija et français',
    requestTranscription: async (_source, options) => {
      calls += 1
      assert.equal(options.language, '')
      return calls === 1
        ? "I've actioned a rendezvous with the disponible for the day."
        : 'Chno l aw9at li disponible f dak nhar'
    },
    buildFallbackSource: async () => ({
      format: 'wav',
      bytes: Buffer.from('two'),
      metadata: { durationSeconds: 4.72 },
    }),
  })
  assert.equal(calls, 2)
  assert.equal(suspiciousThenGood.label, 'fallback:auto-slow')
  assert.equal(suspiciousThenGood.weak, false)
  assert.match(suspiciousThenGood.text, /aw9at/)

  calls = 0
  const firstPassGood = await transcribeWithFallback({
    primarySource: { format: 'wav', bytes: Buffer.from('one'), metadata: { durationSeconds: 3 } },
    model: 'primary-model',
    prompt: 'Darija et français',
    requestTranscription: async () => {
      calls += 1
      return 'bghit rendez-vous nhar tlat m3a 11:30'
    },
    buildFallbackSource: async () => {
      throw new Error('fallback must not run')
    },
  })
  assert.equal(calls, 1)
  assert.equal(firstPassGood.weak, false)

  calls = 0
  const observedFastAudio = await transcribeWithFallback({
    primarySource: { format: 'wav', bytes: Buffer.from('one'), metadata: { durationSeconds: 3.47 } },
    model: 'primary-model',
    prompt: 'Darija et français',
    requestTranscription: async () => {
      calls += 1
      return calls === 1
        ? "I've actually never been to the rendezvous that's available every day."
        : "Affectionate, but I didn't have any rendezvous with the disponibles that I had."
    },
    buildFallbackSource: async () => ({
      format: 'wav',
      bytes: Buffer.from('two'),
      metadata: { durationSeconds: 3.65 },
    }),
  })
  assert.equal(calls, 2)
  assert.equal(observedFastAudio.retryUsed, true)
  assert.equal(observedFastAudio.suspicious, true)
  assert.equal(observedFastAudio.weak, true, 'two divergent suspicious outputs must not be treated as certain')
  assert.equal(observedFastAudio.attemptsDisagree, true)
  assert.match(observedFastAudio.text, /disponibles/i)

  calls = 0
  const hallucinatedArabic = await transcribeWithFallback({
    primarySource: { format: 'ogg', bytes: Buffer.from('one'), metadata: { durationSeconds: 3.31 } },
    model: 'primary-model',
    prompt: 'lexique court',
    fallbackPrompt: '',
    requestTranscription: async (_source, options) => {
      calls += 1
      if (calls === 2) assert.equal(options.prompt, '', 'fallback must be independent from lexical prompt')
      return calls === 1
        ? 'مرعيد بالترثاك الترنيبو يتنخدرون ديف'
        : 'مرعيد بترثك الترنيب بتنخدرون ديف'
    },
    buildFallbackSource: async () => ({
      format: 'wav',
      bytes: Buffer.from('two'),
      metadata: { durationSeconds: 3.48 },
    }),
  })
  assert.equal(hallucinatedArabic.retryUsed, true)
  assert.equal(hallucinatedArabic.weak, true, 'two implausible STT outputs must be unusable')
  assert.ok(hallucinatedArabic.suspiciousReasons.includes('unrecognized_arabic_sequence'))

  calls = 0
  const conflictingPlausible = await transcribeWithFallback({
    primarySource: { format: 'ogg', bytes: Buffer.from('one'), metadata: { durationSeconds: 3 } },
    model: 'primary-model',
    requestTranscription: async () => {
      calls += 1
      return calls === 1
        ? 'I have the rendezvous for this day'
        : 'the clinic is located in Rabat for the patient'
    },
    buildFallbackSource: async () => ({ format: 'wav', bytes: Buffer.from('two') }),
  })
  assert.equal(conflictingPlausible.attemptsDisagree, true)
  assert.equal(conflictingPlausible.weak, true, 'radically different plausible attempts must clarify')
  assert.ok(conflictingPlausible.suspiciousReasons.includes('attempts_disagree'))

  await assert.rejects(
    () => transcribeWithFallback({
      primarySource: { format: 'wav', bytes: Buffer.from('one'), metadata: { durationSeconds: 3 } },
      model: 'primary-model',
      requestTranscription: async () => '',
      buildFallbackSource: async () => ({ format: 'wav', bytes: Buffer.from('two') }),
    }),
    (error) => error.code === 'EMPTY_TRANSCRIPTION' && error.attempts.length === 2,
  )

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
  assert.ok(
    mainSource.indexOf("reason: voiceNluAnalysis?.lowConfidence ? 'audio_low_confidence'")
      < mainSource.indexOf('ingestion = await getIncomingDecision'),
    'final unclear fallback must bypass CRM mutation and preserve the booking draft',
  )
  assert.ok(
    !/handleInboundAvailability\s*&&\s*!isVoice/.test(mainSource),
    'transcribed voice messages must enter the availability workflow',
  )
  assert.match(
    mainSource,
    /protected_voice_workflow_clarification/,
    'a protected workflow must never silently swallow a patient voice message',
  )

  const metadata = parseFfmpegInputMetadata(
    'Duration: 00:00:04.49, start: 0.006\\nStream #0:0: Audio: opus, 48000 Hz, mono, fltp',
  )
  assert.deepStrictEqual(metadata, {
    durationSeconds: 4.49,
    codec: 'opus',
    sampleRate: 48000,
    channels: 'mono',
  })

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-preprocess-'))
  const inputPath = path.join(tempDir, 'input.ogg')
  fs.writeFileSync(inputPath, 'audio')
  let ffmpegArgs = null
  const converted = await preprocessAudio({
    inputPath,
    outputDir: tempDir,
    ffmpegBinary: 'ffmpeg',
    strategy: 'fallback',
    execFileAsync: async (_binary, args) => {
      ffmpegArgs = args
      fs.writeFileSync(args[args.length - 1], 'wav')
      return {
        stderr: 'Duration: 00:00:03.47\\nAudio: opus, 48000 Hz, mono, fltp',
      }
    },
  })
  assert.ok(converted)
  assert.ok(ffmpegArgs.includes('pcm_s16le'))
  assert.ok(ffmpegArgs.includes('16000'))
  assert.match(ffmpegArgs[ffmpegArgs.indexOf('-af') + 1], /atempo=0\.95/)
  fs.rmSync(tempDir, { recursive: true, force: true })

  console.log('voice-transcription-pipeline-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
