/**
 * Phone normalization for Moroccan WhatsApp numbers.
 * Output display format: +212 6 XX XX XX XX
 */

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '')
}

/**
 * Normalize to E.164-ish digits without plus, default Morocco.
 * @param {string} value
 * @returns {string} digits only (e.g. 212612345678)
 */
function normalizePhoneDigits(value) {
  let digits = digitsOnly(value)
  if (!digits) return ''

  // Strip WhatsApp LID-style prefixes already handled upstream — keep last plausible MSISDN.
  if (digits.length > 13 && digits.startsWith('212')) {
    digits = digits.slice(-12)
  }

  if (digits.startsWith('0') && digits.length === 10) {
    digits = `212${digits.slice(1)}`
  } else if (digits.length === 9 && /^[67]/.test(digits)) {
    digits = `212${digits}`
  } else if (digits.startsWith('2120') && digits.length === 13) {
    digits = `212${digits.slice(4)}`
  }

  return digits
}

/**
 * @param {string} value
 * @returns {string} +212XXXXXXXXX
 */
function toE164(value) {
  const digits = normalizePhoneDigits(value)
  return digits ? `+${digits}` : ''
}

/**
 * Pretty Moroccan mobile formatting.
 * @param {string} value
 * @returns {string}
 */
function formatPhoneDisplay(value) {
  const digits = normalizePhoneDigits(value)
  if (!digits) return ''

  if (digits.startsWith('212') && digits.length === 12) {
    const local = digits.slice(3)
    return `+212 ${local[0]} ${local.slice(1, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`.trim()
  }

  return `+${digits}`
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidPhone(value) {
  const digits = normalizePhoneDigits(value)
  return /^212[5-7]\d{8}$/.test(digits) || /^\d{10,15}$/.test(digits)
}

module.exports = {
  digitsOnly,
  normalizePhoneDigits,
  toE164,
  formatPhoneDisplay,
  isValidPhone,
}
