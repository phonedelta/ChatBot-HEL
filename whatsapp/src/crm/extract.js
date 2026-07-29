/**
 * Heuristic extraction of CRM fields from FR / Darija (Arabic + Latin) messages.
 * Supports labeled forms, positional 5-line booking replies, and free-form text.
 */

const { toE164, isValidPhone } = require('./phone')
const {
  resolveService,
  looksLikeServiceText,
  containsForbiddenNameTerm,
  isOfficialService,
} = require('./services')

const MOROCCAN_CITIES = [
  'casablanca', 'casa', 'rabat', 'marrakech', 'marrakesh', 'fes', 'fès', 'meknes', 'meknès',
  'tanger', 'tangier', 'agadir', 'oujda', 'kenitra', 'kénitra', 'tetouan', 'tétouan',
  'el jadida', 'safi', 'mohammedia', 'nador', 'beni mellal', 'khouribga', 'settat',
  'sale', 'salé', 'temara', 'témara', 'berrechid', 'larache', 'essaouira', 'ouarzazate',
  'ifran', 'ifrane',
  'el oulfa', 'oulfa', 'ain sebaa', 'ain diab', 'maarif', 'sidi maarouf', 'hay hassani',
  'الدار البيضاء', 'كازا', 'الرباط', 'مراكش', 'فاس', 'طنجة', 'أكادير', 'وجدة', 'القنيطرة', 'تطوان', 'سلا', 'تمارة',
  'إفران', 'افران',
]

const CITY_ALIASES = {
  casa: 'Casablanca',
  casablanca: 'Casablanca',
  'el oulfa': 'Casablanca',
  oulfa: 'Casablanca',
  'الدار البيضاء': 'Casablanca',
  'كازا': 'Casablanca',
  rabat: 'Rabat',
  'الرباط': 'Rabat',
  marrakech: 'Marrakech',
  marrakesh: 'Marrakech',
  'مراكش': 'Marrakech',
  fes: 'Fès',
  'fès': 'Fès',
  'فاس': 'Fès',
  meknes: 'Meknès',
  'meknès': 'Meknès',
  tanger: 'Tanger',
  tangier: 'Tanger',
  'طنجة': 'Tanger',
  agadir: 'Agadir',
  'أكادير': 'Agadir',
  oujda: 'Oujda',
  'وجدة': 'Oujda',
  kenitra: 'Kénitra',
  'kénitra': 'Kénitra',
  'القنيطرة': 'Kénitra',
  tetouan: 'Tétouan',
  'tétouan': 'Tétouan',
  'تطوان': 'Tétouan',
  sale: 'Salé',
  'salé': 'Salé',
  'سلا': 'Salé',
  temara: 'Témara',
  'témara': 'Témara',
  'تمارة': 'Témara',
  ifran: 'Ifrane',
  ifrane: 'Ifrane',
  'إفران': 'Ifrane',
  'افران': 'Ifrane',
}

const WEEKDAYS_FR = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
}

