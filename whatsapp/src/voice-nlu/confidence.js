/**
 * Confidence scoring for voice transcripts + NLU quality.
 * Clear dental intents should rarely fall into "I didn't understand".
 */

/**
 * @param {object} params
 * @param {number} [params.asrScore]
 * @param {boolean} [params.asrWeak]
 * @param {string} [params.rawText]
 * @param {string} [params.correctedText]
 * @param {string} [params.intent]
 * @param {number} [params.intentConfidence]
 * @param {string} [params.meaningHint]
 * @param {string[]} [params.canonicalTokens]
 * @returns {{ score: number, lowConfidence: boolean, reasons: string[] }}
 */
function computeVoiceConfidence({
  asrScore = 0,
  asrWeak = false,
  rawText = '',
  correctedText = '',
  intent = 'autre',
  intentConfidence = 0,
  meaningHint = '',
  canonicalTokens = [],
} = {}) {
  const reasons = []
  let score = 0.55

  const raw = String(rawText || '').trim()
  const corrected = String(correctedText || '').trim()
  const letters = (corrected.match(/[A-Za-zÀ-ÿ\u0600-\u06FF]/g) || []).length
  const tokens = Array.isArray(canonicalTokens) ? canonicalTokens : []
  const knownDental = tokens.some((token) => [
    'dent', 'douleur', 'rendez-vous', 'vouloir', 'prendre', 'venir', 'urgence',
    'gonflement', 'extraire', 'implant', 'prix', 'service', 'faire',
  ].includes(String(token || '').toLowerCase()))

  if (asrWeak) {
    score -= 0.12
    reasons.push('asr_weak')
  }

  if (Number.isFinite(asrScore)) {
    const asrContribution = Math.max(-0.15, Math.min(0.35, asrScore / 120))
    score += asrContribution
  }

  if (letters < 4) {
    score -= 0.3
    reasons.push('too_short')
  }

  if (!corrected) {
    score -= 0.5
    reasons.push('empty')
  }

  if (intent === 'autre') {
    score -= 0.08
    reasons.push('intent_autre')
  } else {
    score += Math.min(0.28, Number(intentConfidence || 0) * 0.28)
  }

  if (meaningHint) {
    score += 0.12
    reasons.push('meaning_hint')
  }

  if (knownDental) {
    score += 0.1
    reasons.push('dental_tokens')
  }

  // Junk ASR leftovers.
  if (/^(thank you|thanks|you|merci|sous-titres?)\.?$/i.test(raw) || /^(thank you|thanks|sous-titres?)\.?$/i.test(corrected)) {
    score -= 0.5
    reasons.push('junk_transcript')
  }

  score = Math.max(0, Math.min(1, score))

  // Recoverable: known intent or dental tokens ⇒ do not force clarification.
  const recoverable = Boolean(
    (intent && intent !== 'autre' && Number(intentConfidence || 0) >= 0.7)
    || meaningHint
    || knownDental,
  )

  const lowConfidence = recoverable
    ? (score < 0.22 || reasons.includes('empty') || reasons.includes('junk_transcript'))
    : score < 0.42

  return {
    score: Number(score.toFixed(3)),
    lowConfidence,
    reasons,
    recoverable,
  }
}

module.exports = {
  computeVoiceConfidence,
}
