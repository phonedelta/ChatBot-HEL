/**
 * Patient / staff message templates (French + Arabic script for Darija).
 * Booking collection is progressive: patients may send fields across several messages.
 */

const { formatPhoneDisplay } = require('./phone')
const { serviceArabicLabel } = require('../voice-nlu/intent-table')
const { isOfficialService } = require('./services')
const { validateFullName } = require('./name-validator')
const { checkCustomerData } = require('./checkCustomerData')
const { complaintToArabic } = require('./complaint-display')
const { displayNameArabic } = require('./name-transliteration')
const { stripPersonNameLabels } = require('./name-validator')

function isDarija(lang) {
  return ['darija', 'ar', 'arabic'].includes(String(lang || '').toLowerCase())
}

function formatDateDisplay(value) {
  const raw = String(value || '').trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return raw || '—'
}

const DARIJA_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو',
  'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر',
]
const DARIJA_WEEKDAYS = [
  'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
]

function formatLongDateFr(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return formatDateDisplay(isoDate)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  try {
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return formatDateDisplay(isoDate)
  }
}

function formatLongDateDarija(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return formatDateDisplay(isoDate)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const weekday = DARIJA_WEEKDAYS[d.getDay()] || ''
  const day = d.getDate()
  const month = DARIJA_MONTHS[d.getMonth()] || ''
  const year = d.getFullYear()
  return `${weekday} ${day} ${month} ${year}`.trim()
}

function formatLongDateLocalized(isoDate, language = 'fr') {
  return isDarija(language) ? formatLongDateDarija(isoDate) : formatLongDateFr(isoDate)
}

function formatDateTimeLocalized(isoDate, timeStr, language = 'fr') {
  const dateLabel = formatLongDateLocalized(isoDate, language)
  const time = String(timeStr || '').slice(0, 5)
  if (isDarija(language)) {
    return `${dateLabel} مع ${time}`
  }
  return `${dateLabel} à ${time}`
}

const BOOKING_FIELD_ORDER = ['full_name', 'problem', 'phone_number', 'city', 'appointment']

const FIELD_LABELS_FR = {
  full_name: 'Nom complet',
  problem: 'Motif',
  phone_number: 'Numéro de téléphone',
  city: 'Ville',
  appointment: 'Jour et heure souhaités',
}

const FIELD_LABELS_AR = {
  full_name: 'الاسم الكامل',
  problem: 'المشكل ديال السنان',
  phone_number: 'رقم الهاتف',
  city: 'المدينة',
  appointment: 'النهار والساعة اللي مناسبين ليك',
}

function fieldLabel(field, language = 'fr') {
  const map = isDarija(language) ? FIELD_LABELS_AR : FIELD_LABELS_FR
  return map[field] || field
}

function formatAppointmentValue(lead, language = 'fr') {
  const date = formatDateDisplay(lead?.appointment_date)
  const time = String(lead?.appointment_time || '').slice(0, 5)
  if (!lead?.appointment_date || !time) return ''
  if (isDarija(language)) return `${date} مع ${time}`
  return `${date} à ${time}`
}

function motifDisplayValue(lead, language = 'fr') {
  const details = String(lead?.problem_details || '').trim()
  const problem = String(lead?.problem || '').trim()
  if (isDarija(language)) {
    const arComplaint = complaintToArabic(details)
    if (arComplaint) return arComplaint
    if (/[\u0600-\u06FF]/.test(details)) return details
    // Explicit service request (extraction, blanchiment…) → Arabic service label.
    // Symptom/complaint Latin text stays as complaint, never replaced by service name alone
    // when we have a pain/burn/gum summary — handled above.
    if (problem && isOfficialService(problem)) {
      const looksLikeSymptom = /\b(3andi|kadarni|7ri9|hri9|wje3|douleur|mal|mochkil|katnzeff)\b/i.test(details)
      if (!looksLikeSymptom) return serviceArabicLabel(problem)
    }
    if (details && details.toLowerCase() !== problem.toLowerCase()) return details
    return problem ? serviceArabicLabel(problem) : details
  }
  if (details && details.length <= 160 && details !== problem) return details
  return problem
}

function personDisplayName(lead, language = 'fr') {
  const original = stripPersonNameLabels(String(lead?.full_name || '').trim())
  if (!original) return '—'
  const cleaned = validateFullName(original) || original
  if (!isDarija(language)) return cleaned
  return displayNameArabic(cleaned, { arabicName: lead?.full_name_ar }) || cleaned
}

