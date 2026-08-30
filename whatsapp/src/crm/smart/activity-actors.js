/**
 * Activity actor helpers — audit attribution for Smart CRM History.
 * Visible actors: dashboard_user | assistant_ai only.
 */

const { roleLabel } = require('../../dashboard/permissions')

const ASSISTANT_AI_ACTOR = Object.freeze({
  type: 'assistant_ai',
  userId: null,
  displayName: 'Assistant IA',
  role: null,
  roleLabel: 'Automatisation',
})

/** @deprecated internal legacy label — never shown in UI */
const LEGACY_SYSTEM_ACTOR = Object.freeze({
  type: 'assistant_ai',
  userId: null,
  displayName: 'Assistant IA',
  role: null,
  roleLabel: 'Automatisation',
})

const AUTOMATED_EVENT_TYPES = new Set([
  'appointment_created',
  'APPOINTMENT_CREATED',
  'appointment_confirmed',
  'APPOINTMENT_CONFIRMED',
  'appointment_cancelled',
  'APPOINTMENT_CANCELLED',
  'appointment_rescheduled',
  'appointment_moved_manually',
  'APPOINTMENT_MOVED_MANUALLY',
  'slot_proposal_sent',
  'SLOT_PROPOSAL_SENT',
  'slot_proposal_accepted',
  'SLOT_PROPOSAL_ACCEPTED',
  'slot_proposal_declined',
  'SLOT_PROPOSAL_DECLINED',
  'SLOT_PROPOSAL_EXPIRED',
  'slot_recovered',
  'slot_released',
  'confirmation_request_sent',
  'followup_sent',
  'APPOINTMENT_CONFIRMATION_SENT',
  'APPOINTMENT_CONFIRMATION_FOLLOWUP',
  'waitlist_added',
  'intent_detected',
  'dental_problem_detected',
  'voice_transcribed',
  'LANGUAGE_SWITCH',
])

const DASHBOARD_ORIGIN_SOURCES = new Set(['dashboard', 'staff_dashboard'])

/**
 * @param {{ id?: number, displayName?: string, role?: string, username?: string } | null | undefined} dashboardUser
 */
function getAuthenticatedActor(dashboardUser) {
  if (!dashboardUser?.id) return null
  return {
    type: 'dashboard_user',
    userId: Number(dashboardUser.id),
    displayName: String(dashboardUser.displayName || dashboardUser.username || 'Utilisateur'),
    role: String(dashboardUser.role || 'secretary'),
  }
}

function assistantAiActor() {
  return { ...ASSISTANT_AI_ACTOR }
}

/** @deprecated use assistantAiActor — patient is never an executor */
function patientActor(patient, fallbackName = 'Patient') {
  return assistantAiActor()
}

