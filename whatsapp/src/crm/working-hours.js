/**
 * Clinic opening hours — Centre Dentaire HEL
 *
 * Lun–Ven : 10:30 → 19:00
 * Samedi  : 09:30 → 13:00 (fermé à partir de 13:00)
 * Dimanche : fermé
 */

const DAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

/** @type {Record<number, { open: string, close: string }|null>} */
const WEEKLY_HOURS = {
  0: null, // Sunday closed
  1: { open: '10:30', close: '19:00' },
  2: { open: '10:30', close: '19:00' },
  3: { open: '10:30', close: '19:00' },
  4: { open: '10:30', close: '19:00' },
  5: { open: '10:30', close: '19:00' },
  6: { open: '09:30', close: '13:00' }, // Saturday — close exclusive (13:00+ blocked)
}

/**
 * @param {string} hhmm
 * @returns {number|null} minutes from midnight
 */
function toMinutes(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Calendar weekday for YYYY-MM-DD (independent of server timezone).
 * @param {string} isoDate
 * @returns {number|null} 0=Sunday … 6=Saturday
 */
function weekdayFromIsoDate(isoDate) {
  const m = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

/**
 * @param {string|null|undefined} appointmentDate ISO YYYY-MM-DD
 * @param {string|null|undefined} appointmentTime HH:mm
 * @returns {{
 *   ok: boolean,
 *   reason: 'missing'|'invalid_date'|'invalid_time'|'closed_day'|'outside_hours'|null,
 *   weekday: number|null,
 *   dayNameFr: string|null,
 *   dayNameAr: string|null,
 *   open: string|null,
 *   close: string|null,
 * }}
 */
function validateAppointmentHours(appointmentDate, appointmentTime) {
  const date = String(appointmentDate || '').trim()
  const time = String(appointmentTime || '').trim()
  if (!date || !time) {
    return {
      ok: false,
      reason: 'missing',
      weekday: null,
      dayNameFr: null,
      dayNameAr: null,
      open: null,
      close: null,
    }
  }

  const weekday = weekdayFromIsoDate(date)
  if (weekday === null) {
    return {
      ok: false,
      reason: 'invalid_date',
      weekday: null,
      dayNameFr: null,
      dayNameAr: null,
      open: null,
      close: null,
    }
  }

  const minutes = toMinutes(time)
  if (minutes === null) {
    return {
      ok: false,
      reason: 'invalid_time',
      weekday,
      dayNameFr: DAY_NAMES_FR[weekday],
      dayNameAr: DAY_NAMES_AR[weekday],
      open: null,
      close: null,
    }
  }

  const slot = WEEKLY_HOURS[weekday]
  const dayNameFr = DAY_NAMES_FR[weekday]
  const dayNameAr = DAY_NAMES_AR[weekday]

  if (!slot) {
    return {
      ok: false,
      reason: 'closed_day',
      weekday,
      dayNameFr,
      dayNameAr,
      open: null,
      close: null,
    }
  }

  const openMin = toMinutes(slot.open)
  const closeMin = toMinutes(slot.close)
  // Inclusive open, exclusive close → Saturday 13:00 and after blocked
  if (minutes < openMin || minutes >= closeMin) {
    return {
      ok: false,
      reason: 'outside_hours',
      weekday,
      dayNameFr,
      dayNameAr,
      open: slot.open,
      close: slot.close,
    }
  }

  return {
    ok: true,
    reason: null,
    weekday,
    dayNameFr,
    dayNameAr,
    open: slot.open,
    close: slot.close,
  }
}

/**
 * Human-readable error for the patient (FR or Darija Arabic script).
 * @param {string} [language]
 * @param {ReturnType<typeof validateAppointmentHours>} [result]
 */
function outsideWorkingHoursMessage(language = 'fr', result = null) {
  const isAr = ['darija', 'ar', 'arabic'].includes(String(language || '').toLowerCase())
  const hoursBlockFr = [
    'Horaires d\'ouverture :',
    '• Lundi → Vendredi : 10:30 → 19:00',
    '• Samedi : 09:30 → 13:00',
    '• Dimanche : fermé',
  ]
  const hoursBlockAr = [
    'أوقات العمل :',
    '• الإثنين حتى الجمعة : 10:30 → 19:00',
    '• السبت : 09:30 → 13:00',
    '• الأحد : مغلق',
  ]

  if (isAr) {
    if (result?.reason === 'closed_day') {
      return [
        `عذراً، العيادة مغلقة نهار ${result.dayNameAr || 'الأحد'}.`,
        'عافاك اختار يوم وساعة داخل أوقات العمل.',
        '',
        ...hoursBlockAr,
      ].join('\n')
    }
    if (result?.reason === 'outside_hours' && result.weekday === 6) {
      return [
        'عذراً، نهار السبت كنخدمو غير حتى لـ 13:00.',
        'ما يمكنش نحجزو موعد من 13:00 وفما بعد.',
        'عافاك اختار ساعة بين 09:30 و 12:59، ولا يوم آخر.',
        '',
        ...hoursBlockAr,
      ].join('\n')
    }
    return [
      'عذراً، الساعة اللي اختاريتي خارج أوقات العمل.',
      'عافاك صيفط يوم وساعة داخل الأوقات التالية :',
      '',
      ...hoursBlockAr,
    ].join('\n')
  }

  if (result?.reason === 'closed_day') {
    return [
      `Désolé, le cabinet est fermé le ${result.dayNameFr || 'dimanche'}.`,
      'Merci de choisir un jour et une heure pendant nos horaires d\'ouverture.',
      '',
      ...hoursBlockFr,
    ].join('\n')
  }
  if (result?.reason === 'outside_hours' && result.weekday === 6) {
    return [
      'Désolé, le samedi nous sommes ouverts uniquement jusqu\'à 13:00.',
      'Aucun rendez-vous n\'est possible à partir de 13:00.',
      'Merci de choisir une heure entre 09:30 et 12:59, ou un autre jour.',
      '',
      ...hoursBlockFr,
    ].join('\n')
  }
  return [
    'Désolé, l\'horaire demandé est en dehors de nos heures d\'ouverture.',
    'Merci de renvoyer un jour et une heure pendant les créneaux suivants :',
    '',
    ...hoursBlockFr,
  ].join('\n')
}

/**
 * Short error for the admin dashboard API.
 * @param {ReturnType<typeof validateAppointmentHours>} result
 */
function outsideWorkingHoursError(result) {
  if (result?.reason === 'closed_day') {
    return `Le cabinet est fermé le ${result.dayNameFr || 'dimanche'}.`
  }
  if (result?.reason === 'outside_hours' && result.weekday === 6) {
    return 'Le samedi, les rendez-vous ne sont possibles qu\'entre 09:30 et 13:00 (non inclus).'
  }
  if (result?.reason === 'outside_hours') {
    return `Horaire hors ouverture (${result.open} → ${result.close}).`
  }
  return 'Date ou heure de rendez-vous invalide / hors horaires.'
}

module.exports = {
  WEEKLY_HOURS,
  DAY_NAMES_FR,
  DAY_NAMES_AR,
  validateAppointmentHours,
  outsideWorkingHoursMessage,
  outsideWorkingHoursError,
  weekdayFromIsoDate,
  toMinutes,
}
