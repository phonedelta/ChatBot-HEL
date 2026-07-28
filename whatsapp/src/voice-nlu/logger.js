/**
 * Persist voice NLU debug logs for each processed audio.
 */

const fs = require('fs')
const path = require('path')

/**
 * @param {string} baseDir
 * @param {object} entry
 * @returns {string|null} saved file path
 */
function saveVoiceNluLog(baseDir, entry) {
  const root = String(baseDir || '').trim()
  if (!root) {
    return null
  }

  try {
    fs.mkdirSync(root, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const messageId = String(entry?.message_id || 'unknown').replace(/[^\w.-]+/g, '_').slice(0, 80)
    const filePath = path.join(root, `${stamp}_${messageId}.json`)

    const payload = {
      saved_at: new Date().toISOString(),
      ...entry,
    }

    // Avoid storing huge binary in JSON by default; keep path/meta only.
    if (payload.audio_original_base64) {
      delete payload.audio_original_base64
    }

    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return filePath
  } catch (error) {
    console.warn('[voice-nlu] unable to save voice log', {
      reason: error.message || String(error),
    })
    return null
  }
}

/**
 * Optionally copy original audio beside the JSON log.
 * @param {string} baseDir
 * @param {string} sourceAudioPath
 * @param {string} messageId
 * @returns {string|null}
 */
function archiveOriginalAudio(baseDir, sourceAudioPath, messageId) {
  const root = String(baseDir || '').trim()
  const source = String(sourceAudioPath || '').trim()
  if (!root || !source || !fs.existsSync(source)) {
    return null
  }

  try {
    const audioDir = path.join(root, 'audio')
    fs.mkdirSync(audioDir, { recursive: true })
    const ext = path.extname(source) || '.ogg'
    const safeId = String(messageId || Date.now()).replace(/[^\w.-]+/g, '_').slice(0, 80)
    const target = path.join(audioDir, `${Date.now()}_${safeId}${ext}`)
    fs.copyFileSync(source, target)
    return target
  } catch (error) {
    console.warn('[voice-nlu] unable to archive audio file', {
      reason: error.message || String(error),
    })
    return null
  }
}

/**
 * Patch an existing voice log with later fields (e.g. bot reply).
 * @param {string} logPath
 * @param {object} patch
 * @returns {boolean}
 */
function updateVoiceNluLog(logPath, patch = {}) {
  const target = String(logPath || '').trim()
  if (!target || !fs.existsSync(target)) {
    return false
  }

  try {
    const current = JSON.parse(fs.readFileSync(target, 'utf8'))
    const next = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    console.warn('[voice-nlu] unable to update voice log', {
      reason: error.message || String(error),
    })
    return false
  }
}

module.exports = {
  saveVoiceNluLog,
  archiveOriginalAudio,
  updateVoiceNluLog,
}