function roleLabelFr(role) {
  if (!role || role === 'patient') return null
  return roleLabel(role)
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function normalizeStorageActorType(raw) {
  const v = String(raw || '').toLowerCase()
  if (v === 'dashboard_user' || v === 'human' || v === 'staff' || v === 'admin') return 'dashboard_user'
  if (v === 'assistant_ai' || v === 'ai' || v === 'assistant' || v === 'patient' || v === 'system') {
    return 'assistant_ai'
  }
  return 'assistant_ai'
}

function isAutomatedContext({ eventType, source, origin, meta = {} } = {}) {
  const et = String(eventType || '')
  const src = String(source || '').toLowerCase()
  const org = String(origin || '').toLowerCase()
  if (AUTOMATED_EVENT_TYPES.has(et)) {
    if (et === 'slot_proposal_sent' || et === 'SLOT_PROPOSAL_SENT') {
      if (meta.actor_user_id || DASHBOARD_ORIGIN_SOURCES.has(src) || org === 'dashboard') return false
      if (meta.manual === true || meta.created_by) return false
    }
    if (src === 'dashboard' || org === 'dashboard') return false
    return true
  }
  if (src === 'whatsapp' || src === 'whatsapp_patient' || org === 'whatsapp_patient') return true
  if (src === 'automation' || org === 'automation' || org === 'scheduler') return true
  return false
}

function resolveOrigin(source, actorType, eventType, meta = {}) {
  const src = String(source || '').toLowerCase()
  if (src === 'whatsapp' || src === 'whatsapp_patient') return 'whatsapp_patient'
  if (src === 'dashboard' || src === 'staff_dashboard') return 'dashboard'
  if (src === 'automation') return 'automation'
  if (isAutomatedContext({ eventType, source: src, meta })) {
    return src === 'crm' ? 'assistant_ai' : (src || 'automation')
  }
  if (normalizeStorageActorType(actorType) === 'dashboard_user') return 'dashboard'
  return 'assistant_ai'
}

/**
 * Convert trusted actor object to DB record fields.
 */
function actorToRecordFields(actor) {
  if (!actor || typeof actor !== 'object') {
    throw new Error('[audit] actor object required')
  }
  const type = normalizeStorageActorType(actor.type)
  const displayName = type === 'assistant_ai'
    ? 'Assistant IA'
    : String(actor.displayName || 'Utilisateur')
  const role = type === 'assistant_ai' ? null : (actor.role != null ? String(actor.role) : null)
  const userId = type === 'dashboard_user' && actor.userId != null && Number.isFinite(Number(actor.userId))
    ? Number(actor.userId)
    : null

  if (type === 'dashboard_user' && !displayName) {
    throw new Error('[audit] dashboard_user requires displayName snapshot')
  }

  return {
    actor_type: type,
    actor_user_id: userId,
    actor_role: role,
    actor_display_name: displayName,
    actor_name: displayName,
    actor_id: userId != null ? String(userId) : null,
  }
}

function lookupDashboardUserByName(db, name) {
  if (!db || !name) return null
  const trimmed = String(name).trim()
  if (!trimmed || trimmed === 'Équipe' || trimmed === 'Système') return null
  try {
    const row = db.prepare(`
      SELECT id, display_name, role FROM dashboard_users
      WHERE display_name = ? COLLATE NOCASE OR username = ? COLLATE NOCASE
      ORDER BY is_active DESC, id ASC LIMIT 1
    `).get(trimmed, trimmed)
    if (!row) return null
    return {
      type: 'dashboard_user',
      userId: Number(row.id),
      displayName: String(row.display_name),
      role: String(row.role || 'secretary'),
    }
  } catch {
    return null
  }
}

/**
 * Resolve display actor from DB row + metadata (handles legacy patient/system/team).
 */
function enrichActorFromRow(row, meta = {}, db = null) {
  const rawType = String(row?.actor_type || '').toLowerCase()
  const metaObj = meta && typeof meta === 'object' ? meta : {}
  const eventType = row?.event_type
  const source = row?.source
  const origin = row?.origin

  if (rawType === 'dashboard_user' || rawType === 'assistant_ai') {
    if (rawType === 'assistant_ai') {
      return { ...ASSISTANT_AI_ACTOR }
    }
    const userId = row?.actor_user_id != null ? Number(row.actor_user_id) : null
    const displayName = row?.actor_display_name || row?.actor_name || 'Utilisateur'
    const role = row?.actor_role || null
    return {
      type: 'dashboard_user',
      userId: Number.isFinite(userId) && userId > 0 ? userId : null,
      displayName: String(displayName),
      role,
      roleLabel: roleLabelFr(role),
      initials: initialsFromName(displayName),
    }
  }

  // Legacy: human with user id
  if ((rawType === 'human' || rawType === 'staff' || rawType === 'admin') && row?.actor_user_id) {
    const displayName = row.actor_display_name || row.actor_name || 'Utilisateur'
    const role = row.actor_role || null
    return {
      type: 'dashboard_user',
      userId: Number(row.actor_user_id),
      displayName: String(displayName),
      role,
      roleLabel: roleLabelFr(role),
      initials: initialsFromName(displayName),
    }
  }

  // Legacy: human/team — recover from metadata or name
  if (rawType === 'human' || rawType === 'staff' || rawType === 'admin') {
    const metaUserId = metaObj.actor_user_id != null ? Number(metaObj.actor_user_id) : null
    if (Number.isFinite(metaUserId) && metaUserId > 0) {
      const displayName = metaObj.actor_display_name || row?.actor_display_name || row?.actor_name || 'Utilisateur'
      const role = metaObj.actor_role || row?.actor_role || null
      return {
        type: 'dashboard_user',
        userId: metaUserId,
        displayName: String(displayName),
        role,
        roleLabel: roleLabelFr(role),
        initials: initialsFromName(displayName),
      }
    }
    const name = metaObj.actor_display_name || metaObj.created_by || row?.actor_display_name || row?.actor_name
    if (name && name !== 'Équipe' && name !== 'Système') {
      const recovered = db ? lookupDashboardUserByName(db, name) : null
      if (recovered) {
        return {
          ...recovered,
          roleLabel: roleLabelFr(recovered.role),
          initials: initialsFromName(recovered.displayName),
        }
      }
      if (DASHBOARD_ORIGIN_SOURCES.has(String(source || '').toLowerCase()) || origin === 'dashboard') {
        return {
          type: 'dashboard_user',
          userId: null,
          displayName: String(name),
          role: metaObj.actor_role || row?.actor_role || null,
          roleLabel: roleLabelFr(metaObj.actor_role || row?.actor_role),
          initials: initialsFromName(name),
        }
      }
    }
    if (!isAutomatedContext({ eventType, source, origin, meta: metaObj })) {
      const fallbackName = name && name !== 'Équipe' ? String(name) : (row?.actor_display_name || 'Utilisateur')
      return {
        type: 'dashboard_user',
        userId: null,
        displayName: fallbackName,
        role: row?.actor_role || null,
        roleLabel: roleLabelFr(row?.actor_role),
        initials: initialsFromName(fallbackName),
      }
    }
  }

  // Legacy: patient / system / ai → Assistant IA
  return { ...ASSISTANT_AI_ACTOR }
}

function resolveExecutedByFromRow(row, meta = {}, db = null) {
  const actor = enrichActorFromRow(row, meta, db)
  if (actor.type !== 'dashboard_user' || !actor.userId) return null
  return {
    userId: actor.userId,
    displayName: actor.displayName,
    role: actor.role,
    roleLabel: actor.roleLabel || roleLabelFr(actor.role),
    initials: actor.initials || initialsFromName(actor.displayName),
  }
}

function resolveActorFromOptions(options = {}) {
  if (options.actor && typeof options.actor === 'object') {
    return options.actor
  }
  return null
}

function recordUserAuditPayload(user, payload = {}) {
  const actor = getAuthenticatedActor(user)
  if (!actor) {
    throw new Error('[audit] authenticated dashboard user required')
  }
  return {
    ...payload,
    actor,
    origin: payload.origin || 'dashboard',
    source: payload.source || 'dashboard',
  }
}

function recordAssistantAuditPayload(payload = {}) {
  return {
    ...payload,
    actor: assistantAiActor(),
    origin: payload.origin || resolveOrigin(payload.source, 'assistant_ai', payload.event_type, payload.metadata),
    source: payload.source || 'automation',
  }
}

function executedByDisplayName(row, meta = {}, db = null) {
  const actor = enrichActorFromRow(row, meta, db)
  if (actor.type === 'assistant_ai') return 'Assistant IA'
  return actor.displayName || '—'
}

module.exports = {
  AI_ACTOR: ASSISTANT_AI_ACTOR,
  ASSISTANT_AI_ACTOR,
  SYSTEM_ACTOR: LEGACY_SYSTEM_ACTOR,
  getAuthenticatedActor,
  assistantAiActor,
  patientActor,
  actorToRecordFields,
  enrichActorFromRow,
  resolveExecutedByFromRow,
  roleLabelFr,
  initialsFromName,
  resolveActorFromOptions,
  normalizeStorageActorType,
  isAutomatedContext,
  resolveOrigin,
  recordUserAuditPayload,
  recordAssistantAuditPayload,
  executedByDisplayName,
  lookupDashboardUserByName,
  AUTOMATED_EVENT_TYPES,
}
