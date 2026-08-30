import { api } from '@/lib/api'

export type AppointmentsSettings = {
  slotDurationMinutes: number
  minBookingLeadMinutes: number
  bookingHorizonDays: number
  allowSameDayBooking: boolean
  minCancelLeadMinutes: number
  minRescheduleLeadMinutes: number
  proposalValidityMinutes: number
  maxAutoProposalsPerPatient: number
  waitlistEnabled: boolean
}

export type RemindersSettings = {
  confirmationEnabled: boolean
  confirmationHoursBefore: number
  firstReminderEnabled: boolean
  firstReminderHoursAfter: number
  secondReminderEnabled: boolean
  secondReminderHoursAfter: number
  dayOfReminderEnabled: boolean
  dayOfReminderHoursBefore: number
  sendWindowStart: string
  sendWindowEnd: string
}

export type AutomationsSettings = {
  masterEnabled: boolean
  confirmationEnabled: boolean
  followupsEnabled: boolean
  slotReleasedDetectionEnabled: boolean
  autoSlotProposalEnabled: boolean
  waitlistAutoEnabled: boolean
  appointmentRemindersEnabled: boolean
  autoReleaseSlotOnCancel: boolean
}

export type SecuritySettings = {
  sessionDurationHours: number
  idleLogoutEnabled: boolean
  idleTimeoutMinutes: number
}

export type NotificationsSettings = {
  soundEnabled: boolean
  newPatientMessage: boolean
  patientNoResponse: boolean
  appointmentCancelled: boolean
  appointmentUnconfirmed: boolean
  slotReleased: boolean
  handoff: boolean
  whatsappError: boolean
  automationFailure: boolean
}

async function fetchSettings<T>(path: string) {
  const res = await api<{ ok: boolean; settings: T }>(path)
  return res.settings
}

async function saveSettings<T>(path: string, body: Partial<T>) {
  const res = await api<{ ok: boolean; settings: T }>(path, { method: 'PUT', body })
  return res.settings
}

export const cabinetSettingsApi = {
  getAppointments: () => fetchSettings<AppointmentsSettings>('/dashboard/api/settings/appointments'),
  saveAppointments: (body: Partial<AppointmentsSettings>) =>
    saveSettings('/dashboard/api/settings/appointments', body),
  getReminders: () => fetchSettings<RemindersSettings>('/dashboard/api/settings/reminders'),
  saveReminders: (body: Partial<RemindersSettings>) =>
    saveSettings('/dashboard/api/settings/reminders', body),
  getAutomations: () => fetchSettings<AutomationsSettings>('/dashboard/api/settings/automations'),
  saveAutomations: (body: Partial<AutomationsSettings>) =>
    saveSettings('/dashboard/api/settings/automations', body),
  getSecurity: () => fetchSettings<SecuritySettings>('/dashboard/api/settings/security'),
  saveSecurity: (body: Partial<SecuritySettings>) =>
    saveSettings('/dashboard/api/settings/security', body),
  getNotifications: () => fetchSettings<NotificationsSettings>('/dashboard/api/settings/notifications'),
  saveNotifications: (body: Partial<NotificationsSettings>) =>
    saveSettings('/dashboard/api/settings/notifications', body),
}
