/**
 * WhatsApp contact → patient display resolution.
 * Never expose @lid / technical JIDs in the UI.
 * Never invent a phone number from a LID numeric id.
 */

const { toE164, formatPhoneDisplay, normalizePhoneDigits, digitsOnly, isValidPhone } = require('../phone')

function nowIso() {
  return new Date().toISOString()
}

function isTechnicalWhatsAppId(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return true
  if (raw.includes('@lid')) return true
  if (raw.includes('@broadcast') || raw === 'status@broadcast') return true
  if (raw.includes('@g.us')) return false
  if (/^\d{10,}@lid$/.test(raw)) return true
  if (/^main:\d+@lid$/.test(raw)) return true
  return false
}

function stripInstancePrefix(value) {
  return String(value || '').replace(/^[^:]+:/, '').trim()
}

function extractJid(value) {
  const raw = stripInstancePrefix(value)
  if (!raw) return ''
  return raw
}

/**
 * @param {string} value
 * @returns {{ jid: string, digits: string, e164: string, isLid: boolean, isGroup: boolean, isPhoneJid: boolean }}
 */
function parseWhatsAppId(value) {
  const jid = extractJid(value)
  const lower = jid.toLowerCase()
  const isLid = lower.includes('@lid')
  const isGroup = lower.includes('@g.us')
  const isPhoneJid = lower.includes('@c.us') || lower.includes('@s.whatsapp.net')
  const digits = digitsOnly(jid.split('@')[0] || '')
  // LID numeric ids are NOT phone numbers — never invent E.164 from them
  let e164 = ''
  if (!isLid && !isGroup && isPhoneJid && digits) {
    const normalized = normalizePhoneDigits(digits)
    if (/^212[5-7]\d{8}$/.test(normalized)) {
      e164 = `+${normalized}`
    }
  }
  return { jid, digits, e164, isLid, isGroup, isPhoneJid }
}

/**
 * Extract a verified phone from a whatsapp-web.js Contact-like object.
 * Never treat LID ids as phones.
 */
function extractPhoneFromWaContact(contact) {
  if (!contact || typeof contact !== 'object') return null
  const serialized = String(contact?.id?._serialized || contact?.id || '').trim()
  const parsed = parseWhatsAppId(serialized)
  if (parsed.e164) return parsed.e164

  const candidates = [
    contact.number,
    contact?.id?.user,
    contact?.phoneNumber,
    contact?._data?.phoneNumber,
    contact?._data?.userid,
  ]
  for (const raw of candidates) {
    const text = String(raw || '').trim()
    if (!text) continue
    if (/@lid/i.test(text)) continue
    // contact.number is often digits without @c.us — for LID contacts that equals the LID user id
    if (parsed.isLid && text === parsed.digits) continue
    const e164 = coerceReliablePhone(text)
    if (e164) return e164
  }
  return null
}

/**
 * Accept only verified Moroccan mobiles/landlines — never invent from LID digits.
 * @param {string} value
 * @returns {string|null} +212…
 */
function coerceReliablePhone(value) {
  const raw = String(value || '').trim()
  if (!raw || /@lid/i.test(raw)) return null
  // Prefer phone JIDs
  if (/@c\.us$/i.test(raw) || /@s\.whatsapp\.net$/i.test(raw)) {
    const parsed = parseWhatsAppId(raw)
    return parsed.e164 || null
  }
  const e164 = toE164(raw)
  if (e164 && isValidPhone(e164) && /^212[5-7]\d{8}$/.test(normalizePhoneDigits(e164))) {
    return e164
  }
  return null
}

/**
 * Async enrichment: try Contact.getFormattedNumber / WA store for a real phone.
 * Safe for @lid — rejects results that equal LID digits.
 */
