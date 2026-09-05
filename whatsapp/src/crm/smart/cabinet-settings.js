/**
 * Cabinet business settings — persisted in clinic_settings, validated, cached.
 */

const ALLOWED_SLOT_DURATIONS = [15, 20, 30, 45, 60, 90]
const ALLOWED_BOOKING_LEAD = [0, 60, 120, 240, 720, 1440]
const ALLOWED_HORIZON_DAYS = [7, 14, 30, 60, 90]
const ALLOWED_CANCEL_LEAD = [0, 60, 120, 240, 720, 1440]
const ALLOWED_PROPOSAL_VALIDITY = [10, 15, 30, 60, 120, 240]
const ALLOWED_MAX_PROPOSALS = [1, 2, 3, 5]
const ALLOWED_CONFIRMATION_HOURS = [12, 24, 48, 72]
const ALLOWED_REMINDER_HOURS = [2, 4, 6, 12, 24, 36]
const ALLOWED_DAY_REMINDER_HOURS = [1, 2, 3, 4]
const ALLOWED_SESSION_HOURS = [8, 12, 24, 72, 168, 336, 720]
const ALLOWED_IDLE_MINUTES = [15, 30, 60, 120, 240]

const DEFAULT_APPOINTMENTS = {
  slotDurationMinutes: 30,
  minBookingLeadMinutes: 0,
  bookingHorizonDays: 30,
  allowSameDayBooking: true,
  minCancelLeadMinutes: 0,
  minRescheduleLeadMinutes: 0,
  proposalValidityMinutes: 60,
  maxAutoProposalsPerPatient: 3,
  waitlistEnabled: true,
}

const DEFAULT_REMINDERS = {
  confirmationEnabled: true,
  confirmationHoursBefore: 24,
  firstReminderEnabled: true,
  firstReminderHoursAfter: 4,
  secondReminderEnabled: true,
  secondReminderHoursAfter: 24,
  dayOfReminderEnabled: false,
  dayOfReminderHoursBefore: 2,
  sendWindowStart: '08:00',
  sendWindowEnd: '20:00',
}

const DEFAULT_AUTOMATIONS = {
  masterEnabled: true,
  confirmationEnabled: true,
  followupsEnabled: true,
  slotReleasedDetectionEnabled: true,
  autoSlotProposalEnabled: false,
  waitlistAutoEnabled: true,
  appointmentRemindersEnabled: true,
  autoReleaseSlotOnCancel: true,
}

const DEFAULT_SECURITY = {
  sessionDurationHours: 12,
  idleLogoutEnabled: false,
  idleTimeoutMinutes: 30,
}

const DEFAULT_NOTIFICATIONS = {
  soundEnabled: true,
  newPatientMessage: true,
  patientNoResponse: true,
  appointmentCreated: true,
  appointmentCancelled: true,
  appointmentUnconfirmed: true,
  slotReleased: true,
  handoff: true,
  whatsappError: true,
  automationFailure: true,
}

const NOTIFICATION_TYPE_MAP = {
  new_message: 'newPatientMessage',
  patient_message: 'newPatientMessage',
  handoff_to_human: 'handoff',
  handoff: 'handoff',
  conversation_handoff: 'handoff',
  appointment_created: 'appointmentCreated',
  new_appointment: 'appointmentCreated',
  appointment_cancelled: 'appointmentCancelled',
  slot_released: 'slotReleased',
  slot_available_after_cancellation: 'slotReleased',
  confirmation_call: 'appointmentUnconfirmed',
  confirmation_sent: 'appointmentUnconfirmed',
  no_response: 'patientNoResponse',
  patient_no_response: 'patientNoResponse',
  whatsapp_error: 'whatsappError',
  wa_error: 'whatsappError',
  automation_failure: 'automationFailure',
  automation_error: 'automationFailure',
}

let cache = null
let cacheAt = 0
const CACHE_MS = 5000

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function pickEnum(value, allowed, fallback) {
  const n = Number(value)
  return allowed.includes(n) ? n : fallback
}

function pickBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function pickTime(value, fallback) {
  const s = String(value || '').trim()
  if (/^\d{2}:\d{2}$/.test(s)) return s
  return fallback
}

function mergeDefaults(current, defaults) {
  return { ...defaults, ...(current && typeof current === 'object' ? current : {}) }
}

