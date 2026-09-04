/**
 * Booking draft confirmation / correction / cancel-reset flow (pre-CRM create).
 * Field keys: full_name | city | problem | phone_number | appointment
 */

const { parseYesNoReply, normalizeConfirmationText } = require('./binary-confirmation')
const {
  parseNameValue,
  parsePhoneValue,
  parseCityValue,
} = require('./booking-corrections')
const { resolveMotifPair, extractAppointment } = require('./extract')
const { resolveService } = require('./services')
const {
  validateAppointmentHours,
  outsideWorkingHoursMessage,
} = require('./working-hours')

const FIELD_ORDER = ['full_name', 'city', 'problem', 'phone_number', 'appointment']

const FIELD_BY_INDEX = {
  1: 'full_name',
  2: 'city',
  3: 'problem',
  4: 'phone_number',
  5: 'appointment',
}

const FIELD_ALIASES = {
  full_name: [
    'nom', 'name', 'fullname', 'fullnamecomplet', 'fullname complet', 'full name',
    'اسم', 'الاسم', 'الاسم الكامل', 'السمية', 'سمية', 'smiya', 'smito', 'smiti',
  ],
  city: [
    'ville', 'city', 'مدينة', 'المدينة', 'mdina', 'medina',
  ],
  problem: [
    'probleme', 'problem', 'motif', 'plainte', 'service', 'douleur',
    'مشكل', 'المشكل', 'المشكل ديال السنان', 'مشكل السنان', 'سبب',
  ],
  phone_number: [
    'telephone', 'tel', 'phone', 'numero', 'numéro', 'portable',
    'هاتف', 'الهاتف', 'رقم', 'رقم الهاتف', 'رقمي',
  ],
  appointment: [
    'date', 'heure', 'jour', 'creneau', 'créneau', 'rendez vous', 'rendezvous', 'rdv',
    'موعد', 'نهار', 'ساعة', 'التاريخ', 'الساعة', 'النهار والساعة', 'date et heure',
    'jour et heure', 'datetime',
  ],
}

function isDarija(language) {
  return language === 'darija' || language === 'ar'
}

function parseCorrectionState(raw) {
  if (!raw) return { fields: [], index: 0 }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const fields = Array.isArray(parsed?.fields)
      ? parsed.fields.filter((f) => FIELD_ORDER.includes(f))
      : []
    const index = Math.max(0, Number(parsed?.index) || 0)
    return { fields, index }
  } catch {
    return { fields: [], index: 0 }
  }
}

function serializeCorrectionState(state) {
  if (!state?.fields?.length) return null
  return JSON.stringify({
    fields: state.fields,
    index: Math.max(0, Number(state.index) || 0),
  })
}

/**
 * Strict YES for final booking create — excludes ok / wakha / mzyan / d'accord alone.
 */
function isStrictBookingConfirmYes(text) {
  const raw = String(text || '').trim()
  const n = normalizeConfirmationText(raw)
  if (!n) return false
  if (/^(non|no|nn|la|laa|لا|لاء)$/i.test(n)) return false
  if (/^(oui+|ouais|yes|yep)$/i.test(n)) return true
  if (/^(je\s+)?confirm(e|é|ee|er)?$/i.test(n)) return true
  if (/^oui\s+(je\s+)?confirm/i.test(n)) return true
  if (/^je\s+confirme(\s+(le\s+)?(rendez|rdv|demande))?$/i.test(n)) return true
  if (/^(نعم+|ايه|أيوه|ايوه)$/u.test(n)) return true
  if (/^(ايوا|أيوا|إيوا)\s*(نعم)?$/u.test(n)) return true
  if (/نأكد|ناكد|confirmi/i.test(n) && !/لا|non|ما\s/.test(n)) return true
  if (/^(آه|اه)\s*(نأكد|ناكد|نعم)?$/u.test(n)) return true
  return false
}

function isBookingConfirmNo(text) {
  return parseYesNoReply(text, { allowTypoYes: false }).value === 'no'
}