const CONFIRM_YES = [
  /^(oui+|ouais|ok+|okay|yes|yep)$/i,
  /^(نعم+|موافق|أكيد|اكيد|ايوا|أيوا|واخا|تمام|صح)$/i,
  /^(إيوا\s*نعم|ايوا\s*نعم|je confirme|c'est bon|c est bon)$/i,
]

const CONFIRM_NO = [
  /^(non+|no|nn|pas|annule|annuler|annulé|annulee)$/i,
  /^(لا|لاء|ماشي|كانسل|الغ|ألغ|تعديل)$/i,
  /\b(pas possible|autre date|n'est pas bon)\b/i,
]

const BOOKING_INTENT = [
  /\brendez[- ]?vous\b/i,
  /\brdv\b/i,
  /\bmow3id\b/i,
  /\bmo3id\b/i,
  /موعد/,
  /\bbghit(?:i)?\b.*\b(rendez|rdv|mow3id|mo3id|nji|ndir|njib|n9ala3|n9ale3)\b/i,
  /\bbghit(?:i)?\s+rendez/i,
  /\bprendre (un )?rendez/i,
  /\breserver\b/i,
  /\bréserve/i,
  /بغيت\s*(موعد|نجي|نحجز)?/,
  /نحب نحجز/,
  /حجز\s*موعد/,
]

const LABEL_NAME = /^(?:nom(?:\s+complet)?|name|الاسم(?:\s+الكامل)?|سميتي|سمايتي)\s*[:\-]\s*(.+)$/i
const LABEL_PHONE = /^(?:t[ée]l(?:[ée]phone)?|phone|gsm|n(?:um[ée]ro)?|الهاتف|رقم(?:\s+الهاتف)?|تليفون)\s*[:\-]\s*(.+)$/i
const LABEL_CITY = /^(?:ville|city|المدينة|مدينة)\s*[:\-]\s*(.+)$/i
const LABEL_PROBLEM = /^(?:probl[eè]me(?:\s+dentaire)?|problem|motif|service|المشكل|المشكلة|مشكل)\s*[:\-]\s*(.+)$/i
const LABEL_APPOINTMENT = /^(?:rendez[- ]?vous|rdv|date|horaire|الموعد|موعد|التاريخ)\s*[:\-]\s*(.+)$/i

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function titleCaseName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function validateFullName(value) {
  const cleaned = String(value || '')
    .replace(/^(je m'appelle|mon nom (est|c'est)|ismi|smiyti|اسمي)\s*/i, '')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null
  if (containsForbiddenNameTerm(cleaned) || looksLikeServiceText(cleaned)) return null

  const parts = cleaned.split(' ').filter((p) => p.length >= 2)
  if (parts.length < 2) return null
  if (cleaned.length < 5 || cleaned.length > 80) return null
  if (parts.some((p) => looksLikeServiceText(p))) return null

  return titleCaseName(parts.join(' '))
}

function resolveCityValue(value) {
  const key = normalizeText(value).replace(/\s+/g, ' ')
  if (!key) return null
  if (looksLikeServiceText(value) && !CITY_ALIASES[key]) return null
  if (CITY_ALIASES[key]) return CITY_ALIASES[key]
  for (const city of MOROCCAN_CITIES) {
    const cityKey = normalizeText(city)
    if (key === cityKey || key.includes(cityKey)) {
      return CITY_ALIASES[cityKey] || CITY_ALIASES[city] || titleCaseName(city)
    }
  }
  if (/^[\p{L}\s'-]{3,40}$/u.test(String(value || '').trim())) {
    return titleCaseName(value)
  }
  return null
}

function extractPhone(text) {
  const match = String(text || '').match(/(?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8}/)
  if (!match) return null
  const e164 = toE164(match[0])
  return isValidPhone(e164) ? e164 : null
}

function extractProblem(text) {
  const resolved = resolveService(text)
  if (!resolved) return null
  return {
    problem: resolved.service,
    details: resolved.clientLabel,
    urgency: resolved.urgency,
    category: resolved.service,
    display: resolved.displayLabel,
  }
}

function resolveMotifPair(rawText) {
  const exact = String(rawText || '').trim().slice(0, 280)
  if (!exact) {
    return { problem: null, problem_details: null, urgency: null }
  }
  const mapped = extractProblem(exact)
  if (mapped) {
    return {
      problem: mapped.problem,
      problem_details: mapped.details,
      urgency: mapped.urgency,
    }
  }
  return { problem: null, problem_details: exact, urgency: null }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function nextWeekday(from, weekday) {
  const date = new Date(from)
  const delta = (weekday - date.getDay() + 7) % 7 || 7
  date.setDate(date.getDate() + delta)
  return date
}

function extractAppointment(text, now = new Date()) {
  const raw = String(text || '')
  const normalized = normalizeText(raw)
  let date = null
  let time = null

  if (/\baujourd'?hui\b|\blyoum\b|اليوم/.test(normalized)) {
    date = new Date(now)
  } else if (/\bdemain\b|\bghedda\b|غدا|غداً/.test(normalized)) {
    date = new Date(now)
    date.setDate(date.getDate() + 1)
  } else if (/\bapres[- ]?demain\b|\bba3d ghedda\b/.test(normalized)) {
    date = new Date(now)
    date.setDate(date.getDate() + 2)
  } else {
    for (const [name, weekday] of Object.entries(WEEKDAYS_FR)) {
      if (normalized.includes(name)) {
        date = nextWeekday(now, weekday)
        break
      }
    }
  }

  const dmy = raw.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2]) - 1
    let year = dmy[3] ? Number(dmy[3]) : now.getFullYear()
    if (year < 100) year += 2000
    const candidate = new Date(year, month, day)
    if (!Number.isNaN(candidate.getTime())) {
      if (!dmy[3] && candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        candidate.setFullYear(candidate.getFullYear() + 1)
      }
      date = candidate
    }
  }

  const timeMatch = raw.match(/\b(\d{1,2})\s*(?:h|:|مع)\s*(\d{2})?\b/i)
    || raw.match(/\bà\s*(\d{1,2})(?:\s*h)?\b/i)
  if (timeMatch) {
    const hours = Number(timeMatch[1])
    const minutes = Number(timeMatch[2] || 0)
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      time = `${pad2(hours)}:${pad2(minutes)}`
    }
  }

  if (!date && !time) return null
  return {
    appointment_date: date ? formatDateISO(date) : null,
    appointment_time: time,
  }
}

