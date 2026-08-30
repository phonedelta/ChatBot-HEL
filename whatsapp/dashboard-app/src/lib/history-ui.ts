import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  BookOpen,
  Bot,
  Calendar,
  CalendarX,
  CircleCheck,
  Clock3,
  Hand,
  Languages,
  MessageCircle,
  Settings,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import { appointmentStatusLabel, languageLabel } from '@/lib/labels'

export function historyCategoryIcon(category: string, eventType?: string): LucideIcon {
  const et = String(eventType || '')
  if (et.includes('cancel') || et.includes('CANCEL')) return CalendarX
  if (et.includes('confirm') || et.includes('CONFIRM')) return CircleCheck
  if (et.includes('handoff') || et.includes('hand')) return Hand
  if (et.includes('language') || et === 'LANGUAGE_SWITCH') return Languages
  if (et.includes('knowledge')) return BookOpen
  if (et.includes('error') || category === 'error') return TriangleAlert
  if (category === 'followup') return Bell
  if (category === 'waitlist') return Clock3
  if (category === 'patient') return UserRound
  if (category === 'assistant') return Bot
  if (category === 'whatsapp') return MessageCircle
  if (category === 'system') return Settings
  return Calendar
}

export function historyCategoryTint(category: string, severity?: string) {
  if (severity === 'error') return 'bg-danger/10 text-danger'
  if (severity === 'success') return 'bg-success/10 text-success'
  if (category === 'appointment') return 'bg-cyan-tint text-primary'
  if (category === 'followup') return 'bg-warning/10 text-warning'
  if (category === 'assistant') return 'bg-cyan-tint text-primary'
  if (category === 'handoff') return 'bg-[#EEF2F6] text-navy'
  if (category === 'waitlist') return 'bg-cyan-tint/70 text-primary'
  if (category === 'patient') return 'bg-[#F4F6F8] text-navy'
  if (category === 'error') return 'bg-danger/10 text-danger'
  return 'bg-[#EEF2F6] text-muted'
}

function formatDateTimeValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
      }
    }
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    if (obj.date && obj.time) return `${formatDateTimeValue(obj.date)} · ${String(obj.time).slice(0, 5)}`
    if (obj.tone) return String(obj.tone)
    if (obj.name) return String(obj.name)
    if (obj.fr != null || obj.darija != null) {
      const langs: string[] = []
      if (obj.fr) langs.push('Français')
      if (obj.darija) langs.push('Darija')
      return langs.join(' + ') || '—'
    }
    if (obj.value != null) return String(obj.value).slice(0, 120) || '—'
    if (obj.status) return appointmentStatusLabel(String(obj.status))
  }
  return String(value)
}

export function formatHistoryChangeValue(value: Record<string, unknown> | null | undefined): string {
  if (!value) return '—'
  if (value.date || value.time) {
    const date = value.date ? formatDateTimeValue(value.date) : ''
    const time = value.time ? String(value.time).slice(0, 5) : ''
    return [date, time].filter(Boolean).join(' · ') || '—'
  }
  if (value.tone) return String(value.tone)
  if (value.name) return String(value.name)
  if (value.fr != null || value.darija != null) {
    const langs: string[] = []
    if (value.fr) langs.push('Français')
    if (value.darija) langs.push('Darija')
    return langs.join(' + ') || '—'
  }
  if (value.language) return languageLabel(String(value.language)) || String(value.language)
  if (value.status) return appointmentStatusLabel(String(value.status))
  if (value.value != null) return String(value.value).slice(0, 200) || '—'
  const keys = Object.keys(value)
  if (keys.length === 1) return formatDateTimeValue(value[keys[0]])
  return keys.slice(0, 3).map((k) => `${k}: ${formatDateTimeValue(value[k])}`).join(' · ')
}

export function formatHistoryChangePair(
  oldValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
): string | null {
  if (!oldValue || !newValue) return null
  if (oldValue.date && newValue.date) {
    const from = `${formatHistoryChangeValue(oldValue)}`
    const to = `${formatHistoryChangeValue(newValue)}`
    return `${from} → ${to}`
  }
  if (oldValue.tone && newValue.tone) return `${oldValue.tone} → ${newValue.tone}`
  if (oldValue.fr != null && newValue.fr != null) {
    return `${formatHistoryChangeValue(oldValue)} → ${formatHistoryChangeValue(newValue)}`
  }
  return `${formatHistoryChangeValue(oldValue)} → ${formatHistoryChangeValue(newValue)}`
}

