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
  looksLikeAdminOrCatalogQuestion,
} = require('./services')
const {
  validateFullName,
  assessFullNameCandidate,
} = require('./name-validator')
const {
  isConfirmationYes: binaryYes,
  isConfirmationNo: binaryNo,
} = require('./binary-confirmation')
const {
  MOROCCAN_CITY_TOKENS,
  resolveMoroccanCity,
  isKnownMoroccanCity,
  listMoroccanCityMentions,
} = require('./morocco-cities')

/** @deprecated Prefer resolveMoroccanCity — kept for tests/exports. */
const MOROCCAN_CITIES = MOROCCAN_CITY_TOKENS

/** Weekday aliases → JS getDay() (0=Sunday). French + Darija Latin + Arabic. */
const WEEKDAY_ALIASES = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  // Darija Latin
  l7d: 0, lhad: 0, l7ed: 0, nhar_l7d: 0,
  tnin: 1, tnine: 1, ltnin: 1, tnen: 1, nhar_tnin: 1,
  tlat: 2, tlata: 2, tleta: 2, tlt: 2, nhar_tlat: 2,
  larb3: 3, larba: 3, arba: 3, arb3: 3, larb3a: 3, nhar_larb3: 3,
  kmis: 4, khamis: 4, lkmess: 4, nhar_kmis: 4,
  jom3a: 5, jem3a: 5, juma: 5, jumua: 5, nhar_jom3a: 5,
  sebt: 6, sbat: 6, nhar_sebt: 6,
  // Arabic script
  الاحد: 0, الأحد: 0,
  الاثنين: 1, الإثنين: 1,
  الثلاثاء: 2,
  الاربعاء: 3, الأربعاء: 3,
  الخميس: 4,
  الجمعة: 5,
  السبت: 6,
}

const BOOKING_INTENT = [
  /\brendez[- ]?vous\b/i,
  /\brdv\b/i,
  /\bmow3id\b/i,
  /\bmo3id\b/i,
  /موعد/,
  /\bbghit(?:i)?\b.*\b(rendez|rdv|mow3id|mo3id|nji|ndir|njib|n9ala3|n9ale3|nreserve|reserv)\b/i,
  /\bbghit(?:i)?\s+rendez/i,
  /\bprendre (un )?rendez/i,
  /\b(n)?reserv(e|er|i|ation)?\b/i,
  /\bréserve/i,
  /\bnhjez\b|\bn7jez\b|\bn7ajez\b/i,
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

function isKnownCityToken(value) {
  return isKnownMoroccanCity(value)
}

/** True when the patient sent only a first name (needs prénom + nom). */
function looksLikePartialFirstName(value) {
  const cleaned = String(value || '')
    .replace(/^(je m'appelle|mon nom (est|c'est)|ismi|smiti|smiyti|اسمي|سميتي)\s*/i, '')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || isKnownCityToken(cleaned) || looksLikeServiceText(cleaned)) return false
  const parts = cleaned.split(' ').filter((p) => p.length >= 2)
  return parts.length === 1 && parts[0].length >= 3 && parts[0].length <= 40
}

/**
 * @param {string} normalized lowercase normalized text
 * @returns {number|null} weekday 0-6
 */
function matchWeekday(normalized) {
  const text = String(normalized || '')
  if (!text) return null
  const entries = Object.entries(WEEKDAY_ALIASES)
    .map(([name, day]) => [normalizeText(name).replace(/_/g, ' '), day])
    .sort((a, b) => b[0].length - a[0].length)

  for (const [name, day] of entries) {
    if (!name) continue
    if (/[\u0600-\u06FF]/.test(name)) {
      if (text.includes(name)) return day
      continue
    }
    const re = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i')
    if (re.test(` ${text} `)) return day
  }
  return null
}

function resolveCityValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (looksLikeServiceText(raw) && !isKnownMoroccanCity(raw)) return null
  // Morocco whitelist only — never invent a free-text city.
  return resolveMoroccanCity(raw)
}

function extractPhone(text) {
  const raw = String(text || '')
  // Never invent a booking phone from a WhatsApp @lid identifier.
  if (/@lid\b/i.test(raw) && !/(?:\+212|00212|0)[\s.-]*[5-7]/.test(raw)) {
    return null
  }
  const match = raw.match(/(?:\+?212|0)?[\s.-]*[5-7](?:[\s.-]*\d){8}/)
  if (!match) return null
  const e164 = toE164(match[0])
  return isValidPhone(e164) ? e164 : null
}