function extractLabeledValue(line, pattern) {
  const match = String(line || '').trim().match(pattern)
  return match?.[1] ? String(match[1]).trim() : null
}

function looksLikeDateLine(line) {
  return /\d{1,2}[\/\-.]\d{1,2}|\b\d{1,2}\s*(?:h|:)\s*\d{0,2}\b|\bghedda\b|\bdemain\b|غدا/i.test(line)
}

function looksLikeCityLine(line) {
  const raw = String(line || '').trim()
  if (!/^[\p{L}\s'-]{2,40}$/u.test(raw)) return false
  if (extractPhone(raw) || looksLikeDateLine(raw)) return false
  if (validateFullName(raw)) return false
  if (extractProblem(raw) || looksLikeServiceText(raw)) return false
  const words = raw.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 3
}

function emptyResult() {
  return {
    full_name: null,
    phone_number: null,
    city: null,
    problem: null,
    problem_details: null,
    urgency: null,
    appointment_date: null,
    appointment_time: null,
  }
}

function applyMotif(result, motif) {
  if (!motif?.problem) return
  result.problem = motif.problem
  result.problem_details = motif.problem_details
  result.urgency = motif.urgency
}

function extractPositionalBooking(lines, now) {
  if (lines.length < 4 || lines.length > 7) return null

  const phoneIdx = lines.findIndex((line) => extractPhone(line))
  const dateIdx = lines.findIndex((line) => looksLikeDateLine(line))
  if (phoneIdx < 0 || dateIdx < 0) return null

  if (lines.length === 5 && phoneIdx === 1 && dateIdx === 4) {
    const name = validateFullName(lines[0])
    const phone = extractPhone(lines[1])
    const city = resolveCityValue(lines[2])
    const motif = resolveMotifPair(lines[3])
    const appointment = extractAppointment(lines[4], now)
    if (!name || !phone) return null

    const result = emptyResult()
    result.full_name = name
    result.phone_number = phone
    result.city = city
    applyMotif(result, motif)
    if (appointment?.appointment_date) result.appointment_date = appointment.appointment_date
    if (appointment?.appointment_time) result.appointment_time = appointment.appointment_time
    return result
  }

  const result = emptyResult()
  let nameIdx = -1
  for (let i = 0; i < phoneIdx; i += 1) {
    const name = validateFullName(lines[i])
    if (name) {
      result.full_name = name
      nameIdx = i
      break
    }
  }
  result.phone_number = extractPhone(lines[phoneIdx])

  for (let i = 0; i < lines.length; i += 1) {
    if (i === phoneIdx || i === dateIdx || i === nameIdx) continue
    if (!result.city) {
      const city = resolveCityValue(lines[i])
      if (city && !looksLikeServiceText(lines[i]) && !validateFullName(lines[i])) {
        result.city = city
        continue
      }
    }
    if (!result.problem) {
      const motif = resolveMotifPair(lines[i])
      if (motif.problem) applyMotif(result, motif)
    }
  }

  const appointment = extractAppointment(lines[dateIdx], now)
  if (appointment?.appointment_date) result.appointment_date = appointment.appointment_date
  if (appointment?.appointment_time) result.appointment_time = appointment.appointment_time

  if (!result.full_name || !result.phone_number) return null
  return result
}

function extractBulkBookingFields(text, options = {}) {
  const raw = String(text || '').trim()
  const result = emptyResult()
  if (!raw) return result

  const now = options.now || new Date()
  const lines = raw
    .split(/\r?\n|•|\u2022|;/)
    .map((line) => line.trim())
    .filter(Boolean)

  const leftovers = []

  for (const line of lines) {
    const labeledName = extractLabeledValue(line, LABEL_NAME)
    if (labeledName) {
      result.full_name = validateFullName(labeledName) || result.full_name
      continue
    }
    const labeledPhone = extractLabeledValue(line, LABEL_PHONE)
    if (labeledPhone) {
      result.phone_number = extractPhone(labeledPhone) || result.phone_number
      continue
    }
    const labeledCity = extractLabeledValue(line, LABEL_CITY)
    if (labeledCity) {
      result.city = resolveCityValue(labeledCity) || result.city
      continue
    }
    const labeledProblem = extractLabeledValue(line, LABEL_PROBLEM)
    if (labeledProblem) {
      applyMotif(result, resolveMotifPair(labeledProblem))
      continue
    }
    const labeledAppointment = extractLabeledValue(line, LABEL_APPOINTMENT)
    if (labeledAppointment) {
      const appointment = extractAppointment(labeledAppointment, now)
      if (appointment?.appointment_date) result.appointment_date = appointment.appointment_date
      if (appointment?.appointment_time) result.appointment_time = appointment.appointment_time
      continue
    }
    leftovers.push(line)
  }

  if (leftovers.length >= 4 && !result.full_name) {
    const positional = extractPositionalBooking(leftovers, now)
    if (positional) {
      return {
        full_name: positional.full_name || result.full_name,
        phone_number: positional.phone_number || result.phone_number,
        city: positional.city || result.city,
        problem: positional.problem || result.problem,
        problem_details: positional.problem_details || result.problem_details,
        urgency: positional.urgency || result.urgency,
        appointment_date: positional.appointment_date || result.appointment_date,
        appointment_time: positional.appointment_time || result.appointment_time,
      }
    }
  }

  result.phone_number = result.phone_number || extractPhone(raw)
  const wholeAppointment = extractAppointment(raw, now)
  if (!result.appointment_date && wholeAppointment?.appointment_date) {
    result.appointment_date = wholeAppointment.appointment_date
  }
  if (!result.appointment_time && wholeAppointment?.appointment_time) {
    result.appointment_time = wholeAppointment.appointment_time
  }

  for (const line of leftovers) {
    if (!result.phone_number) {
      const phone = extractPhone(line)
      if (phone) {
        result.phone_number = phone
        continue
      }
    }

    if (!result.problem) {
      const mapped = extractProblem(line)
      if (mapped) {
        result.problem = mapped.problem
        result.problem_details = mapped.details
        result.urgency = mapped.urgency
        continue
      }
    }

    if (!result.city) {
      const lineKey = normalizeText(line)
      const knownCity = MOROCCAN_CITIES.some((city) => {
        const cityKey = normalizeText(city)
        return lineKey === cityKey || lineKey.includes(cityKey)
      })
      if ((knownCity || looksLikeCityLine(line)) && !looksLikeServiceText(line)) {
        const city = resolveCityValue(line)
        if (city) {
          result.city = city
          continue
        }
      }
    }

    if ((!result.appointment_date || !result.appointment_time) && looksLikeDateLine(line)) {
      const appointment = extractAppointment(line, now)
      if (appointment?.appointment_date) result.appointment_date = result.appointment_date || appointment.appointment_date
      if (appointment?.appointment_time) result.appointment_time = result.appointment_time || appointment.appointment_time
      continue
    }

    if (!result.full_name) {
      const name = validateFullName(line)
      if (name && !looksLikeDateLine(line) && !extractPhone(line) && !looksLikeServiceText(line)) {
        result.full_name = name
        continue
      }
    }
  }

  if (!result.city) {
    for (const city of MOROCCAN_CITIES) {
      const cityKey = normalizeText(city)
      if (cityKey && normalizeText(raw).includes(cityKey)) {
        result.city = CITY_ALIASES[cityKey] || CITY_ALIASES[city] || titleCaseName(city)
        break
      }
    }
  }

  if (!result.problem) {
    const mapped = extractProblem(raw)
    if (mapped) {
      result.problem = mapped.problem
      result.problem_details = mapped.details
      result.urgency = mapped.urgency
    }
  }

  if (result.full_name && (looksLikeServiceText(result.full_name) || !validateFullName(result.full_name))) {
    result.full_name = null
  }

  return result
}

function extractFullName(text) {
  const bulk = extractBulkBookingFields(text)
  if (bulk.full_name) return bulk.full_name
  const raw = String(text || '').trim()
  if (/^[\p{L}][\p{L}'\-]+(?:\s+[\p{L}][\p{L}'\-]+){1,3}$/u.test(raw)) {
    return validateFullName(raw)
  }
  return null
}

function extractCity(text) {
  return extractBulkBookingFields(text).city || resolveCityValue(text)
}

function isBookingIntent(text, voiceIntent = null) {
  if (['prise_rendez_vous', 'appointment', 'rdv'].includes(String(voiceIntent || '').toLowerCase())) {
    return true
  }
  return BOOKING_INTENT.some((pattern) => pattern.test(String(text || '')))
}

function isConfirmationYes(text) {
  return CONFIRM_YES.some((pattern) => pattern.test(String(text || '').trim()))
}

function isConfirmationNo(text) {
  return CONFIRM_NO.some((pattern) => pattern.test(String(text || '').trim()))
}

function extractCustomerSignals(text, options = {}) {
  const bulk = extractBulkBookingFields(text, options)
  return {
    full_name: bulk.full_name,
    phone_number: bulk.phone_number,
    city: bulk.city,
    problem: bulk.problem,
    problem_details: bulk.problem_details,
    urgency: bulk.urgency,
    appointment_date: bulk.appointment_date,
    appointment_time: bulk.appointment_time,
    booking_intent: isBookingIntent(text, options.voiceIntent),
    confirmation_yes: isConfirmationYes(text),
    confirmation_no: isConfirmationNo(text),
  }
}

module.exports = {
  validateFullName,
  extractFullName,
  extractCity,
  extractPhone,
  extractProblem,
  resolveMotifPair,
  extractAppointment,
  extractBulkBookingFields,
  extractCustomerSignals,
  isBookingIntent,
  isConfirmationYes,
  isConfirmationNo,
  isOfficialService,
  MOROCCAN_CITIES,
}