export const HISTORY_GRID_CLASS = 'sm:grid sm:grid-cols-[88px_minmax(0,1fr)_260px_52px]'
export const HISTORY_GRID_PAD = 'px-4 sm:px-5'

export function historyChannelLabel(source?: string | null) {
  const key = String(source || '').toLowerCase()
  const map: Record<string, string> = {
    dashboard: 'Dashboard',
    crm: 'Smart CRM',
    whatsapp: 'WhatsApp',
    whatsapp_patient: 'WhatsApp patient',
    automation: 'Automatisation',
    assistant_ai: 'Assistant IA',
    system: 'Système',
  }
  return map[key] || (source ? String(source) : 'Smart CRM')
}

export function historyOriginLabel(source?: string | null, _actorType?: string | null, origin?: string | null): string {
  const org = String(origin || source || '').toLowerCase()
  const map: Record<string, string> = {
    dashboard: 'Dashboard',
    whatsapp_patient: 'WhatsApp patient',
    whatsapp: 'WhatsApp patient',
    automation: 'Automatisation',
    assistant_ai: 'Assistant IA',
    scheduler: 'Automatisation',
    system_internal: 'Automatisation',
    crm: 'Smart CRM',
    staff_dashboard: 'Dashboard',
  }
  return map[org] || (origin ? String(origin) : (source ? historyChannelLabel(source) : 'Dashboard'))
}

export type HistoryTargetUser = {
  userId?: number | null
  displayName: string
  role?: string | null
  roleLabel?: string | null
  statusLabel?: string | null
}

const DASHBOARD_USER_EVENTS = new Set([
  'dashboard_user_created',
  'dashboard_user_updated',
  'dashboard_user_permissions_updated',
  'dashboard_user_password_reset',
  'dashboard_user_password_changed',
  'dashboard_user_disabled',
  'dashboard_user_enabled',
  'dashboard_user_deleted',
])

export function isDashboardUserEvent(eventType?: string | null) {
  return DASHBOARD_USER_EVENTS.has(String(eventType || ''))
}

export function historyDrawerCategoryLabel(eventType?: string | null, category?: string | null) {
  if (isDashboardUserEvent(eventType)) return 'Utilisateurs'
  const map: Record<string, string> = {
    appointment: 'Rendez-vous',
    followup: 'Relances',
    patient: 'Patients',
    assistant: 'Assistant',
    whatsapp: 'WhatsApp',
    system: 'Système',
    error: 'Erreurs',
  }
  return map[String(category || '')] || 'Activité'
}

export function historyActionDetailText(
  eventType: string,
  targetUser: HistoryTargetUser | null | undefined,
  fallbackDescription?: string | null,
): string | null {
  const name = (() => {
    if (targetUser?.displayName) return targetUser.displayName
    const desc = fallbackDescription?.trim()
    if (desc?.includes('·')) {
      const part = desc.split('·')[0]?.trim()
      if (part) return part
    }
    return 'cet utilisateur'
  })()

  switch (eventType) {
    case 'dashboard_user_deleted':
      return `Le compte de ${name} a été supprimé du Dashboard.`
    case 'dashboard_user_created': {
      const role = targetUser?.roleLabel ? ` avec le rôle ${targetUser.roleLabel}` : ''
      return `Un nouveau compte a été créé pour ${name}${role}.`
    }
    case 'dashboard_user_updated':
    case 'dashboard_user_permissions_updated':
      return `Les accès de ${name} ont été modifiés.`
    case 'dashboard_user_password_reset':
      return `Le mot de passe de ${name} a été réinitialisé.`
    case 'dashboard_user_password_changed':
      return `Le mot de passe de ${name} a été mis à jour.`
    case 'dashboard_user_disabled':
      return `Le compte de ${name} a été désactivé.`
    case 'dashboard_user_enabled':
      return `Le compte de ${name} a été réactivé.`
    default: {
      const fb = fallbackDescription?.trim()
      if (!fb) return null
      if (/supprimé du Smart CRM/i.test(fb)) {
        return `Le compte de ${name} a été supprimé du Dashboard.`
      }
      return fb
    }
  }
}

export const sourceDisplayLabel = (source?: string | null) => {
  const map: Record<string, string> = {
    dashboard: 'Dashboard',
    whatsapp: 'WhatsApp',
    automation: 'Automatisation',
    crm: 'CRM',
  }
  return map[String(source || '')] || (source ? String(source) : '—')
}
