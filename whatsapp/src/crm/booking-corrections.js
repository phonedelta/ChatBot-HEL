/**
 * Explicit booking-field corrections during progressive WhatsApp booking.
 * A recognized correction patches ONLY the targeted fields — never a free-form re-extract.
 */

const { validateFullName } = require('./name-validator')
const { stripPersonNameLabels } = require('./name-validator')
const { toE164, isValidPhone } = require('./phone')
const { resolveMoroccanCity } = require('./morocco-cities')
const { resolveService } = require('./services')
const { extractAppointment, resolveMotifPair, extractCustomerSignals } = require('./extract')

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function countFilledBookingFields(signals) {
  let n = 0
  if (signals?.full_name) n += 1
  if (signals?.phone_number) n += 1
  if (signals?.city) n += 1
  if (signals?.problem) n += 1
  if (signals?.appointment_date || signals?.appointment_time) n += 1
  return n
}

/**
 * Multi-field booking payload (one message with several CRM fields).
 * Must NOT be treated as a targeted correction — that would drop unlisted fields.
 */
function looksLikeBulkBookingPayload(text, options = {}) {
  const raw = String(text || '').trim()
  if (!raw) return false
  // Explicit correction verbs → keep correction path
  if (/\b(?:changer|corriger|modifier|bdel|nbdl|nbadel|finalement|plutot|plutôt)\b/i.test(raw)) {
    return false
  }
  if (/\b(?:machi|ماشي)\b/i.test(raw) && /\b(?:bghit|probl|motif|ville|nom|tel|num)/i.test(raw)) {
    return false
  }
  try {
    const signals = extractCustomerSignals(raw, {
      now: options.now || new Date(),
      conservative: false,
    })
    return countFilledBookingFields(signals) >= 3
  } catch {
    return false
  }
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

  // Multi-line labeled booking form → never treat as a field correction
  const formLines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean)
  if (formLines.length >= 3) {
    let labels = 0
    for (const line of formLines) {
      if (/^(?:nom|name|t[ée]l|telephone|phone|ville|city|probl[eè]me|motif|rendez|date|heure|موعد|مدينة|هاتف|اسم|المشكل)/i.test(line)) {
        labels += 1
      }
    }
    if (labels >= 2) return empty
  }

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
  // Captures stop at end-of-line so a bulk booking form is NOT treated as a correction.
  const namePatterns = [
    /(?:changer|corriger|modifier|bdel|bdl|nbdl)\s+(?:le\s+)?(?:nom(?:\s+complet)?|smiya|smiyto|smito|smiti|smyti|smiyti|اسم(?:\s+الكامل)?)\s*(?:l|li|en|à|a|ل)?\s*[:\-–]?\s*([^\n\r]+)/iu,
    /(?:changer|corriger)\s+smiya\s*[:\-–]?\s*([^\n\r]+)/iu,
    /(?:bdel|bdl|nbdl)\s+smiya\s+(?:l|li|ل)?\s*([^\n\r]+)/iu,
    /(?:la\s+)?smiya\s+(?:hiya|howa|kamla|correcte?|s7i7a)?\s*[:\-–]?\s*([^\n\r]+)/iu,
    /(?:^|\n)\s*(?:smiya|smiyto|smito|smitha|smita|smiti|smyti|smiyti|lism)\s+(?:dialo|dyalo|dialha|dyalha|dyali|howa|hiya)?\s*[:\-–]?\s*([^\n\r]+)/iu,
    /(?:^|\n)\s*(?:je\s+m['’]appelle|ana\s+(?:smiti|smyti|smiya)?|ismi)\s+([^\n\r]+)/iu,
    /(?:^|\n)\s*(?:mon\s+)?nom(?:\s+complet)?\s+(?:est|c['’]est)\s+([^\n\r]+)/iu,
    /(?:^|\n)\s*(?:mon\s+)?nom(?:\s+complet)?\s*[:\-–]\s*([^\n\r]+)/iu,
    /(?:non[, ]+)?(?:le\s+)?(?:bon\s+)?nom\s+(?:correct(?:e)?|s7i7)?\s+(?:est|c['’]est)\s+([^\n\r]+)/iu,
    /corrige(?:r)?\s+le\s+nom\s+en\s+([^\n\r]+)/iu,
    /(?:c['’]est|cest)\s+([\p{L}][\p{L}'’\-\s]{2,60})$/iu,
    /الاسم(?:\s+الكامل)?(?:\s+الصحيح)?\s*(?:هو|:|ديالي)?\s*([^\n\r]+)/u,
    /(?:سميتي|سميتيا|الاسم\s+ديالي)\s+([^\n\r]+)/u,
    /بدل\s+الاسم\s*(?:ل|الى|إلى)?\s*([^\n\r]+)/u,
  ]

  for (const pattern of namePatterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    // Ignore labeled form lines that are part of a multi-field booking payload
    if (/\n/.test(raw) && /(?:t[ée]l|ville|probl[eè]me|rendez|موعد|مدينة)/i.test(raw)) {
      const onlyNameLine = /^(?:smyti|smiti|smiya|je\s+m['’]appelle|mon\s+nom|اسمي|سميتي)/i.test(raw.trim())
      if (!onlyNameLine && /^(?:nom|name)\s*[:\-–]/im.test(match[0])) {
        continue
      }
    }
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
    /(?:changer|corriger|modifier|bdel|bdl|nbdl)\s+(?:le\s+)?(?:num[eé]ro|n[°o]|telephone|tel[eé]phone|tel|tele|phone|رقم(?:\s+الهاتف)?)\s*(?:l|li|en|à|a|ل)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:le\s+)?bon\s+(?:num[eé]ro|telephone|tel)\s+(?:est|c['’]est)\s*(.+)$/iu,
    /(?:mon\s+)?(?:num[eé]ro|telephone|tel[eé]phone|tel|tele|phone)\s+(?:dyali|diali|howa|correcte?|est|c['’]est|plutot|plutôt)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:r9m|nmr|num)\s+(?:dyali|telephone|tel)?\s*[:\-–]?\s*(.+)$/iu,
    /رقم(?:\s+الهاتف)?(?:\s+الصحيح)?\s*(?:هو|:|ديالي)?\s*(.+)$/u,
    /(?:telephone|tel[eé]phone|tel|tele|phone|num[eé]ro)\s*[:\-–]\s*(.+)$/iu,
  ]
  let phoneMarkerSeen = false
  for (const pattern of phonePatterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    phoneMarkerSeen = true
    const phone = parsePhoneValue(match[1])
    if (phone) {
      fields.phone_number = phone
      mark('phone_number')
      break
    }
  }
  // Contrast: "0612… machi 0600…" / "machi 0600…, 0612…"
  if (!fields.phone_number) {
    const phoneContrast = raw.match(
      /((?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8}).{0,20}(?:machi|pas|ماشي).{0,20}((?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8})/i,
    ) || raw.match(
      /(?:machi|pas|ماشي).{0,20}((?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8}).{0,20}[,:]?\s*((?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8})/i,
    )
    if (phoneContrast) {
      const a = parsePhoneValue(phoneContrast[1])
      const b = parsePhoneValue(phoneContrast[2])
      const draftPhone = options.draft?.phone_number ? parsePhoneValue(options.draft.phone_number) : null
      const next = (draftPhone && a === draftPhone && b) ? b
        : (draftPhone && b === draftPhone && a) ? a
          : (b || a)
      if (next) {
        fields.phone_number = next
        mark('phone_number')
      }
    }
  }
  // Marker present but invalid value → ask again, never wipe a valid draft phone
  const invalidPhoneAttempt = Boolean(phoneMarkerSeen && !fields.phone_number)

  // --- City ---
  const cityPatterns = [
    /(?:changer|corriger|modifier|bdel|bdl|nbdl)\s+(?:la\s+)?(?:ville|city|mdina|lmdina|mdinti|مدينة|المدينة)\s*(?:l|li|en|à|a|ل)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:la\s+)?(?:ville|city)\s+(?:c['’]est|est|hiya|howa|correcte?|s7i7a|bonne)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:ma\s+)?(?:ville|city)\s+(?:est|c['’]est)\s+(.+)$/iu,
    /(?:^|\n)\s*(?:ville|city)\s*[:\-–]?\s*(.+)$/iu,
    /(?:^|\n)\s*(?:mdina|lmdina|mdinti|medina)\s+(?:hiya|howa|dyali|diali|s7i7a)?\s*[:\-–]?\s*(.+)$/iu,
    /(?:ana\s+(?:f|fi|men|mn|min)\s+)([\p{L}][\p{L}\s'-]{1,40})$/iu,
    /(?:ana\s+)?(?:sakn|sakna|saken|sakena)\s+(?:f|fi)\s+([\p{L}][\p{L}\s'-]{1,40})$/iu,
    /(?:je\s+(?:suis|habite|viens)\s+(?:à|a|de)\s+)([\p{L}][\p{L}\s'-]{1,40})$/iu,
    /(?:j['’]?habite\s+(?:à|a)\s+)([\p{L}][\p{L}\s'-]{1,40})$/iu,
    /المدينة(?:\s+الصحيحة|\s+غلط)?\s*(?:هي|:)?\s*(.+)$/u,
    /(?:أنا\s*(?:في|ف|من)\s*)([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})$/u,
    /(?:ساكن|ساكنة)\s*(?:ف|في)\s*([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})$/u,
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

  // Contrast city: "Rabat machi Safi" / "machi Safi, Rabat" / "c'est Rabat pas Safi"
  if (!fields.city) {
    const contrastCity = extractContrastCity(raw, options.draft)
    if (contrastCity) {
      fields.city = contrastCity
      mark('city')
    }
  }

  // --- Motif / complaint (explicit contrast or labeled) ---
  const motifCorrection = (
    /\b(?:la\s+)?machi\b.+\b(?:bghit|3andi|probl[eè]me|mochkil|motif)\b/i.test(raw)
    || /\b(?:le\s+)?(?:probl[eè]me|motif|mouchkil|lmochkil|sbab)\s+(?:c['’]?est|huwa|howa|s7i7)\b/i.test(raw)
    || /\b(?:changer|corriger|modifier|bdel|nbdl)\s+(?:le\s+)?(?:probl[eè]me|motif|service|lmochkil|mouchkil)\b/i.test(n)
    || /المشكل\s*(?:الحقيقي)?\s*هو/.test(raw)
    || /(?:السبب|المشكل)\s*(?:هو|:)/.test(raw)
    || /\b(?:3ndi|3andi)\s+(?:wja3|sen|snan|dent)\b/i.test(n)
    || /\bla\s+machi\s+\w+.+(?:tabyid|blanch|detartrage|jir|facette|urgence|carie|دارssa|ضرس|douleur|wja3)/i.test(raw)
  )
  if (motifCorrection) {
    let motifText = raw
    const afterMachi = raw.match(/\b(?:la\s+)?machi\b[^,]*,?\s*(.+)$/i)
    if (afterMachi?.[1]) motifText = afterMachi[1]
    const afterEst = raw.match(/(?:probl[eè]me\s+c['’]?est|motif\s+c['’]?est|lmochkil\s+(?:huwa|howa)|المشكل\s*(?:الحقيقي)?\s*هو|السبب\s*هو)\s*(.+)$/i)
    if (afterEst?.[1]) motifText = afterEst[1]
    const afterChanger = raw.match(/(?:changer|corriger|modifier|bdel|nbdl)\s+(?:le\s+)?(?:probl[eè]me|motif|service|lmochkil|mouchkil)\s*(?:l|li|en|à|a|ل)?\s*[:\-–]?\s*(.+)$/i)
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
    /\b(?:changer|corriger|bdel|nbdl|finalement|plutot|plutôt|bghit\s+nbdl)\b/i.test(raw)
    || /\b(?:date|heure|jour|nhar|sa3a|saa|wa9t|lwa9t|lwe9t|موعد|ساعة|وقت|نهار|تاريخ)\b/i.test(n)
    || /\b(?:ghda|gheda|ghdda|ghedda|lyoum|lyom|demain|aujourdhui|aujourd)\b/i.test(n)
    || /^(?:m3a|مع|à)\s*\d{1,2}/i.test(raw.trim())
    || /^\d{1,2}\s*h(?:\s*\d{2})?$/i.test(raw.trim())
    || /^\d{1,2}:\d{2}$/.test(raw.trim())
    || /\bmachi\b.+\b(?:ghda|lyoum|demain|\d{1,2}\s*h)/i.test(n)
    || /\b(?:\d{1,2}\s*h|\d{1,2}:\d{2})\s+machi\b/i.test(n)
  )
  if (slotCorrection) {
    const slotText = stripRejectedContrastTail(raw)
    const appointment = extractAppointment(slotText, options.now || new Date())
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
    const multiName = raw.match(/(?:^|\b)(?:nom|smiya)\s+([\p{L}][\p{L}'’\-\s]{2,60}?)(?=\s+(?:ville|city|mdina|مدينة|numero|tel|phone|رقم)|$)/iu)
    if (multiName?.[1] && /\b(?:ville|city|mdina|مدينة|numero|tel)\b/i.test(raw)) {
      const name = parseNameValue(multiName[1])
      if (name) {
        fields.full_name = name
        mark('full_name')
      }
    }
  }
  if (!fields.city) {
    const multiCity = raw.match(/(?:ville|city|mdina|lmdina|مدينة)\s+([\p{L}][\p{L}'’\-\s]{2,40})$/iu)
    if (multiCity?.[1] && (fields.full_name || /\b(?:nom|smiya|smiti)\b/i.test(raw))) {
      const city = parseCityValue(multiCity[1])
      if (city) {
        fields.city = city
        mark('city')
      }
    }
  }

  const isCorrection = changedFields.length > 0
  // Bulk booking forms (name+phone+date+…) must go through extract/merge, not correction patch.
  if (isCorrection && looksLikeBulkBookingPayload(raw, options)) {
    return {
      isCorrection: false,
      fields: {},
      cleared: {},
      changedFields: [],
    }
  }
  const result = {
    isCorrection,
    fields,
    cleared,
    changedFields,
  }
  if (invalidPhoneAttempt) {
    result.invalidPhone = true
    result.isCorrection = true
    if (!changedFields.includes('phone_number')) changedFields.push('phone_number')
    result.changedFields = changedFields
  }
  return result
}

/**
 * Drop rejected contrast tails so "ghda machi lyoum" → "ghda", "14h machi 11h" → "14h".
 */
function stripRejectedContrastTail(text) {
  let raw = String(text || '').trim()
  if (!raw) return raw
  raw = raw
    .replace(/\bmachi\s+[\p{L}\d:hH]+(?:\s*h(?:\s*\d{2})?)?/giu, ' ')
    .replace(/\bpas\s+[\p{L}\d:hH]+(?:\s*h(?:\s*\d{2})?)?/giu, ' ')
    .replace(/\bماشي\s+[\u0600-\u06FF\d:hH]+/gu, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return raw || String(text || '').trim()
}

/**
 * Contrast city extraction using optional draft.city as the rejected value.
 * @param {string} text
 * @param {{ city?: string|null }|null} [draft]
 * @returns {string|null}
 */
function extractContrastCity(text, draft = null) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const patterns = [
    /^([\p{L}][\p{L}'’\-\s]{1,40})\s+machi\s+([\p{L}][\p{L}'’\-\s]{1,40})$/iu,
    /^machi\s+([\p{L}][\p{L}'’\-\s]{1,40})\s*[,:]?\s*([\p{L}][\p{L}'’\-\s]{1,40})$/iu,
    /(?:c['’]est|cest)\s+([\p{L}][\p{L}'’\-\s]{1,40})\s+pas\s+([\p{L}][\p{L}'’\-\s]{1,40})$/iu,
    /(?:pas|non)\s+([\p{L}][\p{L}'’\-\s]{1,40})\s*[,:]?\s*(?:c['’]est\s+)?([\p{L}][\p{L}'’\-\s]{1,40})$/iu,
    /^([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})\s+ماشي\s+([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})$/u,
    /^ماشي\s+([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})\s*[,،]?\s*([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})$/u,
  ]

  const draftCity = draft?.city ? parseCityValue(draft.city) : null

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match?.[1] || !match?.[2]) continue
    const a = parseCityValue(match[1])
    const b = parseCityValue(match[2])
    if (!a && !b) continue
    if (draftCity) {
      if (a === draftCity && b && b !== draftCity) return b
      if (b === draftCity && a && a !== draftCity) return a
    }
    // "X machi Y" → keep X (new). "machi Y, X" → keep X (second group as new when first is rejected)
    if (/^machi\b|^pas\b|^non\b|^ماشي/i.test(raw.trim())) {
      if (b) return b
      if (a) return a
    }
    if (a && b && a !== b) return a
    if (a) return a
    if (b) return b
  }
  return null
}

/**
 * Patient wants to correct something but did not specify which field / value.
 */
function detectGeneralCorrectionRequest(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const n = normalizeText(raw)
  if (detectCorrectionIntent(raw).isCorrection) return false
  if (parseNameValue(raw) || parsePhoneValue(raw) || parseCityValue(raw)) return false

  return (
    /\b(?:bghit|brit)\s+(?:ns7e7|nsa7a7|nbdl|nbadel|nsahah)\b/i.test(n)
    || /\b(?:je\s+veux|je\s+souhaite)\s+(?:corriger|modifier|changer)\b/i.test(n)
    || /\b(?:il\s+y\s+a|y\s+a)\s+(?:une?\s+)?(?:info|information|erreur|donn[eé]e)\b.*\b(?:fausse|incorrecte|erreur|trompe)/i.test(n)
    || /\b(?:information|donn[eé]e|ma3louma|lma3louma).{0,20}(?:ghalta|fausse|incorrecte|faux)\b/i.test(n)
    || /\b(?:kayna|kayn)\s+(?:wahed\s+)?(?:l)?ma3louma\s+ghalta\b/i.test(n)
    || /\b(?:had\s+)?(?:l)?ma3louma\s+ghalta\b/i.test(n)
    || /\bmachi\s+haka\b/i.test(n)
    || /\bje\s+me\s+suis\s+tromp/i.test(n)
    || /\bce\s+n['’]est\s+pas\s+correct\b/i.test(n)
    || /كاين(ة)?\s*(شي\s*)?(معلومة|خطأ)/u.test(raw)
    || /بغيت\s*(نصحح|نبدل)\s*(معلومة|المعلومات)?/u.test(raw)
    || /هاد\s*المعلومة\s*غالطة/u.test(raw)
    || /المعلومات\s*فيها\s*خطأ/u.test(raw)
  )
}

/**
 * Build a lead patch from a correction result. Never touches unrelated fields.
 * Never clears a valid phone when the new value is invalid.
 */
function buildCorrectionPatch(correction) {
  const patch = {}
  if (!correction?.isCorrection) return patch
  if (correction.invalidPhone && !correction.fields?.phone_number) {
    // Keep existing phone; caller must re-ask for a valid number.
    return patch
  }

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

/**
 * Detect a name-correction attempt even when the name is incomplete (1 token).
 * Used at summary confirmation so we ask for full name instead of cancel.
 *
 * @returns {{
 *   type: 'none'|'complete'|'incomplete',
 *   fullName?: string|null,
 *   candidate?: string|null,
 * }}
 */
function detectInlineNameCorrection(text) {
  const raw = String(text || '').trim()
  if (!raw) return { type: 'none' }

  const intro = raw.match(
    /^(?:smyti|smiti|smiya|smiyto|smito|smiyti|ismi|ana(?:\s+(?:smiti|smyti|smiya))?|je\s+m['’]appelle|mon\s+nom(?:\s+complet)?(?:\s+(?:est|c['’]est))?|moi\s+c['’]est|اسمي|سميتي|الاسم\s+ديالي)\s*[:\-–]?\s*(.+)$/iu,
  )
  if (!intro?.[1]) {
    // "Mon nom c'est X" already covered; bare "nom: X" handled by detectCorrectionIntent
    return { type: 'none' }
  }

  const candidate = stripPersonNameLabels(clipTrailingJunk(intro[1]))
    .replace(/^(?:est|c['’]est|howa|hiya)\s+/i, '')
    .trim()
  if (!candidate) return { type: 'none' }

  const full = parseNameValue(candidate) || validateFullName(candidate)
  if (full) return { type: 'complete', fullName: full, candidate }

  const parts = candidate.split(/\s+/).filter(Boolean)
  if (parts.length === 1 && parts[0].length >= 2) {
    return { type: 'incomplete', fullName: null, candidate: parts[0] }
  }
  return { type: 'incomplete', fullName: null, candidate }
}

module.exports = {
  detectCorrectionIntent,
  buildCorrectionPatch,
  detectInlineNameCorrection,
  detectGeneralCorrectionRequest,
  looksLikeBulkBookingPayload,
  extractContrastCity,
  parseNameValue,
  parsePhoneValue,
  parseCityValue,
}