function validateAppointments(raw = {}) {
  return {
    slotDurationMinutes: pickEnum(raw.slotDurationMinutes, ALLOWED_SLOT_DURATIONS, DEFAULT_APPOINTMENTS.slotDurationMinutes),
    minBookingLeadMinutes: pickEnum(raw.minBookingLeadMinutes, ALLOWED_BOOKING_LEAD, DEFAULT_APPOINTMENTS.minBookingLeadMinutes),
    bookingHorizonDays: pickEnum(raw.bookingHorizonDays, ALLOWED_HORIZON_DAYS, DEFAULT_APPOINTMENTS.bookingHorizonDays),
    allowSameDayBooking: pickBool(raw.allowSameDayBooking, DEFAULT_APPOINTMENTS.allowSameDayBooking),
    minCancelLeadMinutes: pickEnum(raw.minCancelLeadMinutes, ALLOWED_CANCEL_LEAD, DEFAULT_APPOINTMENTS.minCancelLeadMinutes),
    minRescheduleLeadMinutes: pickEnum(raw.minRescheduleLeadMinutes, ALLOWED_CANCEL_LEAD, DEFAULT_APPOINTMENTS.minRescheduleLeadMinutes),
    proposalValidityMinutes: pickEnum(raw.proposalValidityMinutes, ALLOWED_PROPOSAL_VALIDITY, DEFAULT_APPOINTMENTS.proposalValidityMinutes),
    maxAutoProposalsPerPatient: pickEnum(raw.maxAutoProposalsPerPatient, ALLOWED_MAX_PROPOSALS, DEFAULT_APPOINTMENTS.maxAutoProposalsPerPatient),
    waitlistEnabled: pickBool(raw.waitlistEnabled, DEFAULT_APPOINTMENTS.waitlistEnabled),
  }
}

function validateReminders(raw = {}) {
  return {
    confirmationEnabled: pickBool(raw.confirmationEnabled, DEFAULT_REMINDERS.confirmationEnabled),
    confirmationHoursBefore: pickEnum(raw.confirmationHoursBefore, ALLOWED_CONFIRMATION_HOURS, DEFAULT_REMINDERS.confirmationHoursBefore),
    firstReminderEnabled: pickBool(raw.firstReminderEnabled, DEFAULT_REMINDERS.firstReminderEnabled),
    firstReminderHoursAfter: pickEnum(raw.firstReminderHoursAfter, ALLOWED_REMINDER_HOURS, DEFAULT_REMINDERS.firstReminderHoursAfter),
    secondReminderEnabled: pickBool(raw.secondReminderEnabled, DEFAULT_REMINDERS.secondReminderEnabled),
    secondReminderHoursAfter: pickEnum(raw.secondReminderHoursAfter, ALLOWED_REMINDER_HOURS, DEFAULT_REMINDERS.secondReminderHoursAfter),
    dayOfReminderEnabled: pickBool(raw.dayOfReminderEnabled, DEFAULT_REMINDERS.dayOfReminderEnabled),
    dayOfReminderHoursBefore: pickEnum(raw.dayOfReminderHoursBefore, ALLOWED_DAY_REMINDER_HOURS, DEFAULT_REMINDERS.dayOfReminderHoursBefore),
    sendWindowStart: pickTime(raw.sendWindowStart, DEFAULT_REMINDERS.sendWindowStart),
    sendWindowEnd: pickTime(raw.sendWindowEnd, DEFAULT_REMINDERS.sendWindowEnd),
  }
}

function validateAutomations(raw = {}) {
  return {
    masterEnabled: pickBool(raw.masterEnabled, DEFAULT_AUTOMATIONS.masterEnabled),
    confirmationEnabled: pickBool(raw.confirmationEnabled, DEFAULT_AUTOMATIONS.confirmationEnabled),
    followupsEnabled: pickBool(raw.followupsEnabled, DEFAULT_AUTOMATIONS.followupsEnabled),
    slotReleasedDetectionEnabled: pickBool(raw.slotReleasedDetectionEnabled, DEFAULT_AUTOMATIONS.slotReleasedDetectionEnabled),
    autoSlotProposalEnabled: pickBool(raw.autoSlotProposalEnabled, DEFAULT_AUTOMATIONS.autoSlotProposalEnabled),
    waitlistAutoEnabled: pickBool(raw.waitlistAutoEnabled, DEFAULT_AUTOMATIONS.waitlistAutoEnabled),
    appointmentRemindersEnabled: pickBool(raw.appointmentRemindersEnabled, DEFAULT_AUTOMATIONS.appointmentRemindersEnabled),
    autoReleaseSlotOnCancel: pickBool(raw.autoReleaseSlotOnCancel, DEFAULT_AUTOMATIONS.autoReleaseSlotOnCancel),
  }
}

