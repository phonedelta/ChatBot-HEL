/** Mirror backend permission keys for dashboard RBAC. */

export const PERMISSIONS = {
  VIEW_TODAY: 'VIEW_TODAY',
  VIEW_MESSAGES: 'VIEW_MESSAGES',
  SEND_MANUAL_MESSAGE: 'SEND_MANUAL_MESSAGE',
  TAKE_OVER_CONVERSATION: 'TAKE_OVER_CONVERSATION',
  RETURN_CONVERSATION_TO_AI: 'RETURN_CONVERSATION_TO_AI',
  VIEW_AGENDA: 'VIEW_AGENDA',
  CREATE_APPOINTMENT: 'CREATE_APPOINTMENT',
  EDIT_APPOINTMENT: 'EDIT_APPOINTMENT',
  CANCEL_APPOINTMENT: 'CANCEL_APPOINTMENT',
  CONFIRM_APPOINTMENT: 'CONFIRM_APPOINTMENT',
  MANAGE_WAITLIST: 'MANAGE_WAITLIST',
  PROPOSE_SLOT: 'PROPOSE_SLOT',
  VIEW_PATIENTS: 'VIEW_PATIENTS',
  CREATE_PATIENT: 'CREATE_PATIENT',
  EDIT_PATIENT: 'EDIT_PATIENT',
  VIEW_FOLLOWUPS: 'VIEW_FOLLOWUPS',
  SEND_MANUAL_FOLLOWUP: 'SEND_MANUAL_FOLLOWUP',
  VALIDATE_FOLLOWUPS: 'VALIDATE_FOLLOWUPS',
  VIEW_ASSISTANT: 'VIEW_ASSISTANT',
  MANAGE_ASSISTANT: 'MANAGE_ASSISTANT',
  MANAGE_KNOWLEDGE: 'MANAGE_KNOWLEDGE',
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  VIEW_HISTORY: 'VIEW_HISTORY',
  EXPORT_HISTORY: 'EXPORT_HISTORY',
  VIEW_INTEGRATIONS: 'VIEW_INTEGRATIONS',
  MANAGE_WHATSAPP: 'MANAGE_WHATSAPP',
  VIEW_SETTINGS: 'VIEW_SETTINGS',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_SETTINGS: 'MANAGE_SETTINGS',
} as const

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS]

export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  '/': PERMISSIONS.VIEW_TODAY,
  '/messages': PERMISSIONS.VIEW_MESSAGES,
  '/agenda': PERMISSIONS.VIEW_AGENDA,
  '/patients': PERMISSIONS.VIEW_PATIENTS,
  '/relances': PERMISSIONS.VIEW_FOLLOWUPS,
  '/assistant': PERMISSIONS.VIEW_ASSISTANT,
  '/analyses': PERMISSIONS.VIEW_ANALYTICS,
  '/historique': PERMISSIONS.VIEW_HISTORY,
  '/integrations': PERMISSIONS.VIEW_INTEGRATIONS,
  '/parametres': PERMISSIONS.VIEW_SETTINGS,
}

export function roleLabel(role?: string | null) {
  const r = String(role || '').toLowerCase()
  if (r === 'admin') return 'Administrateur'
  if (r === 'secretary') return 'Secrétaire'
  return role || '—'
}

export function hasPermission(
  user: { role?: string; permissions?: string[] } | null | undefined,
  permission: PermissionKey | string,
) {
  if (!user) return false
  if (String(user.role || '').toLowerCase() === 'admin') return true
  return (user.permissions || []).includes(String(permission))
}
