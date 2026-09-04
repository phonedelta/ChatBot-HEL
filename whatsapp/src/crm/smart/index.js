/**
 * Smart Mini CRM layer — settings, conversations, tasks, waitlist, today KPIs.
 * Additive on top of the existing CRM repository (customers / appointments).
 */

const crypto = require('crypto')
const {
  HEL_CLINIC,
  HEL_ASSISTANT,
  DEFAULT_AUTOMATIONS,
  DEFAULT_INTEGRATIONS,
  DEFAULT_KNOWLEDGE,
  DEFAULT_PRACTITIONERS,
  DEFAULT_APPOINTMENT_TYPES,
  hoursConfigFromWeekly,
} = require('./defaults')
const { createContactResolver, extractJid, stripInstancePrefix } = require('./contact-resolver')
const {
  updateConversationLanguageState,
  normalizeActiveLanguage,
} = require('./conversation-language')
const { detectLanguageWithConfidence, detectExplicitLanguageRequest } = require('../../voice-nlu/language')
const {
  conversationStatusLabel,
  appointmentStatusLabel,
  formatAiActionLine,
  formatDelayMinutes,
  automationTriggerLabel,
  automationActionLabel,
  capabilityLabel,
  guardrailLabel,
  confirmationPolicyLabel,
} = require('./labels')
const { createCabinetSettingsService } = require('./cabinet-settings')
const { createConversationContextBuilder } = require('./conversation-context')
const { createAgendaBoard } = require('./agenda-board')
const { createAppointmentConfirmationEngine } = require('./appointment-confirmation')
const { createManualAppointmentFlow } = require('./manual-appointment-flow')
const { createSlotProposalEngine } = require('./slot-proposals')
const {
  resolveConversationRoutingState,
  contextualClarificationMessage,
  hasPriorityOverBooking,
  logContextRouter,
} = require('./conversation-routing')
const { createWhatsappCancelEngine } = require('./whatsapp-cancel')
const { createAvailabilityFlow } = require('./availability-flow')
const { createFollowupsBoard } = require('./followups-board')
const { createPatientsBoard } = require('./patients-board')
const { createAnalyticsBoard } = require('./analytics-board')
const { createActivityHistoryEngine } = require('./activity-history')
const { resolveActorFromOptions, normalizeStorageActorType } = require('./activity-actors')
const { createSlotReleaseNotificationService, isUserFacingSlotNotification } = require('./slot-release-notifications')
const { WEEKLY_HOURS, weekdayFromIsoDate, toMinutes } = require('../working-hours')

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [crmRepo] existing CRM repository (optional)
 */