function validateSecurity(raw = {}) {
  const sessionDurationHours = pickEnum(raw.sessionDurationHours, ALLOWED_SESSION_HOURS, DEFAULT_SECURITY.sessionDurationHours)
  const idleLogoutEnabled = pickBool(raw.idleLogoutEnabled, DEFAULT_SECURITY.idleLogoutEnabled)
  return {
    sessionDurationHours,
    idleLogoutEnabled,
    idleTimeoutMinutes: pickEnum(raw.idleTimeoutMinutes, ALLOWED_IDLE_MINUTES, DEFAULT_SECURITY.idleTimeoutMinutes),
  }
}

function validateNotifications(raw = {}) {
  return {
    soundEnabled: pickBool(raw.soundEnabled, DEFAULT_NOTIFICATIONS.soundEnabled),
    newPatientMessage: pickBool(raw.newPatientMessage, DEFAULT_NOTIFICATIONS.newPatientMessage),
    patientNoResponse: pickBool(raw.patientNoResponse, DEFAULT_NOTIFICATIONS.patientNoResponse),
    appointmentCreated: pickBool(raw.appointmentCreated, DEFAULT_NOTIFICATIONS.appointmentCreated),
    appointmentCancelled: pickBool(raw.appointmentCancelled, DEFAULT_NOTIFICATIONS.appointmentCancelled),
    appointmentUnconfirmed: pickBool(raw.appointmentUnconfirmed, DEFAULT_NOTIFICATIONS.appointmentUnconfirmed),
    slotReleased: pickBool(raw.slotReleased, DEFAULT_NOTIFICATIONS.slotReleased),
    handoff: pickBool(raw.handoff, DEFAULT_NOTIFICATIONS.handoff),
    whatsappError: pickBool(raw.whatsappError, DEFAULT_NOTIFICATIONS.whatsappError),
    automationFailure: pickBool(raw.automationFailure, DEFAULT_NOTIFICATIONS.automationFailure),
  }
}

function timeToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function isWithinSendWindow(now = new Date(), reminders) {
  const start = timeToMinutes(reminders.sendWindowStart)
  const end = timeToMinutes(reminders.sendWindowEnd)
  if (start == null || end == null) return true
  const mins = now.getHours() * 60 + now.getMinutes()
  if (start <= end) return mins >= start && mins < end
  return mins >= start || mins < end
}

function nextAllowedSendTime(now = new Date(), reminders) {
  if (isWithinSendWindow(now, reminders)) return now
  const start = timeToMinutes(reminders.sendWindowStart) ?? 8 * 60
  const next = new Date(now)
  const mins = now.getHours() * 60 + now.getMinutes()
  const end = timeToMinutes(reminders.sendWindowEnd) ?? 20 * 60
  if (mins >= end) {
    next.setDate(next.getDate() + 1)
  }
  next.setHours(Math.floor(start / 60), start % 60, 0, 0)
  return next
}

function validateBookingDateTime(dateStr, timeStr, appointments, now = new Date()) {
  const appt = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appt)) {
    return { ok: false, reason: 'invalid_date' }
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const isSameDay = appt === today
  if (isSameDay && !appointments.allowSameDayBooking) {
    return { ok: false, reason: 'same_day_disabled' }
  }
  const apptDate = new Date(`${appt}T12:00:00`)
  const todayDate = new Date(`${today}T12:00:00`)
  const diffDays = Math.floor((apptDate.getTime() - todayDate.getTime()) / 86400000)
  if (diffDays > appointments.bookingHorizonDays) {
    return { ok: false, reason: 'horizon_exceeded' }
  }
  if (appointments.minBookingLeadMinutes > 0) {
    const time = String(timeStr || '12:00').slice(0, 5)
    const apptMs = new Date(`${appt}T${time}:00`).getTime()
    const minMs = now.getTime() + appointments.minBookingLeadMinutes * 60000
    if (!Number.isFinite(apptMs) || apptMs < minMs) {
      return { ok: false, reason: 'min_lead' }
    }
  }
  return { ok: true }
}

