import {
  Bell,
  BellRing,
  CalendarDays,
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

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  description: string
  icon: LucideIcon
  viewPermission: PermissionKey
  managePermission: PermissionKey
}

export const settingsSections: SettingsSection[] = [
  {
    id: 'users',
    label: 'Utilisateurs et accès',
    description: 'Comptes et autorisations',
    icon: UsersRound,
    viewPermission: PERMISSIONS.MANAGE_USERS,
    managePermission: PERMISSIONS.MANAGE_USERS,
  },
  {
    id: 'appointments',
    label: 'Rendez-vous',
    description: 'Règles de réservation',
    icon: CalendarDays,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'reminders',
    label: 'Confirmations & rappels',
    description: 'Confirmations et relances',
    icon: BellRing,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'automations',
    label: 'Automatisations',
    description: 'Actions automatiques',
    icon: Zap,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'security',
    label: 'Sécurité & sessions',
    description: 'Durée et inactivité',
    icon: ShieldCheck,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
  {
    id: 'notifications',
    label: 'Notifications internes',
    description: 'Alertes de l’équipe',
    icon: Bell,
    viewPermission: PERMISSIONS.VIEW_SETTINGS,
    managePermission: PERMISSIONS.MANAGE_SETTINGS,
  },
]

export function parseSettingsSection(raw: string | null): SettingsSectionId {
  const ids = settingsSections.map((s) => s.id)
  if (raw && ids.includes(raw as SettingsSectionId)) return raw as SettingsSectionId
  return 'users'
}