/** Explicit cancel of the *draft* booking request (not a plain NON / modify). */
function isExplicitDraftCancelIntent(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const n = normalizeConfirmationText(raw)
  if (/^(non|no|nn|la|laa|لا|لاء)$/i.test(n)) return false
  if (/\bannul(e|er|é|ee|ation)?\b/i.test(n)) return true
  if (/\bcancel(l?er|lation)?\b/i.test(n)) return true
  if (/\bsupprim(e|er|é)?\b/i.test(n)) return true
  if (/\b(nlghi|nalghi|n\s*lghi|lghi)\b/i.test(n)) return true
  if (/بغيت\s*نلغي|نلغي|تلغي|الغاء|إلغاء|ألغ|الغ/.test(raw)) return true
  if (/ما\s*بغيتش\s*(هاد\s*)?(الموعد|الرنديفو|rendez)/.test(raw)) return true
  if (/je\s+ne\s+veux\s+plus(\s+(le\s+)?(rendez|rdv|demande))?/i.test(n)) return true
  return false
}

function parseRejectionChoice(text) {
  const raw = String(text || '').trim()
  const n = normalizeConfirmationText(raw)
  if (!n) return { type: 'unknown' }

  if (/^1\b/.test(n) || /^١\b/.test(raw.trim())) return { type: 'correct' }
  if (/^2\b/.test(n) || /^٢\b/.test(raw.trim())) return { type: 'cancel' }

  if (
    /\b(corrig|modifi|erreur|fausse|faux|changer|rectif)/i.test(n)
    || /بغيت\s*نصحح|نصحح|تصحح|معلومة\s*غالط|كاين(ة)?\s*معلومة|معلومات\s*(غالطة|غلط)/u.test(raw)
    || /\b(n?sa7a7|n?sahah|ghalta|ghalt)\b/i.test(n)
  ) {
    return { type: 'correct' }
  }

  if (
    /\b(annul|cancel|supprim)/i.test(n)
    || /نلغي|تلغي|الغ|ألغ|لغي|بغيت\s*نلغي|الغاء|إلغاء/u.test(raw)
    || /\b(n?lghi|n?laghi|cancel)\b/i.test(n)
    || /ما\s*بغيتش\s*(موعد|رنديفو|رendez)/u.test(raw)
    || /je\s+ne\s+veux\s+plus/i.test(n)
  ) {
    return { type: 'cancel' }
  }

  return { type: 'unknown' }
}

function aliasKey(value) {
  return normalizeConfirmationText(value).replace(/\s+/g, ' ')
}

function matchFieldAlias(token) {
  const key = aliasKey(token)
  if (!key) return null
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (aliasKey(alias) === key) return field
      if (key.includes(aliasKey(alias)) && aliasKey(alias).length >= 3) return field
    }
  }
  return null
}

/**
 * @returns {string[]} unique field keys in stable order
 */
function parseFieldsToCorrect(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const found = []
  const add = (field) => {
    if (field && !found.includes(field)) found.push(field)
  }

  // Numeric-only choices: 1, 3 or 1 3 or 1،3
  const nums = raw.match(/[1-5١-٥]/g)
  if (nums && nums.length && /^[\s,;|/وet\-–—1-5١-٥،]+$/u.test(raw.replace(/\s+/g, ' ').trim())) {
    for (const ch of nums) {
      const map = { '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5 }
      const n = map[ch] || Number(ch)
      add(FIELD_BY_INDEX[n])
    }
    return FIELD_ORDER.filter((f) => found.includes(f))
  }

  for (const m of raw.matchAll(/(?:^|[\s,;و]|et\b)([1-5١-٥])(?=[\s,;و]|et\b|$)/giu)) {
    const ch = m[1]
    const map = { '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5 }
    add(FIELD_BY_INDEX[map[ch] || Number(ch)])
  }

  const chunks = raw
    .split(/\s*(?:,|;|\/|\bet\b|\bw\b|و|،)\s*/iu)
    .map((c) => c.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    add(matchFieldAlias(chunk))
  }

  const n = aliasKey(raw)
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const a = aliasKey(alias)
      if (a.length >= 3 && n.includes(a)) add(field)
    }
  }

  return FIELD_ORDER.filter((f) => found.includes(f))
}

function parseMotifCorrection(rawValue) {
  const exact = String(rawValue || '').trim()
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
  return { problem: null, problem_details: exact, urgency: 'moyenne' }
}

/**
 * Parse a single correction value for the active field.
 * @returns {{ ok: true, patch: object } | { ok: false, reason: string, hours?: object }}
 */
