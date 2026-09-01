import {
  Bell,
  BellRing,
  CalendarDays,
  Monitor,
  ShieldCheck,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions'

export type SettingsSectionId =
  | 'users'
  | 'appointments'
  | 'reminders'
  | 'automations'
  | 'security'
  | 'notifications'
  | 'appearance'

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
  viewPermission: PermissionKey
  managePermission: PermissionKey
}

export const settingsSections: SettingsSection[] = [
  {
    id: 'users',
    label: 'Utilisateurs et accès',
    shortLabel: 'Accès',
    description: 'Comptes et autorisations',
    icon: UsersRound,
    viewPermission: PERMISSIONS.MANAGE_USERS,
    managePermission: PERMISSIONS.MANAGE_USERS,
  },
  {
    id: 'appointments',
    label: 'Rendez-vous',
    shortLabel: 'RDV',
    description: 'Règles de réservation',
    icon: CalendarDays,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'reminders',
    label: 'Confirmations & rappels',
    shortLabel: 'Rappels',
    description: 'Confirmations et relances',
    icon: BellRing,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'automations',
    label: 'Automatisations',
    shortLabel: 'Auto',
    description: 'Actions automatiques',
    icon: Zap,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'security',
    label: 'Sécurité & sessions',
    shortLabel: 'Sécurité',
    description: 'Inactivité',
    icon: ShieldCheck,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'notifications',
    label: 'Notifications internes',
    shortLabel: 'Alertes',
    description: 'Alertes de l’équipe',
    icon: Bell,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'appearance',
    label: 'Apparence',
    shortLabel: 'Zoom',
    description: 'Zoom de toute l’interface',
    icon: Monitor,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.VIEW_SETTINGS,
  },
]

export function parseSettingsSection(raw: string | null): SettingsSectionId {
  const ids = settingsSections.map((s) => s.id)
  if (raw && ids.includes(raw as SettingsSectionId)) return raw as SettingsSectionId
  return 'users'
}
