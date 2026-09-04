/**
 * Deterministic multi-appointment selection for WhatsApp confirmation.
 * Never uses LLM; display index ≠ DB id.
 */

const { normalizePersonName } = require('../contact-patients')

const BOTH_PATTERNS = [
  /^(les\s+deux|both|tous|tous\s+les\s+deux|الكل|بجوج|جوج|الثنين|الاتنين|الاثنين)$/i,
  /^(confirm(e|er)?\s+(les\s+)?deux|أكد(هم)?\s*بجوج)$/i,
]

function normalizeSelectionText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstNameOf(fullName) {
  return normalizePersonName(fullName).split(' ').filter(Boolean)[0] || ''
}

function lastNameOf(fullName) {
  const parts = normalizePersonName(fullName).split(' ').filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 1] : ''
}

function candidateName(c) {
  return c.patientName || c.full_name || c.patient_name || ''
}

function candidateId(c) {
  return Number(c.appointmentId ?? c.appointment_id ?? c.id)
}

function looksLikeIndexOnlyMessage(text) {
  const raw = normalizeSelectionText(text)
  if (!raw || !/\d/.test(raw)) return false
  // Digits + separators / et / و / and — no person-name letters
  const stripped = raw
    .replace(/\b(et|and)\b/gi, ' ')
    .replace(/و/g, ' ')
    .replace(/[#).,:;\-/&|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(\d{1,2}(\s+\d{1,2})*)$/.test(stripped)
}

function extractDisplayIndices(text) {
  const raw = normalizeSelectionText(text)
  if (!raw) return []
  const matches = raw.match(/\d{1,2}/g) || []
  const out = []
  const seen = new Set()
  for (const m of matches) {
    const n = Number(m)
    if (!Number.isFinite(n) || n < 1 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function parseSingleIndexToken(text, max) {
  const raw = normalizeSelectionText(text)
  const m = raw.match(/^#?\s*(\d{1,2})\s*[).:]?\s*$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 1 || n > max) {
    return { n, valid: false }
  }
  return { n, valid: true }
}

/**
 * @param {{ message: string, candidates: Array<{appointmentId?:number,appointment_id?:number,id?:number,patientName?:string,full_name?:string,patient_name?:string}> }} input
 * @returns {{
 *   type: 'single'|'multiple'|'invalid'|'ambiguous'|'empty',
 *   appointmentIds: number[],
 *   matchedBy: string|null,
 *   reason?: string,
 *   displayIndices?: number[],
 * }}
 */
function parseAppointmentSelection({ message, candidates } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  const raw = normalizeSelectionText(message)
  if (!raw) {
    return { type: 'empty', appointmentIds: [], matchedBy: null, reason: 'empty' }
  }
  if (!list.length) {
    return { type: 'invalid', appointmentIds: [], matchedBy: null, reason: 'no_candidates' }
  }

  const max = list.length

  if (BOTH_PATTERNS.some((re) => re.test(raw))) {
    return {
      type: 'multiple',
      appointmentIds: list.map(candidateId).filter(Number.isFinite),
      matchedBy: 'multiple_indices',
      reason: 'both_keyword',
      displayIndices: list.map((_, i) => i + 1),
    }
  }

  if (looksLikeIndexOnlyMessage(raw)) {
    const indices = extractDisplayIndices(raw)
    if (!indices.length) {
      return { type: 'invalid', appointmentIds: [], matchedBy: 'index', reason: 'no_index' }
    }
    const invalid = indices.filter((n) => n < 1 || n > max)
    if (invalid.length) {
      return {
        type: 'invalid',
        appointmentIds: [],
        matchedBy: 'index',
        reason: 'index_out_of_range',
        displayIndices: indices,
      }
    }
    const ids = indices.map((n) => candidateId(list[n - 1])).filter(Number.isFinite)
    if (ids.length === 1) {
      return {
        type: 'single',
        appointmentIds: ids,
        matchedBy: 'index',
        displayIndices: indices,
      }
    }
    return {
      type: 'multiple',
      appointmentIds: ids,
      matchedBy: 'multiple_indices',
      displayIndices: indices,
    }
  }

  const singleIdx = parseSingleIndexToken(raw, max)
  if (singleIdx) {
    if (!singleIdx.valid) {
      return {
        type: 'invalid',
        appointmentIds: [],
        matchedBy: 'index',
        reason: 'index_out_of_range',
        displayIndices: [singleIdx.n],
      }
    }
    return {
      type: 'single',
      appointmentIds: [candidateId(list[singleIdx.n - 1])],
      matchedBy: 'index',
      displayIndices: [singleIdx.n],
    }
  }

  const norm = normalizePersonName(raw)
  if (!norm) {
    return { type: 'invalid', appointmentIds: [], matchedBy: null, reason: 'empty_name' }
  }

  // 1) Full name exact
  const exactFull = list.filter((c) => normalizePersonName(candidateName(c)) === norm)
  if (exactFull.length === 1) {
    return {
      type: 'single',
      appointmentIds: [candidateId(exactFull[0])],
      matchedBy: 'name',
      reason: 'full_name',
    }
  }
  if (exactFull.length > 1) {
    return {
      type: 'ambiguous',
      appointmentIds: exactFull.map(candidateId),
      matchedBy: 'name',
      reason: 'full_name_ambiguous',
    }
  }

  // Message contains a unique full name among candidates
  const contained = list.filter((c) => {
    const full = normalizePersonName(candidateName(c))
    return full && (norm.includes(full) || full.includes(norm))
  })
  if (contained.length === 1 && normalizePersonName(candidateName(contained[0])).split(' ').length >= 2) {
    const full = normalizePersonName(candidateName(contained[0]))
    if (norm === full || norm.includes(full)) {
      return {
        type: 'single',
        appointmentIds: [candidateId(contained[0])],
        matchedBy: 'name',
        reason: 'full_name_contained',
      }
    }
  }

  const tokens = norm.split(' ').filter(Boolean)

  // 2) Unique first name
  if (tokens.length === 1) {
    const first = tokens[0]
    const byFirst = list.filter((c) => firstNameOf(candidateName(c)) === first)
    if (byFirst.length === 1) {
      return {
        type: 'single',
        appointmentIds: [candidateId(byFirst[0])],
        matchedBy: 'name',
        reason: 'first_name',
      }
    }
    if (byFirst.length > 1) {
      return {
        type: 'ambiguous',
        appointmentIds: byFirst.map(candidateId),
        matchedBy: 'name',
        reason: 'first_name_ambiguous',
      }
    }

    // 3) Unique last name
    const byLast = list.filter((c) => lastNameOf(candidateName(c)) === first)
    if (byLast.length === 1) {
      return {
        type: 'single',
        appointmentIds: [candidateId(byLast[0])],
        matchedBy: 'name',
        reason: 'last_name',
      }
    }
    if (byLast.length > 1) {
      return {
        type: 'ambiguous',
        appointmentIds: byLast.map(candidateId),
        matchedBy: 'name',
        reason: 'last_name_ambiguous',
      }
    }

    return {
      type: 'invalid',
      appointmentIds: [],
      matchedBy: 'name',
      reason: 'unknown_name',
    }
  }

  // Multi-token without exact match → unknown (no aggressive fuzzy)
  return {
    type: 'invalid',
    appointmentIds: [],
    matchedBy: 'name',
    reason: 'unknown_name',
  }
}

function toSelectionCandidate(row) {
  return {
    appointmentId: Number(row.appointment_id ?? row.appointmentId ?? row.id),
    patientId: Number(row.customer_id ?? row.patient_id ?? row.patientId ?? 0) || null,
    patientName: String(row.full_name || row.patientName || row.patient_name || '').trim(),
    date: String(row.appointment_date || row.date || '').slice(0, 10),
    time: String(row.appointment_time || row.time || '').slice(0, 5),
  }
}

module.exports = {
  parseAppointmentSelection,
  normalizePersonName,
  normalizeSelectionText,
  toSelectionCandidate,
  looksLikeIndexOnlyMessage,
  extractDisplayIndices,
}
