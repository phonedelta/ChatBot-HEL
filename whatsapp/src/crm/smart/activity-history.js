/**
 * Operational activity history — append-only business audit journal.
 * Not raw WhatsApp message logs.
 */

const {
  aiActionLabel,
  intentLabel,
  conversationStatusLabel,
  appointmentStatusLabel,
} = require('./labels')
const {
  actorToRecordFields,
  enrichActorFromRow,
  resolveExecutedByFromRow,
  roleLabelFr,
  ASSISTANT_AI_ACTOR,
  assistantAiActor,
  normalizeStorageActorType,
  isAutomatedContext,
  resolveOrigin,
  recordUserAuditPayload,
  recordAssistantAuditPayload,
  executedByDisplayName,
  lookupDashboardUserByName,
} = require('./activity-actors')

const SECRET_KEYS = /^(api[_-]?key|password|token|secret|authorization|cookie|session|qr|credential|openai)/i

/** ai_action types excluded from history (not business-significant). */
const SKIP_AI_ACTION_TYPES = new Set([
  'ai_reply',
  'human_reply_sent',
  'human_reply_queued',
  'admin_reply',
])

/** timeline events mirrored only when no paired ai_action exists. */
const TIMELINE_MIRROR_TYPES = new Set([
  'LANGUAGE_SWITCH',
  'note_added',
  'waitlist_added',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CONFIRMATION_SENT',
  'APPOINTMENT_CONFIRMATION_FOLLOWUP',
  'CONFIRMATION_STAFF_TASK',
])

const EVENT_CATEGORY_MAP = {
  handoff_to_human: 'handoff',
  handoff_to_ai: 'handoff',
  appointment_created: 'appointment',
  APPOINTMENT_CREATED: 'appointment',
  appointment_confirmed: 'appointment',
  APPOINTMENT_CONFIRMED: 'appointment',
  appointment_cancelled: 'appointment',
  APPOINTMENT_CANCELLED: 'appointment',
  appointment_rescheduled: 'appointment',
  appointment_moved_manually: 'appointment',
  APPOINTMENT_MOVED_MANUALLY: 'appointment',
  confirmation_request_sent: 'followup',
  followup_sent: 'followup',
  followup_manual_sent: 'followup',
  followup_validated: 'followup',
  FOLLOWUP_MANUAL_SENT: 'followup',
  APPOINTMENT_CONFIRMATION_SENT: 'followup',
  APPOINTMENT_CONFIRMATION_FOLLOWUP: 'followup',
  slot_proposal_sent: 'waitlist',
  slot_proposal_accepted: 'waitlist',
  slot_proposal_declined: 'waitlist',
  slot_recovered: 'waitlist',
  SLOT_PROPOSAL_SENT: 'waitlist',
  SLOT_PROPOSAL_ACCEPTED: 'waitlist',
  SLOT_PROPOSAL_DECLINED: 'waitlist',
  SLOT_PROPOSAL_EXPIRED: 'waitlist',
  waitlist_added: 'waitlist',
  task_created: 'task',
  task_completed: 'task',
  CONFIRMATION_STAFF_TASK: 'task',
  patient_updated: 'patient',
  note_added: 'patient',
  patient_linked: 'patient',
  assistant_paused: 'assistant',
  assistant_enabled: 'assistant',
  assistant_tone_changed: 'assistant',
  assistant_language_changed: 'assistant',
  knowledge_updated: 'knowledge',
  intent_detected: 'assistant',
  dental_problem_detected: 'assistant',
  voice_transcribed: 'assistant',
  conversation_status_changed: 'handoff',
  whatsapp_connected: 'whatsapp',
  whatsapp_disconnected: 'whatsapp',
  whatsapp_qr_generated: 'whatsapp',
  whatsapp_session_reset: 'whatsapp',
  functional_error: 'error',
  LANGUAGE_SWITCH: 'assistant',
}