function extractProblem(text) {
  const exact = String(text || '').trim()
  if (!exact) return null
  if (looksLikeAdminOrCatalogQuestion(exact)) return null

  const resolved = resolveService(exact)
  if (resolved) {
    return {
      problem: resolved.service,
      details: resolved.clientLabel,
      urgency: resolved.urgency,
      category: resolved.service,
      display: resolved.displayLabel,
    }
  }

  try {
    const { classifyDentalProblem } = require('../voice-nlu/dental-problem-classifier')
    const classified = classifyDentalProblem(exact)
    if (
      classified.service
      && isOfficialService(classified.service)
      && Number(classified.confidence || 0) >= 0.55
      && classified.dentalProblem
      && classified.dentalProblem !== 'UNKNOWN_DENTAL_PROBLEM'
    ) {
      return {
        problem: classified.service,
        details: exact.slice(0, 280),
        urgency: classified.service === 'Urgences dentaires' ? 'haute' : 'moyenne',
        category: classified.service,
        display: classified.service,
      }
    }
  } catch {
    // Classifier is a fallback only; CRM extraction must still work without it.
  }
  return null
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

function extractAppointment(text, nowOrOpts = new Date()) {
  const raw = String(text || '')
  const normalized = normalizeText(raw)
  const now = nowOrOpts instanceof Date
    ? nowOrOpts
    : (nowOrOpts && nowOrOpts.now instanceof Date ? nowOrOpts.now : new Date())
  let date = null
  let time = null

  if (/\baujourd'?hui\b|\blyoum\b|\blyom\b|اليوم/.test(normalized)) {
    date = new Date(now)
  } else if (
    /\bdemain\b|\bghda\b|\bghedda\b|\bghdda\b|\bgheda\b|\bghada\b|\bgadda\b|غدا|غداً/.test(normalized)
  ) {
    date = new Date(now)
    date.setDate(date.getDate() + 1)
  } else if (
    /\bapres[- ]?demain\b|\bba3d ghedda\b|\bba3d ghdda\b|\bba3d ghda\b|\bmn b3d ghdda\b|\bmn b3d ghda\b|بعد\s*غدا/.test(normalized)
  ) {
    date = new Date(now)
    date.setDate(date.getDate() + 2)
  } else {
    const weekday = matchWeekday(normalized)
    if (weekday !== null) {
      date = nextWeekday(now, weekday)
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

  // Shared time normalizer (12h30, 14h, m3a 14h, غدا مع 14, …)
  try {
    const { extractEmbeddedTime } = require('./appointment-slots')
    const embedded = extractEmbeddedTime(raw)
    if (embedded) time = embedded
  } catch {
    const timeMatch = raw.match(/\b(?:m3a|مع|à)\s*(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\b/i)
      || raw.match(/\b(\d{1,2})\s*[h:]\s*(\d{2})\b/i)
      || raw.match(/\b(\d{1,2})\s*h(?:\s*(\d{2}))?\b/i)
    if (timeMatch) {
      const hours = Number(timeMatch[1])
      const minutes = Number(timeMatch[2] || 0)
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        time = `${pad2(hours)}:${pad2(minutes)}`
      }
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
  const raw = String(line || '')
  if (/\d{1,2}[\/\-.]\d{1,2}|\b\d{1,2}\s*(?:h|:|مع|m3a)\s*\d{0,2}\b|\bghda\b|\bghedda\b|\bghdda\b|\bgheda\b|\bdemain\b|غدا/i.test(raw)) {
    return true
  }
  return matchWeekday(normalizeText(raw)) !== null
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

function hasKnownCityMention(text) {
  return listMoroccanCityMentions(text).length > 0 || Boolean(resolveMoroccanCity(String(text || '').trim()))
}

function canonicalCityName(value) {
  return resolveMoroccanCity(value) || null
}

function looksLikeClinicLocationQuestion(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const n = normalizeText(raw)
  // Latin Darija cabinet questions (no city mention required)
  if (/\b(ntoma|ntuma|ntouma)\b/.test(n) && /\b(fin|fayn|kayn|kaynin|kayna)\b/.test(n)) {
    return true
  }
  if (/\b(fin|fayn)\s+(kaynin|kayn|kayna)\b/.test(n)) return true
  if (/\b(ou|w)\s+kayn(in|a)?\b/.test(n) && /\b(cabinet|clinique|centre)\b/.test(n)) return true
  if (hasKnownCityMention(raw)) {
    if (/\b(vous etes|vous situez|votre (cabinet|clinique|adresse|centre)|le cabinet|le centre dentaire)\b/.test(n)) {
      return true
    }
    if (/[?؟]/.test(raw) && /\b(vous|votre|cabinet|wach|wachi|فين|واش)\b/i.test(n)) {
      return true
    }
  }
  if (/واش\s*(نتوما|كاينين)|فين\s*كاين|واش\s*كاين/.test(raw)) return true
  if (/نتوما\s*فين|فين\s*نتوما/.test(raw)) return true
  return false
}

function patientStatesOwnCity(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (extractLabeledValue(raw, LABEL_CITY)) return true
  const n = normalizeText(raw)
  if (/\b(je (suis|habite|vis|viens)|j habite|jhabite|ma ville)\b/.test(n)) return true
  if (/\b(ana (men|mn|min|f|fi|kayn|kayna|saken|sakna|sakn|sakena|kan3ich|3ayech)|saken|sakna|sakn|sakena|kanskn|mdinti|ville dyali)\b/.test(n)) {
    return true
  }
  if (/أنا\s*(من|ف|في|ساكن|ساكنة)|كانسكن|ساكن|كنعيش|مدينتي/.test(raw)) return true
  return false
}

function isStandaloneCityMessage(text) {
  const raw = String(text || '').trim()
  if (!raw || /[?؟]/.test(raw)) return false
  if (isBookingIntent(raw) || isConfirmationYes(raw) || isConfirmationNo(raw)) return false
  const words = raw.split(/\s+/).filter(Boolean)
  if (words.length > 3) return false
  if (extractPhone(raw) || looksLikeDateLine(raw) || looksLikeServiceText(raw)) return false
  return Boolean(isKnownCityToken(raw) || (looksLikeCityLine(raw) && resolveCityValue(raw) && isKnownCityToken(raw)))
}

function looksLikeAvailabilityProbe(text) {
  const raw = String(text || '').trim()
  const n = normalizeText(raw)
  const hasDay = matchWeekday(n) !== null || /\b(demain|ghda|ghedda|ghdda|gheda|غدا|غداً|aujourdhui|aujourd hui|lyoum|lyom|اليوم)\b/.test(n)
  if (!hasDay) return false
  const hasClock = /\b\d{1,2}\s*(?:h|:|مع|m3a)\s*\d{0,2}\b/i.test(raw)
    || /\bà\s*\d{1,2}\b/i.test(raw)
  const questionish = /[?؟]/.test(raw)
    || /\b(vous avez|avez vous|etes vous|kayn chi|wach kayn|wach 3ndkom)\b/.test(n)
    || /عندكم|واش كاين/.test(raw)
  if (questionish && !hasClock) return true
  if (/\b(quelque chose|dispo|disponible|un creneau)\b/.test(n) && !hasClock) return true
  return false
}

function citiesNegatedInText(text) {
  const n = ` ${normalizeText(text)} `
  const negated = new Set()
  const mentions = listMoroccanCityMentions(text)
  for (const city of mentions) {
    const cityKey = normalizeText(city)
    if (!cityKey) continue
    const re = new RegExp(`(?:^|\\s)(?:pas|not|machi|maachi)\\s+${cityKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
    if (re.test(n)) negated.add(city)
  }
  for (const token of MOROCCAN_CITY_TOKENS) {
    if (token.length < 3) continue
    const re = new RegExp(`(?:^|\\s)(?:pas|not|machi|maachi)\\s+${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
    if (re.test(n)) {
      const resolved = resolveMoroccanCity(token)
      if (resolved) negated.add(resolved)
    }
  }
  if (/ماشي\s*(كازا|الدار البيضاء)/.test(String(text || ''))) negated.add('Casablanca')
  if (/ماشي\s*الرباط/.test(String(text || ''))) negated.add('Rabat')
  return negated
}

/**
 * Prefer explicit patient self-location over any other city mention in the same message.
 * Example: "Ah Casa ana kayn f kenitra" → Kénitra (not Casablanca).
 */
function extractPersonalCity(text) {
  const raw = String(text || '').trim()
  if (!raw || looksLikeClinicLocationQuestion(raw)) return null

  const patterns = [
    /(?:ana\s+(?:kayn|kayna)\s+(?:f|fi)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:ana\s+(?:saken|sakna|sakn|sakena|kan3ich|3ayech)\s+(?:f|fi)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:ana\s+(?:men|mn|min|f|fi)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:(?:saken|sakna|sakn|sakena|kanskn|kan3ich)\s+(?:f|fi)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:(?:saken|sakna|sakn|sakena)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:(?:howa|howwa|hiya|hta\s+howa)\s+(?:mn|men|min|f|fi)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:\b(?:mn|men|min)\s+)([\p{L}][\p{L}']{2,40})(?=\s|$)/iu,
    /(?:mdinti|ville\s+dyali)\s*[:\s]+([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:je\s+(?:suis|habite|vis)\s+(?:à|a|sur|en)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:j['’]?habite\s+(?:à|a|sur)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /(?:ma\s+ville\s+(?:est|c['’]est)\s+)([\p{L}][\p{L}\s'-]{1,40})/iu,
    /أنا\s*(?:ساكن|ساكنة)?\s*(?:ف|في|من)\s*([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})/u,
    /كنعيش\s*(?:ف|في)\s*([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})/u,
    /مدينتي\s*[:\s]*([\u0600-\u06FF][\u0600-\u06FF\s]{1,40})/u,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const candidate = String(match[1]).trim().split(/[.,;!?؟]/)[0].trim()
    // Stop at contrast words ("walakin", "mais")
    const clipped = candidate.split(/\s+(?:walakin|mais|mais\s+ana|و\s*لكن)\b/i)[0].trim()
    const city = resolveCityValue(clipped.split(/\s+/).slice(0, 3).join(' '))
    if (city) return city
  }
  return null
}

function clipNameCandidate(value) {
  let s = String(value || '').trim()
  if (!s) return ''
  const stop = s.search(
    /\s+(?:3ando|3ndi|3andha|3endi|3endo|bghit|bgha|baghi|bagha|baghya|ydir|ndir|ndiro|kaydir|tabyid|tabyit|tbyid|blanch|appareil|apareil|kayn|mochkil|mochkel|darssa|darsa|derssa|drssa|rendez|rdv|w\s+khass|hta|howwa|howa\s+mn|w\s+sakn|w\s+saken|w\s+sakna|sakn\s+f|saken\s+f|nemra|nimra|numero|tel(?:ephone)?|tele|nhar|sa3a|lwa9t|و|موعد|عندو|عنده|عندها|ando|khassha|t7ayd|بغا|باغي|بغيت|يدير)\b/i,
  )
  if (stop > 0) s = s.slice(0, stop)
  s = s.replace(/[,:;.\-–—]+$/g, '').trim()
  s = s.replace(
    /^(?:khoya|khti|marti|mra|zawji|fr[eè]re|soeur|sœur|femme|mari|fils|fille|enfant|mon|ma|son|sa)\s+/ig,
    '',
  ).trim()
  return s
}

function extractIntroducedName(text) {
  const raw = String(text || '').trim()
  if (!raw) return { full_name: null, name_incomplete: false }
  // Speaker only — never smito/smitha (third-party).
  const re = /(?:je m['’]appelle|mon nom(?: complet)?(?:\s+(?:est|c['’]est))?|moi c['’]est|c['’]est moi|smiti|smiyti|smiytiya|smiyiti|ismi|اسمي(?:\s+الكامل)?|سميتي|سميتيا|أنا\s+سميتي)\s+([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){0,4})/iu
  const match = raw.match(re)
  if (!match) return { full_name: null, name_incomplete: false }
  let candidate = clipNameCandidate(match[1])
  candidate = candidate.replace(/\s+(?:et|و|depuis|من|depuis hier)\b.*$/i, '').trim()
  const full = validateFullName(candidate)
  if (full) return { full_name: full, name_incomplete: false }
  if (looksLikePartialFirstName(candidate)) {
    return { full_name: null, name_incomplete: true }
  }
  return { full_name: null, name_incomplete: false }
}

/**
 * Extract a third-party / target patient name from natural Darija / FR booking phrasing.
 * Never returns a relation word ("khoya", "ma femme") as identity.
 */
function extractTargetPersonName(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const patterns = [
    /(?:smito|smiyto|smitou|smiytu|smiytou|smitha|smita|اسمو|سميتو|سميته|سميتها)\s+([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /(?:اسم(?:\s+الكامل)?\s+ديالو|الاسم\s+ديالو|السمية\s+ديالو)\s*[:\s]*([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /(?:rendez[- ]?vous|rdv|موعد)\s+(?:pour|l|li|لي)\s+([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /\bpour(?:\s+(?:mon|ma|son|sa)\s+(?:fr[eè]re|soeur|sœur|femme|mari|fils|fille|enfant))?\s+([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /\bbghit\s+(?:nakhod\s+)?(?:lih|liha)\s+(?:rendez[- ]?vous\s*|rdv\s*)?(?:,\s*)?(?:smito\s+)?([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /\bbghit\s+(?:nakhod\s+)?(?:rendez[- ]?vous|rdv)\s+l(?:ih|iha)?\s+([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
    /(?:khoya|khti|marti|mra|zawji)\s+(?:smito|smiyto|smiytu|smitha|smita)?\s*([\p{L}][\p{L}'’\-]{1,40}(?:\s+[\p{L}][\p{L}'’\-]{1,40}){1,3})/iu,
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match?.[1]) continue
    const clipped = clipNameCandidate(match[1])
    const full = validateFullName(clipped)
    if (full) return full
  }

  const introduced = extractIntroducedName(raw)
  if (introduced.full_name) return introduced.full_name
  return null
}

function detectClearedFields(text, extracted = {}) {
  const n = normalizeText(text)
  const cleared = {}
  const deniesPhone = /\b(numero|telephone|tel|phone|رقم(?:\s*الهاتف)?).{0,28}(faux|fausse|pas bon|pas correct|incorrect|mauvais|غالط|ماشي صحيح)\b/.test(n)
    || /\b(faux|incorrect).{0,16}(numero|telephone|رقم)\b/.test(n)
  if (deniesPhone && !extracted.phone_number) cleared.phone_number = true

  const deniesCity = /\b(ville|city|مدينة).{0,20}(fausse|pas (bonne|correcte)|faux|غالطة|ماشي صحيحة)\b/.test(n)
  if (deniesCity && !extracted.city) cleared.city = true

  const deniesName = /\b(nom(?: complet)?|اسم(?: الكامل)?).{0,20}(faux|pas (bon|correct)|غالط|ماشي صحيح)\b/.test(n)
  if (deniesName && !extracted.full_name) cleared.full_name = true

  const deniesProblem = /\b(probleme|motif|مشكل).{0,24}(faux|pas (bon|le bon)|غالط|ماشي)\b/.test(n)
    && !extracted.problem
  if (deniesProblem) cleared.problem = true

  const deniesSlot = /\b(date|heure|creneau|jour|موعد|ساعة|نهار).{0,20}(fausse|faux|pas (bon|bonne|correct)|غالط|ماشي)\b/.test(n)
  if (deniesSlot && !extracted.appointment_date && !extracted.appointment_time) {
    cleared.appointment = true
  }
  return cleared
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
    name_incomplete: false,
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
    // Keep other fields even if only a first name was sent (CRM will ask for full name).
    if (!phone || (!name && !looksLikePartialFirstName(lines[0]))) return null

    const result = emptyResult()
    result.full_name = name
    result.phone_number = phone
    result.city = city
    result.name_incomplete = Boolean(!name && looksLikePartialFirstName(lines[0]))
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
    if (looksLikePartialFirstName(lines[i])) {
      result.name_incomplete = true
      nameIdx = i
      break
    }
  }
  result.phone_number = extractPhone(lines[phoneIdx])

  for (let i = 0; i < lines.length; i += 1) {
    if (i === phoneIdx || i === dateIdx || i === nameIdx) continue
    if (!result.city) {
      const city = resolveCityValue(lines[i])
      // Strict 2-word names are not cities; single known city tokens stay cities.
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

  const conservative = Boolean(options.conservative)
  const now = options.now || new Date()
  const lines = raw
    .split(/\r?\n|•|\u2022|;/)
    .map((line) => line.trim())
    .filter(Boolean)

  const leftovers = []

  for (const line of lines) {
    const labeledName = extractLabeledValue(line, LABEL_NAME)
    if (labeledName) {
      const full = validateFullName(labeledName)
      if (full) result.full_name = full
      else if (looksLikePartialFirstName(labeledName)) result.name_incomplete = true
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
        name_incomplete: Boolean(positional.name_incomplete || result.name_incomplete),
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

    if (
      !result.city
      && !looksLikeClinicLocationQuestion(line)
      && !isConfirmationYes(line)
      && !isConfirmationNo(line)
      && !isBookingIntent(line)
    ) {
      const personal = extractPersonalCity(line)
      if (personal && !citiesNegatedInText(line).has(personal)) {
        result.city = personal
        continue
      }
      const knownCity = isKnownCityToken(line) || listMoroccanCityMentions(line).length > 0
      if ((knownCity || looksLikeCityLine(line)) && !looksLikeServiceText(line)) {
        const city = resolveCityValue(line)
        if (city && !citiesNegatedInText(line).has(city)) {
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
    if (looksLikePartialFirstName(line) && !looksLikeDateLine(line) && !extractPhone(line)) {
      result.name_incomplete = true
    }
  }
  }

  if (!result.full_name) {
    const introduced = extractIntroducedName(raw)
    if (introduced.full_name) result.full_name = introduced.full_name
    else if (introduced.name_incomplete) result.name_incomplete = true
  }

  if (!result.full_name) {
    const targetName = extractTargetPersonName(raw)
    if (targetName) result.full_name = targetName
  }

  const negated = citiesNegatedInText(raw)
  if (looksLikeClinicLocationQuestion(raw) || (result.city && negated.has(result.city))) {
    result.city = null
  }

  // Explicit patient self-location always wins over incidental city mentions (e.g. Casa).
  const personalCity = extractPersonalCity(raw)
  if (personalCity && !negated.has(personalCity) && !looksLikeClinicLocationQuestion(raw)) {
    result.city = personalCity
  }

  if (!result.city) {
    const allowWholeTextCity = !looksLikeClinicLocationQuestion(raw)
      && !isBookingIntent(raw)
      && !isConfirmationYes(raw)
      && !isConfirmationNo(raw)
      && (!conservative || patientStatesOwnCity(raw) || isStandaloneCityMessage(raw))
    if (allowWholeTextCity) {
      const mentions = listMoroccanCityMentions(raw)
      for (const resolved of mentions) {
        if (!negated.has(resolved)) {
          result.city = resolved
          break
        }
      }
    }
  }

  if (looksLikeAvailabilityProbe(raw)) {
    result.appointment_date = null
    result.appointment_time = null
  } else if (conservative && result.appointment_date && !result.appointment_time) {
    result.appointment_date = null
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

  if (isConfirmationYes(raw) || isConfirmationNo(raw)) {
    if (!patientStatesOwnCity(raw) && !extractLabeledValue(raw, LABEL_CITY)) {
      result.city = result.city && isKnownCityToken(result.city) ? result.city : null
      if (result.city === 'Oui' || normalizeText(result.city) === 'oui') result.city = null
    }
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
  // Prefer the transcript itself. Soft voice NLU labels alone are too noisy
  // (Whisper + interpreter often tag random audio as "appointment").
  if (BOOKING_INTENT.some((pattern) => pattern.test(String(text || '')))) {
    return true
  }
  // Keep voiceIntent only as a weak secondary signal when text already looks booking-ish
  const hint = String(voiceIntent || '').toLowerCase()
  if (['prise_rendez_vous', 'appointment', 'rdv', 'book_appointment'].includes(hint)) {
    return /\b(rdv|rendez|موعد|bghit|بغيت|je\s+veux|je\s+voudrais)\b/i.test(String(text || ''))
  }
  return false
}

function isConfirmationYes(text) {
  return binaryYes(text, 'generic')
}

function isConfirmationNo(text) {
  return binaryNo(text, 'generic')
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
    name_incomplete: Boolean(bulk.name_incomplete),
    booking_intent: isBookingIntent(text, options.voiceIntent),
    confirmation_yes: isConfirmationYes(text),
    confirmation_no: isConfirmationNo(text),
    _cleared: detectClearedFields(text, bulk),
  }
}

module.exports = {
  validateFullName,
  assessFullNameCandidate,
  looksLikePartialFirstName,
  extractFullName,
  extractCity,
  extractPhone,
  extractProblem,
  resolveMotifPair,
  extractAppointment,
  extractBulkBookingFields,
  extractCustomerSignals,
  extractIntroducedName,
  extractTargetPersonName,
  detectClearedFields,
  looksLikeClinicLocationQuestion,
  looksLikeAvailabilityProbe,
  extractPersonalCity,
  patientStatesOwnCity,
  isStandaloneCityMessage,
  isBookingIntent,
  isConfirmationYes,
  isConfirmationNo,
  isOfficialService,
  MOROCCAN_CITIES,
  resolveCityValue,
  WEEKDAY_ALIASES,
}
