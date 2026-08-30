/**
 * Single source of truth for outbound patient message language.
 *
 * Priority:
 * 1. conversations.language via getActiveConversationLanguage(chatKey)
 * 2. persisted DB lookup (customer conversation, key variants, recent patient messages)
 * 3. conversationLanguage field on a joined row
 * 4. inboundLanguageHint (current patient message)
 * 5. patient preferred_language
 * 6. fr (logged as fallback)
 */

const { normalizeActiveLanguage } = require('./conversation-language')
const { detectLanguageWithConfidence } = require('../../voice-nlu/language')
const { extractJid } = require('./contact-resolver')

function buildKeyVariants(key, conversationKeyVariants) {
  if (typeof conversationKeyVariants === 'function') {
    return conversationKeyVariants(key)
  }
  const raw = String(key || '').trim()
  if (!raw) return []
  const jid = extractJid(raw) || raw
  const bare = raw.replace(/^[^:]+:/, '')
  return [...new Set([raw, jid, bare, jid ? `main:${jid}` : ''].filter(Boolean))]
}

/**
 * Deep DB lookup when in-memory getter misses (key mismatch, scheduler, dashboard).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   customerId?: number|null,
 *   chatKey?: string|null,
 *   appointmentConversationId?: string|null,
 *   conversationDbId?: number|null,
 * }} input
 * @param {{ conversationKeyVariants?: (key: string) => string[] }} helpers
 * @returns {{ language: 'fr'|'darija'|null, source: string|null }}
 */
function lookupPersistedConversationLanguage(db, input = {}, helpers = {}) {
  if (!db) return { language: null, source: null }

  const customerId = input.customerId ? Number(input.customerId) : null
  const conversationDbId = input.conversationDbId ? Number(input.conversationDbId) : null
  const chatKey = String(input.chatKey || input.appointmentConversationId || '').trim()
  const variants = buildKeyVariants(chatKey, helpers.conversationKeyVariants)

  if (conversationDbId) {
    const row = db.prepare('SELECT language, customer_id FROM conversations WHERE id = ?').get(conversationDbId)
    const lang = normalizeActiveLanguage(row?.language)
    const ownerMismatch = customerId && row?.customer_id
      && Number(row.customer_id) !== Number(customerId)
    if (lang && !ownerMismatch) {
      return { language: lang, source: 'conversation_db_id' }
    }
  }

  if (customerId) {
    const row = db.prepare(`
      SELECT language FROM conversations
      WHERE customer_id = ?
        AND language IS NOT NULL AND TRIM(language) != ''
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(customerId)
    const lang = normalizeActiveLanguage(row?.language)
    if (lang) return { language: lang, source: 'conversation_customer_id' }
  }

  for (const variant of variants) {
    const row = db.prepare('SELECT language FROM conversations WHERE external_key = ?').get(variant)
    const lang = normalizeActiveLanguage(row?.language)
    if (lang) return { language: lang, source: 'conversation_external_key' }
  }

  if (customerId) {
    const cust = db.prepare(`
      SELECT phone_number, whatsapp_chat_id, preferred_language
      FROM customers WHERE id = ?
    `).get(customerId)

    if (cust?.whatsapp_chat_id) {
      for (const variant of buildKeyVariants(cust.whatsapp_chat_id, helpers.conversationKeyVariants)) {
        const row = db.prepare('SELECT language FROM conversations WHERE external_key = ?').get(variant)
        const lang = normalizeActiveLanguage(row?.language)
        if (lang) return { language: lang, source: 'customer_whatsapp_chat_id' }
      }
    }

    if (cust?.phone_number) {
      const row = db.prepare(`
        SELECT language FROM conversations
        WHERE phone_e164 = ?
          AND language IS NOT NULL AND TRIM(language) != ''
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(cust.phone_number)
      const lang = normalizeActiveLanguage(row?.language)
      if (lang) return { language: lang, source: 'conversation_phone' }
    }
  }

  const convIds = []
  for (const variant of variants) {
    const row = db.prepare('SELECT id FROM conversations WHERE external_key = ?').get(variant)
    if (row?.id) convIds.push(row.id)
  }
  if (customerId) {
    const rows = db.prepare('SELECT id FROM conversations WHERE customer_id = ?').all(customerId)
    for (const r of rows) convIds.push(r.id)
  }

  const uniqueConvIds = [...new Set(convIds.filter(Boolean))]
  if (uniqueConvIds.length) {
    const placeholders = uniqueConvIds.map(() => '?').join(',')
    const msgs = db.prepare(`
      SELECT body FROM messages
      WHERE conversation_id IN (${placeholders})
        AND direction = 'inbound'
        AND author_type IN ('patient', 'user', 'customer')
        AND body IS NOT NULL AND TRIM(body) != ''
      ORDER BY created_at DESC
      LIMIT 12
    `).all(...uniqueConvIds)

    for (const msg of msgs) {
      const det = detectLanguageWithConfidence(msg.body || '')
      const lang = normalizeActiveLanguage(det.language)
      if (det.reliable && lang) {
        return { language: lang, source: 'inbound_messages' }
      }
    }
  }

  return { language: null, source: null }
}