const SENSITIVE_EVENT_TYPES = new Set([
  'handoff_to_human',
  'handoff_to_ai',
  'appointment_cancelled',
  'APPOINTMENT_CANCELLED',
  'appointment_rescheduled',
  'appointment_moved_manually',
  'APPOINTMENT_MOVED_MANUALLY',
  'assistant_paused',
  'assistant_enabled',
  'assistant_tone_changed',
  'assistant_language_changed',
  'knowledge_updated',
  'whatsapp_disconnected',
  'whatsapp_session_reset',
  'patient_updated',
])

const ACTIVITY_TITLE_LABELS = {
  handoff_to_human: 'Prise en main par l’équipe',
  handoff_to_ai: 'Retour à l’assistant IA',
  appointment_created: 'Rendez-vous créé',
  APPOINTMENT_CREATED: 'Rendez-vous créé',
  appointment_confirmed: 'Rendez-vous confirmé',
  APPOINTMENT_CONFIRMED: 'Rendez-vous confirmé',
  appointment_cancelled: 'Rendez-vous annulé',
  APPOINTMENT_CANCELLED: 'Rendez-vous annulé',
  appointment_rescheduled: 'Rendez-vous déplacé',
  appointment_moved_manually: 'Rendez-vous déplacé',
  APPOINTMENT_MOVED_MANUALLY: 'Rendez-vous déplacé',
  appointment_updated: 'Rendez-vous modifié',
  appointment_deleted: 'Rendez-vous supprimé',
  confirmation_request_sent: 'Demande de confirmation envoyée',
  followup_sent: 'Relance automatique envoyée',
  followup_manual_sent: 'Relance manuelle envoyée',
  followup_validated: 'Relance validée',
  FOLLOWUP_MANUAL_SENT: 'Relance manuelle envoyée',
  APPOINTMENT_CONFIRMATION_SENT: 'Demande de confirmation WhatsApp',
  APPOINTMENT_CONFIRMATION_FOLLOWUP: 'Relance de confirmation',
  slot_proposal_sent: 'Proposition de créneau envoyée',
  slot_proposal_accepted: 'Proposition de créneau acceptée',
  slot_proposal_declined: 'Proposition de créneau refusée',
  slot_recovered: 'Créneau récupéré',
  SLOT_PROPOSAL_SENT: 'Proposition de créneau envoyée',
  SLOT_PROPOSAL_ACCEPTED: 'Créneau réattribué',
  SLOT_PROPOSAL_DECLINED: 'Proposition refusée',
  SLOT_PROPOSAL_EXPIRED: 'Proposition expirée',
  waitlist_added: 'Patient ajouté en liste d’attente',
  task_created: 'Tâche créée',
  task_completed: 'Tâche terminée',
  CONFIRMATION_STAFF_TASK: 'Tâche de confirmation créée',
  note_added: 'Note patient ajoutée',
  patient_updated: 'Fiche patient modifiée',
  patient_linked: 'Patient associé au contact',
  assistant_paused: 'Assistant IA mis en pause',
  assistant_enabled: 'Assistant IA réactivé',
  assistant_tone_changed: 'Ton de l’assistant modifié',
  assistant_language_changed: 'Langues de l’assistant modifiées',
  knowledge_updated: 'Base de connaissances modifiée',
  intent_detected: 'Intention détectée',
  dental_problem_detected: 'Problème dentaire détecté',
  voice_transcribed: 'Message vocal transcrit',
  conversation_status_changed: 'Statut de conversation modifié',
  LANGUAGE_SWITCH: 'Langue de conversation modifiée',
  whatsapp_connected: 'WhatsApp connecté',
  whatsapp_disconnected: 'WhatsApp déconnecté',
  whatsapp_qr_generated: 'QR WhatsApp généré',
  whatsapp_session_reset: 'Session WhatsApp réinitialisée',
  functional_error: 'Erreur fonctionnelle',
  dashboard_user_created: 'Compte utilisateur créé',
  dashboard_user_updated: 'Accès utilisateur modifiés',
  dashboard_user_permissions_updated: 'Permissions modifiées',
  dashboard_user_password_reset: 'Mot de passe réinitialisé',
  dashboard_user_password_changed: 'Mot de passe mis à jour',
  dashboard_user_disabled: 'Compte désactivé',
  dashboard_user_enabled: 'Compte réactivé',
  dashboard_user_deleted: 'Compte utilisateur supprimé',
  dashboard_login: 'Connexion au dashboard',
  slot_released: 'Créneau libéré',
}

