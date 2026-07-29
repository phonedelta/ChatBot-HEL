/**
 * Patient / staff message templates (French + Arabic script for Darija).
 */

const { formatPhoneDisplay } = require('./phone')

function isDarija(lang) {
  return ['darija', 'ar', 'arabic'].includes(String(lang || '').toLowerCase())
}

function bookingFormMessage(language = 'fr') {
  if (isDarija(language)) {
    return [
      'مرحبا 👋',
      '',
      'من أجل حجز موعد، المرجو إرسال المعلومات التالية في رسالة واحدة:',
      '',
      '• الاسم الكامل',
      '• رقم الهاتف',
      '• المدينة',
      '• المشكل ديال الأسنان',
      '• اليوم والساعة اللي كيناسبوك',
      '',
      'أوقات العمل:',
      '',
      'الإثنين حتى الجمعة',
      '10:30 ➜ 19:00',
      '',
      'السبت',
      '09:30 ➜ 13:00',
    ].join('\n')
  }

  return [
    'Bonjour 👋',
    '',
    'Afin de préparer votre rendez-vous, merci de m\'envoyer les informations suivantes dans un seul message :',
    '',
    '• Nom complet',
    '• Numéro de téléphone',
    '• Ville',
    '• Problème dentaire',
    '• Jour et heure souhaités',
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

function askMissingField(field, language = 'fr') {
  const darija = isDarija(language)
  const mapFr = {
    full_name: 'Merci.\n\nIl me manque uniquement votre nom complet (prénom et nom).',
    phone_number: 'Merci.\n\nIl me manque uniquement votre numéro de téléphone.\nExemple : 06XXXXXXXX ou +2126XXXXXXXX',
    city: 'Merci.\n\nIl me manque uniquement votre ville.',
    problem: 'Merci.\n\nIl me manque uniquement votre problème dentaire.',
    appointment: 'Merci.\n\nIl me manque uniquement le jour et l\'heure souhaités.\nExemple : 29/07 à 11h00',
  }
  const mapDarija = {
    full_name: 'شكراً.\n\nخاصني غير الاسم الكامل (الاسم الشخصي والعائلي).',
    phone_number: 'شكراً.\n\nخاصني غير رقم الهاتف.\nمثال : 06XXXXXXXX أو +2126XXXXXXXX',
    city: 'شكراً.\n\nخاصني غير المدينة.',
    problem: 'شكراً.\n\nخاصني غير المشكل ديال الأسنان.',
    appointment: 'شكراً.\n\nخاصني غير اليوم والساعة.\nمثال : 29/07 مع 11:00',
  }
  return (darija ? mapDarija : mapFr)[field] || mapFr.full_name
}

function askConfirmation(lead, language = 'fr') {
  const phone = formatPhoneDisplay(lead.phone_number) || lead.phone_number || '—'
  if (isDarija(language)) {
    return [
      '📋 ملخص طلب الموعد ديالك :',
      '',
      `الاسم : ${lead.full_name || '—'}`,
      `الهاتف : ${phone}`,
      `المدينة : ${lead.city || '—'}`,
      `المشكل (AI) : ${lead.problem || '—'}`,
      `رسالة الزبون : ${lead.problem_details || lead.problem || '—'}`,
      `التاريخ : ${lead.appointment_date || '—'}`,
      `الساعة : ${lead.appointment_time || '—'}`,
      '',
      'باش نأكد الطلب، أرسل فقط :',
      '',
      'نعم',
      '',
      'من بعد غادي يتصل بيك المركز بالتليفون.',
    ].join('\n')
  }

  return [
    '📋 Récapitulatif de votre demande :',
    '',
    `Nom : ${lead.full_name || '—'}`,
    `Téléphone : ${phone}`,
    `Ville : ${lead.city || '—'}`,
    `Motif (IA) : ${lead.problem || '—'}`,
    `Message client : ${lead.problem_details || lead.problem || '—'}`,
    `Date : ${lead.appointment_date || '—'}`,
    `Heure : ${lead.appointment_time || '—'}`,
    '',
    'Pour valider, répondez uniquement par :',
    '',
    'OUI',
    '',
    'Le centre vous appellera ensuite pour confirmer définitivement.',
  ].join('\n')
}

function patientConfirmationMessage(lead, language = 'fr') {
  const name = lead.full_name || 'Patient'
  const date = lead.appointment_date
  const time = lead.appointment_time
  if (isDarija(language)) {
    return [
      '✅ تم تسجيل طلب الموعد ديالك.',
      '',
      `الاسم : ${name}`,
      `التاريخ : ${date}`,
      `الساعة : ${time}`,
      '',
      'الحالة : غير مؤكد',
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
    'Statut : Non confirmé',
    '',
    'Le Centre Dentaire HEL vous appellera par téléphone pour confirmer définitivement le rendez-vous.',
  ].join('\n')
}

function staffNotificationText(booking) {
  const customer = booking.customer
  const appointment = booking.appointment
  const dentalCase = booking.dentalCase
  return [
    'Nouvelle commande RDV (Non confirmé) :',
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
  askConfirmation,
  patientConfirmationMessage,
  staffNotificationText,
  isDarija,
}
