/**
 * WhatsApp booking: choose which linked patient the RDV is for.
 * Phone/chat is a contact channel — never a unique patient identity.
 */

const { formatPhoneDisplay } = require('./phone')
const { normalizePersonName } = require('./contact-patients')
const { formatDateDisplay, isDarija } = require('./messages')
const {
  isConfirmationYes,
  isConfirmationNo,
  validateFullName,
  looksLikePartialFirstName,
  extractTargetPersonName,
} = require('./extract')

const STATUS_LABEL_FR = {
  non_confirme: 'À confirmer',
  pending_confirmation: 'À confirmer',
  confirmed: 'Confirmé',
  cancelled: 'Annulé',
  no_show: 'Patient absent',
  completed: 'Terminé',
}

const STATUS_LABEL_AR = {
  non_confirme: 'في انتظار التأكيد',
  pending_confirmation: 'في انتظار التأكيد',
  confirmed: 'مؤكد',
  cancelled: 'ملغي',
  no_show: 'ما جاوش',
  completed: 'سالا',
}

const NAME_STOPWORDS = new Set([
  'pour', 'rdv', 'rendez', 'vous', 'veux', 'voudrais', 'prendre', 'prendre',
  'nouveau', 'nouvelle', 'personne', 'patient', 'patiente', 'un', 'une',
  'le', 'la', 'les', 'de', 'du', 'des', 'mon', 'ma', 'mes', 'son', 'sa',
  'femme', 'mari', 'fils', 'fille', 'enfant', 'avec', 'moi', 'elle', 'lui',
  'veux', 'besoin', 'aussi', 'aussi', 'the', 'and', 'khoya', 'khti', 'marti',
])

const NEW_PERSON_PATTERNS = [
  /nouvelle personne/i,
  /nouveau patient/i,
  /nouvelle patiente/i,
  /quelqu['’]un d['’]autre/i,
  /une autre personne/i,
  /un autre patient/i,
  /autre personne/i,
  /^nouveau$/i,
  /^nouvelle$/i,
  /شخص جديد/,
  /مريض جديد/,
  /واحد جديد/,
  /شخص آخر/,
  /شخص اخر/,
  /واحد آخر/,
  /واحد اخر/,
  /\bchi\s+wahed\s+jdid\b/i,
  /\bwa7d\s+jdid\b/i,
  /\bwahed\s+jdid\b/i,
  /\bpatient\s+jdid\b/i,
  /\bpersonne\s+jdid(?:a|e)?\b/i,
]

const RELATION_ONLY_NEW = [
  /^(?:pour\s+)?(?:ma femme|mon fr[eè]re|mon mari|ma soeur|ma sœur|khoya|khti|marti)\s*$/i,
  /\bbghit\s+(?:ndir\s+)?l\s+(?:khoya|khti|marti)\b/i,
  /\bbghit\s+l\s+(?:khoya|khti|marti)\b/i,
]

const FOR_ME_PATTERNS = [
  /^pour moi\b/i,
  /\bpour moi\b/i,
  /^moi[!.]?$/i,
  /باسمي/,
  /ليا أنا/,
  /عليا أنا/,
  /^لييا$/,
]

function statusLabel(status, language = 'fr') {
  const key = String(status || '').trim()
  const map = isDarija(language) ? STATUS_LABEL_AR : STATUS_LABEL_FR
  return map[key] || (isDarija(language) ? 'موعد' : 'Rendez-vous')
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstNameOf(patient) {
  return normalizePersonName(patient?.full_name).split(' ').filter(Boolean)[0] || ''
}

function looksLikeNewPerson(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (NEW_PERSON_PATTERNS.some((re) => re.test(raw))) return true
  if (extractTargetPersonName(raw) || validateFullName(raw)) return false
  return RELATION_ONLY_NEW.some((re) => re.test(raw))
}

function looksLikeForMe(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  return FOR_ME_PATTERNS.some((re) => re.test(raw))
}

function extractChoiceNumber(text, max, { allowBareIndex = true } = {}) {
  const raw = String(text || '').trim()
  const labeled = raw.match(/\b(?:pour|choix|option|num[eé]ro|رقم)\s*(\d{1,2})\b/i)
  const bare = allowBareIndex
    ? raw.match(/^(\d{1,2})(?:[\).:\s-]*)$/)
    : null
  const match = labeled || bare
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n < 1 || n > max) return null
  return n
}