function activityTitle(eventType, fallback = null) {
  return ACTIVITY_TITLE_LABELS[eventType] || fallback || aiActionLabel(eventType) || String(eventType || 'Activité')
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function sanitizeHistoryMetadata(input) {
  if (input == null) return null
  if (typeof input !== 'object' || Array.isArray(input)) {
    return typeof input === 'string' && input.length > 500 ? `${input.slice(0, 500)}…` : input
  }
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEYS.test(key)) continue
    if (typeof value === 'string' && value.length > 2000) {
      out[key] = `${value.slice(0, 2000)}…`
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeHistoryMetadata(value)
    } else {
      out[key] = value
    }
  }
  return out
}

function resolveCategory(eventType) {
  return EVENT_CATEGORY_MAP[eventType] || 'system'
}

function resolveSeverity(eventType, status = 'ok') {
  if (status === 'error' || eventType === 'functional_error') return 'error'
  if (SENSITIVE_EVENT_TYPES.has(eventType)) return 'sensitive'
  if (status === 'warning') return 'warning'
  if (String(eventType || '').includes('confirmed') || String(eventType || '').includes('accepted')) return 'success'
  return 'info'
}

function mapLegacyActorType(raw) {
  return normalizeStorageActorType(raw)
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createActivityHistoryEngine(db, { nowIso = () => new Date().toISOString() } = {}) {
  function ensureTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'system',
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_id TEXT,
        actor_name TEXT,
        source TEXT DEFAULT 'crm',
        patient_id INTEGER,
        conversation_id INTEGER,
        appointment_id INTEGER,
        task_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        old_value_json TEXT,
        new_value_json TEXT,
        metadata_json TEXT,
        source_event_id TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (patient_id) REFERENCES customers(id) ON DELETE SET NULL
      );
    `)
    for (const sql of [
      'ALTER TABLE activity_history ADD COLUMN actor_user_id INTEGER',
      'ALTER TABLE activity_history ADD COLUMN actor_role TEXT',
      'ALTER TABLE activity_history ADD COLUMN actor_display_name TEXT',
      'ALTER TABLE activity_history ADD COLUMN origin TEXT',
    ]) {
      try { db.exec(sql) } catch (e) {
        if (!/duplicate column name/i.test(String(e?.message || e))) throw e
      }
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_history_created ON activity_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_category ON activity_history(category, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_actor ON activity_history(actor_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_actor_user ON activity_history(actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_patient ON activity_history(patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_conversation ON activity_history(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_appointment ON activity_history(appointment_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_severity ON activity_history(severity, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_history_event_type ON activity_history(event_type, created_at DESC);
    `)
  }

  ensureTable()
  migrateLegacyActorRows()

  function migrateLegacyActorRows() {
    try {
      db.exec(`
        UPDATE activity_history
        SET actor_type = 'assistant_ai',
            actor_display_name = 'Assistant IA',
            actor_name = 'Assistant IA',
            actor_role = NULL,
            actor_user_id = NULL
        WHERE actor_type IN ('patient', 'system', 'ai', 'assistant')
      `)
      db.exec(`
        UPDATE activity_history
        SET actor_type = 'dashboard_user'
        WHERE actor_type IN ('human', 'staff', 'admin')
      `)
      db.exec(`
        UPDATE activity_history
        SET actor_display_name = COALESCE(actor_display_name, actor_name),
            actor_name = COALESCE(actor_name, actor_display_name)
        WHERE actor_type = 'dashboard_user'
          AND actor_user_id IS NOT NULL
          AND (actor_display_name IS NULL OR actor_display_name = 'Équipe')
      `)
      db.exec(`
        UPDATE activity_history
        SET origin = CASE
          WHEN source IN ('whatsapp', 'whatsapp_patient') THEN 'whatsapp_patient'
          WHEN source IN ('dashboard', 'staff_dashboard') THEN 'dashboard'
          WHEN source = 'automation' THEN 'automation'
          ELSE COALESCE(origin, 'assistant_ai')
        END
        WHERE origin IS NULL OR origin = ''
      `)
    } catch (error) {
      console.warn('[activity-history] legacy actor migration skipped:', error?.message || error)
    }
  }

  function resolveActorFromInput(input) {
    if (input.actor && typeof input.actor === 'object') {
      return actorToRecordFields(input.actor)
    }
    const meta = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    const eventType = input.event_type || input.type
    const source = input.source
    if (isAutomatedContext({ eventType, source, origin: input.origin, meta })) {
      return actorToRecordFields(assistantAiActor())
    }
    const recovered = lookupDashboardUserByName(db, input.actor_display_name || input.actor_name || meta.created_by)
    if (recovered) return actorToRecordFields(recovered)
    return actorToRecordFields(assistantAiActor())
  }

  function recordActivity(input = {}) {
    try {
      const eventType = String(input.event_type || input.type || '').trim()
      if (!eventType) return null

      const title = String(input.title || activityTitle(eventType)).trim()
      if (!title) return null

      const category = input.category || resolveCategory(eventType)
      const actorFields = resolveActorFromInput(input)
      const severity = input.severity || resolveSeverity(eventType, input.status)
      const origin = input.origin || resolveOrigin(input.source, actorFields.actor_type, eventType, input.metadata)
      const oldValue = input.old_value != null ? sanitizeHistoryMetadata(input.old_value) : null
      const newValue = input.new_value != null ? sanitizeHistoryMetadata(input.new_value) : null
      const metadata = input.metadata != null ? sanitizeHistoryMetadata(input.metadata) : null

      const insert = db.prepare(`
        INSERT OR IGNORE INTO activity_history (
          event_type, category, actor_type, actor_id, actor_name,
          actor_user_id, actor_role, actor_display_name,
          source, origin,
          patient_id, conversation_id, appointment_id, task_id,
          title, description, severity,
          old_value_json, new_value_json, metadata_json,
          source_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventType,
        category,
        actorFields.actor_type,
        actorFields.actor_id,
        actorFields.actor_name,
        actorFields.actor_user_id,
        actorFields.actor_role,
        actorFields.actor_display_name,
        input.source || 'crm',
        origin,
        input.patient_id != null ? Number(input.patient_id) || null : null,
        input.conversation_id != null ? Number(input.conversation_id) || null : null,
        input.appointment_id != null ? Number(input.appointment_id) || null : null,
        input.task_id != null ? Number(input.task_id) || null : null,
        title,
        input.description ? String(input.description).slice(0, 2000) : null,
        severity,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        metadata ? JSON.stringify(metadata) : null,
        input.source_event_id ? String(input.source_event_id) : null,
        input.created_at || nowIso(),
      )

      if (!insert.changes) {
        const existing = input.source_event_id
          ? db.prepare('SELECT * FROM activity_history WHERE source_event_id = ?').get(String(input.source_event_id))
          : null
        return existing || null
      }

      return db.prepare('SELECT * FROM activity_history WHERE id = ?').get(insert.lastInsertRowid)
    } catch (error) {
      console.error('[activity-history] recordActivity failed:', error?.message || error)
      return null
    }
  }

  function mirrorFromAiAction(row) {
    if (!row?.action_type || SKIP_AI_ACTION_TYPES.has(row.action_type)) return null

    let eventType = String(row.action_type)
    if (eventType === 'appointment_moved_manually') eventType = 'appointment_rescheduled'

    const payload = parseJson(row.payload_json, {})
    const appointmentId = payload.appointment_id || Number(row.result) || null
    const mappedType = mapLegacyActorType(row.actor_type)

    let actor
    if (mappedType === 'assistant_ai') {
      actor = assistantAiActor()
    } else {
      const userId = payload.actor_user_id != null ? Number(payload.actor_user_id) || null : null
      const displayName = payload.actor_display_name
        || payload.actor_name
        || payload.created_by
        || null
      if (userId) {
        actor = {
          type: 'dashboard_user',
          userId,
          displayName: String(displayName || 'Utilisateur'),
          role: payload.actor_role || null,
        }
      } else if (displayName && displayName !== 'Équipe') {
        const recovered = lookupDashboardUserByName(db, displayName)
        actor = recovered || {
          type: 'dashboard_user',
          userId: null,
          displayName: String(displayName),
          role: payload.actor_role || null,
        }
      } else if (isAutomatedContext({
        eventType,
        source: row.source,
        meta: payload,
      })) {
        actor = assistantAiActor()
      } else {
        actor = assistantAiActor()
      }
    }

    return recordActivity({
      event_type: eventType,
      category: resolveCategory(eventType),
      actor,
      origin: resolveOrigin(row.source, actor.type, eventType, payload),
      patient_id: row.customer_id,
      conversation_id: row.conversation_id,
      appointment_id: Number.isFinite(Number(appointmentId)) ? Number(appointmentId) : null,
      title: activityTitle(eventType),
      description: row.reason || row.result || null,
      severity: resolveSeverity(eventType, row.status),
      metadata: payload,
      source_event_id: `ai_action:${row.id}`,
      created_at: row.created_at,
    })
  }

  function mirrorFromTimeline(row) {
    if (!row?.event_type || !TIMELINE_MIRROR_TYPES.has(row.event_type)) return null

    const payload = parseJson(row.payload_json, {})
    const meta = payload
    let actor = null
    if (row.actor_type === 'human' || row.actor_type === 'dashboard_user') {
      const recovered = lookupDashboardUserByName(db, row.actor_name)
      actor = recovered || {
        type: 'dashboard_user',
        userId: null,
        displayName: row.actor_name || row.actor_display_name || 'Utilisateur',
        role: null,
      }
    } else {
      actor = assistantAiActor()
    }
    return recordActivity({
      event_type: row.event_type,
      category: resolveCategory(row.event_type),
      actor,
      origin: resolveOrigin('crm', actor.type, row.event_type, meta),
      source: 'crm',
      patient_id: row.customer_id,
      conversation_id: row.conversation_id,
      appointment_id: row.appointment_id,
      title: row.title || activityTitle(row.event_type),
      description: row.detail || null,
      metadata: payload,
      source_event_id: `timeline:${row.id}`,
      created_at: row.created_at,
    })
  }

  function targetStatusLabel(eventType) {
  const map = {
    dashboard_user_deleted: 'Compte supprimé',
    dashboard_user_disabled: 'Compte désactivé',
    dashboard_user_enabled: 'Compte réactivé',
  }
  return map[String(eventType || '')] || null
}

function resolveTargetUser(row, meta = {}) {
  const eventType = String(row?.event_type || '')
  if (!eventType.startsWith('dashboard_user_')) return null

  if (meta.display_name) {
    return {
      userId: meta.user_id != null ? Number(meta.user_id) || null : null,
      displayName: String(meta.display_name),
      role: meta.role || null,
      roleLabel: meta.role_label || roleLabelFr(meta.role) || null,
      statusLabel: meta.account_status_label || targetStatusLabel(eventType),
    }
  }

  const desc = String(row?.description || '').trim()
  const descParts = desc.split('·').map((s) => s.trim()).filter(Boolean)
  if (descParts.length >= 2 && eventType === 'dashboard_user_deleted') {
    return {
      userId: meta.user_id != null ? Number(meta.user_id) || null : null,
      displayName: descParts[0],
      roleLabel: descParts[1],
      role: meta.role || null,
      statusLabel: targetStatusLabel(eventType),
    }
  }

  const titleMatch = /:\s*(.+)$/.exec(String(row?.title || ''))
  if (titleMatch) {
    const roleFromDesc = desc.replace(/^Rôle\s*:\s*/i, '').trim()
    return {
      userId: meta.user_id != null ? Number(meta.user_id) || null : null,
      displayName: titleMatch[1].trim(),
      role: meta.role || null,
      roleLabel: meta.role_label || roleFromDesc || roleLabelFr(meta.role) || null,
      statusLabel: targetStatusLabel(eventType),
    }
  }

  return null
}

function enrichRow(row) {
    if (!row) return null
    const meta = parseJson(row.metadata_json, {})
    const oldValue = parseJson(row.old_value_json, null)
    const newValue = parseJson(row.new_value_json, null)
    let patientName = null
    if (row.patient_id) {
      patientName = db.prepare('SELECT full_name FROM customers WHERE id = ?').get(row.patient_id)?.full_name || null
    }
    let actor = enrichActorFromRow(row, meta, db)
    return {
      id: row.id,
      event_type: row.event_type,
      category: row.category,
      actor,
      executedBy: resolveExecutedByFromRow(row, meta, db),
      targetUser: resolveTargetUser(row, meta),
      actor_type: actor.type,
      actor_id: row.actor_id,
      actor_name: row.actor_name,
      actor_label: actor.displayName,
      origin: row.origin || resolveOrigin(row.source, actor.type, row.event_type, meta),
      source: row.source,
      patient_id: row.patient_id,
      patient_name: patientName,
      conversation_id: row.conversation_id,
      appointment_id: row.appointment_id,
      task_id: row.task_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      old_value: oldValue,
      new_value: newValue,
      metadata: meta,
      source_event_id: row.source_event_id || null,
      created_at: row.created_at,
    }
  }

  function buildWhereClause(filters = {}) {
    const clauses = ['1=1']
    const params = []

    if (filters.startDate) {
      clauses.push('a.created_at >= ?')
      params.push(String(filters.startDate))
    }
    if (filters.endDate) {
      clauses.push('a.created_at <= ?')
      params.push(`${String(filters.endDate)}T23:59:59.999`)
    }
    if (filters.days && !filters.startDate) {
      const d = Math.max(1, Math.min(365, Number(filters.days) || 7))
      clauses.push(`a.created_at >= datetime('now', ?)`)
      params.push(`-${d} days`)
    }
    if (filters.category && filters.category !== 'all') {
      clauses.push('a.category = ?')
      params.push(String(filters.category))
    }
    if (filters.actorType && filters.actorType !== 'all') {
      const at = String(filters.actorType)
      if (at === 'assistant_ai' || at === 'ai') {
        clauses.push("a.actor_type = 'assistant_ai'")
      } else if (at === 'dashboard_user' || at === 'human') {
        clauses.push("a.actor_type = 'dashboard_user'")
      } else {
        clauses.push('a.actor_type = ?')
        params.push(at)
      }
    }
    if (filters.actorUserId) {
      clauses.push('a.actor_user_id = ?')
      params.push(Number(filters.actorUserId))
    } else if (filters.actorId && String(filters.actorId).startsWith('user:')) {
      clauses.push('a.actor_user_id = ?')
      params.push(Number(String(filters.actorId).slice(5)))
    } else if (filters.actorId && !filters.actorType) {
      clauses.push('a.actor_id = ?')
      params.push(String(filters.actorId))
    }
    if (filters.patientId) {
      clauses.push('a.patient_id = ?')
      params.push(Number(filters.patientId))
    }
    if (filters.conversationId) {
      clauses.push('a.conversation_id = ?')
      params.push(Number(filters.conversationId))
    }
    if (filters.appointmentId) {
      clauses.push('a.appointment_id = ?')
      params.push(Number(filters.appointmentId))
    }
    if (filters.severity) {
      clauses.push('a.severity = ?')
      params.push(String(filters.severity))
    }
    if (filters.typeFilter === 'ai') {
      clauses.push("a.actor_type = 'assistant_ai'")
    } else if (filters.typeFilter === 'human') {
      clauses.push("a.actor_type = 'dashboard_user'")
    } else if (filters.typeFilter === 'patient' || filters.typeFilter === 'system') {
      clauses.push("a.actor_type = 'assistant_ai'")
    } else if (filters.typeFilter === 'errors') {
      clauses.push("a.severity = 'error'")
    } else if (filters.typeFilter && filters.typeFilter !== 'all') {
      clauses.push('a.category = ?')
      params.push(String(filters.typeFilter))
    }
    if (filters.search) {
      const q = `%${String(filters.search).trim().replace(/%/g, '')}%`
      clauses.push(`(
        a.title LIKE ? OR a.description LIKE ? OR a.actor_name LIKE ? OR a.actor_display_name LIKE ?
        OR EXISTS (SELECT 1 FROM customers c WHERE c.id = a.patient_id AND (c.full_name LIKE ? OR c.phone_number LIKE ?))
      )`)
      params.push(q, q, q, q, q, q)
    }

    return { where: clauses.join(' AND '), params }
  }

  function listActivityHistory(filters = {}) {
    const page = Math.max(1, Number(filters.page) || 1)
    const pageSize = Math.max(1, Math.min(100, Number(filters.limit) || 50))
    const offset = (page - 1) * pageSize
    const { where, params } = buildWhereClause(filters)

    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM activity_history a WHERE ${where}
    `).get(...params)?.n || 0

    const rows = db.prepare(`
      SELECT a.* FROM activity_history a
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset)

    return {
      items: rows.map(enrichRow),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    }
  }

  function getActivitySummary(filters = {}) {
    const { where, params } = buildWhereClause(filters)
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN actor_type = 'assistant_ai' THEN 1 ELSE 0 END) AS ai,
        SUM(CASE WHEN actor_type = 'dashboard_user' THEN 1 ELSE 0 END) AS human,
        SUM(CASE WHEN actor_type NOT IN ('dashboard_user', 'assistant_ai') THEN 1 ELSE 0 END) AS system
      FROM activity_history a
      WHERE ${where}
    `).get(...params)

    const categories = db.prepare(`
      SELECT category, COUNT(*) AS count
      FROM activity_history a
      WHERE ${where}
      GROUP BY category
      ORDER BY count DESC
    `).all(...params)

    const errorRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM activity_history a
      WHERE ${where} AND a.severity = 'error'
    `).get(...params)

    const todayWhere = `${where} AND date(a.created_at) = date('now', 'localtime')`
    const today = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN actor_type = 'assistant_ai' THEN 1 ELSE 0 END) AS ai,
        SUM(CASE WHEN actor_type = 'dashboard_user' THEN 1 ELSE 0 END) AS human,
        SUM(CASE WHEN actor_type NOT IN ('dashboard_user', 'assistant_ai') THEN 1 ELSE 0 END) AS system
      FROM activity_history a
      WHERE ${todayWhere}
    `).get(...params)

    return {
      period: {
        total: Number(row?.total || 0),
        ai: Number(row?.ai || 0),
        human: Number(row?.human || 0),
        system: Number(row?.system || 0),
      },
      today: {
        total: Number(today?.total || 0),
        ai: Number(today?.ai || 0),
        human: Number(today?.human || 0),
        system: Number(today?.system || 0),
      },
      categories: categories.map((c) => ({
        category: c.category,
        count: Number(c.count || 0),
      })),
      errors: Number(errorRow?.count || 0),
    }
  }

  function getActivityEvent(id) {
    const row = db.prepare('SELECT * FROM activity_history WHERE id = ?').get(Number(id))
    return enrichRow(row)
  }

  function exportActivityCsv(filters = {}) {
    const { where, params } = buildWhereClause(filters)
    const rows = db.prepare(`
      SELECT a.*, c.full_name AS patient_name
      FROM activity_history a
      LEFT JOIN customers c ON c.id = a.patient_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 5000
    `).all(...params)

    const header = ['Date', 'Heure', 'Action', 'Catégorie', 'Patient', 'Exécuté par', 'Rôle', 'Origine', 'Description']
    const escape = (v) => {
      const s = String(v ?? '').replace(/"/g, '""')
      return `"${s}"`
    }
    const lines = [header.map(escape).join(',')]
    for (const row of rows) {
      const dt = String(row.created_at || '')
      const meta = parseJson(row.metadata_json, {})
      const executedBy = executedByDisplayName(row, meta, db)
      const role = resolveExecutedByFromRow(row, meta, db)?.roleLabel || ''
      const originLabel = row.origin || resolveOrigin(row.source, row.actor_type, row.event_type, meta)
      lines.push([
        dt.slice(0, 10),
        dt.slice(11, 16),
        row.title || activityTitle(row.event_type),
        row.category,
        row.patient_name || '',
        executedBy,
        role,
        originLabel,
        row.description || '',
      ].map(escape).join(','))
    }
    return lines.join('\n')
  }

  function listHistoryActorFilters() {
    const groups = [
      {
        group: 'Exécutants',
        items: [
          {
            id: 'assistant_ai',
            label: 'Assistant IA',
            type: 'assistant_ai',
          },
        ],
      },
      {
        group: 'Équipe',
        items: [],
      },
    ]

    const teamRows = db.prepare(`
      SELECT DISTINCT
        a.actor_user_id AS user_id,
        a.actor_display_name AS display_name,
        a.actor_role AS role,
        u.is_active
      FROM activity_history a
      LEFT JOIN dashboard_users u ON u.id = a.actor_user_id
      WHERE a.actor_type = 'dashboard_user' AND a.actor_user_id IS NOT NULL
      ORDER BY a.actor_display_name ASC
    `).all()

    const seen = new Set()
    for (const row of teamRows) {
      const uid = Number(row.user_id)
      if (!uid || seen.has(uid)) continue
      seen.add(uid)
      const inactive = row.is_active === 0
      groups[1].items.push({
        id: `user:${uid}`,
        label: inactive ? `${row.display_name || 'Utilisateur'} — compte désactivé` : (row.display_name || 'Utilisateur'),
        type: 'dashboard_user',
        userId: uid,
        role: row.role,
      })
    }

    const activeUsers = db.prepare(`
      SELECT id, display_name, role, is_active FROM dashboard_users
      WHERE is_active = 1 AND role != 'admin'
      ORDER BY display_name ASC
    `).all()
    for (const u of activeUsers) {
      if (seen.has(Number(u.id))) continue
      groups[1].items.push({
        id: `user:${u.id}`,
        label: u.display_name,
        type: 'dashboard_user',
        userId: Number(u.id),
        role: u.role,
      })
    }

    const admins = db.prepare(`
      SELECT id, display_name, role FROM dashboard_users WHERE role = 'admin' AND is_active = 1
    `).all()
    for (const u of admins) {
      if (seen.has(Number(u.id))) continue
      groups[1].items.unshift({
        id: `user:${u.id}`,
        label: u.display_name,
        type: 'dashboard_user',
        userId: Number(u.id),
        role: u.role,
      })
    }

    return groups
  }

  function backfillFromLegacy({ limit = 500 } = {}) {
    const lim = Math.max(1, Math.min(5000, Number(limit) || 500))
    let inserted = 0

    const aiRows = db.prepare(`
      SELECT * FROM ai_actions ORDER BY id DESC LIMIT ?
    `).all(lim)
    for (const row of aiRows) {
      const r = mirrorFromAiAction(row)
      if (r) inserted += 1
    }

    const timelineRows = db.prepare(`
      SELECT * FROM timeline_events ORDER BY id DESC LIMIT ?
    `).all(lim)
    for (const row of timelineRows) {
      const r = mirrorFromTimeline(row)
      if (r) inserted += 1
    }

    return { inserted }
  }

  function recordUserAuditEvent(user, payload = {}) {
    return recordActivity(recordUserAuditPayload(user, payload))
  }

  function recordAssistantAuditEvent(payload = {}) {
    return recordActivity(recordAssistantAuditPayload(payload))
  }

  return {
    recordActivity,
    recordUserAuditEvent,
    recordAssistantAuditEvent,
    mirrorFromAiAction,
    mirrorFromTimeline,
    listActivityHistory,
    getActivitySummary,
    getActivityEvent,
    exportActivityCsv,
    backfillFromLegacy,
    listHistoryActorFilters,
    activityTitle,
    ACTIVITY_TITLE_LABELS,
    SKIP_AI_ACTION_TYPES,
    TIMELINE_MIRROR_TYPES,
  }
}

module.exports = {
  createActivityHistoryEngine,
  sanitizeHistoryMetadata,
  activityTitle,
  ACTIVITY_TITLE_LABELS,
  EVENT_CATEGORY_MAP,
}