function createSmartCrm(db, crmRepo = null) {
  const contacts = createContactResolver(db)
  const activityHistory = createActivityHistoryEngine(db)
  const cabinetSettings = createCabinetSettingsService(db, {
    activityHistory,
    resolveActorFromOptions,
  })
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM activity_history').get()?.n || 0
    if (Number(count) === 0) {
      activityHistory.backfillFromLegacy({ limit: 800 })
    }
  } catch { /* optional backfill */ }

  function nowIso() {
    return new Date().toISOString()
  }

  function conversationKeyVariants(key) {
    const raw = String(key || '').trim()
    if (!raw) return []
    const jid = extractJid(raw)
    const bare = stripInstancePrefix(raw)
    return [...new Set([raw, jid, bare, `main:${jid}`, jid ? `main:${jid}` : ''].filter(Boolean))]
  }

  function findConversationByExternalKey(key) {
    const variants = conversationKeyVariants(key)
    for (const variant of variants) {
      const row = db.prepare('SELECT * FROM conversations WHERE external_key = ?').get(variant)
      if (row) return row
    }
    return null
  }

  function enrichConversation(row) {
    if (!row) return null
    const resolved = contacts.resolveContact({
      external_key: row.external_key,
      whatsapp_chat_id: row.external_key,
      phone_number: row.patient_phone || row.phone_e164 || null,
      conversation_phone: row.phone_e164 || null,
      customer_id: row.customer_id,
      contact_name: row.patient_name,
      push_name: row.push_name || null,
    })
    return {
      ...row,
      display_name: resolved.display_name,
      display_subtitle: resolved.subtitle,
      phone_display: resolved.phone_display,
      phone_e164: resolved.phone_e164 || row.phone_e164 || null,
      is_unknown_patient: resolved.is_unknown,
      status_label: conversationStatusLabel(row.status),
      patient_name: resolved.display_name,
      patient_phone: resolved.phone_e164 || row.patient_phone || null,
      active_language: normalizeActiveLanguage(row.language) || null,
      // Never leak technical JID as name
      external_key_hidden: true,
    }
  }

  function getConversationLanguageRow(chatKey) {
    const key = extractJid(chatKey) || String(chatKey || '').trim()
    if (!key) return null
    return findConversationByExternalKey(key)
      || findConversationByExternalKey(String(chatKey || '').replace(/^[^:]+:/, ''))
      || null
  }

  /**
   * Apply inbound patient text to persisted conversation language memory.
   * Voice: may seed initial active language only — never increments switch counter.
   */
  function applyInboundLanguage({
    chatId = null,
    conversationId = null,
    text = '',
    isVoice = false,
  } = {}) {
    const key = extractJid(chatId) || extractJid(conversationId) || String(chatId || conversationId || '').trim()
    if (!key || key.includes('@broadcast')) {
      return {
        activeLanguage: null,
        candidateLanguage: null,
        candidateLanguageCount: 0,
        switched: false,
        responseLanguage: null,
        reason: 'missing_key',
      }
    }

    let row = getConversationLanguageRow(key)
    if (!row) {
      row = getOrCreateConversation({ external_key: key })
    }

    const detection = detectLanguageWithConfidence(text)
    const currentActive = normalizeActiveLanguage(row.language)
    const explicit = detectExplicitLanguageRequest(text)

    // Voice notes: seed only when no active language yet; never drive 2-message switch
    let next
    if (explicit) {
      next = {
        activeLanguage: explicit,
        candidateLanguage: null,
        candidateLanguageCount: 0,
        switched: explicit !== currentActive,
        responseLanguage: explicit,
        reason: 'explicit_request',
      }
    } else if (isVoice) {
      if (!currentActive && detection.reliable) {
        next = {
          activeLanguage: detection.language,
          candidateLanguage: null,
          candidateLanguageCount: 0,
          switched: true,
          responseLanguage: detection.language,
          reason: 'voice_seed',
        }
      } else {
        next = {
          activeLanguage: currentActive,
          candidateLanguage: row.candidate_language || null,
          candidateLanguageCount: Number(row.candidate_language_count) || 0,
          switched: false,
          responseLanguage: currentActive,
          reason: 'voice_ignored_for_switch',
        }
      }
    } else {
      next = updateConversationLanguageState({
        activeLanguage: currentActive,
        candidateLanguage: row.candidate_language,
        candidateLanguageCount: row.candidate_language_count,
        detectedLanguage: detection.language,
        confidence: detection.confidence,
        reliable: detection.reliable,
      })
    }

    try {
      db.prepare(`
        UPDATE conversations
        SET language = ?,
            candidate_language = ?,
            candidate_language_count = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        next.activeLanguage || null,
        next.candidateLanguage || null,
        Number(next.candidateLanguageCount) || 0,
        nowIso(),
        row.id,
      )
    } catch (error) {
      // Older DB without candidate columns — still keep active language
      db.prepare('UPDATE conversations SET language = ?, updated_at = ? WHERE id = ?')
        .run(next.activeLanguage || null, nowIso(), row.id)
    }

    if (next.switched) {
      try {
        addTimelineEvent({
          conversation_id: row.id,
          customer_id: row.customer_id || null,
          event_type: 'LANGUAGE_SWITCH',
          title: 'Changement de langue',
          detail: `${currentActive || '—'} → ${next.activeLanguage}`,
          actor_type: 'system',
          payload: {
            from: currentActive,
            to: next.activeLanguage,
            source: 'language_memory',
          },
        })
      } catch {
        // timeline optional
      }
    }

    if (next.switched && next.activeLanguage && row.customer_id) {
      try {
        db.prepare('UPDATE customers SET preferred_language = ? WHERE id = ?')
          .run(next.activeLanguage, row.customer_id)
      } catch {
        /* optional */
      }
    }

    if (process.env.NODE_ENV !== 'production' || process.env.CRM_DEBUG_LANGUAGE === '1') {
      console.log('[LANGUAGE_STATE]', {
        conversation: row.id,
        detected: detection.language,
        confidence: detection.confidence,
        reliable: detection.reliable,
        active: next.activeLanguage,
        candidate: next.candidateLanguage,
        count: next.candidateLanguageCount,
        switched: next.switched,
        reason: next.reason,
      })
    }

    return {
      ...next,
      conversationId: row.id,
      detection,
    }
  }

  function getActiveConversationLanguage(chatKey) {
    const row = getConversationLanguageRow(chatKey)
    return normalizeActiveLanguage(row?.language) || null
  }

  /**
   * Persist WhatsApp ↔ phone ↔ customer and refresh conversation columns.
   */
  function linkConversationIdentity({
    whatsapp_id = null,
    phone_number = null,
    customer_id = null,
    push_name = null,
    source = 'crm',
  } = {}) {
    const linked = contacts.linkWhatsAppIdentity({
      whatsapp_id,
      phone_number,
      customer_id,
      push_name,
      source,
    })
    if (process.env.NODE_ENV !== 'production' || process.env.CRM_DEBUG_IDENTITY === '1') {
      console.log('[IDENTITY_RESOLUTION]', {
        whatsappId: whatsapp_id || null,
        customerId: linked?.customer_id || customer_id || null,
        phoneSource: source,
        phoneResolved: Boolean(linked?.phone_e164 || phone_number),
      })
    }
    return linked
  }

  function todayLocal() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function parseJson(raw, fallback = null) {
    if (raw == null || raw === '') return fallback
    try {
      return JSON.parse(raw)
    } catch {
      return fallback
    }
  }

  function getSetting(key, fallback = null) {
    const row = db.prepare('SELECT value_json FROM clinic_settings WHERE key = ?').get(key)
    if (!row) return fallback
    return parseJson(row.value_json, fallback)
  }

  function setSetting(key, value) {
    db.prepare(`
      INSERT INTO clinic_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), nowIso())
    return getSetting(key)
  }

  function seedIfEmpty() {
    const autoCount = db.prepare('SELECT COUNT(*) AS c FROM automations').get()?.c || 0
    if (!autoCount) {
      const insert = db.prepare(`
        INSERT INTO automations (
          key, name, description, trigger_event, action_type, delay_minutes, status, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const row of DEFAULT_AUTOMATIONS) {
        insert.run(
          row.key,
          row.name,
          row.description,
          row.trigger_event,
          row.action_type,
          row.delay_minutes,
          row.status,
          row.config_json,
          nowIso(),
          nowIso(),
        )
      }
    }

    const integCount = db.prepare('SELECT COUNT(*) AS c FROM integrations').get()?.c || 0
    if (!integCount) {
      const insert = db.prepare(`
        INSERT INTO integrations (
          key, name, status, is_source_of_truth, synced_entities, last_sync_at, config_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, '{}', ?)
      `)
      for (const row of DEFAULT_INTEGRATIONS) {
        insert.run(
          row.key,
          row.name,
          row.status,
          row.is_source_of_truth,
          row.synced_entities,
          nowIso(),
        )
      }
    }

    const knowCount = db.prepare('SELECT COUNT(*) AS c FROM knowledge_items').get()?.c || 0
    if (!knowCount) {
      const insert = db.prepare(`
        INSERT INTO knowledge_items (category, key, label, value, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const row of DEFAULT_KNOWLEDGE) {
        insert.run(
          row.category,
          row.key,
          row.label,
          row.value || null,
          row.value ? 'filled' : 'empty',
          nowIso(),
        )
      }
    }

    const pracCount = db.prepare('SELECT COUNT(*) AS c FROM practitioners').get()?.c || 0
    if (!pracCount) {
      const insert = db.prepare(`
        INSERT INTO practitioners (full_name, specialty, active, created_at)
        VALUES (?, ?, 1, ?)
      `)
      for (const row of DEFAULT_PRACTITIONERS) {
        insert.run(row.full_name, row.specialty || null, nowIso())
      }
    }

    const typeCount = db.prepare('SELECT COUNT(*) AS c FROM appointment_types').get()?.c || 0
    if (!typeCount) {
      const insert = db.prepare(`
        INSERT INTO appointment_types (name, duration_minutes, active, created_at)
        VALUES (?, ?, 1, ?)
      `)
      for (const row of DEFAULT_APPOINTMENT_TYPES) {
        insert.run(row.name, row.duration_minutes, nowIso())
      }
    }

    if (getSetting('clinic') == null) setSetting('clinic', HEL_CLINIC)
    if (getSetting('assistant') == null) setSetting('assistant', HEL_ASSISTANT)
    if (getSetting('hours') == null) setSetting('hours', hoursConfigFromWeekly())
    if (getSetting('appointment_source') == null) {
      setSetting('appointment_source', { source: 'local_crm' })
    }
  }

  seedIfEmpty()

  // ---- Settings / Assistant -------------------------------------------------

  function getClinicSettings() {
    return {
      clinic: getSetting('clinic', HEL_CLINIC),
      assistant: getSetting('assistant', HEL_ASSISTANT),
      hours: getSetting('hours', hoursConfigFromWeekly()),
      appointment_source: getSetting('appointment_source', { source: 'local_crm' }),
    }
  }

  function updateAssistantSettings(patch = {}, options = {}) {
    const actor = resolveActorFromOptions(options)
    if (!actor?.userId) {
      throw new Error('Authenticated dashboard user required to update assistant settings')
    }
    const actorName = actor.displayName
    const current = getSetting('assistant', HEL_ASSISTANT)
    const next = {
      ...current,
      ...patch,
      capabilities: { ...(current.capabilities || {}), ...(patch.capabilities || {}) },
      guardrails: { ...(current.guardrails || {}), ...(patch.guardrails || {}) },
      languages: { ...(current.languages || HEL_CLINIC.languages), ...(patch.languages || {}) },
    }
    const saved = setSetting('assistant', next)

    try {
      if (patch.active === false && current.active !== false) {
        activityHistory.recordActivity({
          event_type: 'assistant_paused',
          actor,
          source: 'dashboard',
          title: 'Assistant IA mis en pause',
          description: `${actorName} a mis l’assistant IA en pause.`,
        })
      } else if (patch.active === true && current.active === false) {
        activityHistory.recordActivity({
          event_type: 'assistant_enabled',
          actor,
          source: 'dashboard',
          title: 'Assistant IA réactivé',
          description: `${actorName} a réactivé l’assistant IA.`,
        })
      }
      if (patch.tone && patch.tone !== current.tone) {
        activityHistory.recordActivity({
          event_type: 'assistant_tone_changed',
          actor,
          source: 'dashboard',
          title: 'Ton de l’assistant modifié',
          old_value: { tone: current.tone },
          new_value: { tone: patch.tone },
        })
      }
      if (patch.languages) {
        const prev = { fr: Boolean(current.languages?.fr), darija: Boolean(current.languages?.darija) }
        const nowLang = { fr: Boolean(next.languages?.fr), darija: Boolean(next.languages?.darija) }
        if (prev.fr !== nowLang.fr || prev.darija !== nowLang.darija) {
          activityHistory.recordActivity({
            event_type: 'assistant_language_changed',
            actor,
            source: 'dashboard',
            title: 'Langues de l’assistant modifiées',
            old_value: prev,
            new_value: nowLang,
          })
        }
      }
      if (patch.name && patch.name !== current.name) {
        activityHistory.recordActivity({
          event_type: 'assistant_tone_changed',
          actor,
          source: 'dashboard',
          title: 'Nom de l’assistant modifié',
          old_value: { name: current.name },
          new_value: { name: patch.name },
        })
      }
    } catch { /* non-blocking */ }

    return saved
  }

  function updateClinicProfile(patch = {}) {
    const current = getSetting('clinic', HEL_CLINIC)
    return setSetting('clinic', { ...current, ...patch })
  }

  function isAssistantActive() {
    const assistant = getSetting('assistant', HEL_ASSISTANT)
    return Boolean(assistant?.active !== false)
  }

  // ---- Conversations --------------------------------------------------------

  function getOrCreateConversation({
    external_key,
    customer_id = null,
    language = null,
    channel = 'whatsapp',
    phone_number = null,
    push_name = null,
  }) {
    const key = extractJid(external_key) || String(external_key || '').trim()
    if (!key) throw new Error('external_key required')

    const parsed = contacts.parseWhatsAppId(key)
    if (phone_number || customer_id || push_name) {
      linkConversationIdentity({
        whatsapp_id: key,
        phone_number,
        customer_id,
        push_name,
        source: phone_number ? 'whatsapp_or_form' : 'conversation',
      })
    }

    let row = findConversationByExternalKey(key)
    if (row) {
      const resolved = contacts.resolveContact({
        external_key: key,
        whatsapp_chat_id: key,
        customer_id: customer_id || row.customer_id,
        phone_number: phone_number || row.phone_e164,
        conversation_phone: row.phone_e164,
        push_name,
      })
      const nextCustomerId = customer_id || resolved.customer_id || row.customer_id || null
      const nextPhone = resolved.phone_e164 || row.phone_e164 || null
      const nextLid = parsed.isLid ? key : (row.whatsapp_lid || null)
      // Never overwrite active language from incidental getOrCreate calls
      if (
        (nextCustomerId && nextCustomerId !== row.customer_id)
        || (nextPhone && nextPhone !== row.phone_e164)
        || (nextLid && nextLid !== row.whatsapp_lid)
      ) {
        try {
          db.prepare(`
            UPDATE conversations
            SET customer_id = COALESCE(?, customer_id),
                phone_e164 = COALESCE(?, phone_e164),
                whatsapp_lid = COALESCE(?, whatsapp_lid),
                updated_at = ?
            WHERE id = ?
          `).run(nextCustomerId, nextPhone, nextLid, nowIso(), row.id)
        } catch {
          if (nextCustomerId && !row.customer_id) {
            db.prepare('UPDATE conversations SET customer_id = ?, updated_at = ? WHERE id = ?')
              .run(nextCustomerId, nowIso(), row.id)
          }
        }
        row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id)
      }
      return row
    }

    const resolved = contacts.resolveContact({
      external_key: key,
      whatsapp_chat_id: key,
      customer_id,
      phone_number,
    })

    const lid = parsed.isLid ? key : null
    const initialLanguage = normalizeActiveLanguage(language)
    try {
      const result = db.prepare(`
        INSERT INTO conversations (
          external_key, customer_id, channel, status, owner, language,
          phone_e164, whatsapp_lid, candidate_language, candidate_language_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'TO_PROCESS', 'AI', ?, ?, ?, NULL, 0, ?, ?)
      `).run(
        key,
        customer_id || resolved.customer_id || null,
        channel,
        initialLanguage,
        resolved.phone_e164 || null,
        lid,
        nowIso(),
        nowIso(),
      )
      return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid)
    } catch {
      const result = db.prepare(`
        INSERT INTO conversations (
          external_key, customer_id, channel, status, owner, language, created_at, updated_at
        ) VALUES (?, ?, ?, 'TO_PROCESS', 'AI', ?, ?, ?)
      `).run(
        key,
        customer_id || resolved.customer_id || null,
        channel,
        initialLanguage,
        nowIso(),
        nowIso(),
      )
      return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid)
    }
  }

  function listConversations({ status = null, limit = 50, query = '' } = {}) {
    ensureConversationsFromLegacy()
    backfillMessagesFromLogs({ limitConversations: 40 })

    const lim = Math.max(1, Math.min(200, Number(limit) || 50))
    const q = String(query || '').trim()
    const like = `%${q}%`
    const statusFilter = status && status !== 'all' ? String(status).toUpperCase() : null

    let sql = `
      SELECT
        conv.*,
        c.full_name AS patient_name,
        c.phone_number AS patient_phone
      FROM conversations conv
      LEFT JOIN customers c ON c.id = conv.customer_id
      WHERE conv.external_key NOT LIKE '%@broadcast%'
        AND conv.external_key != 'status@broadcast'
    `
    const params = []

    if (statusFilter) {
      sql += ' AND conv.status = ?'
      params.push(statusFilter)
    }
    if (q) {
      const { toE164, normalizePhoneDigits } = require('../phone')
      const e164 = toE164(q)
      const digits = normalizePhoneDigits(q)
      sql += ` AND (
        c.full_name LIKE ?
        OR c.phone_number LIKE ?
        OR conv.phone_e164 LIKE ?
        OR conv.last_message_preview LIKE ?
        OR (? != '' AND (c.phone_number = ? OR conv.phone_e164 = ?))
        OR (? != '' AND (REPLACE(c.phone_number, '+', '') LIKE ? OR REPLACE(COALESCE(conv.phone_e164, ''), '+', '') LIKE ?))
      )`
      params.push(like, like, like, like, e164, e164, e164, digits, `%${digits}%`, `%${digits}%`)
    }

    sql += ' ORDER BY COALESCE(conv.last_message_at, conv.updated_at) DESC LIMIT ?'
    params.push(lim)

    return db.prepare(sql).all(...params).map(enrichConversation)
  }

  function getConversation(id) {
    const row = db.prepare(`
      SELECT
        conv.*,
        c.full_name AS patient_name,
        c.phone_number AS patient_phone,
        c.city AS patient_city,
        c.preferred_language
      FROM conversations conv
      LEFT JOIN customers c ON c.id = conv.customer_id
      WHERE conv.id = ?
    `).get(Number(id)) || null
    return enrichConversation(row)
  }

  function listMessages(conversationId, { limit = 100 } = {}) {
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(Number(conversationId), Math.max(1, Math.min(500, Number(limit) || 100)))

    return rows.map((row) => ({
      ...row,
      media_url: row.media_path
        ? `/dashboard/api/conversations/${row.conversation_id}/messages/${row.id}/media`
        : null,
      has_media: Boolean(row.media_path || row.message_type === 'image'),
    }))
  }

  function getMessage(messageId) {
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(messageId)) || null
  }

  function addMessage(conversationId, {
    direction,
    author_type,
    author_name = null,
    body = '',
    message_type = 'text',
    external_message_id = null,
    created_at = null,
    media_path = null,
    media_mime = null,
    media_filename = null,
    media_size = null,
  }) {
    const cid = Number(conversationId)
    const ts = created_at || nowIso()

    if (external_message_id) {
      const existing = db.prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ? AND external_message_id = ?
      `).get(cid, String(external_message_id))
      if (existing) return existing
    }

    let result
    try {
      result = db.prepare(`
        INSERT INTO messages (
          conversation_id, direction, author_type, author_name, body, message_type,
          external_message_id, media_path, media_mime, media_filename, media_size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cid,
        direction,
        author_type,
        author_name,
        body,
        message_type,
        external_message_id,
        media_path,
        media_mime,
        media_filename,
        media_size == null ? null : Number(media_size),
        ts,
      )
    } catch {
      result = db.prepare(`
        INSERT INTO messages (
          conversation_id, direction, author_type, author_name, body, message_type, external_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cid,
        direction,
        author_type,
        author_name,
        body,
        message_type,
        external_message_id,
        ts,
      )
    }

    if (author_type !== 'system') {
      const preview = message_type === 'image'
        ? (String(body || '').trim() ? `🖼 ${String(body).slice(0, 160)}` : '🖼 Image')
        : String(body || '').slice(0, 180)
      db.prepare(`
        UPDATE conversations
        SET last_message_preview = ?, last_message_at = ?, updated_at = ?,
            unread_count = CASE WHEN ? = 'inbound' THEN unread_count + 1 ELSE unread_count END,
            status = CASE
              WHEN ? = 'inbound' AND owner = 'AI' AND status NOT IN ('HUMAN_CONTROLLED', 'TRANSFERRED', 'COMPLETED')
                THEN 'TO_PROCESS'
              ELSE status
            END
        WHERE id = ?
      `).run(preview, ts, ts, direction, direction, cid)
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, cid)
    }

    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
    return {
      ...row,
      media_url: row?.media_path
        ? `/dashboard/api/conversations/${row.conversation_id}/messages/${row.id}/media`
        : null,
      has_media: Boolean(row?.media_path || row?.message_type === 'image'),
    }
  }

  /**
   * Persist a WhatsApp turn into Smart CRM conversations/messages.
   */
  function trackWhatsAppTurn({
    chatId,
    conversationId = null,
    customerId = null,
    language = null,
    inboundText = null,
    outboundText = null,
    inboundMessageId = null,
    outboundMessageId = null,
    inboundType = 'text',
    outboundAuthor = 'ai',
    contactName = null,
    phoneNumber = null,
    mediaPath = null,
    mediaMime = null,
    mediaFilename = null,
    mediaSize = null,
  } = {}) {
    const key = extractJid(chatId) || extractJid(conversationId) || String(chatId || conversationId || '').trim()
    if (!key || key.includes('@broadcast')) return null

    // Always persist pushname mapping even without phone
    if (phoneNumber || customerId || contactName) {
      linkConversationIdentity({
        whatsapp_id: key,
        phone_number: phoneNumber,
        customer_id: customerId,
        push_name: contactName,
        source: phoneNumber ? 'whatsapp_contact' : 'whatsapp_turn',
      })
    }

    const resolved = contacts.resolveContact({
      external_key: key,
      whatsapp_chat_id: key,
      customer_id: customerId,
      contact_name: contactName,
      phone_number: phoneNumber,
    })

    const conv = getOrCreateConversation({
      external_key: key,
      customer_id: customerId || resolved.customer_id || null,
      language,
      phone_number: phoneNumber || resolved.phone_e164 || null,
      push_name: contactName,
    })

    if (inboundText || mediaPath) {
      addMessage(conv.id, {
        direction: 'inbound',
        author_type: 'patient',
        author_name: resolved.display_name,
        body: String(inboundText || '').slice(0, 4000),
        message_type: inboundType || (mediaPath ? 'image' : 'text'),
        external_message_id: inboundMessageId || null,
        media_path: mediaPath,
        media_mime: mediaMime,
        media_filename: mediaFilename,
        media_size: mediaSize,
      })
    }

    if (outboundText || (mediaPath && outboundAuthor)) {
      // outbound media handled by dedicated callers via addMessage
    }

    if (outboundText && !mediaPath) {
      addMessage(conv.id, {
        direction: 'outbound',
        author_type: outboundAuthor === 'human' ? 'human' : 'ai',
        author_name: outboundAuthor === 'human' ? 'Assistante' : 'Assistant IA',
        body: String(outboundText).slice(0, 4000),
        message_type: 'text',
        external_message_id: outboundMessageId || null,
      })
      if (outboundAuthor === 'ai') {
        logAiAction({
          conversation_id: conv.id,
          customer_id: conv.customer_id,
          action_type: 'ai_reply',
          reason: 'Réponse automatique WhatsApp',
          result: 'sent',
          actor_type: 'ai',
          source: 'whatsapp',
        })
      }
    }

    return getConversation(conv.id)
  }

  /**
   * One-time / lazy backfill from conversation_logs into messages.
   */
  function backfillMessagesFromLogs({ limitConversations = 30 } = {}) {
    const msgCount = db.prepare('SELECT COUNT(*) AS c FROM messages').get()?.c || 0
    // Always allow incremental backfill for conversations that still have 0 messages
    const emptyConvs = db.prepare(`
      SELECT conv.id, conv.external_key
      FROM conversations conv
      WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conv.id)
        AND conv.external_key NOT LIKE '%@broadcast%'
      ORDER BY COALESCE(conv.last_message_at, conv.updated_at) DESC
      LIMIT ?
    `).all(Math.max(1, Number(limitConversations) || 30))

    for (const conv of emptyConvs) {
      const variants = conversationKeyVariants(conv.external_key)
      if (!variants.length) continue
      const placeholders = variants.map(() => '?').join(',')
      const logs = db.prepare(`
        SELECT direction, message_text, created_at, whatsapp_chat_id, conversation_id
        FROM conversation_logs
        WHERE whatsapp_chat_id IN (${placeholders})
           OR conversation_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC
        LIMIT 80
      `).all(...variants, ...variants)

      for (const log of logs) {
        const direction = String(log.direction || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound'
        const body = String(log.message_text || '').trim()
        if (!body) continue
        addMessage(conv.id, {
          direction,
          author_type: direction === 'inbound' ? 'patient' : 'ai',
          author_name: direction === 'inbound' ? null : 'Assistant IA',
          body: body.slice(0, 4000),
          message_type: 'text',
          external_message_id: `log:${conv.id}:${log.created_at}:${body.slice(0, 24)}`,
          created_at: log.created_at || nowIso(),
        })
      }
    }

    return { conversations_checked: emptyConvs.length, messages_before: Number(msgCount) }
  }

  function setHandoff(conversationId, { owner, owner_user = null, status = null, actor = null } = {}) {
    const nextOwner = String(owner || '').toUpperCase() === 'HUMAN' ? 'HUMAN' : 'AI'
    const nextStatus = status
      || (nextOwner === 'HUMAN' ? 'HUMAN_CONTROLLED' : 'AI_IN_PROGRESS')
    const actorObj = actor || (owner_user ? { type: 'human', displayName: String(owner_user), role: null } : null)
    const actorLabel = actorObj?.displayName || String(owner_user || 'Assistante').trim() || 'Assistante'
    const now = nowIso()
    db.prepare(`
      UPDATE conversations
      SET owner = ?, owner_user = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(nextOwner, nextOwner === 'HUMAN' ? actorLabel : null, nextStatus, now, Number(conversationId))

    logAiAction({
      conversation_id: Number(conversationId),
      action_type: nextOwner === 'HUMAN' ? 'handoff_to_human' : 'handoff_to_ai',
      reason: nextOwner === 'HUMAN'
        ? `${actorLabel} a pris la main`
        : `${actorLabel} a rendu la main à l’IA`,
      result: nextStatus,
      actor_type: 'human',
      source: 'dashboard',
      actor: actorObj,
    })

    addMessage(Number(conversationId), {
      direction: 'outbound',
      author_type: 'system',
      author_name: 'Système',
      body: nextOwner === 'HUMAN'
        ? `${actorLabel} a pris la main`
        : `${actorLabel} a rendu la main à l’IA`,
      message_type: 'system',
      external_message_id: `handoff:${nextOwner}:${Number(conversationId)}:${now}`,
      created_at: now,
    })

    return getConversation(conversationId)
  }

  function updateConversation(conversationId, patch = {}) {
    const current = getConversation(conversationId)
    if (!current) return null
    const status = patch.status != null ? String(patch.status) : current.status
    const ai_summary = patch.ai_summary !== undefined ? patch.ai_summary : current.ai_summary
    const next_action = patch.next_action !== undefined ? patch.next_action : current.next_action
    const customer_id = patch.customer_id !== undefined ? patch.customer_id : current.customer_id
    db.prepare(`
      UPDATE conversations
      SET status = ?, ai_summary = ?, next_action = ?, customer_id = COALESCE(?, customer_id), updated_at = ?
      WHERE id = ?
    `).run(status, ai_summary, next_action, customer_id, nowIso(), Number(conversationId))
    return getConversation(conversationId)
  }

  /**
   * Backfill lightweight conversation rows from crm_leads / conversation_logs when inbox is empty.
   */
  function ensureConversationsFromLegacy() {
    const leads = db.prepare(`
      SELECT conversation_id, whatsapp_chat_id, full_name, phone_number, language, stage, updated_at, problem
      FROM crm_leads
      ORDER BY updated_at DESC
      LIMIT 100
    `).all()

    let created = 0
    for (const lead of leads) {
      const key = extractJid(lead.whatsapp_chat_id || lead.conversation_id || '')
      if (!key || key.includes('@broadcast')) continue
      const existing = findConversationByExternalKey(key)
      if (existing) {
        // Link customer / phone if missing
        if (lead.phone_number) {
          linkConversationIdentity({
            whatsapp_id: key,
            phone_number: lead.phone_number,
            customer_id: existing.customer_id || null,
            push_name: lead.full_name || null,
            source: 'crm_lead',
          })
        }
        if (!existing.customer_id && lead.phone_number) {
          const customer = contacts.findCustomerByPhone(lead.phone_number)
          if (customer) {
            try {
              db.prepare(`
                UPDATE conversations
                SET customer_id = ?, phone_e164 = COALESCE(?, phone_e164), updated_at = ?
                WHERE id = ?
              `).run(customer.id, contacts.resolveContact({ phone_number: lead.phone_number }).phone_e164, nowIso(), existing.id)
            } catch {
              db.prepare('UPDATE conversations SET customer_id = ?, updated_at = ? WHERE id = ?')
                .run(customer.id, nowIso(), existing.id)
            }
          }
        }
        continue
      }

      let customerId = null
      if (lead.phone_number) {
        customerId = contacts.findCustomerByPhone(lead.phone_number)?.id || null
      }
      if (!customerId) {
        customerId = contacts.findCustomerByWhatsAppId(key)?.id || null
      }

      const status = lead.stage === 'confirmed' ? 'COMPLETED' : 'TO_PROCESS'
      const preview = contacts.looksLikePersonName(lead.problem)
        ? lead.problem
        : (lead.problem || 'Conversation WhatsApp')

      db.prepare(`
        INSERT INTO conversations (
          external_key, customer_id, channel, status, owner, language,
          last_message_preview, last_message_at, ai_summary, next_action, created_at, updated_at
        ) VALUES (?, ?, 'whatsapp', ?, 'AI', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        key,
        customerId,
        status,
        lead.language || 'fr',
        String(preview).slice(0, 180),
        lead.updated_at || nowIso(),
        lead.problem && contacts.looksLikePersonName(lead.full_name) === false
          ? `Motif: ${String(lead.problem).slice(0, 120)}`
          : null,
        status === 'COMPLETED' ? null : 'Répondre au patient',
        lead.updated_at || nowIso(),
        lead.updated_at || nowIso(),
      )
      created += 1
    }

    if (created === 0) {
      const count = db.prepare('SELECT COUNT(*) AS c FROM conversations').get()?.c || 0
      if (count === 0) {
        const logs = db.prepare(`
          SELECT DISTINCT whatsapp_chat_id, conversation_id, customer_id
          FROM conversation_logs
          WHERE whatsapp_chat_id IS NOT NULL OR conversation_id IS NOT NULL
          ORDER BY id DESC
          LIMIT 40
        `).all()
        for (const log of logs) {
          const key = extractJid(log.whatsapp_chat_id || log.conversation_id || '')
          if (!key || key.includes('@broadcast')) continue
          if (findConversationByExternalKey(key)) continue
          db.prepare(`
            INSERT INTO conversations (
              external_key, customer_id, channel, status, owner, language, created_at, updated_at
            ) VALUES (?, ?, 'whatsapp', 'TO_PROCESS', 'AI', 'fr', ?, ?)
          `).run(key, log.customer_id || null, nowIso(), nowIso())
          created += 1
        }
      }
    }

    return { created }
  }

  function canAiAutoReply(externalKey) {
    if (!isAssistantActive()) return false
    if (!externalKey) return true
    const conv = findConversationByExternalKey(externalKey)
    if (!conv) return true
    if (conv.owner === 'HUMAN') return false
    if (conv.status === 'HUMAN_CONTROLLED') return false
    return true
  }

  function countAvailableSlotsToday(dateIso = todayLocal()) {
    const weekday = weekdayFromIsoDate(dateIso)
    if (weekday == null) return 0
    const hours = WEEKLY_HOURS[weekday]
    if (!hours) return 0
    const open = toMinutes(hours.open)
    const close = toMinutes(hours.close)
    if (open == null || close == null || close <= open) return 0

    // 30-minute slots within HEL hours
    const slots = []
    for (let m = open; m + 30 <= close; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      slots.push(`${hh}:${mm}`)
    }

    const taken = db.prepare(`
      SELECT appointment_time FROM appointments
      WHERE appointment_date = ?
        AND status IN ('non_confirme', 'confirmed')
    `).all(dateIso).map((r) => String(r.appointment_time || '').slice(0, 5))

    const takenSet = new Set(taken)
    return slots.filter((s) => !takenSet.has(s)).length
  }

  function buildConversationSuggestion(conversation) {
    if (!conversation) return null
    const customerId = conversation.customer_id
    let nextAppt = null
    if (customerId) {
      nextAppt = db.prepare(`
        SELECT a.*, d.problem
        FROM appointments a
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.customer_id = ?
          AND a.appointment_date >= date('now', 'localtime')
          AND a.status != 'cancelled'
        ORDER BY a.appointment_date ASC, a.appointment_time ASC
        LIMIT 1
      `).get(customerId)
    }

    const summary = conversation.ai_summary
    const preview = String(conversation.last_message_preview || '').toLowerCase()
    const wantsReschedule = /d[eé]plac|report|changer|modifier|resched|nbeddel|nbdl/.test(preview)
    const wantsCancel = /annul|cancel|annuler|ma bghit|ما بغي/.test(preview)

    if (wantsReschedule && nextAppt) {
      return {
        title: 'Suggestion de l’assistant IA',
        body: `Le patient souhaite déplacer son rendez-vous prévu le ${nextAppt.appointment_date} à ${nextAppt.appointment_time}.`,
        slots: [],
        next_action: 'Proposer des créneaux ou prendre la main',
        intent: 'RESCHEDULE_APPOINTMENT',
      }
    }
    if (wantsCancel && nextAppt) {
      return {
        title: 'Suggestion de l’assistant IA',
        body: `Le patient semble vouloir annuler le rendez-vous du ${nextAppt.appointment_date} à ${nextAppt.appointment_time}.`,
        slots: [],
        next_action: 'Confirmer l’annulation avec le patient',
        intent: 'CANCEL_APPOINTMENT',
      }
    }
    if (summary) {
      return {
        title: 'Suggestion de l’assistant IA',
        body: summary.startsWith('Demande:') || summary.startsWith('Motif:')
          ? 'Le patient a envoyé une demande via WhatsApp.'
          : summary,
        slots: [],
        next_action: conversation.next_action || 'Répondre au patient',
        intent: 'OTHER',
      }
    }
    return {
      title: 'Suggestion de l’assistant IA',
      body: conversation.is_unknown_patient
        ? 'Nouveau contact WhatsApp. Identifiez le patient puis répondez ou prenez la main.'
        : 'Analysez la demande et répondez, ou prenez la main si le cas est sensible.',
      slots: [],
      next_action: conversation.next_action || 'Répondre au patient',
      intent: 'OTHER',
    }
  }

  const conversationContext = createConversationContextBuilder({
    db,
    getConversation,
    buildConversationSuggestion,
    listWaitlist,
    contacts,
  })

  function getConversationContext(conversationId) {
    return conversationContext.getConversationContext(conversationId)
  }

  const agendaBoard = createAgendaBoard({
    db,
    listWaitlist,
    listPractitioners,
    listAppointmentTypes,
    getSlotDurationMinutes: () => cabinetSettings.getAppointmentsSettings().slotDurationMinutes,
    getAppointmentsSettings: () => cabinetSettings.getAppointmentsSettings(),
  })

  function getAgendaBoard(options = {}) {
    return agendaBoard.getAgendaBoard(options)
  }

  function getAgendaAppointment(appointmentId) {
    return agendaBoard.getAgendaAppointment(appointmentId)
  }

  // Confirmation engine wired after helpers exist — set via late init below
  let appointmentConfirmation = null

  function getAppointmentConfirmation() {
    return appointmentConfirmation
  }

  // ---- Timeline / AI actions / Tasks / Waitlist -----------------------------

  function addTimelineEvent({
    customer_id = null,
    conversation_id = null,
    appointment_id = null,
    event_type,
    title,
    detail = null,
    actor_type = 'system',
    actor_name = null,
    payload = null,
  }) {
    const result = db.prepare(`
      INSERT INTO timeline_events (
        customer_id, conversation_id, appointment_id, event_type, title, detail,
        actor_type, actor_name, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer_id,
      conversation_id,
      appointment_id,
      event_type,
      title,
      detail,
      actor_type,
      actor_name,
      payload ? JSON.stringify(payload) : null,
      nowIso(),
    )
    const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(result.lastInsertRowid)
    try {
      activityHistory.mirrorFromTimeline(row)
    } catch { /* non-blocking */ }
    return row
  }

  function listTimeline(customerId, { limit = 50 } = {}) {
    return db.prepare(`
      SELECT * FROM timeline_events
      WHERE customer_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(Number(customerId), Math.max(1, Math.min(200, Number(limit) || 50)))
  }

  function logAiAction({
    conversation_id = null,
    customer_id = null,
    action_type,
    reason = null,
    result = null,
    status = 'ok',
    source = 'automation',
    actor_type = 'ai',
    payload = null,
    actor = null,
  }) {
    const payloadObj = payload && typeof payload === 'object' ? { ...payload } : {}
    if (actor && typeof actor === 'object') {
      if (actor.userId != null) payloadObj.actor_user_id = actor.userId
      if (actor.displayName) payloadObj.actor_display_name = actor.displayName
      if (actor.role) payloadObj.actor_role = actor.role
    }
    const insert = db.prepare(`
      INSERT INTO ai_actions (
        conversation_id, customer_id, action_type, reason, result, status, source, actor_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversation_id,
      customer_id,
      action_type,
      reason,
      result,
      status,
      source,
      actor?.type ? normalizeStorageActorType(actor.type) : normalizeStorageActorType(actor_type),
      Object.keys(payloadObj).length ? JSON.stringify(payloadObj) : null,
      nowIso(),
    )
    const row = db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(insert.lastInsertRowid)
    try {
      activityHistory.mirrorFromAiAction(row)
    } catch { /* non-blocking */ }
    return row
  }

  function listAiActions({ limit = 50 } = {}) {
    return db.prepare(`
      SELECT * FROM ai_actions
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(200, Number(limit) || 50)))
  }

  function listTasks({ status = null, limit = 50, category = null } = {}) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 50))
    let sql = `
      SELECT
        t.*,
        c.full_name AS patient_name,
        c.phone_number AS patient_phone
      FROM tasks t
      LEFT JOIN customers c ON c.id = t.customer_id
      WHERE 1=1
    `
    const params = []
    if (status && status !== 'all') {
      sql += ' AND t.status = ?'
      params.push(String(status))
    }
    if (category) {
      sql += ' AND t.task_type = ?'
      params.push(String(category))
    }
    sql += ' ORDER BY COALESCE(t.due_at, t.created_at) ASC LIMIT ?'
    params.push(lim)
    return db.prepare(sql).all(...params)
  }

  function createTask(input = {}) {
    const result = db.prepare(`
      INSERT INTO tasks (
        customer_id, appointment_id, conversation_id, task_type, title, reason,
        priority, status, due_at, owner_user, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.customer_id || null,
      input.appointment_id || null,
      input.conversation_id || null,
      input.task_type || 'followup',
      input.title || 'Tâche',
      input.reason || null,
      input.priority || 'normal',
      input.status || 'planned',
      input.due_at || null,
      input.owner_user || null,
      nowIso(),
      nowIso(),
    )
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
    try {
      activityHistory.recordActivity({
        event_type: 'task_created',
        category: 'task',
        actor: input.actor || (input.actor_type ? {
          type: input.actor_type,
          displayName: input.owner_user || input.actor_name || null,
          role: null,
        } : null),
        source: input.source || 'crm',
        patient_id: task.customer_id,
        conversation_id: task.conversation_id,
        appointment_id: task.appointment_id,
        task_id: task.id,
        title: 'Tâche créée',
        description: task.title,
        metadata: { task_type: task.task_type, reason: task.reason },
        source_event_id: input.source_event_id || `task_created:${task.id}`,
      })
    } catch { /* non-blocking */ }
    return task
  }

  function updateTask(id, patch = {}) {
    const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id))
    if (!current) return null
    const status = patch.status != null ? patch.status : current.status
    const completed_at = status === 'completed' ? (current.completed_at || nowIso()) : null
    db.prepare(`
      UPDATE tasks
      SET status = ?, title = COALESCE(?, title), reason = COALESCE(?, reason),
          priority = COALESCE(?, priority), due_at = COALESCE(?, due_at),
          updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      status,
      patch.title ?? null,
      patch.reason ?? null,
      patch.priority ?? null,
      patch.due_at ?? null,
      nowIso(),
      completed_at,
      Number(id),
    )
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id))
    try {
      if (status === 'completed' && current.status !== 'completed') {
        activityHistory.recordActivity({
          event_type: 'task_completed',
          category: 'task',
          actor: patch.actor || resolveActorFromOptions(patch) || {
            type: patch.actor_type || 'human',
            displayName: patch.owner_user || patch.actor_name || updated.owner_user || 'Équipe',
            role: null,
          },
          source: patch.source || 'dashboard',
          patient_id: updated.customer_id,
          conversation_id: updated.conversation_id,
          appointment_id: updated.appointment_id,
          task_id: updated.id,
          title: 'Tâche terminée',
          description: updated.title,
          source_event_id: `task_completed:${updated.id}:${updated.completed_at}`,
        })
      }
    } catch { /* non-blocking */ }
    return updated
  }

  function listWaitlist({ status = 'active', limit = 50 } = {}) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 50))
    const params = []
    let sql = `
      SELECT
        w.*,
        c.full_name AS patient_name,
        c.phone_number AS patient_phone,
        p.full_name AS practitioner_name
      FROM waiting_list_entries w
      JOIN customers c ON c.id = w.customer_id
      LEFT JOIN practitioners p ON p.id = w.practitioner_id
      WHERE 1=1
    `
    if (status && status !== 'all') {
      sql += ' AND w.status = ?'
      params.push(String(status))
    }
    sql += ` ORDER BY
      CASE w.priority WHEN 'urgence' THEN 0 WHEN 'haute' THEN 1 ELSE 2 END,
      w.created_at ASC
      LIMIT ?`
    params.push(lim)
    return db.prepare(sql).all(...params)
  }

  function createWaitlistEntry(input = {}) {
    if (!input.customer_id) throw new Error('customer_id required')
    const result = db.prepare(`
      INSERT INTO waiting_list_entries (
        customer_id, practitioner_id, appointment_type, preferred_date_from, preferred_date_to,
        preferred_time_ranges, priority, current_appointment_id, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      Number(input.customer_id),
      input.practitioner_id || null,
      input.appointment_type || null,
      input.preferred_date_from || null,
      input.preferred_date_to || null,
      input.preferred_time_ranges ? JSON.stringify(input.preferred_time_ranges) : null,
      input.priority || 'normale',
      input.current_appointment_id || null,
      input.notes || null,
      nowIso(),
      nowIso(),
    )
    addTimelineEvent({
      customer_id: Number(input.customer_id),
      event_type: 'waitlist_added',
      title: 'Ajouté à la liste d’attente',
      actor_type: 'human',
    })
    return db.prepare('SELECT * FROM waiting_list_entries WHERE id = ?').get(result.lastInsertRowid)
  }

  function matchWaitlistForSlot({ slot_date, slot_time, limit = 10 } = {}) {
    // Informational only — no compatibility filter. Returns active waitlist for display.
    const entries = listWaitlist({ status: 'active', limit: Math.max(1, Number(limit) || 10) })
    return {
      slot_date,
      slot_time,
      compatible_count: 0,
      patients: entries,
      note: 'La sélection du patient est manuelle — aucun matching automatique.',
    }
  }

  function createWaitlistOffer({ waiting_list_id, slot_date, slot_time, expires_minutes = 30 }) {
    const token = crypto.randomBytes(16).toString('hex')
    const expires = new Date(Date.now() + expires_minutes * 60 * 1000).toISOString()
    const locked = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    const existingLock = db.prepare(`
      SELECT * FROM waiting_list_offers
      WHERE slot_date = ? AND slot_time = ?
        AND status = 'pending'
        AND (locked_until IS NULL OR locked_until > ?)
      LIMIT 1
    `).get(slot_date, slot_time, nowIso())
    if (existingLock && Number(existingLock.waiting_list_id) !== Number(waiting_list_id)) {
      const err = new Error('Ce créneau est déjà proposé à un autre patient')
      err.code = 'SLOT_LOCKED'
      throw err
    }

    const result = db.prepare(`
      INSERT INTO waiting_list_offers (
        waiting_list_id, slot_date, slot_time, offer_token, status, locked_until, expires_at, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      Number(waiting_list_id),
      slot_date,
      slot_time,
      token,
      locked,
      expires,
      nowIso(),
    )
    db.prepare(`
      UPDATE waiting_list_entries SET status = 'offered', updated_at = ? WHERE id = ?
    `).run(nowIso(), Number(waiting_list_id))
    return db.prepare('SELECT * FROM waiting_list_offers WHERE id = ?').get(result.lastInsertRowid)
  }

  /**
   * @deprecated Prefer createSlotProposal / moveAppointmentDirect.
   * Never auto-selects patients — waiting_list_ids required.
   */
  function proposeSlotToWaitlist({
    slot_date,
    slot_time,
    waiting_list_ids = [],
    expires_minutes = 30,
  } = {}) {
    const date = String(slot_date || '').trim()
    const time = String(slot_time || '').slice(0, 5)
    if (!date || !time) throw new Error('slot_date et slot_time requis')

    const busy = db.prepare(`
      SELECT id FROM appointments
      WHERE appointment_date = ?
        AND substr(appointment_time, 1, 5) = ?
        AND status IN ('non_confirme', 'confirmed')
      LIMIT 1
    `).get(date, time)
    if (busy) {
      const err = new Error('Ce créneau est déjà réservé')
      err.code = 'SLOT_TAKEN'
      throw err
    }

    const ids = (Array.isArray(waiting_list_ids) ? waiting_list_ids : [waiting_list_ids])
      .map((id) => Number(id))
      .filter(Boolean)
    if (!ids.length) {
      const err = new Error('Sélectionnez un patient manuellement')
      err.code = 'PATIENT_REQUIRED'
      throw err
    }

    const offers = []
    for (const wid of ids) {
      try {
        const offer = createWaitlistOffer({
          waiting_list_id: wid,
          slot_date: date,
          slot_time: time,
          expires_minutes,
        })
        const entry = db.prepare(`
          SELECT w.*, c.full_name AS patient_name, c.phone_number AS patient_phone
          FROM waiting_list_entries w
          JOIN customers c ON c.id = w.customer_id
          WHERE w.id = ?
        `).get(wid)
        offers.push({ offer, entry })
        logAiAction({
          customer_id: entry?.customer_id || null,
          action_type: 'slot_recovered',
          reason: `Proposition créneau ${date} ${time}`,
          result: offer.offer_token,
          source: 'dashboard',
          actor_type: 'human',
        })
      } catch (error) {
        if (error.code === 'SLOT_LOCKED' && offers.length) break
        throw error
      }
    }

    createNotification({
      type: 'waitlist_offer',
      title: 'Proposition de créneau envoyée',
      body: `${offers.length} patient(s) contacté(s) pour ${date} à ${time}`,
      link_path: '/agenda',
    })

    return {
      slot_date: date,
      slot_time: time,
      offers_count: offers.length,
      offers,
    }
  }

  /**
   * Accept a waitlist offer atomically — prevents double booking.
   */
  function acceptWaitlistOffer(offerToken, { createAppointmentFn = null } = {}) {
    const token = String(offerToken || '').trim()
    if (!token) throw new Error('token requis')

    const acceptTx = db.transaction(() => {
      const offer = db.prepare(`
        SELECT * FROM waiting_list_offers WHERE offer_token = ?
      `).get(token)
      if (!offer) {
        const err = new Error('Offre introuvable')
        err.code = 'NOT_FOUND'
        throw err
      }
      if (offer.status !== 'pending') {
        const err = new Error('Cette offre n’est plus valide')
        err.code = 'OFFER_CLOSED'
        throw err
      }
      if (offer.expires_at && offer.expires_at < nowIso()) {
        db.prepare(`UPDATE waiting_list_offers SET status = 'expired' WHERE id = ?`).run(offer.id)
        const err = new Error('Offre expirée')
        err.code = 'EXPIRED'
        throw err
      }

      const busy = db.prepare(`
        SELECT id FROM appointments
        WHERE appointment_date = ?
          AND substr(appointment_time, 1, 5) = ?
          AND status IN ('non_confirme', 'confirmed')
        LIMIT 1
      `).get(offer.slot_date, String(offer.slot_time).slice(0, 5))
      if (busy) {
        db.prepare(`UPDATE waiting_list_offers SET status = 'taken' WHERE id = ?`).run(offer.id)
        const err = new Error('Ce créneau vient d’être attribué à un autre patient')
        err.code = 'SLOT_TAKEN'
        throw err
      }

      // Close sibling pending offers for same slot
      db.prepare(`
        UPDATE waiting_list_offers
        SET status = 'taken'
        WHERE slot_date = ? AND slot_time = ? AND status = 'pending' AND id != ?
      `).run(offer.slot_date, offer.slot_time, offer.id)

      db.prepare(`
        UPDATE waiting_list_offers
        SET status = 'accepted', responded_at = ?
        WHERE id = ?
      `).run(nowIso(), offer.id)

      db.prepare(`
        UPDATE waiting_list_entries
        SET status = 'booked', updated_at = ?
        WHERE id = ?
      `).run(nowIso(), offer.waiting_list_id)

      const entry = db.prepare('SELECT * FROM waiting_list_entries WHERE id = ?')
        .get(offer.waiting_list_id)

      return { offer, entry }
    })

    const result = acceptTx()
    return result
  }

  // ---- Automations / Knowledge / Integrations / Notifications ---------------

  function listAutomations() {
    return db.prepare('SELECT * FROM automations ORDER BY id ASC').all().map((row) => {
      const runsWeek = db.prepare(`
        SELECT COUNT(*) AS c FROM automation_runs
        WHERE automation_id = ?
          AND created_at >= datetime('now', '-7 days')
      `).get(row.id)?.c || 0
      const lastRun = db.prepare(`
        SELECT * FROM automation_runs
        WHERE automation_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(row.id)
      return {
        ...row,
        trigger_label: automationTriggerLabel(row.trigger_event),
        action_label: automationActionLabel(row.action_type),
        delay_label: formatDelayMinutes(row.delay_minutes),
        status_label: row.status === 'active' ? 'Active' : 'En pause',
        runs_this_week: Number(runsWeek),
        last_run_at: lastRun?.created_at || null,
      }
    })
  }

  function ensureFollowUpTasks() {
    // Confirmation staff tasks are created by the WhatsApp confirmation engine
    // (24 h without patient reply) — do NOT flood Relances on every booking.

    const unanswered = db.prepare(`
      SELECT id, customer_id, last_message_preview
      FROM conversations
      WHERE status IN ('TO_PROCESS', 'WAITING_PATIENT')
        AND owner = 'AI'
        AND last_message_at IS NOT NULL
        AND datetime(last_message_at) <= datetime('now', '-4 hours')
      LIMIT 30
    `).all()

    for (const conv of unanswered) {
      const existing = db.prepare(`
        SELECT id FROM tasks
        WHERE conversation_id = ? AND task_type = 'no_response' AND status != 'completed'
      `).get(conv.id)
      if (existing) continue
      createTask({
        customer_id: conv.customer_id,
        conversation_id: conv.id,
        task_type: 'no_response',
        title: 'Patient sans réponse',
        reason: conv.last_message_preview || 'Aucune réponse depuis 4 h',
        priority: 'normal',
        status: 'waiting_response',
        due_at: nowIso(),
      })
    }
  }

  let followupsBoard = null

  function getFollowupsBoardEngine() {
    if (!followupsBoard) {
      followupsBoard = createFollowupsBoard(db, {
        listTasks,
        createTask,
        updateTask,
        listAutomations,
        listWaitlist,
        addMessage,
        getOrCreateConversation,
        logAiAction,
        addTimelineEvent,
        getActiveConversationLanguage,
        get sendWhatsAppText() {
          return helpersSendRef.fn
        },
        trackWhatsAppTurn,
      })
    }
    return followupsBoard
  }

  function getFollowUpsBoard(options = {}) {
    ensureFollowUpTasks()
    return getFollowupsBoardEngine().getFollowUpsBoard(options)
  }

  function previewManualFollowup(appointmentId) {
    return getFollowupsBoardEngine().buildManualFollowupPreview(appointmentId)
  }

  async function sendManualFollowup(appointmentId, options = {}) {
    return getFollowupsBoardEngine().sendManualFollowup(appointmentId, options)
  }

  function validateFollowupTasks(taskIds, options = {}) {
    return getFollowupsBoardEngine().validatePendingTasks(taskIds, options)
  }

  function listFollowupValidationCandidates() {
    return getFollowupsBoardEngine().listValidationCandidates()
  }

  function updateAutomation(idOrKey, patch = {}) {
    const row = Number.isFinite(Number(idOrKey))
      ? db.prepare('SELECT * FROM automations WHERE id = ?').get(Number(idOrKey))
      : db.prepare('SELECT * FROM automations WHERE key = ?').get(String(idOrKey))
    if (!row) return null
    const status = patch.status != null ? patch.status : row.status
    const delay = patch.delay_minutes != null ? Number(patch.delay_minutes) : row.delay_minutes
    const config = patch.config_json != null
      ? (typeof patch.config_json === 'string' ? patch.config_json : JSON.stringify(patch.config_json))
      : row.config_json
    db.prepare(`
      UPDATE automations
      SET status = ?, delay_minutes = ?, config_json = ?,
          name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ?
      WHERE id = ?
    `).run(status, delay, config, patch.name ?? null, patch.description ?? null, nowIso(), row.id)
    return db.prepare('SELECT * FROM automations WHERE id = ?').get(row.id)
  }

  function listKnowledge({ category = null } = {}) {
    if (category) {
      return db.prepare('SELECT * FROM knowledge_items WHERE category = ? ORDER BY category, key').all(category)
    }
    return db.prepare('SELECT * FROM knowledge_items ORDER BY category, key').all()
  }

  function upsertKnowledgeItem({ category, key, label, value }, options = {}) {
    const actor = resolveActorFromOptions(options) || {
      type: 'human',
      displayName: 'Admin',
      role: 'admin',
    }
    const existing = db.prepare('SELECT * FROM knowledge_items WHERE category = ? AND key = ?').get(category, key)
    const status = value && String(value).trim() ? 'filled' : 'empty'
    db.prepare(`
      INSERT INTO knowledge_items (category, key, label, value, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, key) DO UPDATE SET
        label = excluded.label,
        value = excluded.value,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(category, key, label || key, value || null, status, nowIso())
    const item = db.prepare('SELECT * FROM knowledge_items WHERE category = ? AND key = ?').get(category, key)
    try {
      if (!existing || String(existing.value || '') !== String(value || '')) {
        activityHistory.recordActivity({
          event_type: 'knowledge_updated',
          category: 'knowledge',
          actor,
          source: 'dashboard',
          title: 'Base de connaissances modifiée',
          description: `${label || key} (${category})`,
          old_value: existing ? { value: existing.value } : null,
          new_value: { value: value || null },
          metadata: { category, key, label: label || key },
          source_event_id: existing
            ? `knowledge:${category}:${key}:${nowIso()}`
            : `knowledge_new:${category}:${key}`,
        })
      }
    } catch { /* non-blocking */ }
    return item
  }

  function listIntegrations() {
    return db.prepare('SELECT * FROM integrations ORDER BY id ASC').all().map((row) => ({
      ...row,
      synced_entities: parseJson(row.synced_entities, []),
      config: parseJson(row.config_json, {}),
    }))
  }

  function updateIntegration(key, patch = {}) {
    const row = db.prepare('SELECT * FROM integrations WHERE key = ?').get(String(key))
    if (!row) return null
    db.prepare(`
      UPDATE integrations
      SET status = COALESCE(?, status),
          is_source_of_truth = COALESCE(?, is_source_of_truth),
          last_sync_at = COALESCE(?, last_sync_at),
          config_json = COALESCE(?, config_json),
          updated_at = ?
      WHERE key = ?
    `).run(
      patch.status ?? null,
      patch.is_source_of_truth != null ? (patch.is_source_of_truth ? 1 : 0) : null,
      patch.last_sync_at ?? null,
      patch.config != null ? JSON.stringify(patch.config) : null,
      nowIso(),
      String(key),
    )
    return listIntegrations().find((i) => i.key === key) || null
  }

  const USER_BELL_TYPE_LABELS = {
    slot_released: 'Créneau disponible',
    slot_available_after_cancellation: 'Créneau disponible',
    confirmation_sent: 'Confirmation envoyée',
    confirmation_call: 'À rappeler',
    waitlist_offer: 'Liste d’attente',
  }

  const HIDDEN_BELL_TYPES = new Set([
    'slot_proposal',
    'proposal_sent',
    'slot_proposal_sent',
    'appointment_moved',
  ])

  function isBellVisibleNotification(row) {
    if (!row) return false
    const type = String(row.type || '')
    if (HIDDEN_BELL_TYPES.has(type)) return false
    if (type === 'slot_released' || type === 'slot_available_after_cancellation') {
      return isUserFacingSlotNotification(row)
    }
    return true
  }

  function listNotifications({ limit = 20, unreadOnly = false } = {}) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 20))
    // Fetch extra then filter so hidden audit rows don't occupy the limit
    const fetchLimit = Math.min(200, lim * 4)
    const rows = unreadOnly
      ? db.prepare(`
          SELECT * FROM notifications WHERE read_at IS NULL
          ORDER BY created_at DESC LIMIT ?
        `).all(fetchLimit)
      : db.prepare(`
          SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?
        `).all(fetchLimit)

    return rows
      .filter((row) => isBellVisibleNotification(row))
      .slice(0, lim)
      .map((row) => enrichNotification(row))
  }

  function enrichNotification(row) {
    if (!row) return null
    let slotAvailable = null
    if (
      (row.type === 'slot_released' || row.type === 'slot_available_after_cancellation')
      && row.slot_date
      && row.slot_time
    ) {
      if (!slotReleaseNotifications.isSlotInFuture(row.slot_date, row.slot_time)) {
        slotAvailable = false
      } else {
        slotAvailable = slotReleaseNotifications.isSlotCurrentlyFree(
          row.slot_date,
          row.slot_time,
        )
      }
    }
    const typeLabel = USER_BELL_TYPE_LABELS[row.type] || row.title || 'Notification'
    return {
      ...row,
      is_read: Boolean(row.read_at),
      slot_available: slotAvailable,
      type_label: typeLabel,
    }
  }

  function getNotificationsBoard({ limit = 30, unreadOnly = false } = {}) {
    const items = listNotifications({ limit, unreadOnly })
    const unreadRows = db.prepare(`
      SELECT * FROM notifications WHERE read_at IS NULL
    `).all()
    const unreadCount = unreadRows.filter((row) => isBellVisibleNotification(row)).length
    return {
      items,
      unreadCount: Number(unreadCount),
    }
  }

  function createNotificationRaw({
    type,
    title,
    body = null,
    link_path = null,
    unique_key = null,
    slot_date = null,
    slot_time = null,
    appointment_id = null,
    source_event = null,
    metadata = null,
  }) {
    // Never persist proposal/audit events as user bell notifications
    if (HIDDEN_BELL_TYPES.has(String(type || ''))) {
      return null
    }
    if (
      (type === 'slot_released' || type === 'slot_available_after_cancellation')
      && String(source_event || '') !== 'appointment_cancelled'
      && source_event != null
    ) {
      return null
    }
    try {
      const result = db.prepare(`
        INSERT INTO notifications (
          type, title, body, link_path, unique_key, slot_date, slot_time,
          appointment_id, source_event, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        type,
        title,
        body,
        link_path,
        unique_key,
        slot_date,
        slot_time,
        appointment_id,
        source_event,
        metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
        nowIso(),
      )
      return enrichNotification(
        db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid),
      )
    } catch (error) {
      if (unique_key && /UNIQUE/i.test(String(error?.message || error))) {
        return enrichNotification(
          db.prepare('SELECT * FROM notifications WHERE unique_key = ?').get(unique_key),
        )
      }
      // Fallback if columns missing on very old DB mid-migration
      const result = db.prepare(`
        INSERT INTO notifications (type, title, body, link_path, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, title, body, link_path, nowIso())
      return enrichNotification(
        db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid),
      )
    }
  }

  function createNotification(args) {
    if (!cabinetSettings.isNotificationEnabled(args?.type)) return null
    return createNotificationRaw(args)
  }

  function markNotificationRead(id) {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), Number(id))
    return enrichNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(id)))
  }

  function markAllNotificationsRead() {
    // Mark only visible bell notifications as read
    const unread = db.prepare(`SELECT * FROM notifications WHERE read_at IS NULL`).all()
    const mark = db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ?`)
    const ts = nowIso()
    for (const row of unread) {
      if (isBellVisibleNotification(row)) mark.run(ts, row.id)
    }
    return getNotificationsBoard({ limit: 30 })
  }

  const slotReleaseNotifications = createSlotReleaseNotificationService(db)

  // Soft-hide historical mistaken proposal notifications (keep for audit, exclude from unread)
  try {
    db.prepare(`
      UPDATE notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE type IN ('slot_proposal', 'proposal_sent', 'slot_proposal_sent')
        AND read_at IS NULL
    `).run(nowIso())
    db.prepare(`
      UPDATE notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE type IN ('slot_released', 'slot_available_after_cancellation')
        AND source_event IS NOT NULL
        AND source_event != 'appointment_cancelled'
        AND read_at IS NULL
    `).run(nowIso())
  } catch { /* ignore */ }

  function notifySlotReleased(input = {}) {
    if (!cabinetSettings.isAutomationEnabled('slot_released')) return null
    if (!cabinetSettings.isAutomationEnabled('auto_release') && input?.sourceEvent !== 'appointment_cancelled') {
      return null
    }
    return slotReleaseNotifications.createSlotReleasedNotification(input)
  }

  function listPractitioners() {
    return db.prepare('SELECT * FROM practitioners WHERE active = 1 ORDER BY id ASC').all()
  }

  function listAppointmentTypes() {
    return db.prepare('SELECT * FROM appointment_types WHERE active = 1 ORDER BY id ASC').all()
  }

  // ---- Patient notes / tags / detail ----------------------------------------

  function listPatientNotes(customerId) {
    return db.prepare(`
      SELECT * FROM patient_notes WHERE customer_id = ? ORDER BY created_at DESC
    `).all(Number(customerId))
  }

  function addPatientNote(customerId, body, authorOrOptions = null) {
    let author_name = null
    let actor = null
    if (authorOrOptions && typeof authorOrOptions === 'object') {
      actor = authorOrOptions.actor || resolveActorFromOptions(authorOrOptions)
      author_name = actor?.displayName || authorOrOptions.author_name || null
    } else {
      author_name = authorOrOptions
      if (author_name) {
        actor = { type: 'human', displayName: String(author_name), role: null }
      }
    }
    const result = db.prepare(`
      INSERT INTO patient_notes (customer_id, body, author_name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(Number(customerId), String(body || '').trim(), author_name, nowIso())
    addTimelineEvent({
      customer_id: Number(customerId),
      event_type: 'note_added',
      title: 'Note ajoutée',
      detail: String(body || '').slice(0, 200),
      actor_type: 'human',
      actor_name: author_name,
    })
    try {
      activityHistory.recordActivity({
        event_type: 'note_added',
        category: 'patient',
        actor,
        source: 'dashboard',
        patient_id: Number(customerId),
        title: 'Note patient ajoutée',
        description: String(body || '').slice(0, 200),
        source_event_id: `note:${result.lastInsertRowid}`,
      })
    } catch { /* non-blocking */ }
    return db.prepare('SELECT * FROM patient_notes WHERE id = ?').get(result.lastInsertRowid)
  }

  function listPatientTags(customerId) {
    return db.prepare('SELECT * FROM patient_tags WHERE customer_id = ? ORDER BY tag ASC').all(Number(customerId))
  }

  function addPatientTag(customerId, tag) {
    const clean = String(tag || '').trim().toLowerCase()
    if (!clean) throw new Error('tag required')
    db.prepare(`
      INSERT OR IGNORE INTO patient_tags (customer_id, tag, created_at) VALUES (?, ?, ?)
    `).run(Number(customerId), clean, nowIso())
    return listPatientTags(customerId)
  }

  function getPatientDetail(customerId) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId))
    if (!customer) return null

    const board = getPatientsBoardEngine()
    const context = board.getPatientContext(customerId)
    if (!context) return null

    const upcoming = context.next_appointment
      ? {
        ...context.next_appointment,
        appointment_time: context.next_appointment.appointment_time,
      }
      : null

    return {
      patient: customer,
      next_appointment: upcoming
        ? db.prepare(`
            SELECT a.*, d.problem, d.description AS problem_details
            FROM appointments a
            LEFT JOIN dental_cases d ON d.appointment_id = a.id
            WHERE a.id = ?
          `).get(Number(upcoming.id))
        : null,
      last_appointment: db.prepare(`
        SELECT a.*, d.problem
        FROM appointments a
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.customer_id = ?
        ORDER BY a.appointment_date DESC, a.appointment_time DESC
        LIMIT 1
      `).get(Number(customerId)) || null,
      notes: context.notes || listPatientNotes(customerId),
      tags: context.tags || listPatientTags(customerId),
      timeline: context.timeline || listTimeline(customerId, { limit: 40 }),
      waitlist: context.waitlist || [],
      next_action: context.next_action?.label || 'Aucune action nécessaire',
      context,
    }
  }

  let patientsBoard = null

  function getPatientsBoardEngine() {
    if (!patientsBoard) {
      patientsBoard = createPatientsBoard(db, {
        listTimeline,
        listPatientNotes,
        listPatientTags,
        listWaitlist,
        listTasks,
      })
    }
    return patientsBoard
  }

  function listPatientsBoard(options = {}) {
    return getPatientsBoardEngine().listPatientsBoard(options)
  }

  function getPatientContext(customerId) {
    return getPatientsBoardEngine().getPatientContext(customerId)
  }

  function createManualPatient(input = {}) {
    return getPatientsBoardEngine().createManualPatient(input)
  }

  // ---- Today / Analytics / Search -------------------------------------------

  function getTodayDashboard() {
    ensureConversationsFromLegacy()
    const today = todayLocal()

    const waitingReply = db.prepare(`
      SELECT COUNT(*) AS c FROM conversations
      WHERE status IN ('TO_PROCESS', 'TRANSFERRED', 'WAITING_PATIENT')
        AND owner != 'HUMAN'
    `).get()?.c || 0

    const transferred = db.prepare(`
      SELECT COUNT(*) AS c FROM conversations
      WHERE status IN ('TRANSFERRED', 'HUMAN_CONTROLLED')
    `).get()?.c || 0

    const toConfirm = db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'non_confirme'
        AND appointment_date >= date('now', 'localtime')
    `).get()?.c || 0

    const toCall = db.prepare(`
      SELECT COUNT(*) AS c FROM tasks
      WHERE status IN ('to_call', 'waiting_response', 'planned')
        AND (due_at IS NULL OR date(due_at) <= date('now', 'localtime'))
    `).get()?.c || 0

    const dayAppointments = db.prepare(`
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.duration_minutes,
        c.id AS customer_id, c.full_name, c.phone_number,
        d.problem, d.description AS problem_details
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.appointment_date = ?
      ORDER BY a.appointment_time ASC
    `).all(today)

    const confirmedToday = dayAppointments.filter((a) => a.status === 'confirmed').length
    const pendingToday = dayAppointments.filter((a) => a.status === 'non_confirme').length
    const cancelledToday = dayAppointments.filter((a) => a.status === 'cancelled').length

    const availableSlots = countAvailableSlotsToday(today)

    const aiRecentRaw = listAiActions({ limit: 8 })
    const aiToday = {
      messages_auto: db.prepare(`
        SELECT COUNT(*) AS c FROM ai_actions
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
          AND action_type IN ('ai_reply', 'human_reply_sent')
      `).get()?.c || 0,
      appointments_created: db.prepare(`
        SELECT COUNT(*) AS c FROM appointments
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
      `).get()?.c || 0,
      followups_sent: db.prepare(`
        SELECT COUNT(*) AS c FROM ai_actions
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
          AND action_type LIKE '%follow%'
      `).get()?.c || 0,
      slots_recovered: db.prepare(`
        SELECT COUNT(*) AS c FROM ai_actions
        WHERE date(created_at, 'localtime') = date('now', 'localtime')
          AND action_type = 'slot_recovered'
      `).get()?.c || 0,
      transferred: Number(transferred),
      recent: aiRecentRaw.map(formatAiActionLine),
    }

    const frequentRaw = crmRepo?.frequentProblems
      ? crmRepo.frequentProblems(8)
      : db.prepare(`
          SELECT problem, COUNT(*) AS count FROM dental_cases
          GROUP BY problem ORDER BY count DESC LIMIT 8
        `).all()

    const frequent = normalizeFrequentProblems(frequentRaw)

    const clinic = getSetting('clinic', HEL_CLINIC)
    const assistant = getSetting('assistant', HEL_ASSISTANT)

    return {
      clinic,
      assistant: {
        name: assistant.name,
        active: assistant.active !== false,
      },
      attention: {
        waiting_reply: Number(waitingReply),
        to_confirm: Number(toConfirm),
        to_call: Number(toCall),
        transferred: Number(transferred),
      },
      kpis: {
        appointments_today: dayAppointments.length,
        confirmed: confirmedToday,
        pending: pendingToday,
        cancelled: cancelledToday,
        available_slots: availableSlots,
      },
      agenda: dayAppointments.map((row) => ({
        ...row,
        status_label: appointmentStatusLabel(row.status),
      })),
      available_slot_times: buildFreeSlotTimes(today).slice(0, 6),
      ai_activity: aiToday,
      frequent_requests: frequent,
      waitlist_count: db.prepare(`
        SELECT COUNT(*) AS c FROM waiting_list_entries WHERE status = 'active'
      `).get()?.c || 0,
    }
  }

  function buildFreeSlotTimes(dateIso) {
    const weekday = weekdayFromIsoDate(dateIso)
    if (weekday == null) return []
    const hours = WEEKLY_HOURS[weekday]
    if (!hours) return []
    const open = toMinutes(hours.open)
    const close = toMinutes(hours.close)
    if (open == null || close == null) return []
    const slots = []
    for (let m = open; m + 30 <= close; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      slots.push(`${hh}:${mm}`)
    }
    const taken = new Set(db.prepare(`
      SELECT appointment_time FROM appointments
      WHERE appointment_date = ? AND status IN ('non_confirme', 'confirmed')
    `).all(dateIso).map((r) => String(r.appointment_time || '').slice(0, 5)))
    return slots.filter((s) => !taken.has(s))
  }

  function normalizeFrequentProblems(rows) {
    const map = new Map()
    const skip = new Set(['motif patient', 'consultation générale', 'consultation generale', '—', '-'])
    for (const row of rows || []) {
      let problem = String(row.problem || '').trim().toLowerCase()
      if (!problem || skip.has(problem)) continue
      problem = problem
        .replace(/dentaire/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!problem) continue
      // Merge close variants
      if (problem.includes('détartrage') || problem.includes('detartrage')) problem = 'détartrage'
      if (problem.includes('urgence')) problem = 'urgence dentaire'
      if (problem.includes('orthodon')) problem = 'orthodontie'
      const prev = map.get(problem) || 0
      map.set(problem, prev + Number(row.count || 0))
    }
    return [...map.entries()]
      .map(([problem, count]) => ({
        problem: problem.charAt(0).toUpperCase() + problem.slice(1),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }

  let analyticsBoard = null

  function getAnalyticsBoardEngine() {
    if (!analyticsBoard) {
      analyticsBoard = createAnalyticsBoard(db, {
        listAiActions,
        frequentProblems: crmRepo?.frequentProblems
          ? (limit) => crmRepo.frequentProblems(limit)
          : null,
      })
    }
    return analyticsBoard
  }

  function getAnalyticsSummary(options = {}) {
    return getAnalyticsBoardEngine().getAnalyticsSummary(options)
  }

  function globalSearch(query, { limit = 20 } = {}) {
    const q = String(query || '').trim()
    if (!q) return { patients: [], appointments: [] }
    const like = `%${q}%`
    const lim = Math.max(1, Math.min(50, Number(limit) || 20))

    const patients = db.prepare(`
      SELECT id, full_name, phone_number, city FROM customers
      WHERE full_name LIKE ? OR phone_number LIKE ?
      ORDER BY full_name ASC LIMIT ?
    `).all(like, like, lim)

    const appointments = db.prepare(`
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status,
        c.full_name, c.phone_number
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE c.full_name LIKE ? OR c.phone_number LIKE ? OR a.appointment_date LIKE ?
      ORDER BY a.appointment_date DESC LIMIT ?
    `).all(like, like, like, lim).map((row) => ({
      ...row,
      status_label: appointmentStatusLabel(row.status),
    }))

    return { patients, appointments }
  }

  /**
   * Whether the bot may auto-reply for this WhatsApp chat (handoff + assistant pause).
   * (canonical implementation lives above — keep single definition)
   */

  // Mutable sender ref used by confirmation engine (bound from index.js)
  const helpersSendRef = { fn: null }

  appointmentConfirmation = createAppointmentConfirmationEngine(db, {
    addTimelineEvent,
    logAiAction,
    createTask,
    updateTask,
    createNotification,
    trackWhatsAppTurn,
    getOrCreateConversation,
    canAiAutoReply,
    matchWaitlistForSlot,
    addMessage,
    notifySlotReleased,
    getActiveConversationLanguage,
    getRemindersSettings: () => cabinetSettings.getRemindersSettings(),
    getAutomationsSettings: () => cabinetSettings.getAutomationsSettings(),
    isAutomationEnabled: (key) => cabinetSettings.isAutomationEnabled(key),
    isWithinSendWindow: (now) => cabinetSettings.isWithinSendWindow(now, cabinetSettings.getRemindersSettings()),
    nextAllowedSendTime: (now) => cabinetSettings.nextAllowedSendTime(now, cabinetSettings.getRemindersSettings()),
    get sendWhatsAppText() {
      return helpersSendRef.fn
    },
  })

  const slotProposals = createSlotProposalEngine(db, {
    addTimelineEvent,
    logAiAction,
    createNotification,
    trackWhatsAppTurn,
    getOrCreateConversation,
    notifySlotReleased,
    getActiveConversationLanguage,
    conversationKeyVariants,
    getAppointmentsSettings: () => cabinetSettings.getAppointmentsSettings(),
    get sendWhatsAppText() {
      return helpersSendRef.fn
    },
    registerBookingCreated: (...args) => appointmentConfirmation.registerBookingCreated(...args),
  })

  const whatsappCancel = createWhatsappCancelEngine(db, {
    getOrCreateConversation,
    addTimelineEvent,
    logAiAction,
    notifySlotReleased,
    getActiveConversationLanguage,
    getAppointmentsSettings: () => cabinetSettings.getAppointmentsSettings(),
    canCancelOrReschedule: (...args) => cabinetSettings.canCancelOrReschedule(...args),
    cancelAppointmentCore: (appointmentId, opts = {}) => (
      appointmentConfirmation.cancelAppointmentFromConfirmation(appointmentId, opts)
    ),
  })

  const availabilityFlow = createAvailabilityFlow(db, {
    getAppointmentsSettings: () => cabinetSettings.getAppointmentsSettings(),
    getLead: (id) => crmRepo?.getLead?.(id) || null,
    upsertLead: (id, patch) => crmRepo?.upsertLead?.(id, patch),
    resolveLeadConversationId: (chatKey) => {
      const key = String(chatKey || '').trim()
      const bare = key.replace(/^[^:]+:/, '')
      if (crmRepo?.getLead?.(key)) return key
      if (crmRepo?.getLead?.(`main:${bare}`)) return `main:${bare}`
      if (crmRepo?.getLead?.(bare)) return bare
      return key.startsWith('main:') ? key : `main:${bare}`
    },
  })

  const manualAppointmentFlow = createManualAppointmentFlow(db, {
    appointmentConfirmation,
    trackWhatsAppTurn,
    logAiAction,
    getSendWhatsAppText: () => helpersSendRef.fn,
  })

  function setAppointmentConfirmationSender(fn) {
    helpersSendRef.fn = typeof fn === 'function' ? fn : null
  }

  // Alias — same WhatsApp sender for slot proposals
  function setSlotProposalSender(fn) {
    helpersSendRef.fn = typeof fn === 'function' ? fn : null
  }

  return {
    getClinicSettings,
    updateAssistantSettings,
    updateClinicProfile,
    isAssistantActive,
    getOrCreateConversation,
    listConversations,
    getConversation,
    getConversationContext,
    getAgendaBoard,
    getAgendaAppointment,
    getAppointmentConfirmation,
    appointmentConfirmation,
    setAppointmentConfirmationSender,
    setSlotProposalSender,
    registerBookingCreated: (...args) => appointmentConfirmation.registerBookingCreated(...args),
    registerManualConfirmedAppointment: (...args) => (
      appointmentConfirmation.registerManualConfirmedAppointment(...args)
    ),
    completeManualAppointmentCreation: (...args) => (
      manualAppointmentFlow.completeManualAppointmentCreation(...args)
    ),
    handleInboundConfirmationReply: (...args) => appointmentConfirmation.handleInboundConfirmationReply(...args),
    runConfirmationTick: (...args) => appointmentConfirmation.runConfirmationTick(...args),
    confirmAppointmentViaEngine: (...args) => appointmentConfirmation.confirmAppointment(...args),
    slotProposals,
    searchPatientsForSlot: (...args) => slotProposals.searchPatientsForSlot(...args),
    createSlotProposal: (...args) => slotProposals.createAndSendProposal(...args),
    moveAppointmentDirect: (...args) => slotProposals.moveAppointmentDirect(...args),
    cancelSlotProposal: (...args) => slotProposals.cancelProposal(...args),
    handleInboundSlotProposalReply: (...args) => slotProposals.handleInboundProposalReply(...args),
    whatsappCancel,
    handleInboundCancel: (...args) => whatsappCancel.handleInboundCancel(...args),
    availabilityFlow,
    handleInboundAvailability: (...args) => availabilityFlow.handleInboundAvailability(...args),
    getBookableSlotsForDate: (...args) => availabilityFlow.getBookableSlotsForDate(...args),
    cancelAppointment: (...args) => whatsappCancel.executeCancel(...args),
    resolveConversationRouting: (chatKey) => {
      const lead = crmRepo?.getLead?.(chatKey) || null
      const availabilityState = availabilityFlow.getState?.(chatKey) || null
      return resolveConversationRoutingState(db, chatKey, lead, { availabilityState })
    },
    contextualClarificationMessage,
    hasPriorityOverBooking,
    logContextRouter,
    getCabinetSettingsBundle: () => cabinetSettings.getCabinetSettingsBundle(),
    getAppointmentsSettings: () => cabinetSettings.getAppointmentsSettings(),
    getRemindersSettings: () => cabinetSettings.getRemindersSettings(),
    getAutomationsSettings: () => cabinetSettings.getAutomationsSettings(),
    getSecuritySettings: () => cabinetSettings.getSecuritySettings(),
    getNotificationsSettings: () => cabinetSettings.getNotificationsSettings(),
    getSessionTtlMs: () => cabinetSettings.getSessionTtlMs(),
    updateAppointmentsSettings: (...args) => cabinetSettings.updateAppointmentsSettings(...args),
    updateRemindersSettings: (...args) => cabinetSettings.updateRemindersSettings(...args),
    updateAutomationsSettings: (...args) => cabinetSettings.updateAutomationsSettings(...args),
    updateSecuritySettings: (...args) => cabinetSettings.updateSecuritySettings(...args),
    updateNotificationsSettings: (...args) => cabinetSettings.updateNotificationsSettings(...args),
    validateBookingDateTime: (date, time) => cabinetSettings.validateBookingDateTime(
      date,
      time,
      cabinetSettings.getAppointmentsSettings(),
    ),
    canCancelOrReschedule: (...args) => cabinetSettings.canCancelOrReschedule(...args),
    listMessages,
    getMessage,
    addMessage,
    trackWhatsAppTurn,
    linkConversationIdentity,
    applyInboundLanguage,
    getActiveConversationLanguage,
    backfillMessagesFromLogs,
    buildConversationSuggestion,
    setHandoff,
    updateConversation,
    ensureConversationsFromLegacy,
    addTimelineEvent,
    listTimeline,
    logAiAction,
    listAiActions,
    listTasks,
    createTask,
    updateTask,
    ensureFollowUpTasks,
    getFollowUpsBoard,
    previewManualFollowup,
    sendManualFollowup,
    validateFollowupTasks,
    listFollowupValidationCandidates,
    listWaitlist,
    createWaitlistEntry,
    matchWaitlistForSlot,
    createWaitlistOffer,
    proposeSlotToWaitlist,
    acceptWaitlistOffer,
    listAutomations,
    updateAutomation,
    listKnowledge,
    upsertKnowledgeItem,
    listIntegrations,
    updateIntegration,
    listNotifications,
    getNotificationsBoard,
    createNotification,
    markNotificationRead,
    markAllNotificationsRead,
    notifySlotReleased,
    listPractitioners,
    listAppointmentTypes,
    listPatientNotes,
    addPatientNote,
    listPatientTags,
    addPatientTag,
    getPatientDetail,
    listPatientsBoard,
    getPatientContext,
    createManualPatient,
    getTodayDashboard,
    getAnalyticsSummary,
    globalSearch,
    listActivityHistory: (...args) => activityHistory.listActivityHistory(...args),
    getActivitySummary: (...args) => activityHistory.getActivitySummary(...args),
    getActivityEvent: (...args) => activityHistory.getActivityEvent(...args),
    exportActivityCsv: (...args) => activityHistory.exportActivityCsv(...args),
    exportActivityPdf: (...args) => activityHistory.exportActivityPdf(...args),
    recordActivity: (...args) => activityHistory.recordActivity(...args),
    recordUserAuditEvent: (...args) => activityHistory.recordUserAuditEvent(...args),
    recordAssistantAuditEvent: (...args) => activityHistory.recordAssistantAuditEvent(...args),
    listHistoryActorFilters: (...args) => activityHistory.listHistoryActorFilters(...args),
    backfillActivityHistory: (...args) => activityHistory.backfillFromLegacy(...args),
    canAiAutoReply,
    countAvailableSlotsToday,
    contacts,
    labels: {
      conversationStatusLabel,
      appointmentStatusLabel,
      automationTriggerLabel,
      automationActionLabel,
      capabilityLabel,
      guardrailLabel,
      confirmationPolicyLabel,
      formatDelayMinutes,
    },
    HEL_CLINIC,
    HEL_ASSISTANT,
  }
}

module.exports = {
  createSmartCrm,
}