function knownBookingValues(lead, language = 'fr') {
  const check = checkCustomerData(lead || {})
  const values = {}
  if (check.checks.full_name) values.full_name = personDisplayName(lead, language)
  if (check.checks.problem) values.problem = motifDisplayValue(lead, language)
  if (check.checks.phone_number) values.phone_number = formatPhoneDisplay(lead.phone_number) || lead.phone_number
  if (check.checks.city) values.city = lead.city
  if (check.checks.appointment) values.appointment = formatAppointmentValue(lead, language)
  return values
}

function hoursHint(language = 'fr') {
  if (isDarija(language)) {
    return 'أوقات العمل: الإثنين–الجمعة 10:30→19:00، السبت 09:30→13:00.'
  }
  return 'Horaires : lundi–vendredi 10h30–19h00, samedi 09h30–13h00.'
}

function missingFieldsMessage(language = 'fr', missing = [], options = {}) {
  const fields = (missing || []).filter((f) => BOOKING_FIELD_ORDER.includes(f))
  const bullets = fields.map((f) => `• ${fieldLabel(f, language)}`)
  const several = options.allowSeveral !== false
  const thank = options.thankYou || null
  const includeHours = Boolean(options.includeHours) && fields.includes('appointment')

  if (isDarija(language)) {
    const intro = options.intro
      || (thank
        ? `${thank}\n\nباقي خاصني:`
        : (fields.length === BOOKING_FIELD_ORDER.length
          ? 'باش نحجز الموعد، صيفط ليا هاد المعلومات:'
          : 'باش نكمل طلب الموعد، صيفط ليا غير المعلومات الناقصة:'))
    return [
      intro,
      '',
      ...bullets,
      several ? '\nتقدر تصيفطهم فمساج واحد ولا فكثر من مساج.' : null,
      includeHours ? `\n${hoursHint(language)}` : null,
    ].filter((line) => line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  const intro = options.intro
    || (thank
      ? `${thank}\n\nIl me manque encore :`
      : (fields.length === BOOKING_FIELD_ORDER.length
        ? 'Pour préparer votre rendez-vous, envoyez-moi :'
        : 'Pour compléter votre demande de rendez-vous, envoyez-moi uniquement :'))
  return [
    intro,
    '',
    ...bullets,
    several ? '\nVous pouvez les envoyer en un ou plusieurs messages.' : null,
    includeHours ? `\n${hoursHint(language)}` : null,
  ].filter((line) => line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function knownFieldsMessage(lead, language = 'fr') {
  const known = knownBookingValues(lead, language)
  const keys = BOOKING_FIELD_ORDER.filter((k) => known[k])
  if (!keys.length) return null
  const bullets = keys.map((k) => `• ${fieldLabel(k, language)} : ${known[k]}`)
  if (isDarija(language)) {
    return [
      'هاد المعلومات اللي عندي دابا:',
      '',
      ...bullets,
      '',
      'إلى كانت شي معلومة ماشي صحيحة، غير صححها ليا.',
    ].join('\n')
  }
  return [
    'Voici les informations que j’ai déjà :',
    '',
    ...bullets,
    '',
    'Si une information n’est pas correcte, vous pouvez simplement me la corriger.',
  ].join('\n')
}

function thankYouForFields(language, justFilled = []) {
  const fields = (justFilled || []).filter(Boolean)
  if (!fields.length) return null
  if (isDarija(language)) {
    if (fields.length === 1) {
      return `شكرا، سجّلت ${fieldLabel(fields[0], language)}.`
    }
    return 'شكرا، سجّلت المعلومات اللي صيفطيتي.'
  }
  if (fields.length === 1) {
    const fr = {
      full_name: 'votre nom',
      problem: 'le motif',
      phone_number: 'votre numéro de téléphone',
      city: 'votre ville',
      appointment: 'le jour et l’heure',
    }
    return `Merci, j’ai bien noté ${fr[fields[0]] || 'cette information'}.`
  }
  return 'Merci, j’ai bien noté ces informations.'
}

/**
 * Two WhatsApp messages when some fields are known and others are missing.
 * Otherwise a single message (never an empty known-fields summary).
 */
function buildBookingCollectionReplies(lead, language = 'fr', options = {}) {
  const missing = options.missing || checkCustomerData(lead || {}).missing
  const knownMsg = options.includeKnown === false ? null : knownFieldsMessage(lead, language)
  const hasKnown = Boolean(knownMsg)
  const rejectedName = Boolean(options.rejectedName)
  const nameHint = rejectedName ? fullNameRequiredMessage(language).trim() : null
  const thank = thankYouForFields(language, options.justFilled)
  const missingMsg = missing.length
    ? missingFieldsMessage(language, missing, {
      thankYou: thank,
      includeHours: Boolean(options.includeHours) || missing.includes('appointment'),
      intro: options.missingIntro || null,
    })
    : null

  const replies = []
  if (options.entry && hasKnown && missingMsg) {
    replies.push(knownMsg)
    replies.push(nameHint ? `${nameHint}\n\n${missingMsg}` : missingMsg)
    return replies
  }
  if (nameHint && missingMsg) {
    replies.push(`${nameHint}\n\n${missingMsg}`)
    return replies
  }
  if (missingMsg) {
    replies.push(missingMsg)
    return replies
  }
  return replies
}

/**
 * @param {string} [language]
 * @param {{ knownService?: string|null, skipProblem?: boolean, missing?: string[] }} [options]
 */
function bookingFormMessage(language = 'fr', options = {}) {
  const knownService = String(options.knownService || '').trim()
  const missing = options.missing || (
    options.skipProblem && isOfficialService(knownService)
      ? BOOKING_FIELD_ORDER.filter((f) => f !== 'problem')
      : BOOKING_FIELD_ORDER.slice()
  )
  const intro = knownService
    ? (isDarija(language)
      ? `يسعدني نعاونك تحجز موعد ل${serviceArabicLabel(knownService)}.`
      : `Avec plaisir, je vous aide à prendre rendez-vous pour : ${knownService}.`)
    : null
  return missingFieldsMessage(language, missing, {
    intro: intro
      ? `${intro}\n\n${isDarija(language)
        ? 'باش نكمل، صيفط ليا:'
        : 'Pour préparer votre rendez-vous, envoyez-moi :'}`
      : undefined,
    includeHours: true,
  })
}

/**
 * Patient sent only a first name — ask again for prénom + nom.
 */
function fullNameRequiredMessage(language = 'fr') {
  if (isDarija(language)) {
    return [
      'عافاك صيفط الاسم الكامل (الاسم الشخصي + الاسم العائلي)، ماشي الاسم بوحدو.',
      'مثال : هشام العلوي',
      '',
    ].join('\n')
  }
  return [
    'Merci d\'indiquer votre nom complet (prénom + nom de famille), pas seulement le prénom.',
    'Exemple : Hicham Alaoui',
    '',
  ].join('\n')
}

function incompleteBulkReminder(language = 'fr', missing = []) {
  return missingFieldsMessage(language, missing, { includeHours: (missing || []).includes('appointment') })
}

/**
 * Short reminder when the patient is already in booking mode but sends a voice note.
 */
function voiceUseTextReminder(language = 'fr', missing = []) {
  const fields = (missing || []).length ? missing : BOOKING_FIELD_ORDER.slice()
  const list = missingFieldsMessage(language, fields, {
    intro: isDarija(language)
      ? 'شكراً على الرسالة الصوتية. باش نكمل الحجز، عافاك صيفط المعلومات الناقصة برسالة نصية:'
      : 'Merci pour votre message vocal. Pour continuer la réservation, merci d’envoyer les informations demandées par message texte :',
    includeHours: false,
  })
  return list
}

function askMissingField(field, language = 'fr') {
  return incompleteBulkReminder(language, field ? [field] : [])
}

function askConfirmation(lead, language = 'fr') {
  const phone = formatPhoneDisplay(lead.phone_number) || lead.phone_number || '—'
  const date = formatDateDisplay(lead.appointment_date)
  const time = lead.appointment_time || '—'
  const complaint = motifDisplayValue(lead, language) || lead.problem_details || lead.problem || '—'
  const serviceLabel = lead.problem
    ? (isDarija(language) ? serviceArabicLabel(lead.problem) : lead.problem)
    : null
  const name = personDisplayName(lead, language)
  const { confirmationOuiNonFooter } = require('./booking-confirmation-flow')

  if (isDarija(language)) {
    return [
      '📋 *ملخص طلبكم:*',
      '',
      `الاسم: ${name}`,
      `الهاتف: ${phone}`,
      `المدينة: ${lead.city || '—'}`,
      `المشكل ديال السنان: ${complaint}`,
      serviceLabel && serviceLabel !== complaint ? `الخدمة المناسبة: ${serviceLabel}` : null,
      `التاريخ: ${date}`,
      `الساعة: ${time}`,
      '',
      confirmationOuiNonFooter(language),
    ].filter((line) => line !== null).join('\n')
  }

  return [
    '📋 *Récapitulatif de votre demande :*',
    '',
    `Nom: ${name}`,
    `Téléphone: ${phone}`,
    `Ville: ${lead.city || '—'}`,
    `Motif: ${complaint}`,
    serviceLabel && serviceLabel !== complaint ? `Service: ${serviceLabel}` : null,
    `Date: ${date}`,
    `Heure: ${time}`,
    '',
    confirmationOuiNonFooter(language),
  ].filter((line) => line !== null).join('\n')
}

function patientConfirmationMessage(lead, language = 'fr') {
  const name = personDisplayName(lead, language) || 'Patient'
  const date = formatDateDisplay(lead.appointment_date)
  const time = lead.appointment_time
  if (isDarija(language)) {
    return [
      '✅ تم تسجيل الموعد ديالك.',
      '',
      `الاسم : ${name}`,
      `التاريخ : ${date}`,
      `الساعة : ${time}`,
      '',
      'الحالة : في انتظار التأكيد',
      '',
      'غادي نصيفطولك ميساج واتساب قبل الموعد باش نأكد معاك.',
    ].join('\n')
  }
  return [
    '✅ Votre rendez-vous a bien été enregistré.',
    '',
    `Nom : ${name}`,
    `Date : ${date}`,
    `Heure : ${time}`,
    '',
    'Statut : À confirmer',
    '',
    'Nous vous enverrons un message WhatsApp de confirmation avant votre rendez-vous.',
  ].join('\n')
}

function staffNotificationText(booking) {
  const customer = booking.customer
  const appointment = booking.appointment
  const dentalCase = booking.dentalCase
  return [
    'Nouveau rendez-vous (À confirmer) :',
    '',
    `Client : ${customer.full_name}`,
    `Téléphone : ${formatPhoneDisplay(customer.phone_number)}`,
    `Ville : ${customer.city || '—'}`,
    `Problème : ${dentalCase.problem}`,
    `Date : ${appointment.appointment_date}`,
    `Heure : ${appointment.appointment_time}`,
    '',
    'Confirmation WhatsApp automatique 24 h avant. Intervention staff seulement si le patient ne répond pas.',
  ].join('\n')
}

function correctionAck(changedFields = [], language = 'fr') {
  const fields = Array.isArray(changedFields) ? changedFields : []
  const darija = isDarija(language)
  const mapAr = {
    full_name: 'تم تصحيح الاسم.',
    phone_number: 'تم تصحيح رقم الهاتف.',
    city: 'تم تصحيح المدينة.',
    problem: 'تم تصحيح المشكل ديال السنان.',
    appointment: 'تم تصحيح الموعد.',
  }
  const mapFr = {
    full_name: 'Le nom a été corrigé.',
    phone_number: 'Le numéro a été corrigé.',
    city: 'La ville a été corrigée.',
    problem: 'Le motif a été corrigé.',
    appointment: 'Le créneau a été corrigé.',
  }
  const map = darija ? mapAr : mapFr
  if (fields.length === 1 && map[fields[0]]) return map[fields[0]]
  if (fields.length > 1) {
    return darija ? 'تم تصحيح المعلومات.' : 'Les informations ont été corrigées.'
  }
  return darija ? 'تم التصحيح.' : 'Correction enregistrée.'
}

module.exports = {
  BOOKING_FIELD_ORDER,
  bookingFormMessage,
  askMissingField,
  incompleteBulkReminder,
  fullNameRequiredMessage,
  voiceUseTextReminder,
  knownFieldsMessage,
  missingFieldsMessage,
  buildBookingCollectionReplies,
  askConfirmation,
  patientConfirmationMessage,
  staffNotificationText,
  correctionAck,
  motifDisplayValue,
  personDisplayName,
  isDarija,
  formatDateDisplay,
  formatLongDateFr,
  formatLongDateDarija,
  formatLongDateLocalized,
  formatDateTimeLocalized,
}