function getConversationRowForChat(db, chatKey, conversationKeyVariants) {
  if (!db || !chatKey) return null
  for (const variant of buildKeyVariants(chatKey, conversationKeyVariants)) {
    const row = db.prepare('SELECT id, customer_id, language FROM conversations WHERE external_key = ?').get(variant)
    if (row) return row
  }
  return null
}

function isSharedContactMismatch(db, chatKey, customerId, conversationKeyVariants) {
  if (!db || !customerId || !chatKey) return false
  const row = getConversationRowForChat(db, chatKey, conversationKeyVariants)
  return Boolean(row?.customer_id && Number(row.customer_id) !== Number(customerId))
}

/**
 * @param {{
 *   chatKey?: string|null,
 *   customerId?: number|null,
 *   conversationDbId?: number|null,
 *   appointmentConversationId?: string|null,
 *   conversationLanguage?: string|null,
 *   patientPreferredLanguage?: string|null,
 *   inboundLanguageHint?: string|null,
 *   getActiveConversationLanguage?: ((chatKey: string) => string|null|undefined)|null,
 *   db?: import('node:sqlite').DatabaseSync|null,
 *   conversationKeyVariants?: (key: string) => string[],
 * }} input
 * @returns {{ language: 'fr'|'darija', source: string, languageFallback?: boolean }}
 */