async function resolvePhoneFromWhatsAppContact(contact, options = {}) {
  const sync = extractPhoneFromWaContact(contact)
  if (sync) return sync

  const serialized = String(contact?.id?._serialized || contact?.id || '').trim()
  const parsed = parseWhatsAppId(serialized)
  const client = options.client || contact?.client || null

  // getFormattedNumber only works for phone JIDs in wwebjs 1.34.x
  if (!parsed.isLid && typeof contact?.getFormattedNumber === 'function') {
    try {
      const formatted = await contact.getFormattedNumber()
      const e164 = coerceReliablePhone(formatted)
      if (e164) return e164
    } catch {
      // ignore
    }
  }

  if (parsed.isLid && client?.pupPage) {
    try {
      const candidates = await client.pupPage.evaluate(async (lidId) => {
        const out = []
        const push = (v) => {
          if (v == null) return
          const s = String(v).trim()
          if (s) out.push(s)
        }
        try {
          const collections = window.require('WAWebCollections')
          const contactModel = collections?.Contact?.get?.(lidId)
            || (collections?.Contact?.find ? await collections.Contact.find(lidId) : null)
          if (contactModel) {
            push(contactModel.phoneNumber)
            push(contactModel.__x_phoneNumber)
            push(contactModel.id?._serialized)
            push(contactModel.id)
            // Some builds keep a parallel @c.us id
            push(contactModel.phoneNumberUser)
          }
        } catch {
          // ignore
        }
        try {
          const mapMod = window.require('WAWebLidPnMapping')
          if (mapMod?.getPNForLID) {
            const pn = await mapMod.getPNForLID(lidId)
            push(pn?._serialized || pn?.user || pn)
          }
          if (mapMod?.lidToPn) {
            const pn = await mapMod.lidToPn(lidId)
            push(pn?._serialized || pn?.user || pn)
          }
        } catch {
          // ignore
        }
        return out
      }, serialized)

      for (const raw of candidates || []) {
        if (parsed.digits && digitsOnly(raw) === parsed.digits) continue
        const e164 = coerceReliablePhone(raw)
        if (e164) return e164
      }
    } catch {
      // LID→phone mapping unavailable in this WhatsApp Web build
    }
  }

  return null
}

function looksLikePersonName(value) {
  const name = String(value || '').trim()
  if (!name) return false
  if (isTechnicalWhatsAppId(name)) return false
  if (name.includes('@')) return false
  if (/^\+?\d[\d\s.-]{6,}$/.test(name)) return false
  if (name.length < 2 || name.length > 80) return false
  if (/[?؟]/.test(name)) return false
  const lower = name.toLowerCase()
  const badStarts = [
    'bghit', 'salam', 'bonjour', 'bonsoir', 'hello', 'cv', 'sba7', '3ndi', 'wach',
    'ymkn', 'imken', 'momkin', 'nakhdo', 'nakhod', 'merci', 'je veux', 'possible',
  ]
  if (badStarts.some((b) => lower === b || lower.startsWith(`${b} `))) return false
  try {
    const { validateFullName } = require('../name-validator')
    if (validateFullName(name)) return true
  } catch {
    // fall through
  }
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return false
  return false
}

/**
 * Build a UI-safe display label for a conversation/patient.
 */