function parseFieldCorrectionValue(field, text, options = {}) {
  const raw = String(text || '').trim()
  if (!raw) return { ok: false, reason: 'empty' }

  if (field === 'full_name') {
    const name = parseNameValue(raw)
    if (!name) return { ok: false, reason: 'invalid_name' }
    return { ok: true, patch: { full_name: name } }
  }
  if (field === 'city') {
    const city = parseCityValue(raw)
    if (!city) return { ok: false, reason: 'invalid_city' }
    return { ok: true, patch: { city } }
  }
  if (field === 'phone_number') {
    const phone = parsePhoneValue(raw)
    if (!phone) return { ok: false, reason: 'invalid_phone' }
    return { ok: true, patch: { phone_number: phone } }
  }
  if (field === 'problem') {
    const motif = parseMotifCorrection(raw)
    if (!motif) return { ok: false, reason: 'invalid_problem' }
    return {
      ok: true,
      patch: {
        problem: motif.problem,
        problem_details: motif.problem_details,
        urgency: motif.urgency || 'moyenne',
      },
    }
  }
  if (field === 'appointment') {
    const appt = extractAppointment(raw, { now: options.now || new Date() })
    if (!appt?.appointment_date || !appt?.appointment_time) {
      return { ok: false, reason: 'invalid_datetime' }
    }
    const hours = validateAppointmentHours(appt.appointment_date, appt.appointment_time)
    if (!hours.ok) {
      return { ok: false, reason: 'outside_hours', hours }
    }
    return {
      ok: true,
      patch: {
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
      },
    }
  }
  return { ok: false, reason: 'unknown_field' }
}

function rejectionMenuMessage(language = 'fr') {
  if (isDarija(language)) {
    return [
      'شنو بغيتي تدير؟',
      '',
      '1. تصحح معلومة ولا أكثر',
      '2. تلغي طلب الموعد كامل',
    ].join('\n')
  }
  return [
    'Que souhaitez-vous faire ?',
    '',
    '1. Corriger une ou plusieurs informations',
    '2. Annuler complètement cette demande de rendez-vous',
  ].join('\n')
}

function fieldsToCorrectPrompt(language = 'fr') {
  if (isDarija(language)) {
    return [
      'شنو هي المعلومات اللي بغيتي تصحح؟',
      '',
      'تقدر تختار معلومة وحدة ولا أكثر:',
      '',
      '1. الاسم الكامل',
      '2. المدينة',
      '3. المشكل ديال السنان',
      '4. رقم الهاتف',
      '5. نهار وساعة الموعد',
      '',
      'مثلا:',
      '1',
      'ولا',
      '1، 3',
      'ولا',
      'الاسم والمدينة',
    ].join('\n')
  }
  return [
    'Quelles informations souhaitez-vous corriger ?',
    '',
    'Vous pouvez en choisir une ou plusieurs :',
    '',
    '1. Nom complet',
    '2. Ville',
    '3. Problème / motif',
    '4. Numéro de téléphone',
    '5. Date et heure du rendez-vous',
    '',
    'Par exemple :',
    '1',
    'ou',
    '1, 3',
    'ou',
    'Nom complet et ville',
  ].join('\n')
}

function fieldCorrectionPrompt(field, language = 'fr') {
  const darija = isDarija(language)
  const mapAr = {
    full_name: 'كتب ليا الاسم الكامل الصحيح.',
    city: 'كتب ليا المدينة الصحيحة.',
    problem: 'كتب ليا المشكل ديال السنان الصحيح.',
    phone_number: 'كتب ليا رقم الهاتف الصحيح.',
    appointment: 'كتب ليا النهار والساعة الجداد اللي مناسبين ليك.',
  }
  const mapFr = {
    full_name: 'Écrivez le nom complet correct.',
    city: 'Écrivez la ville correcte.',
    problem: 'Écrivez le problème dentaire correct.',
    phone_number: 'Écrivez le numéro de téléphone correct.',
    appointment: 'Écrivez le nouveau jour et la nouvelle heure souhaités.',
  }
  return (darija ? mapAr : mapFr)[field]
    || (darija ? 'كتب ليا المعلومة الصحيحة.' : 'Écrivez la valeur correcte.')
}