function minutesUntilAppointment(dateStr, timeStr, now = new Date()) {
  const d = String(dateStr || '').trim()
  const t = String(timeStr || '12:00').slice(0, 5)
  const dt = new Date(`${d}T${t}:00`)
  if (Number.isNaN(dt.getTime())) return null
  return Math.round((dt.getTime() - now.getTime()) / 60000)
}

function canCancelOrReschedule(dateStr, timeStr, leadMinutes, now = new Date()) {
  if (!leadMinutes) return { ok: true }
  const until = minutesUntilAppointment(dateStr, timeStr, now)
  if (until == null) return { ok: false, reason: 'invalid' }
  if (until < leadMinutes) return { ok: false, reason: 'too_late' }
  return { ok: true }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ activityHistory?: object, resolveActorFromOptions?: Function }} [deps]
 */
function createCabinetSettingsService(db, deps = {}) {
  const { activityHistory = null, resolveActorFromOptions = null } = deps

  function nowIso() {
    return new Date().toISOString()
  }

  function readKey(key, fallback) {
    const row = db.prepare('SELECT value_json FROM clinic_settings WHERE key = ?').get(key)
    if (!row) return fallback
    return parseJson(row.value_json, fallback)
  }

  function writeKey(key, value) {
    db.prepare(`
      INSERT INTO clinic_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), nowIso())
    invalidateCache()
    return value
  }

  function invalidateCache() {
    cache = null
    cacheAt = 0
  }

  function seedDefaultsIfMissing() {
    if (readKey('settings_appointments', null) == null) {
      writeKey('settings_appointments', DEFAULT_APPOINTMENTS)
    }
    if (readKey('settings_reminders', null) == null) {
      writeKey('settings_reminders', DEFAULT_REMINDERS)
    }
    if (readKey('settings_automations', null) == null) {
      writeKey('settings_automations', DEFAULT_AUTOMATIONS)
    }
    if (readKey('settings_security', null) == null) {
      writeKey('settings_security', DEFAULT_SECURITY)
    }
    if (readKey('settings_notifications', null) == null) {
      writeKey('settings_notifications', DEFAULT_NOTIFICATIONS)
    }
  }

  seedDefaultsIfMissing()

  function getAllCached() {
    const now = Date.now()
    if (cache && now - cacheAt < CACHE_MS) return cache
    cache = {
      appointments: validateAppointments(readKey('settings_appointments', DEFAULT_APPOINTMENTS)),
      reminders: validateReminders(readKey('settings_reminders', DEFAULT_REMINDERS)),
      automations: validateAutomations(readKey('settings_automations', DEFAULT_AUTOMATIONS)),
      security: validateSecurity(readKey('settings_security', DEFAULT_SECURITY)),
      notifications: validateNotifications(readKey('settings_notifications', DEFAULT_NOTIFICATIONS)),
    }
    cacheAt = now
    return cache
  }

  function getAppointmentsSettings() {
    return getAllCached().appointments
  }

  function getRemindersSettings() {
    return getAllCached().reminders
  }

  function getAutomationsSettings() {
    return getAllCached().automations
  }

  function getSecuritySettings() {
    return getAllCached().security
  }

  function getNotificationsSettings() {
    return getAllCached().notifications
  }

  function getSessionTtlMs() {
    const h = getSecuritySettings().sessionDurationHours
    return h * 60 * 60 * 1000
  }

  function isAutomationEnabled(key) {
    const a = getAutomationsSettings()
    if (!a.masterEnabled) return false
    const map = {
      confirmation: a.confirmationEnabled,
      followups: a.followupsEnabled,
      slot_released: a.slotReleasedDetectionEnabled,
      auto_slot_proposal: a.autoSlotProposalEnabled,
      waitlist: a.waitlistAutoEnabled,
      reminders: a.appointmentRemindersEnabled,
      auto_release: a.autoReleaseSlotOnCancel,
    }
    return map[key] !== false
  }

  function isNotificationEnabled(type) {
    const prefs = getNotificationsSettings()
    const key = NOTIFICATION_TYPE_MAP[String(type || '').toLowerCase()]
    if (!key) return true
    return prefs[key] !== false
  }

  function logSettingsChange(section, actor, description, details = null) {
    if (!activityHistory?.recordActivity) return
    try {
      activityHistory.recordActivity({
        event_type: 'settings_updated',
        category: 'settings',
        actor: actor || { type: 'human', displayName: 'Admin', role: 'admin' },
        source: 'dashboard',
        title: `Paramètres ${section} modifiés`,
        description,
        metadata: details || undefined,
      })
    } catch { /* ignore */ }
  }

  function updateAppointmentsSettings(patch = {}, options = {}) {
    const prev = getAppointmentsSettings()
    const next = validateAppointments({ ...prev, ...patch })
    writeKey('settings_appointments', next)
    const actor = resolveActorFromOptions?.(options)
    const changes = []
    if (prev.slotDurationMinutes !== next.slotDurationMinutes) {
      changes.push(`Durée créneau : ${prev.slotDurationMinutes} → ${next.slotDurationMinutes} min`)
    }
    logSettingsChange('rendez-vous', actor, changes.length ? changes.join(' · ') : 'Règles rendez-vous mises à jour', { section: 'appointments', prev, next })
    return next
  }

  function updateRemindersSettings(patch = {}, options = {}) {
    const prev = getRemindersSettings()
    const next = validateReminders({ ...prev, ...patch })
    writeKey('settings_reminders', next)
    const actor = resolveActorFromOptions?.(options)
    const changes = []
    if (prev.confirmationHoursBefore !== next.confirmationHoursBefore) {
      changes.push(`Confirmation : ${prev.confirmationHoursBefore}h → ${next.confirmationHoursBefore}h`)
    }
    logSettingsChange('confirmations & rappels', actor, changes.length ? changes.join(' · ') : 'Confirmations & rappels mis à jour', { section: 'reminders', prev, next })
    return next
  }

  function updateAutomationsSettings(patch = {}, options = {}) {
    const prev = getAutomationsSettings()
    const next = validateAutomations({ ...prev, ...patch })
    writeKey('settings_automations', next)
    const actor = resolveActorFromOptions?.(options)
    logSettingsChange('automatisations', actor, 'Automatisations mises à jour', { section: 'automations', prev, next })
    return next
  }

  function updateSecuritySettings(patch = {}, options = {}) {
    const prev = getSecuritySettings()
    const next = validateSecurity({ ...prev, ...patch })
    writeKey('settings_security', next)
    const actor = resolveActorFromOptions?.(options)
    const changes = []
    if (prev.sessionDurationHours !== next.sessionDurationHours) {
      changes.push(`Durée session : ${prev.sessionDurationHours}h → ${next.sessionDurationHours}h`)
    }
    logSettingsChange('sécurité & sessions', actor, changes.length ? changes.join(' · ') : 'Sécurité & sessions mis à jour', { section: 'security', prev, next })
    return next
  }

  function updateNotificationsSettings(patch = {}, options = {}) {
    const prev = getNotificationsSettings()
    const next = validateNotifications({ ...prev, ...patch })
    writeKey('settings_notifications', next)
    const actor = resolveActorFromOptions?.(options)
    logSettingsChange('notifications internes', actor, 'Notifications internes mises à jour', { section: 'notifications', prev, next })
    return next
  }

  function getCabinetSettingsBundle() {
    return getAllCached()
  }

  return {
    getAppointmentsSettings,
    getRemindersSettings,
    getAutomationsSettings,
    getSecuritySettings,
    getNotificationsSettings,
    getSessionTtlMs,
    getCabinetSettingsBundle,
    updateAppointmentsSettings,
    updateRemindersSettings,
    updateAutomationsSettings,
    updateSecuritySettings,
    updateNotificationsSettings,
    isAutomationEnabled,
    isNotificationEnabled,
    isWithinSendWindow,
    nextAllowedSendTime,
    validateBookingDateTime,
    canCancelOrReschedule,
    minutesUntilAppointment,
    invalidateCache,
    ALLOWED_SLOT_DURATIONS,
    ALLOWED_BOOKING_LEAD,
    ALLOWED_HORIZON_DAYS,
    ALLOWED_CANCEL_LEAD,
    ALLOWED_PROPOSAL_VALIDITY,
    ALLOWED_MAX_PROPOSALS,
    ALLOWED_CONFIRMATION_HOURS,
    ALLOWED_REMINDER_HOURS,
    ALLOWED_SESSION_HOURS,
    ALLOWED_IDLE_MINUTES,
  }
}

module.exports = {
  createCabinetSettingsService,
  validateBookingDateTime,
  DEFAULT_APPOINTMENTS,
  DEFAULT_REMINDERS,
  DEFAULT_AUTOMATIONS,
  DEFAULT_SECURITY,
  DEFAULT_NOTIFICATIONS,
}