function resolveDisplayIdentity(input = {}) {
  const {
    full_name = null,
    phone_number = null,
    whatsapp_chat_id = null,
    external_key = null,
    contact_name = null,
    push_name = null,
  } = input

  const parsed = parseWhatsAppId(whatsapp_chat_id || external_key || '')
  const phone = toE164(phone_number) || parsed.e164 || ''
  const phoneDisplay = phone ? formatPhoneDisplay(phone) : ''

  const candidates = [full_name, contact_name, push_name].filter(looksLikePersonName)
  if (candidates.length) {
    return {
      display_name: candidates[0],
      subtitle: phoneDisplay || null,
      phone_e164: phone || null,
      phone_display: phoneDisplay || null,
      is_unknown: false,
      technical_id: parsed.jid || null,
    }
  }

  if (phoneDisplay) {
    return {
      display_name: 'Contact WhatsApp',
      subtitle: phoneDisplay,
      phone_e164: phone,
      phone_display: phoneDisplay,
      is_unknown: true,
      technical_id: parsed.jid || null,
    }
  }

  // Soft WhatsApp pushname as display only (not CRM full name)
  const softName = [contact_name, push_name]
    .map((v) => String(v || '').trim())
    .find((v) => v && !isTechnicalWhatsAppId(v) && !v.includes('@') && v.length >= 2 && v.length <= 40)

  return {
    display_name: softName || 'Contact WhatsApp',
    subtitle: null,
    phone_e164: null,
    phone_display: null,
    is_unknown: true,
    technical_id: parsed.jid || null,
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createContactResolver(db) {
  function findCustomerByPhone(phone) {
    const e164 = toE164(phone)
    if (!e164) return null
    return db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(e164) || null
  }

  function findCustomerByWhatsAppId(chatId) {
    const jid = extractJid(chatId)
    if (!jid) return null
    const byExact = db.prepare('SELECT * FROM customers WHERE whatsapp_chat_id = ?').get(jid)
    if (byExact) return byExact
    const withPrefix = db.prepare('SELECT * FROM customers WHERE whatsapp_chat_id = ?').get(`main:${jid}`)
    if (withPrefix) return withPrefix
    const rows = db.prepare(`
      SELECT * FROM customers
      WHERE whatsapp_chat_id IS NOT NULL
        AND (whatsapp_chat_id = ? OR whatsapp_chat_id LIKE ?)
      LIMIT 5
    `).all(jid, `%${jid}`)
    return rows[0] || null
  }

  function findIdentity(whatsappId) {
    const jid = extractJid(whatsappId)
    if (!jid) return null
    return db.prepare('SELECT * FROM whatsapp_identities WHERE whatsapp_id = ?').get(jid)
      || db.prepare('SELECT * FROM whatsapp_identities WHERE whatsapp_lid = ?').get(jid)
      || null
  }

  function findLeadPhone(whatsappId) {
    const jid = extractJid(whatsappId)
    if (!jid) return null
    const lead = db.prepare(`
      SELECT phone_number, full_name, whatsapp_chat_id, conversation_id
      FROM crm_leads
      WHERE whatsapp_chat_id = ?
         OR whatsapp_chat_id = ?
         OR conversation_id = ?
         OR conversation_id LIKE ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(jid, `main:${jid}`, jid, `%${jid}`)
    if (!lead) return null
    const e164 = lead.phone_number ? toE164(lead.phone_number) : null
    return {
      phone_e164: e164 && isValidPhone(e164) ? e164 : null,
      full_name: lead.full_name || null,
    }
  }

  /**
   * Persist WhatsApp id ↔ phone / customer. Never stores LID digits as phone.
   */
  function linkWhatsAppIdentity({
    whatsapp_id = null,
    phone_number = null,
    customer_id = null,
    push_name = null,
    source = 'unknown',
  } = {}) {
    const jid = extractJid(whatsapp_id)
    if (!jid || jid.includes('@broadcast') || jid.includes('@g.us')) return null

    const parsed = parseWhatsAppId(jid)
    const phone = toE164(phone_number)
    if (phone && !isValidPhone(phone)) {
      // Reject non-Moroccan junk carefully — still allow valid E.164 mobiles
      if (!/^212[5-7]\d{8}$/.test(normalizePhoneDigits(phone))) {
        return null
      }
    }
    const safePhone = phone && /^212[5-7]\d{8}$/.test(normalizePhoneDigits(phone)) ? phone : null

    let customer = null
    if (customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customer_id)) || null
    }
    if (!customer && safePhone) {
      customer = findCustomerByPhone(safePhone)
    }

    const existing = findIdentity(jid)
    const nextCustomerId = customer?.id || existing?.customer_id || null
    const nextPhone = safePhone || existing?.phone_e164 || customer?.phone_number || null
    const nextPush = push_name || existing?.push_name || null
    const lid = parsed.isLid ? jid : (existing?.whatsapp_lid || null)

    if (existing) {
      db.prepare(`
        UPDATE whatsapp_identities
        SET customer_id = COALESCE(?, customer_id),
            phone_e164 = COALESCE(?, phone_e164),
            push_name = COALESCE(?, push_name),
            whatsapp_lid = COALESCE(?, whatsapp_lid),
            source = ?,
            updated_at = ?
        WHERE id = ?
      `).run(nextCustomerId, nextPhone, nextPush, lid, source, nowIso(), existing.id)
    } else {
      db.prepare(`
        INSERT INTO whatsapp_identities (
          whatsapp_id, whatsapp_lid, customer_id, phone_e164, push_name, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(jid, lid, nextCustomerId, nextPhone, nextPush, source, nowIso(), nowIso())
    }

    // Keep customer.whatsapp_chat_id in sync when we know the WA id
    if (nextCustomerId) {
      db.prepare(`
        UPDATE customers
        SET whatsapp_chat_id = COALESCE(whatsapp_chat_id, ?),
            last_contact_at = ?
        WHERE id = ?
      `).run(jid, nowIso(), nextCustomerId)
    }

    // Update conversations that use this external key
    try {
      db.prepare(`
        UPDATE conversations
        SET customer_id = COALESCE(customer_id, ?),
            phone_e164 = COALESCE(?, phone_e164),
            whatsapp_lid = COALESCE(?, whatsapp_lid),
            updated_at = ?
        WHERE external_key = ? OR external_key = ? OR external_key LIKE ?
      `).run(
        nextCustomerId,
        nextPhone,
        lid,
        nowIso(),
        jid,
        `main:${jid}`,
        `%${jid}`,
      )
    } catch {
      // columns may not exist on very old DBs mid-migrate
    }

    return findIdentity(jid)
  }

  /**
   * Resolve patient for a WhatsApp conversation key / chat id.
   * Priority: linked customer → identity mapping → phone jid → lead phone → unknown
   */
  function resolveContact({
    external_key = null,
    whatsapp_chat_id = null,
    phone_number = null,
    contact_name = null,
    push_name = null,
    customer_id = null,
    conversation_phone = null,
  } = {}) {
    const key = extractJid(whatsapp_chat_id || external_key || '')
    let customer = null
    let phoneSource = null
    let resolvedPhone = toE164(phone_number) || toE164(conversation_phone) || null

    if (customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customer_id)) || null
      if (customer?.phone_number) {
        resolvedPhone = toE164(customer.phone_number) || resolvedPhone
        phoneSource = 'customer'
      }
    }

    const identity = key ? findIdentity(key) : null
    if (!customer && identity?.customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(identity.customer_id)) || null
    }
    if (!resolvedPhone && identity?.phone_e164) {
      resolvedPhone = toE164(identity.phone_e164)
      phoneSource = phoneSource || 'whatsapp_identity'
    }
    if (customer?.phone_number) {
      resolvedPhone = toE164(customer.phone_number) || resolvedPhone
      phoneSource = phoneSource || 'customer'
    }

    if (!customer) {
      customer = findCustomerByWhatsAppId(key)
      if (customer?.phone_number) {
        resolvedPhone = toE164(customer.phone_number) || resolvedPhone
        phoneSource = phoneSource || 'customer_whatsapp_id'
      }
    }

    if (!resolvedPhone && key) {
      const parsed = parseWhatsAppId(key)
      if (parsed.e164) {
        resolvedPhone = parsed.e164
        phoneSource = phoneSource || 'phone_jid'
      }
    }

    let leadName = null
    if (key) {
      const leadHit = findLeadPhone(key)
      if (leadHit?.phone_e164 && !resolvedPhone) {
        resolvedPhone = leadHit.phone_e164
        phoneSource = phoneSource || 'crm_lead'
        if (!customer) customer = findCustomerByPhone(resolvedPhone)
      }
      if (leadHit?.full_name) leadName = leadHit.full_name
    }

    if (!customer && resolvedPhone) {
      customer = findCustomerByPhone(resolvedPhone)
      if (customer) phoneSource = phoneSource || 'customer_phone_match'
    }

    // Same WhatsApp phone may serve several patients — not an error
    if (resolvedPhone) {
      const matches = db.prepare('SELECT id, full_name FROM customers WHERE phone_number = ?').all(resolvedPhone)
      if (matches.length > 1 && !customer_id) {
        // Prefer conversation.customer_id when set; otherwise leave first match for display only
        console.info('[IDENTITY_RESOLUTION] shared contact phone — multiple patients', {
          phone: resolvedPhone,
          patient_ids: matches.map((m) => m.id),
        })
      }
    }

    const identityOut = resolveDisplayIdentity({
      full_name: customer?.full_name || leadName || null,
      phone_number: resolvedPhone || customer?.phone_number || null,
      whatsapp_chat_id: customer?.whatsapp_chat_id || key,
      external_key: key,
      contact_name: contact_name || identity?.push_name || null,
      push_name: push_name || identity?.push_name || null,
    })

    return {
      customer,
      customer_id: customer?.id || identity?.customer_id || null,
      phone_source: phoneSource,
      ...identityOut,
    }
  }

  return {
    resolveContact,
    linkWhatsAppIdentity,
    findCustomerByPhone,
    findCustomerByWhatsAppId,
    findIdentity,
    parseWhatsAppId,
    resolveDisplayIdentity,
    extractPhoneFromWaContact,
    isTechnicalWhatsAppId,
    looksLikePersonName,
  }
}

module.exports = {
  createContactResolver,
  resolveDisplayIdentity,
  parseWhatsAppId,
  isTechnicalWhatsAppId,
  looksLikePersonName,
  extractJid,
  stripInstancePrefix,
  extractPhoneFromWaContact,
  resolvePhoneFromWhatsAppContact,
  coerceReliablePhone,
}
