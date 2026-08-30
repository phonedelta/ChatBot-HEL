/**
 * Conversation language memory — stable active language with 2-message switch.
 * Pure state machine (no I/O). Persist via Smart CRM.
 */

const ALLOWED = new Set(['fr', 'darija'])

/**
 * @param {string|null|undefined} value
 * @returns {'fr'|'darija'|null}
 */
function normalizeActiveLanguage(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'ar' || raw === 'arabic' || raw.includes('darija') || raw.includes('arabe')) {
    return 'darija'
  }
  if (raw === 'fr' || raw === 'french' || raw.includes('fran')) {
    return 'fr'
  }
  return null
}

/**
 * @param {{
 *   activeLanguage?: string|null,
 *   candidateLanguage?: string|null,
 *   candidateLanguageCount?: number,
 *   detectedLanguage?: string|null,
 *   confidence?: number,
 *   reliable?: boolean,
 *   switchThreshold?: number,
 * }} input
 */
function updateConversationLanguageState(input = {}) {
  const switchThreshold = Math.max(2, Number(input.switchThreshold) || 2)
  const activeLanguage = normalizeActiveLanguage(input.activeLanguage)
  const candidateLanguage = normalizeActiveLanguage(input.candidateLanguage)
  const candidateLanguageCount = Math.max(0, Number(input.candidateLanguageCount) || 0)

  const reliable = input.reliable !== false
    && Boolean(input.reliable || (Number(input.confidence) >= 0.75))
  const detected = normalizeActiveLanguage(input.detectedLanguage)

  // Neutral / unknown / low confidence — leave state unchanged
  if (!reliable || !detected || !ALLOWED.has(detected)) {
    return {
      activeLanguage,
      candidateLanguage,
      candidateLanguageCount,
      switched: false,
      responseLanguage: activeLanguage,
      reason: 'neutral_or_unreliable',
    }
  }

  // First clear language → set immediately
  if (!activeLanguage) {
    return {
      activeLanguage: detected,
      candidateLanguage: null,
      candidateLanguageCount: 0,
      switched: true,
      responseLanguage: detected,
      reason: 'initial',
    }
  }

  // Same as active → reset candidate
  if (detected === activeLanguage) {
    return {
      activeLanguage,
      candidateLanguage: null,
      candidateLanguageCount: 0,
      switched: false,
      responseLanguage: activeLanguage,
      reason: 'same_as_active',
    }
  }

  // Continuing same candidate
  if (candidateLanguage === detected) {
    const nextCount = candidateLanguageCount + 1
    if (nextCount >= switchThreshold) {
      return {
        activeLanguage: detected,
        candidateLanguage: null,
        candidateLanguageCount: 0,
        switched: true,
        responseLanguage: detected,
        reason: 'switched_after_threshold',
      }
    }
    return {
      activeLanguage,
      candidateLanguage: detected,
      candidateLanguageCount: nextCount,
      switched: false,
      responseLanguage: activeLanguage,
      reason: 'candidate_increment',
    }
  }

  // New other language → start candidate at 1
  return {
    activeLanguage,
    candidateLanguage: detected,
    candidateLanguageCount: 1,
    switched: false,
    responseLanguage: activeLanguage,
    reason: 'new_candidate',
  }
}

module.exports = {
  updateConversationLanguageState,
  normalizeActiveLanguage,
  ALLOWED_LANGUAGES: ALLOWED,
}
