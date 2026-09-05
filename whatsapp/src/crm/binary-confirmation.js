/**
 * Central binary confirmation parser (OUI/NON, نعم/لا, Darija Latin).
 * Used by cancel, appointment confirmation, slot proposals, etc.
 *
 * Returns value only — the calling workflow assigns business meaning
 * (e.g. yes = cancel vs yes = confirm appointment).
 */

const CONFIRM_YES_PATTERNS = [
  /^(oui+|ouais|ok+|okay|yes|yep|daccord|je confirme|confirm[ée]?|cest bon|vas y)$/i,
  /^(نعم+|موافق|أكيد|اكيد|ايوا|أيوا|إيوا|واخا|تمام|صح|وا|ايه|آها)$/i,
  /^(iwa|iyeh|iyah|iyeh+|iwa+|wakha|waha|ah|aah|aaah|confirmi|confirm|na3am|naam)$/i,
  /^(إيوا\s*نعم|ايوا\s*نعم|n?ak?d(?:\s*lmo3id|\s*lmow3id)?)$/i,
  /^(?:(?:na3am|naam|oui|yes|wakha|waha|اه|آه|نعم)\s+)?(?:kolchi|kol\s*chi|tout)\s+(?:shih|s7i7|s7ih|sahih|mzyan|mzian|correct|bon|صحيح|مزيان)$/i,
  /^(?:oui|yes)\s+(?:tout\s+(?:est\s+)?(?:correct|bon)|cest\s+bon|c['’]est\s+bon)$/i,
  /^(?:كلشي|كل\s*شي)\s+(?:صحيح|مزيان)$/u,
  /^(?:نعم|اه|آه)\s+(?:كلشي|كل\s*شي)\s+(?:صحيح|مزيان)$/u,
]

const CONFIRM_NO_PATTERNS = [
  /^(non+|no|nn|pas|annule|annuler|annulé|annulee)$/i,
  /^(لا|لاء|ماشي|كانسل|الغ|ألغ|تعديل)$/i,
  /^(la|laa|lla|la2|lah|mabghitch|mabghitsh)$/i,
  /^(مابغيتش|ما\s*بغيتش)$/i,
  /\b(pas possible|autre date|nest pas bon)\b/i,
  /^(non merci|je garde|finalement non)$/i,
]

/** Patient wants to KEEP appointment (NO to cancellation). */
const KEEP_APPOINTMENT_PATTERNS = [
  /\bje\s+(veux|souhaite|prefere)\s+(garder|conserver|rester)\b/i,
  /\b(non\s+)?je\s+garde\b/i,
  /\b(ne\s+)?pas\s+annul/i,
  /\bn[\s']?annul(e|ez|er)?\s+pas\b/i,
  /\bje\s+ne\s+veux\s+plus\s+annul/i,
  /\bfinalement\s+non\b/i,
  /\blaiss(e|ez)\s+(le\s+)?rendez/i,
  /\b(conserver|garder)\s+(mon\s+)?rendez/i,
  /\bلا\s+خلي\b/,
  /\bخلي\s+(ال)?موعد\b/,
  /\bبغيت\s+نخلي\b/,
  /\bما\s+بغيتش\s+نلغي\b/,
  /\bما\s+تلغيش\b/,
  /\bلا\s+ما\s+تلغيش\b/,
  /\bخليه\s+كيف\s+ما\s+هو\b/,
  /\bبغيت\s+نبقى\b/,
  /\bla\s+b?ghit\s+n?[9q]?a\b/i,
  /\bla\s+b?ghit\s+n?b?[9q]?a\b/i,
  /\bbghit\s+n?[9q]?a\b.*\b(rendez|rdv|mo3id|mow3id|lmo3id|appointment)\b/i,
  /\bbghit\s+n?b?[9q]?a\b.*\b(rendez|rdv|mo3id|mow3id|lmo3id|appointment)\b/i,
  /\bbghit\s+n?e?b?[9q]?a\b.*\b(rendez|rdv|mo3id|mow3id|lmo3id)\b/i,
  /\bkh+a?ll?i?\s+(lmo3id|rendez|rdv|mo3id|mow3id|appointment)\b/i,
  /\bkh+a?li\s+(lmo3id|rendez|rdv|mo3id|mow3id)\b/i,
  /\bn?kh+a?ll?i?\s+(lmo3id|rendez|rdv|mo3id)\b/i,
  /\bma\s+b?gh?it?ch\s+n?\s*annul/i,
  /\bmab?gh?it?ch\s+n?\s*annul/i,
  /\bma\s+t?\s*annul/i,
  /\bmatl?gh?ich\b/i,
  /\bma\s+tl?gh?ich\b/i,
  /\bma\s+b?gh?it?ch\s+n?\s*l?gh/i,
  /\bbghit\s+n?kh+a?ll?i?\s+(rendez|rdv|lmo3id|mo3id)\b/i,
  /\bbghit\s+n?5li\s+(rendez|rdv|lmo3id)\b/i,
  /\bla\s+merci\b/i,
  /\bla\s+chou?kran\b/i,
]

/** Patient confirms they DO want to cancel (YES to cancellation). */
const CONFIRM_CANCEL_PATTERNS = [
  /\bwakha\s+annul/i,
  /\bwakha\s+l?gh/i,
  /\bbghit\s+n?\s*l?gh/i,
  /\bbghit\s+n?l?gh?i\b/i,
  /\blghi\s+(rendez|rdv|mo3id|mow3id|lmo3id|appointment)\b/i,
  /\bn?lghi\s+(rendez|rdv|mo3id)\b/i,
  /\boui\s+annul/i,
  /\boui\s+annulez/i,
  /\bje\s+confirme\s+l?\s?annul/i,
  /\bconfirm(e|er)?\s+l?\s?annul/i,
  /\bنعم\s+لغ/i,
  /\bواخا\s+لغ/i,
  /\bبغيت\s+نلغي\b/,
  /\bلغي\s+الموعد\b/,
]

function normalizeConfirmationText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`´]/g, ' ')
    .replace(/[^\p{L}\p{N}\s\u0600-\u06FF]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesAny(patterns, value) {
  return patterns.some((pattern) => pattern.test(value))
}

function isExactBinaryNoToken(normalized) {
  return /^(la|laa|lla|la2|lah|non|no|nn|لا|لاء|mabghitch|mabghitsh|مابغيتش)$/.test(normalized)
}

function isExactBinaryYesToken(normalized) {
  if (/^(la|laa|lla|la2|lah|non|no|nn|لا|لاء)$/.test(normalized)) return false
  return /^(oui|ouais|ok|okay|yes|yep|wakha|waha|iwa|iyeh|iyah|ah|aah|na3am|naam|نعم|ايوا|أيوا|واخا|ايه|وا)$/.test(normalized)
}

/** Common typos for "oui" in YES/NO contexts (slot proposal, confirmation). */
function isTypoAffirmative(normalized) {
  return /^(ui|oiu|ouii|ouiii|u+i|y+ep?|yup|okk+|ok+)$/i.test(normalized)
}

/**
 * Parse short YES/NO replies in an active binary workflow context.
 * @param {string} text
 * @param {{ allowTypoYes?: boolean }} [opts]
 * @returns {{ value: 'yes'|'no'|'unknown', confidence: number, reason?: string }}
 */
function parseYesNoReply(text, opts = {}) {
  const allowTypoYes = opts.allowTypoYes !== false
  const normalized = normalizeConfirmationText(text)
  if (!normalized) return { value: 'unknown', confidence: 0, reason: 'empty' }

  // Complex intent (reschedule / cancel / book) → let router handle
  if (
    normalized.split(/\s+/).length >= 3
    && /\b(bghit|brit|baghi|nbdl|n7wel|nlghi|annul|changer|reporter|walakin|mais)\b/i.test(normalized)
  ) {
    return { value: 'unknown', confidence: 0.25, reason: 'complex_intent' }
  }

  if (isExactBinaryNoToken(normalized) || matchesAny(CONFIRM_NO_PATTERNS, normalized)) {
    return { value: 'no', confidence: isExactBinaryNoToken(normalized) ? 0.98 : 0.88, reason: 'binary_no' }
  }

  if (isExactBinaryYesToken(normalized) || matchesAny(CONFIRM_YES_PATTERNS, normalized)) {
    return { value: 'yes', confidence: 0.93, reason: 'binary_yes' }
  }

  if (allowTypoYes && isTypoAffirmative(normalized)) {
    return { value: 'yes', confidence: 0.85, reason: 'typo_yes' }
  }

  return { value: 'unknown', confidence: 0.2, reason: 'unrecognized' }
}

function hasKeepSignal(normalized) {
  if (isExactBinaryNoToken(normalized)) return true
  return matchesAny(KEEP_APPOINTMENT_PATTERNS, normalized)
}

function hasCancelConfirmSignal(normalized) {
  if (matchesAny(CONFIRM_CANCEL_PATTERNS, normalized)) return true
  return matchesAny(CONFIRM_YES_PATTERNS, normalized) && /\b(annul|lgh|cancel|لغ)\b/i.test(normalized)
}

function isAmbiguousCancelConfirmation(normalized) {
  const hasLaOrNoPrefix = /^(la|non|laa|لا)(\s|,|$)/.test(normalized)
  const hasContradictionBridge = /\b(mais|finalement|walakin|wakha)\b/i.test(normalized)
  const hasCancelWord = /\bannul|\blghi|\bnlghi|\bcancel|\bلغ/i.test(normalized)
  if (hasLaOrNoPrefix && hasContradictionBridge && hasCancelWord) {
    return true
  }

  const keep = hasKeepSignal(normalized)
  const cancel = hasCancelConfirmSignal(normalized)
  if (!keep || !cancel) return false
  if (isExactBinaryNoToken(normalized)) return false
  return normalized.split(/\s+/).length > 2
}

/**
 * @param {{ text?: string, context?: 'generic'|'cancel_confirmation' }} input
 * @returns {{ value: 'yes'|'no'|'unknown'|'ambiguous', confidence: number, reason?: string }}
 */
function parseBinaryConfirmation(input = {}) {
  const raw = String(input.text || '').trim()
  const normalized = normalizeConfirmationText(raw)
  const context = input.context || 'generic'

  if (!normalized) {
    return { value: 'unknown', confidence: 0, reason: 'empty' }
  }

  // Never treat scheduling phrases as binary NO
  if (context === 'generic' && /\b(la semaine prochaine|la semaine|la prochaine)\b/i.test(normalized)) {
    return { value: 'unknown', confidence: 0, reason: 'scheduling_phrase' }
  }

  // "ah walakin bghit nbdl..." is not a blind YES
  if (
    normalized.split(/\s+/).length >= 3
    && /\b(walakin|mais|bghit|nbdl|n7wel|nlghi|annul|changer)\b/i.test(normalized)
    && context !== 'cancel_confirmation'
  ) {
    return { value: 'unknown', confidence: 0.25, reason: 'complex_intent' }
  }

  if (context === 'cancel_confirmation') {
    if (isAmbiguousCancelConfirmation(normalized)) {
      return { value: 'ambiguous', confidence: 0.55, reason: 'contradictory' }
    }

    if (hasKeepSignal(normalized)) {
      return { value: 'no', confidence: isExactBinaryNoToken(normalized) ? 0.98 : 0.93, reason: 'keep_appointment' }
    }

    if (hasCancelConfirmSignal(normalized)) {
      return { value: 'yes', confidence: 0.93, reason: 'confirm_cancel' }
    }
  }

  if (matchesAny(CONFIRM_YES_PATTERNS, normalized) || isExactBinaryYesToken(normalized)) {
    return { value: 'yes', confidence: 0.9, reason: 'binary_yes' }
  }

  if (matchesAny(CONFIRM_NO_PATTERNS, normalized) || isExactBinaryNoToken(normalized)) {
    return { value: 'no', confidence: isExactBinaryNoToken(normalized) ? 0.95 : 0.88, reason: 'binary_no' }
  }

  if (context === 'cancel_confirmation' && matchesAny(KEEP_APPOINTMENT_PATTERNS, normalized)) {
    return { value: 'no', confidence: 0.85, reason: 'keep_semantic' }
  }

  return { value: 'unknown', confidence: 0.2, reason: 'unrecognized' }
}

function isConfirmationYes(text, context = 'generic') {
  return parseBinaryConfirmation({ text, context }).value === 'yes'
}

function isConfirmationNo(text, context = 'generic') {
  return parseBinaryConfirmation({ text, context }).value === 'no'
}

module.exports = {
  parseBinaryConfirmation,
  parseYesNoReply,
  normalizeConfirmationText,
  isConfirmationYes,
  isConfirmationNo,
  isTypoAffirmative,
}
