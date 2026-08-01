/**
 * Patient / staff message templates (French + Arabic script for Darija).
 * Booking form + summary must stay exact (single-message collection UX).
 */

const { formatPhoneDisplay } = require('./phone')
const { serviceArabicLabel } = require('../voice-nlu/intent-table')

function isDarija(lang) {
  return ['darija', 'ar', 'arabic'].includes(String(lang || '').toLowerCase())
}

function formatDateDisplay(value) {
  const raw = String(value || '').trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return raw || '—'
}

/**
 * @param {string} [language]
 * @param {{ knownService?: string|null, skipProblem?: boolean }} [options]
 */
function bookingFormMessage(language = 'fr', options = {}) {
  const knownService = String(options.knownService || '').trim()
  // Field order is fixed — Problème is always requested in the form.
  const fieldsFr = [
    '• Nom et prénom (nom complet)',
    '• Problème',
    '• Numéro de téléphone',
    '• Ville',
    '• Jour et heure souhaités',
  ]
  const fieldsAr = [
    '• الاسم الكامل (الاسم الشخصي + الاسم العائلي)',
    '• المشكل ديال الأسنان',
    '• رقم الهاتف',
    '• المدينة',
    '• اليوم والساعة اللي كيناسبوك',
  ]

  if (isDarija(language)) {
    const intro = knownService
      ? [
        `يسعدني مساعدتك في حجز موعد ل${serviceArabicLabel(knownService)}.`,
        '',
        'من فضلك أرسل المعلومات التالية في رسالة واحدة:',
      ]
      : [
        'مرحبا 👋',
        '',
        'من أجل حجز موعد، المرجو إرسال المعلومات التالية في رسالة واحدة:',
      ]

    return [
      ...intro,
      '',
      ...fieldsAr,
      '',
      'أوقات العمل:',
      '',
      'الإثنين حتى الجمعة',
      '10:30 -> 19:00',
      '',
      'السبت',
      '09:30 -> 13:00',
    ].join('\n')
  }

  const intro = knownService
    ? [
      `Avec plaisir, je vous aide à prendre rendez-vous pour : ${knownService}.`,
      '',
      'Merci d\'envoyer les informations suivantes dans un seul message :',
    ]
    : [
      'Bonjour 👋',
      '',
      'Afin de préparer votre rendez-vous, merci de m\'envoyer les informations suivantes dans un seul message :',
    ]

  return [
    ...intro,
    '',
    ...fieldsFr,
    '',
    'Nos horaires :',
    '',
    'Lundi → Vendredi',
    '10h30 → 19h00',
    '',
    'Samedi',
    '09h30 → 13h00',
  ].join('\n')
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

/**
 * Reminder when the patient reply was incomplete — always ask again for ONE full message.
 * (We never collect fields one-by-one.)
 */
function incompleteBulkReminder(language = 'fr', missing = []) {
  const labelsFr = {
    full_name: 'nom et prénom (nom complet)',
    phone_number: 'numéro de téléphone',
    city: 'ville',
    problem: 'problème dentaire',
    appointment: 'jour et heure',
  }
  const labelsAr = {
    full_name: 'الاسم الكامل (الاسم الشخصي + الاسم العائلي)',
    phone_number: 'رقم الهاتف',
    city: 'المدينة',
    problem: 'المشكل ديال الأسنان',
    appointment: 'اليوم والساعة',
  }
  if (isDarija(language)) {
    const list = (missing || []).map((f) => labelsAr[f] || f).filter(Boolean)
    return [
      'شكراً.',
      '',
      'خاصني كامل المعلومات فـ رسالة واحدة (ماشي رسالة برسالة، وماشي بصوت).',
      list.length ? `ناقص دابا : ${list.join('، ')}.` : null,
      '',
    ].filter((line) => line !== null).join('\n')
  }
  const list = (missing || []).map((f) => labelsFr[f] || f).filter(Boolean)
  return [
    'Merci.',
    '',
    'J\'ai besoin de toutes les informations dans un seul message texte (pas message par message, pas en vocal).',
    list.length ? `Il manque encore : ${list.join(', ')}.` : null,
    '',
  ].filter((line) => line !== null).join('\n')
}

/**
 * Short reminder when the patient is already in booking mode but sends a voice note.
 * Do NOT dump the full form again for every vocal.
 */
function voiceUseTextReminder(language = 'fr') {
  if (isDarija(language)) {
    return 'شكراً على الرسالة الصوتية. باش نحجز الموعد، عافاك صيفط المعلومات كاملة فـ رسالة نصية وحدة (ماشي بصوت).'
  }
  return 'Merci pour votre message vocal. Pour réserver le rendez-vous, merci d\'envoyer toutes les informations dans un seul message texte (pas en vocal).'
}

/** @deprecated kept for compatibility — always prefer incompleteBulkReminder + full form */
function askMissingField(field, language = 'fr') {
  return incompleteBulkReminder(language, field ? [field] : [])
}

function askConfirmation(lead, language = 'fr') {
  const phone = formatPhoneDisplay(lead.phone_number) || lead.phone_number || '—'
  const date = formatDateDisplay(lead.appointment_date)
  const time = lead.appointment_time || '—'
  const reason = lead.problem || '—'
  const clientMsg = lead.problem_details || lead.problem || '—'

  if (isDarija(language)) {
    return [
      '📋 *ملخص طلبكم:*',
      '',
      `الاسم: ${lead.full_name || '—'}`,
      `الهاتف: ${phone}`,
      `المدينة: ${lead.city || '—'}`,
      `سبب الموعد: ${reason}`,
      `رسالة الزبون: ${clientMsg}`,
      `التاريخ: ${date}`,
      `الساعة: ${time}`,
      '',
      'للمصادقة، المرجو الرد فقط بـ:',
      '',
      '*OUI*',
      '',
      'بعد ذلك، سيتصل بكم المركز لتأكيد الموعد نهائياً.',
    ].join('\n')
  }

  return [
    '📋 *Récapitulatif de votre demande :*',
    '',
    `Nom: ${lead.full_name || '—'}`,
    `Téléphone: ${phone}`,
    `Ville: ${lead.city || '—'}`,
    `Motif: ${reason}`,
    `Message client: ${clientMsg}`,
    `Date: ${date}`,
    `Heure: ${time}`,
    '',
    'Pour valider, merci de répondre uniquement par :',
    '',
    '*OUI*',
    '',
    'Ensuite, le centre vous appellera pour confirmer définitivement le rendez-vous.',
  ].join('\n')
}

function patientConfirmationMessage(lead, language = 'fr') {
  const name = lead.full_name || 'Patient'
  const date = formatDateDisplay(lead.appointment_date)
  const time = lead.appointment_time
  if (isDarija(language)) {
    return [
      '✅ تم تسجيل طلب الموعد ديالك.',
      '',
      `الاسم : ${name}`,
      `التاريخ : ${date}`,
      `الساعة : ${time}`,
      '',
      'الحالة : في الانتظار',
      '',
      'غادي يتصل بيك مركز HEL بالتليفون باش يؤكد الموعد.',
    ].join('\n')
  }
  return [
    '✅ Votre demande de rendez-vous est enregistrée.',
    '',
    `Nom : ${name}`,
    `Date : ${date}`,
    `Heure : ${time}`,
    '',
    'Statut : En attente',
    '',
    'Le Centre Dentaire HEL vous appellera par téléphone pour confirmer définitivement le rendez-vous.',
  ].join('\n')
}

function staffNotificationText(booking) {
  const customer = booking.customer
  const appointment = booking.appointment
  const dentalCase = booking.dentalCase
  return [
    'Nouvelle commande RDV (En attente) :',
    '',
    `Client : ${customer.full_name}`,
    `Téléphone : ${formatPhoneDisplay(customer.phone_number)}`,
    `Ville : ${customer.city || '—'}`,
    `Problème : ${dentalCase.problem}`,
    `Date : ${appointment.appointment_date}`,
    `Heure : ${appointment.appointment_time}`,
    '',
    'Action : appeler le patient pour confirmer, puis passer le statut à « Confirmé » dans le dashboard.',
  ].join('\n')
}

module.exports = {
  bookingFormMessage,
  askMissingField,
  incompleteBulkReminder,
  fullNameRequiredMessage,
  voiceUseTextReminder,
  askConfirmation,
  patientConfirmationMessage,
  staffNotificationText,
  isDarija,
  formatDateDisplay,
}