function resolvePatientLanguage(input = {}) {
  const chatKey = String(input.chatKey || input.appointmentConversationId || '').trim()
  const getter = input.getActiveConversationLanguage
  const sharedMismatch = isSharedContactMismatch(
    input.db,
    chatKey,
    input.customerId,
    input.conversationKeyVariants,
  )

  if (getter && chatKey && !sharedMismatch) {
    try {
      const active = normalizeActiveLanguage(getter(chatKey))
      if (active) {
        if (process.env.CRM_DEBUG_LANGUAGE === '1') {
          console.log('[LANGUAGE]', { resolved: active, source: 'conversation_active', chatKey })
        }
        return { language: active, source: 'conversation_active' }
      }
    } catch {
      /* keep */
    }
  }

  if (input.db) {
    const looked = lookupPersistedConversationLanguage(input.db, {
      customerId: input.customerId,
      chatKey,
      appointmentConversationId: input.appointmentConversationId,
      conversationDbId: input.conversationDbId,
    }, { conversationKeyVariants: input.conversationKeyVariants })
    const skipSharedChatLang = sharedMismatch && (
      looked.source === 'conversation_external_key'
      || looked.source === 'conversation_phone'
      || looked.source === 'customer_whatsapp_chat_id'
      || looked.source === 'inbound_messages'
    )
    if (looked.language && !skipSharedChatLang) {
      if (process.env.CRM_DEBUG_LANGUAGE === '1') {
        console.log('[LANGUAGE]', {
          resolved: looked.language,
          source: looked.source,
          chatKey,
          customerId: input.customerId || null,
        })
      }
      return { language: looked.language, source: looked.source || 'persisted_lookup' }
    }
  }

  if (sharedMismatch) {
    const pref = normalizeActiveLanguage(input.patientPreferredLanguage)
    if (pref) {
      if (process.env.CRM_DEBUG_LANGUAGE === '1') {
        console.log('[LANGUAGE]', {
          resolved: pref,
          source: 'patient_preferred_shared_contact',
          customerId: input.customerId,
        })
      }
      return { language: pref, source: 'patient_preferred_shared_contact' }
    }
  }

  const convLang = normalizeActiveLanguage(input.conversationLanguage)
  if (convLang) {
    if (process.env.CRM_DEBUG_LANGUAGE === '1') {
      console.log('[LANGUAGE]', { resolved: convLang, source: 'conversation_field' })
    }
    return { language: convLang, source: 'conversation_field' }
  }

  const inboundHint = normalizeActiveLanguage(input.inboundLanguageHint)
  if (inboundHint) {
    if (process.env.CRM_DEBUG_LANGUAGE === '1') {
      console.log('[LANGUAGE]', { resolved: inboundHint, source: 'inbound_hint' })
    }
    return { language: inboundHint, source: 'inbound_hint' }
  }

  const patientLang = normalizeActiveLanguage(input.patientPreferredLanguage)
  if (patientLang) {
    if (process.env.CRM_DEBUG_LANGUAGE === '1') {
      console.log('[LANGUAGE]', { resolved: patientLang, source: 'patient_preferred' })
    }
    return { language: patientLang, source: 'patient_preferred' }
  }

  if (process.env.CRM_DEBUG_LANGUAGE === '1' || process.env.NODE_ENV !== 'production') {
    console.log('[LANGUAGE]', {
      resolved: 'fr',
      source: 'fallback',
      languageFallback: true,
      chatKey: chatKey || null,
      customerId: input.customerId || null,
    })
  }
  return { language: 'fr', source: 'fallback', languageFallback: true }
}

/**
 * Convenience wrapper for appointment/customer rows from SQL joins.
 * @param {object|null|undefined} row
 * @param {{
 *   chatKey?: string|null,
 *   conversationDbId?: number|null,
 *   getActiveConversationLanguage?: Function|null,
 *   inboundLanguageHint?: string|null,
 *   db?: import('node:sqlite').DatabaseSync|null,
 *   conversationKeyVariants?: (key: string) => string[],
 * }} helpers
 * @returns {{ language: 'fr'|'darija', source: string, languageFallback?: boolean }}
 */
function resolvePatientLanguageFromRow(row, helpers = {}) {
  if (!row) return { language: 'fr', source: 'fallback', languageFallback: true }
  const chatKey = helpers.chatKey
    || row.whatsapp_chat_id
    || row.chat_key
    || row.conversation_id
    || null
  return resolvePatientLanguage({
    chatKey,
    customerId: row.customer_id || helpers.customerId || null,
    conversationDbId: helpers.conversationDbId || row.conversation_db_id || null,
    appointmentConversationId: row.conversation_id || null,
    conversationLanguage: row.conversation_language || row.language || null,
    patientPreferredLanguage: row.preferred_language,
    inboundLanguageHint: helpers.inboundLanguageHint || null,
    getActiveConversationLanguage: helpers.getActiveConversationLanguage,
    db: helpers.db || null,
    conversationKeyVariants: helpers.conversationKeyVariants,
  })
}

module.exports = {
  resolvePatientLanguage,
  resolvePatientLanguageFromRow,
  lookupPersistedConversationLanguage,
  isSharedContactMismatch,
}
