/**
 * Dashboard RBAC — permission keys, groups, defaults.
 * ADMIN role bypasses all checks (see hasPermission).
 */

const PERMISSIONS = {
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
}

const ALL_PERMISSION_KEYS = Object.values(PERMISSIONS)

const PERMISSION_GROUPS = [
  {
    group: 'Général',
    items: [
      { key: PERMISSIONS.VIEW_TODAY, label: 'Voir Aujourd’hui' },
    ],
  },
  {
    group: 'Messages',
    items: [
      { key: PERMISSIONS.VIEW_MESSAGES, label: 'Voir les conversations' },
      { key: PERMISSIONS.SEND_MANUAL_MESSAGE, label: 'Envoyer des messages' },
      { key: PERMISSIONS.TAKE_OVER_CONVERSATION, label: 'Prendre la main sur l’IA' },
      { key: PERMISSIONS.RETURN_CONVERSATION_TO_AI, label: 'Rendre la conversation à l’IA' },
    ],
  },
  {
    group: 'Agenda',
    items: [
      { key: PERMISSIONS.VIEW_AGENDA, label: 'Voir l’agenda' },
      { key: PERMISSIONS.CREATE_APPOINTMENT, label: 'Créer un rendez-vous' },
      { key: PERMISSIONS.EDIT_APPOINTMENT, label: 'Modifier un rendez-vous' },
      { key: PERMISSIONS.CANCEL_APPOINTMENT, label: 'Annuler un rendez-vous' },
      { key: PERMISSIONS.CONFIRM_APPOINTMENT, label: 'Confirmer un rendez-vous' },
      { key: PERMISSIONS.MANAGE_WAITLIST, label: 'Gérer la liste d’attente' },
      { key: PERMISSIONS.PROPOSE_SLOT, label: 'Proposer un créneau' },
    ],
  },
  {
    group: 'Patients',
    items: [
      { key: PERMISSIONS.VIEW_PATIENTS, label: 'Voir les patients' },
      { key: PERMISSIONS.CREATE_PATIENT, label: 'Ajouter un patient' },
      { key: PERMISSIONS.EDIT_PATIENT, label: 'Modifier un patient' },
    ],
  },
  {
    group: 'Relances',
    items: [
      { key: PERMISSIONS.VIEW_FOLLOWUPS, label: 'Voir les relances' },
      { key: PERMISSIONS.SEND_MANUAL_FOLLOWUP, label: 'Envoyer une relance' },
      { key: PERMISSIONS.VALIDATE_FOLLOWUPS, label: 'Valider les relances' },
    ],
  },
  {
    group: 'Assistant IA',
    items: [
      { key: PERMISSIONS.VIEW_ASSISTANT, label: 'Voir la configuration' },
      { key: PERMISSIONS.MANAGE_ASSISTANT, label: 'Modifier l’assistant' },
      { key: PERMISSIONS.MANAGE_KNOWLEDGE, label: 'Modifier la base de connaissances' },
    ],
  },
  {
    group: 'Analyses',
    items: [
      { key: PERMISSIONS.VIEW_ANALYTICS, label: 'Voir les analyses' },
    ],
  },
  {
    group: 'Historique',
    items: [
      { key: PERMISSIONS.VIEW_HISTORY, label: 'Voir l’historique' },
      { key: PERMISSIONS.EXPORT_HISTORY, label: 'Exporter l’historique' },
    ],
  },
  {
    group: 'Intégrations',
    items: [
      { key: PERMISSIONS.VIEW_INTEGRATIONS, label: 'Voir les intégrations' },
      { key: PERMISSIONS.MANAGE_WHATSAPP, label: 'Gérer WhatsApp' },
    ],
  },
  {
    group: 'Paramètres',
    items: [
      { key: PERMISSIONS.VIEW_SETTINGS, label: 'Accéder aux paramètres' },
      { key: PERMISSIONS.MANAGE_SETTINGS, label: 'Modifier les paramètres du cabinet' },
      { key: PERMISSIONS.MANAGE_USERS, label: 'Gérer les utilisateurs' },
    ],
  },
]

/** Preset shown when creating a new secretary — admin can adjust before save. */
const DEFAULT_SECRETARY_PERMISSIONS = [
  PERMISSIONS.VIEW_TODAY,
  PERMISSIONS.VIEW_MESSAGES,
  PERMISSIONS.SEND_MANUAL_MESSAGE,
  PERMISSIONS.VIEW_AGENDA,
  PERMISSIONS.VIEW_PATIENTS,
  PERMISSIONS.VIEW_FOLLOWUPS,
  PERMISSIONS.VIEW_SETTINGS,
]

const ROUTE_PERMISSIONS = {
  '/today': PERMISSIONS.VIEW_TODAY,
  '/search': PERMISSIONS.VIEW_PATIENTS,
  '/conversations': PERMISSIONS.VIEW_MESSAGES,
  '/patients': PERMISSIONS.VIEW_PATIENTS,
  '/agenda': PERMISSIONS.VIEW_AGENDA,
  '/tasks': PERMISSIONS.VIEW_FOLLOWUPS,
  '/followups': PERMISSIONS.VIEW_FOLLOWUPS,
  '/waitlist': PERMISSIONS.MANAGE_WAITLIST,
  '/automations': PERMISSIONS.VIEW_ASSISTANT,
  '/assistant': PERMISSIONS.VIEW_ASSISTANT,
  '/knowledge': PERMISSIONS.MANAGE_KNOWLEDGE,
  '/analytics': PERMISSIONS.VIEW_ANALYTICS,
  '/integrations': PERMISSIONS.VIEW_INTEGRATIONS,
  '/settings': PERMISSIONS.VIEW_SETTINGS,
  '/notifications': PERMISSIONS.VIEW_TODAY,
  '/history': PERMISSIONS.VIEW_HISTORY,
}

function isValidPermission(key) {
  return ALL_PERMISSION_KEYS.includes(String(key || ''))
}

function sanitizePermissions(list) {
  const set = new Set()
  for (const item of list || []) {
    if (isValidPermission(item)) set.add(String(item))
  }
  return Array.from(set)
}

function hasPermission(user, permission) {
  if (!user) return false
  if (String(user.role || '').toLowerCase() === 'admin') return true
  const perms = user.permissions || []
  return perms.includes(String(permission || ''))
}

function roleLabel(role) {
  const r = String(role || '').toLowerCase()
  if (r === 'admin') return 'Administrateur'
  if (r === 'secretary') return 'Secrétaire'
  return role || '—'
}

module.exports = {
  PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  DEFAULT_SECRETARY_PERMISSIONS,
  ROUTE_PERMISSIONS,
  isValidPermission,
  sanitizePermissions,
  hasPermission,
  roleLabel,
}
