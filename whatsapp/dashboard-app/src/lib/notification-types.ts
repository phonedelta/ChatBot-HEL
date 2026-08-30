import type { NotificationsSettings } from '@/lib/cabinet-settings'

export type DashNotification = {
  id: number
  type: string
  type_label?: string
  title: string
  body?: string | null
  link_path?: string | null
  slot_date?: string | null
  slot_time?: string | null
  is_read?: boolean
  read_at?: string | null
  created_at: string
  slot_available?: boolean | null
  source_event?: string | null
}

/** Maps bell notification types → settings key (when applicable). */
export const NOTIFICATION_TYPE_SETTINGS_KEY: Partial<
  Record<string, keyof NotificationsSettings>
> = {
  slot_released: 'slotReleased',
  slot_available_after_cancellation: 'slotReleased',
  new_message: 'newPatientMessage',
  patient_message: 'newPatientMessage',
  handoff_to_human: 'handoff',
  handoff: 'handoff',
  conversation_handoff: 'handoff',
  appointment_cancelled: 'appointmentCancelled',
  confirmation_call: 'appointmentUnconfirmed',
  confirmation_sent: 'appointmentUnconfirmed',
  no_response: 'patientNoResponse',
  patient_no_response: 'patientNoResponse',
  whatsapp_error: 'whatsappError',
  wa_error: 'whatsappError',
  automation_failure: 'automationFailure',
  automation_error: 'automationFailure',
}

export type NotificationAlertPreferences = NotificationsSettings & {
  soundEnabled?: boolean
}

export function parseNotificationTimestamp(iso: string): number {
  const raw = String(iso || '').trim()
  if (!raw) return NaN
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const hasTz = /Z|[+-]\d{2}:\d{2}$/.test(normalized)
  const t = new Date(hasTz ? normalized : `${normalized}Z`).getTime()
  if (Number.isFinite(t)) return t
  return new Date(normalized).getTime()
}

export function isRecentNotification(iso: string, maxAgeMs = 15_000): boolean {
  const t = parseNotificationTimestamp(iso)
  if (!Number.isFinite(t)) return false
  return Date.now() - t <= maxAgeMs
}

export function shouldPlaySoundForNotification(
  notification: DashNotification,
  prefs: NotificationAlertPreferences,
): boolean {
  if (prefs.soundEnabled === false) return false
  const key = NOTIFICATION_TYPE_SETTINGS_KEY[notification.type]
  if (!key) return true
  return prefs[key] !== false
}
