/**
 * Explicit booking-field corrections during progressive WhatsApp booking.
 * A recognized correction patches ONLY the targeted fields — never a free-form re-extract.
 */

const { validateFullName } = require('./name-validator')
const { stripPersonNameLabels } = require('./name-validator')
const { toE164, isValidPhone } = require('./phone')
const { resolveMoroccanCity } = require('./morocco-cities')
const { resolveService } = require('./services')
const { extractAppointment, resolveMotifPair } = require('./extract')

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function clipTrailingJunk(value) {
  let s = String(value || '').trim()
  if (!s) return ''
  // Stop before another field label / contrast in multi-corrections
  s = s.split(/\s*(?:,|\bet\b|\bw\b|و)\s*(?=(?:ville|city|مدينة|numero|n[°o]|tel|telephone|phone|رقم|date|heure|jour|موعد))/i)[0]
  s = s.replace(/[,:;.\-–—]+$/g, '').trim()
  return s
}

function parseNameValue(rawValue) {
  let candidate = stripPersonNameLabels(clipTrailingJunk(rawValue))
  candidate = candidate
    .replace(/^(?:est|c['’]est|howa|hiya|howwa|kayn|cest)\s+/i, '')
    .replace(/^(?:l['’]|le|la|el)\s+/i, '')
    .trim()
  candidate = stripPersonNameLabels(candidate)
  // Arabic: "لياسين" → "ياسين" after بدل الاسم ل…
  candidate = candidate.replace(/^ل(?=[\u0600-\u06FF])/u, '')
  const full = validateFullName(candidate)
  if (full) return full
  const parts = candidate.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    for (let n = Math.min(4, parts.length); n >= 2; n -= 1) {
      const slice = validateFullName(parts.slice(0, n).join(' '))
      if (slice) return slice
    }
  }
  return null
}

function parsePhoneValue(rawValue) {
  const raw = String(rawValue || '')
  const match = raw.match(/(?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8}/)
  if (!match) return null
  const e164 = toE164(match[0])
  return isValidPhone(e164) ? e164 : null
}

function parseCityValue(rawValue) {
  return resolveMoroccanCity(clipTrailingJunk(rawValue))
}

function parseMotifValue(rawValue) {
  const exact = clipTrailingJunk(rawValue)
  if (!exact) return null
  const motif = resolveMotifPair(exact)
  if (motif?.problem) return motif
  const resolved = resolveService(exact)
  if (resolved) {
    return {
      problem: resolved.service,
      problem_details: resolved.clientLabel || exact,
      urgency: resolved.urgency || 'moyenne',
    }
  }
  return { problem: null, problem_details: exact, urgency: null }
}

/**
 * @returns {{
 *   isCorrection: boolean,
 *   fields: Object,
 *   cleared: Object,
 *   changedFields: string[],
 * }}
 */
function detectCorrectionIntent(text, options = {}) {
  const raw = String(text || '').trim()
  const empty = { isCorrection: false, fields: {}, cleared: {}, changedFields: [] }
  if (!raw) return empty

  const fields = {}
  const cleared = {}
  const changedFields = []
  const n = normalizeText(raw)

  const mark = (key) => {
    if (!changedFields.includes(key)) changedFields.push(key)
  }

  // --- Clear without replacement ---
  if (
    /\b(?:le\s+)?nom(?:\s+complet)?\s+(?:est\s+)?(?:faux|incorrect|pas\s+(?:bon|correct)|غلط|غالط|ماشي\s*صحيح)\b/.test(n)
    || /\b(?:smiya|اسم)\s+(?:dialo|dyalo)?\s*(?:ghalta|غالطة|ماشي|faux)\b/.test(n)
  ) {
    cleared.full_name = true
    mark('full_name')
  }
  if (
    /\b(?:le\s+)?(?:numero|n[°o]|telephone|tel|phone|رقم)\s+(?:est\s+)?(?:faux|incorrect|pas\s+bon|غالط|ماشي)\b/.test(n)
  ) {
    if (!/(?:\+?212|0)[\s.-]*[5-7]/.test(raw)) {
      cleared.phone_number = true
      mark('phone_number')
    }
  }
  if (
    /\b(?:la\s+)?(?:ville|city|مدينة)\s+(?:est\s+)?(?:fausse|incorrecte|pas\s+(?:bonne|correcte)|غالطة|ماشي)\b/.test(n)
  ) {
    if (!parseCityValue(raw)) {
      cleared.city = true
      mark('city')
    }
  }

  // --- Name corrections with value ---
  const namePatterns = [
    /(?:changer|corriger|modifier|bdel|bdl)\s+(?:le\s+)?(?:nom(?:\s+complet)?|smiya|smiyto|smito|اسم(?:\s+الكامل)?)\s*[:\-–]?\s*(.+)$/iu,
    /(?:changer|corriger)\s+smiya\s*[:\-–]?\s*(.+)$/iu,
    /(?:bdel|bdl)\s+smiya\s+(?:l|li|ل)?\s*(.+)$/iu,
    /(?:la\s+)?smiya\s+(?:hiya|howa|kamla|correcte?)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:smiya|smiyto|smito|smitha|smita)\s+(?:dialo|dyalo|dialha|dyalha|howa|hiya)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:le\s+)?nom(?:\s+complet)?(?:\s+(?:est|c['’]est|correct(?:e)?(?:\s+est)?))?\s*[:\-–]\s*(.+)$/iu,
    /(?:le\s+)?nom(?:\s+complet)?\s+(?:est|c['’]est)\s+(.+)$/iu,
    /(?:non[, ]+)?(?:le\s+)?nom\s+correct(?:e)?\s+(?:est|c['’]est)\s+(.+)$/iu,
    /corrige(?:r)?\s+le\s+nom\s+en\s+(.+)$/iu,
    /الاسم(?:\s+الكامل)?(?:\s+الصحيح)?\s*(?:هو|:)\s*(.+)$/u,
    /بدل\s+الاسم\s*(?:ل|الى|إلى)?\s*(.+)$/u,
  ]

  for (const pattern of namePatterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const name = parseNameValue(match[1])
    if (name) {
      fields.full_name = name
      mark('full_name')
      break
    }
  }
  // Explicit replacement wins over a bare "nom est faux"
  if (fields.full_name && cleared.full_name) {
    delete cleared.full_name
  }

  // --- Phone ---
  const phonePatterns = [
    /(?:changer|corriger|bdel|bdl)\s+(?:le\s+)?(?:num[eé]ro|n[°o]|telephone|tel[eé]phone|tel|phone|رقم(?:\s+الهاتف)?)\s*[:\-–]?\s*(.+)$/iu,
    /(?:la?\s+)?(?:num[eé]ro|telephone|tel[eé]phone|tel|phone)\s+(?:howa|correcte?|est|plutot|plutôt)?\s*[:\-–]?\s*(.+)$/iu,
    /رقم(?:\s+الهاتف)?(?:\s+الصحيح)?\s*(?:هو|:)\s*(.+)$/u,
    /(?:telephone|tel[eé]phone|tel|phone|num[eé]ro)\s*[:\-–]\s*(.+)$/iu,
  ]
  for (const pattern of phonePatterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const phone = parsePhoneValue(match[1])
    if (phone) {
      fields.phone_number = phone
      mark('phone_number')
      break
    }
  }

  // --- City ---
  const cityPatterns = [
    /(?:changer|corriger|bdel|bdl)\s+(?:la\s+)?(?:ville|city|مدينة)\s*[:\-–]?\s*(.+)$/iu,
    /(?:la\s+)?(?:ville|city)\s+(?:hiya|howa|correcte?|est)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:ville|city)\s*[:\-–]\s*(.+)$/iu,
    /المدينة(?:\s+الصحيحة)?\s*(?:هي|:)\s*(.+)$/u,
    /\bla\s+ana\s+f\s+([\p{L}][\p{L}\s'-]{1,40})$/iu,
  ]
  for (const pattern of cityPatterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const city = parseCityValue(match[1])
    if (city) {
      fields.city = city
      mark('city')
      break
    }
  }

  // --- Motif / complaint (explicit contrast or labeled) ---
  const motifCorrection = (
    /\b(?:la\s+)?machi\b.+\b(?:bghit|3andi|probl[eè]me|mochkil)\b/i.test(raw)
    || /\b(?:le\s+)?probl[eè]me\s+c['’]?est\b/i.test(raw)
    || /\b(?:changer|corriger)\s+(?:le\s+)?(?:probl[eè]me|motif|service)\b/i.test(n)
    || /المشكل\s+هو/.test(raw)
    || /\bla\s+machi\s+\w+.+(?:tabyid|blanch|detartrage|jir|facette|urgence|carie|دارssa|ضرس)/i.test(raw)
  )
  if (motifCorrection) {
    // Prefer text after contrast marker
    let motifText = raw
    const afterMachi = raw.match(/\bla\s+machi\b[^,]*,?\s*(.+)$/i)
    if (afterMachi?.[1]) motifText = afterMachi[1]
    const afterEst = raw.match(/(?:probl[eè]me\s+c['’]?est|المشكل\s+هو)\s*(.+)$/i)
    if (afterEst?.[1]) motifText = afterEst[1]
    const afterChanger = raw.match(/(?:changer|corriger)\s+(?:le\s+)?(?:probl[eè]me|motif|service)\s*[:\-–]?\s*(.+)$/i)
    if (afterChanger?.[1]) motifText = afterChanger[1]

    const motif = parseMotifValue(motifText)
    if (motif?.problem) {
      fields.problem = motif.problem
      fields.problem_details = motif.problem_details
      if (motif.urgency) fields.urgency = motif.urgency
      mark('problem')
    } else if (motif?.problem_details) {
      fields.problem_details = motif.problem_details
      mark('problem')
    }
  }

  // --- Date / time ---
  const slotCorrection = (
    /\b(?:changer|corriger|bdel|la\s+finalement|plutot|plutôt)\b.+\b(?:\d{1,2}[\/\-]\d{1,2}|\d{1,2}\s*h|\d{1,2}:\d{2})/i.test(raw)
    || /\b(?:date|heure|jour|موعد)\s*[:\-–]/.test(n)
  )
  if (slotCorrection) {
    const appointment = extractAppointment(raw, options.now || new Date())
    if (appointment?.appointment_date) {
      fields.appointment_date = appointment.appointment_date
      mark('appointment')
    }
    if (appointment?.appointment_time) {
      fields.appointment_time = appointment.appointment_time
      mark('appointment')
    }
  }

  // Multi inline: "nom X ville Y" without changer keyword
  if (!fields.full_name) {
    const multiName = raw.match(/(?:^|\b)(?:nom|smiya)\s+([\p{L}][\p{L}'’\-\s]{2,60}?)(?=\s+(?:ville|city|مدينة|numero|tel|phone|رقم)|$)/iu)
    if (multiName?.[1] && /\b(?:ville|city|مدينة|numero|tel)\b/i.test(raw)) {
      const name = parseNameValue(multiName[1])
      if (name) {
        fields.full_name = name
        mark('full_name')
      }
    }
  }
  if (!fields.city) {
    const multiCity = raw.match(/(?:ville|city|مدينة)\s+([\p{L}][\p{L}'’\-\s]{2,40})$/iu)
    if (multiCity?.[1] && fields.full_name) {
      const city = parseCityValue(multiCity[1])
      if (city) {
        fields.city = city
        mark('city')
      }
    }
  }

  const isCorrection = changedFields.length > 0
  return {
    isCorrection,
    fields,
    cleared,
    changedFields,
  }
}

/**
 * Build a lead patch from a correction result. Never touches unrelated fields.
 */
function buildCorrectionPatch(correction) {
  const patch = {}
  if (!correction?.isCorrection) return patch

  if (correction.fields.full_name) patch.full_name = correction.fields.full_name
  if (correction.fields.phone_number) patch.phone_number = correction.fields.phone_number
  if (correction.fields.city) patch.city = correction.fields.city
  if (correction.fields.problem) {
    patch.problem = correction.fields.problem
    if (correction.fields.problem_details) patch.problem_details = correction.fields.problem_details
    if (correction.fields.urgency) patch.urgency = correction.fields.urgency
  } else if (correction.fields.problem_details && correction.changedFields.includes('problem')) {
    patch.problem_details = correction.fields.problem_details
  }
  if (correction.fields.appointment_date) patch.appointment_date = correction.fields.appointment_date
  if (correction.fields.appointment_time) patch.appointment_time = correction.fields.appointment_time

  if (correction.cleared.full_name) patch.full_name = null
  if (correction.cleared.phone_number) patch.phone_number = null
  if (correction.cleared.city) patch.city = null
  if (correction.cleared.problem) {
    patch.problem = null
    patch.problem_details = null
  }
  if (correction.cleared.appointment) {
    patch.appointment_date = null
    patch.appointment_time = null
  }

  return patch
}

module.exports = {
  detectCorrectionIntent,
  buildCorrectionPatch,
  parseNameValue,
  parsePhoneValue,
  parseCityValue,
}