function fieldCorrectionRetry(field, language = 'fr') {
  const darija = isDarija(language)
  if (field === 'city') {
    return darija
      ? 'المدينة ما مقبولاش. كتب ليا مدينة مغربية صحيحة.'
      : 'Ville non reconnue. Indiquez une ville marocaine valide.'
  }
  if (field === 'phone_number') {
    return darija
      ? 'رقم الهاتف ما صالحش. كتب ليا رقم صحيح (مثال: 06XXXXXXXX).'
      : 'Numéro invalide. Indiquez un numéro marocain valide (ex. 06XXXXXXXX).'
  }
  if (field === 'full_name') {
    return darija
      ? 'الاسم خاصو يكون الاسم الكامل (الاسم والنسبة).'
      : 'Indiquez le nom complet (prénom et nom).'
  }
  if (field === 'appointment') {
    return darija
      ? 'عافاك صيفط نهار و ساعة واضحين ضمن ساعات العمل.'
      : 'Indiquez un jour et une heure clairs dans les horaires d’ouverture.'
  }
  return fieldCorrectionPrompt(field, language)
}

function draftCancelConfirmMessage(language = 'fr') {
  if (isDarija(language)) {
    return [
      'واش متأكد بغيتي تلغي طلب الموعد كامل؟',
      '',
      'جاوب بنعم ولا لا.',
    ].join('\n')
  }
  return [
    'Voulez-vous vraiment annuler cette demande de rendez-vous ?',
    '',
    'Répondez OUI ou NON.',
  ].join('\n')
}

function unclearReplyCancelAskMessage(language = 'fr') {
  // Legacy helper kept for explicit cancel confirmations only.
  return draftCancelConfirmMessage(language)
}

function unclearSummaryClarifyMessage(language = 'fr') {
  if (isDarija(language)) {
    return [
      'ما فهمتش شنو بغيتي تبدل.',
      '',
      'تقدر تكتب ليا الاسم، التلفون، المدينة، المشكل، النهار ولا الساعة باش نصححو،',
      'ولا جاوب بـ *نعم* إلا كلشي صحيح.',
    ].join('\n')
  }
  return [
    'Je n’ai pas compris ce que vous souhaitez modifier.',
    '',
    'Indiquez le nom, téléphone, ville, motif, date ou heure à corriger,',
    'ou répondez *OUI* si tout est correct.',
  ].join('\n')
}

function askFullNameAfterPartialCorrection(language = 'fr') {
  if (isDarija(language)) {
    return 'شكراً. عفاك صيفط ليا الاسم الكامل ديالك: الاسم والنسب.'
  }
  return 'Merci. Pouvez-vous m’envoyer votre prénom et votre nom complets ?'
}

function draftCancelledMessage(language = 'fr') {
  if (isDarija(language)) {
    return 'تم إلغاء طلب الموعد. تقدر تكتب ليا من جديد فأي وقت.'
  }
  return 'Votre demande de rendez-vous a été annulée. Vous pouvez me réécrire quand vous souhaitez.'
}

function confirmationOuiNonFooter(language = 'fr') {
  if (isDarija(language)) {
    return [
      'واش هاد المعلومات صحيحة؟',
      '',
      'جاوب:',
      '• *نعم* باش تأكد الموعد',
      '• *لا* باش تصحح شي معلومة',
      '',
      'إلا بغيتي تلغي الطلب، كتب صراحة « بغيت نلغي ».',
    ].join('\n')
  }
  return [
    'Les informations sont-elles correctes ?',
    '',
    'Répondez :',
    '• *OUI* pour confirmer',
    '• *NON* pour modifier une information',
    '',
    'Pour annuler la demande, écrivez explicitement « annuler ».',
  ].join('\n')
}

function outsideHoursRetry(language, hours) {
  return outsideWorkingHoursMessage(language, hours)
}

module.exports = {
  FIELD_ORDER,
  FIELD_BY_INDEX,
  parseCorrectionState,
  serializeCorrectionState,
  isStrictBookingConfirmYes,
  isBookingConfirmNo,
  isExplicitDraftCancelIntent,
  parseRejectionChoice,
  parseFieldsToCorrect,
  parseFieldCorrectionValue,
  rejectionMenuMessage,
  fieldsToCorrectPrompt,
  fieldCorrectionPrompt,
  fieldCorrectionRetry,
  draftCancelConfirmMessage,
  unclearReplyCancelAskMessage,
  unclearSummaryClarifyMessage,
  askFullNameAfterPartialCorrection,
  draftCancelledMessage,
  confirmationOuiNonFooter,
  outsideHoursRetry,
}
