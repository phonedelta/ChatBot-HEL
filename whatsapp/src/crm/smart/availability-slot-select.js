/**
 * Parse selection of an available slot (index or clock time).
 * Uses shared normalizeTimeExpression for Moroccan / FR formats.
 */

const {
  normalizeSlotTime,
  parseTimeMinutes,
  normalizeTimeExpression,
  extractEmbeddedTime,
} = require('../appointment-slots')

function normalizeSelectionInput(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Extract a clock time from a short selection reply.
 * Prefer shared normalizer; keep half-hour Darija forms.
 */
function extractClockTime(text) {
  const raw = normalizeSelectionInput(text)
  if (!raw) return null

  const direct = normalizeTimeExpression(raw)
  if (direct) return direct.normalized

  // 11 ونص / 11 w nos → +30 (also covered by normalizer, keep fallback)
  const halfAr = raw.match(/^(?:m3a|مع|a)?\s*(\d{1,2})\s*(?:ونص|w\s*nos|ou?\s*nos)\s*$/i)
  if (halfAr) {
    const h = Number(halfAr[1])
    if (h >= 0 && h <= 23) return normalizeSlotTime(`${h}:30`)
  }

  return extractEmbeddedTime(raw)
}

/**
 * @param {{ input: string, candidateSlots: Array<{index?:number, time:string}|string> }} args
 * @returns {{
 *   type: 'index'|'time'|'invalid',
 *   selectedTime?: string,
 *   index?: number,
 *   reason?: string,
 * }}
 */
function parseAvailableSlotSelection({ input, candidateSlots } = {}) {
  const list = (Array.isArray(candidateSlots) ? candidateSlots : []).map((c, i) => {
    if (typeof c === 'string') return { index: i + 1, time: normalizeSlotTime(c) }
    return {
      index: Number(c.index) || i + 1,
      time: normalizeSlotTime(c.time || c.slot_time || ''),
    }
  }).filter((c) => c.time)

  const raw = normalizeSelectionInput(input)
  if (!raw) return { type: 'invalid', reason: 'empty' }
  if (!list.length) return { type: 'invalid', reason: 'no_candidates' }

  // Index only (never treat bare "3" as 03:00 while in selection state)
  const idxMatch = raw.match(/^#?\s*(\d{1,2})\s*[).:]?\s*$/)
  if (idxMatch) {
    const n = Number(idxMatch[1])
    const hit = list.find((c) => c.index === n)
    if (!hit) return { type: 'invalid', reason: 'index_out_of_range', index: n }
    return { type: 'index', selectedTime: hit.time, index: n }
  }

  const clock = extractClockTime(raw)
  if (clock) {
    const hit = list.find((c) => c.time === clock)
    if (!hit) {
      const mins = parseTimeMinutes(clock)
      const byMin = list.find((c) => parseTimeMinutes(c.time) === mins)
      if (!byMin) return { type: 'invalid', reason: 'time_unavailable', selectedTime: clock }
      return { type: 'time', selectedTime: byMin.time, index: byMin.index }
    }
    return { type: 'time', selectedTime: hit.time, index: hit.index }
  }

  return { type: 'invalid', reason: 'unrecognized' }
}

module.exports = {
  parseAvailableSlotSelection,
  extractClockTime,
  normalizeTimeExpression,
}