function nameMentionedInText(text, patient) {
  const t = normalizePersonName(text)
  const full = normalizePersonName(patient?.full_name)
  if (!t || !full) return false
  if (t.includes(full) || full === t) return true
  const first = firstNameOf(patient)
  if (first.length < 3) return false
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(first)}(?:\\s|$)`)
  return re.test(` ${t} `)
}

function uniqueNameMatches(text, patients) {
  const t = normalizePersonName(text)
  if (!t || !patients?.length) return []

  const exact = patients.filter((p) => {
    const full = normalizePersonName(p.full_name)
    return full && (t.includes(full) || full === t)
  })
  if (exact.length === 1) return exact
  if (exact.length > 1) return exact

  const firstHits = patients.filter((p) => {
    const first = firstNameOf(p)
    if (first.length < 3) return false
    const re = new RegExp(`(?:^|\\s)${escapeRegExp(first)}(?:\\s|$)`)
    return re.test(` ${t} `)
  })
  if (firstHits.length === 1) return firstHits
  if (firstHits.length > 1) return firstHits

  const tokens = t.split(' ').filter((tok) => tok.length >= 4 && !NAME_STOPWORDS.has(tok))
  let ambiguous = null
  const prefixHits = []
  for (const tok of tokens) {
    const hits = patients.filter((p) => {
      const first = firstNameOf(p)
      if (!first) return false
      return first === tok || first.startsWith(tok) || (tok.startsWith(first) && first.length >= 4)
    })
    if (hits.length > 1) {
      ambiguous = hits
      break
    }
    if (hits.length === 1 && !prefixHits.some((p) => p.id === hits[0].id)) {
      prefixHits.push(hits[0])
    }
  }
  if (ambiguous) return ambiguous
  return prefixHits
}

/**
 * Match a candidate name to linked patients.
 * Full name that does not exactly match an existing patient → new person
 * (never invent a match from first name alone when a surname was given).
 */
function matchLinkedByName(named, patients = []) {
  const list = Array.isArray(patients) ? patients : []
  const norm = normalizePersonName(named)
  if (!norm) return { type: 'unknown' }

  const exact = list.filter((p) => normalizePersonName(p.full_name) === norm)
  if (exact.length === 1) return { type: 'existing', patient: exact[0], fullName: named }
  if (exact.length > 1) return { type: 'ambiguous', matches: exact, fullName: named }

  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.length >= 2) {
    return { type: 'new', fullName: named, reason: 'unknown_full_name' }
  }

  const firstHits = list.filter((p) => firstNameOf(p) === tokens[0])
  if (firstHits.length === 1) return { type: 'existing', patient: firstHits[0], fullName: named }
  if (firstHits.length > 1) return { type: 'ambiguous', matches: firstHits, fullName: named }
  return { type: 'new_incomplete', firstName: named }
}

/**
 * @returns {{
 *   type: 'existing'|'new'|'ambiguous'|'unknown'|'new_incomplete',
 *   patient?: object|null,
 *   fullName?: string|null,
 *   firstName?: string|null,
 *   matches?: object[],
 *   reason?: string,
 * }}
 */
function parsePatientSelection(text, patients = [], options = {}) {
  const raw = String(text || '').trim()
  const list = Array.isArray(patients) ? patients : []
  const allowIndex = options.allowIndex !== false
  const acceptUnknownFullName = options.acceptUnknownFullName !== false
  if (!raw) return { type: 'unknown' }

  if (looksLikeNewPerson(raw)) {
    return { type: 'new', reason: 'explicit_new' }
  }

  const max = list.length + 1
  const num = extractChoiceNumber(raw, max, { allowBareIndex: allowIndex })
  if (num != null) {
    if (num === list.length + 1) return { type: 'new', reason: 'index_new' }
    return { type: 'existing', patient: list[num - 1], reason: 'index' }
  }

  if (looksLikeForMe(raw)) {
    if (list.length === 1) return { type: 'existing', patient: list[0], reason: 'pour_moi_unique' }
    return { type: 'ambiguous', reason: 'pour_moi_multiple' }
  }

  const hits = uniqueNameMatches(raw, list)
  if (hits.length === 1) return { type: 'existing', patient: hits[0], reason: 'name' }
  if (hits.length > 1) return { type: 'ambiguous', reason: 'name_ambiguous', matches: hits }

  const introduced = extractTargetPersonName(raw)
  if (introduced) {
    const linked = matchLinkedByName(introduced, list)
    if (linked.type === 'existing') return { ...linked, reason: 'introduced_existing' }
    if (linked.type === 'ambiguous') return { ...linked, reason: 'introduced_ambiguous' }
    if (linked.type === 'new') return { type: 'new', fullName: introduced, reason: 'introduced_new' }
  }

  if (acceptUnknownFullName) {
    const standalone = validateFullName(raw)
    if (standalone) {
      const linked = matchLinkedByName(standalone, list)
      if (linked.type === 'existing') return { ...linked, reason: 'standalone_existing' }
      if (linked.type === 'ambiguous') return { ...linked, reason: 'standalone_ambiguous' }
      return { type: 'new', fullName: standalone, reason: 'standalone_new' }
    }
    if (looksLikePartialFirstName(raw)) {
      const linked = matchLinkedByName(String(raw).trim(), list)
      if (linked.type === 'existing') return { ...linked, reason: 'first_name_existing' }
      if (linked.type === 'ambiguous') return { ...linked, reason: 'first_name_ambiguous' }
      return { type: 'new_incomplete', firstName: String(raw).trim(), reason: 'first_name_new' }
    }
  }

  return { type: 'unknown' }
}

function mentionedLinkedPatients(texts, patients) {
  const mentioned = []
  const seen = new Set()
  for (const text of texts || []) {
    for (const patient of patients || []) {
      if (seen.has(patient.id)) continue
      if (nameMentionedInText(text, patient)) {
        seen.add(patient.id)
        mentioned.push(patient)
      }
    }
  }
  return mentioned
}

function conversationAppliesToPatient(selected, patients, recentTexts) {
  if (!selected?.id) return true
  const mentioned = mentionedLinkedPatients(recentTexts, patients)
  if (!mentioned.length) return true
  if (mentioned.length === 1) return mentioned[0].id === selected.id
  return mentioned.some((p) => p.id === selected.id) && mentioned.length === 1
}

function inferPatientFromTexts(texts, patients) {
  const mentioned = mentionedLinkedPatients(texts, patients)
  if (mentioned.length === 1) return mentioned[0]
  return null
}

function appointmentLine(appt, language = 'fr') {
  const date = formatDateDisplay(appt.appointment_date)
  const time = String(appt.appointment_time || '').slice(0, 5)
  const status = statusLabel(appt.status, language)
  if (isDarija(language)) return `   • ${date} مع ${time} — ${status}`
  return `   • ${date} à ${time} — ${status}`
}

function patientBlock(index, patient, language = 'fr') {
  const appts = Array.isArray(patient.appointments) ? patient.appointments : []
  const lines = [`${index}. ${patient.full_name}`]
  for (const appt of appts) {
    lines.push(appointmentLine(appt, language))
  }
  return lines.join('\n')
}

/**
 * Split picker into several WhatsApp messages if needed. Never mix two patients in one block.
 */
function buildPatientPickerReplies(patients, language = 'fr') {
  const list = Array.isArray(patients) ? patients : []
  const newIndex = list.length + 1
  const darija = isDarija(language)
  const intro = list.length === 1
    ? (darija
      ? 'هاد الرقم ديال واتساب مرتبط بهاد الشخص:'
      : 'Ce numéro WhatsApp est déjà lié à :')
    : (darija
      ? 'هاد الرقم ديال واتساب مرتبط بهاد الأشخاص:'
      : 'Ce numéro WhatsApp est déjà lié à plusieurs patients :')

  const blocks = list.map((patient, i) => patientBlock(i + 1, patient, language))
  const newLine = darija ? `${newIndex}. شخص جديد` : `${newIndex}. Nouvelle personne`
  const question = darija
    ? 'الموعد الجديد ديال شكون؟ جاوب بالسمية أو بالرقم.'
    : (list.length === 1
      ? `Souhaitez-vous prendre le rendez-vous pour ${list[0].full_name}, ou pour une nouvelle personne ?`
      : 'Pour qui souhaitez-vous prendre le rendez-vous ?')

  const replies = []
  let current = intro
  for (const block of blocks) {
    const next = `${current}\n\n${block}`
    if (current !== intro && next.length > 1100) {
      replies.push(current.trim())
      current = block
    } else {
      current = next
    }
  }
  const closing = `${current}\n\n${newLine}\n\n${question}`
  if (closing.length > 1400 && current !== intro) {
    replies.push(current.trim())
    replies.push(`${newLine}\n\n${question}`)
  } else {
    replies.push(closing.trim())
  }
  return replies.filter(Boolean)
}

function existingPatientAck(patient, language = 'fr') {
  const name = patient?.full_name || 'le patient'
  if (isDarija(language)) {
    return `مزيان، الموعد غادي يكون لـ ${name}.`
  }
  return `Très bien, le rendez-vous sera pour ${name}.`
}

function newPersonAck(language = 'fr', fullName = null) {
  const name = String(fullName || '').trim()
  if (isDarija(language)) {
    if (name) return `مزيان، الموعد غادي يكون لشخص جديد:\n\n• الاسم الكامل: ${name}`
    return 'مزيان. الموعد غادي يكون لشخص جديد.'
  }
  if (name) return `Très bien, le rendez-vous sera pour une nouvelle personne :\n\n• Nom complet : ${name}`
  return 'Très bien. Le rendez-vous sera pour une nouvelle personne.'
}

function duplicateNameConfirmMessage(patient, language = 'fr') {
  const name = patient?.full_name || ''
  if (isDarija(language)) {
    return [
      `${name} أصلاً مرتبط بهاد الرقم.`,
      '',
      'واش بغيتي تستعمل هاد المريض الموجود، ولا بغيتي تسجّل شخص جديد بنفس السمية؟',
      '',
      '1. المريض الموجود',
      '2. شخص جديد',
    ].join('\n')
  }
  return [
    `${name} est déjà lié à ce numéro.`,
    '',
    'Souhaitez-vous utiliser ce patient existant, ou créer réellement une nouvelle personne ?',
    '',
    '1. Patient existant',
    '2. Nouvelle personne',
  ].join('\n')
}

function ambiguousPatientMessage(language = 'fr', matches = []) {
  const names = (matches || []).map((p) => p.full_name).filter(Boolean)
  if (isDarija(language)) {
    return names.length
      ? `ما فهمتش شكون بالضبط. واش ${names.join(' ولا ')}؟`
      : 'عافاك حدد السمية الكاملة ديال الشخص.'
  }
  return names.length
    ? `Plusieurs personnes correspondent. S’agit-il de ${names.join(' ou de ')} ?`
    : 'Merci de préciser le nom complet de la personne concernée.'
}

function parseDuplicateConfirm(text) {
  const raw = String(text || '').trim()
  if (!raw) return { type: 'unknown' }
  if (/^(1|existant|existante|ce patient|ce malade|الموجود)/i.test(raw) || isConfirmationYes(raw)) {
    return { type: 'existing' }
  }
  if (/^(2|nouveau|nouvelle|جديد)/i.test(raw) || looksLikeNewPerson(raw) || isConfirmationNo(raw)) {
    return { type: 'new' }
  }
  return { type: 'unknown' }
}

function formatProfilePhone(patient) {
  return formatPhoneDisplay(patient?.phone_number) || patient?.phone_number || null
}

module.exports = {
  uniqueNameMatches,
  matchLinkedByName,
  parsePatientSelection,
  looksLikeNewPerson,
  looksLikeForMe,
  nameMentionedInText,
  mentionedLinkedPatients,
  conversationAppliesToPatient,
  inferPatientFromTexts,
  buildPatientPickerReplies,
  existingPatientAck,
  newPersonAck,
  duplicateNameConfirmMessage,
  ambiguousPatientMessage,
  parseDuplicateConfirm,
  statusLabel,
  formatProfilePhone,
}
