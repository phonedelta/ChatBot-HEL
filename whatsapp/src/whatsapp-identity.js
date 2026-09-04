/**
 * WhatsApp transport identity — phone JID vs LID vs other.
 * Never treat a LID (or LID user digits) as a telephone number.
 * Never branch on Android vs iOS.
 */

const {
  parseWhatsAppId,
  coerceReliablePhone,
  extractPhoneFromWaContact,
  resolvePhoneFromWhatsAppContact,
} = require('./crm/smart/contact-resolver')
const { formatPhoneDisplay, toE164, isValidPhone } = require('./crm/phone')

function serializedOf(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') {
    return String(value._serialized || value.serialized || value.id || '').trim()
  }
  return String(value).trim()
}

function jidsEqual(a, b) {
  const left = serializedOf(a).toLowerCase()
  const right = serializedOf(b).toLowerCase()
  if (!left || !right) return false
  if (left === right) return true
  const pa = parseWhatsAppId(left)
  const pb = parseWhatsAppId(right)
  if (pa.jid && pb.jid && pa.jid.toLowerCase() === pb.jid.toLowerCase()) return true
  return false
}

/**
 * @param {string} value
 */
function classifyJid(value) {
  const parsed = parseWhatsAppId(value)
  const lower = String(parsed.jid || '').toLowerCase()
  let jidType = 'other'
  if (parsed.isLid) jidType = 'lid'
  else if (parsed.isPhoneJid) jidType = 'phone'
  else if (parsed.isGroup) jidType = 'group'
  else if (lower.endsWith('@broadcast') || lower.endsWith('@newsletter') || lower === 'status@broadcast') {
    jidType = 'broadcast'
  }

  const phoneNumber = parsed.e164 || null
  return {
    jid: parsed.jid || serializedOf(value),
    jidType,
    phoneNumber,
    displayPhone: phoneNumber ? formatPhoneDisplay(phoneNumber) : null,
    isPrivate: jidType === 'phone' || jidType === 'lid',
    isGroup: jidType === 'group',
    isBroadcast: jidType === 'broadcast',
    resolved: Boolean(phoneNumber),
    stableAccountId: parsed.jid || serializedOf(value),
  }
}

function isPrivateChatJid(value) {
  const c = classifyJid(value)
  return c.isPrivate
}

function isIgnorableChatJid(value) {
  const c = classifyJid(value)
  return c.isBroadcast || c.jidType === 'other' && !c.jid
}

/**
 * Prefer the provider chat JID from the live message; never rebuild blindly from phone.
 */
function resolveReplyDestination({ chatJid = '', senderJid = '', phoneNumber = '' } = {}) {
  const chat = classifyJid(chatJid)
  if (chat.isPrivate && chat.jid.includes('@')) {
    return { destinationJid: chat.jid, phoneNumber: chat.phoneNumber || phoneNumber || null }
  }
  const sender = classifyJid(senderJid)
  if (sender.isPrivate && sender.jid.includes('@')) {
    return { destinationJid: sender.jid, phoneNumber: sender.phoneNumber || phoneNumber || null }
  }
  const phone = coerceReliablePhone(phoneNumber) || toE164(phoneNumber) || ''
  return { destinationJid: null, phoneNumber: phone || null }
}

/**
 * Direction that does not trust fromMe alone (LID sessions can mis-flag inbound).
 */
function resolveMessageDirection(message, ownSerialized) {
  const from = serializedOf(message?.from)
  const to = serializedOf(message?.to)
  const flagFromMe = Boolean(message?.fromMe)
  const own = serializedOf(ownSerialized)

  if (own) {
    const fromIsOwn = jidsEqual(from, own)
    const toIsOwn = jidsEqual(to, own)
    if (toIsOwn && from && !fromIsOwn) {
      return { fromMe: false, chatJid: from, senderJid: from }
    }
    if (fromIsOwn && to && !toIsOwn) {
      return { fromMe: true, chatJid: to, senderJid: own }
    }
  }

  if (flagFromMe) {
    return { fromMe: true, chatJid: to || from, senderJid: own || from }
  }
  return { fromMe: false, chatJid: from || to, senderJid: from || to }
}

function sanitizeAccountPhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/@lid/i.test(raw) || /@g\.us/i.test(raw) || /@broadcast/i.test(raw)) return null
  const classified = classifyJid(raw)
  if (classified.jidType === 'lid') return null
  const phone = coerceReliablePhone(raw) || classified.phoneNumber
  if (phone && isValidPhone(phone)) return phone
  return null
}

function extractWidSerialized(client) {
  const info = client?.info || {}
  return serializedOf(info?.wid || info?.me)
}

async function resolvePhoneViaWaStore(client, lidSerialized) {
  if (!client?.pupPage || !lidSerialized) return null
  try {
    const candidates = await client.pupPage.evaluate(async (lidId) => {
      const out = []
      const push = (v) => {
        if (v == null) return
        const s = String(v).trim()
        if (s) out.push(s)
      }
      try {
        const Conn = window.require('WAWebConnModel')?.Conn
        push(Conn?.phone)
        push(Conn?.wid?._serialized)
        push(Conn?.wid)
      } catch { /* ignore */ }
      try {
        const prefs = window.require('WAWebUserPrefsMeUser')
        const me = prefs?.getMeUser?.() || prefs?.getMaybeMePnUser?.()
        push(me?._serialized || me?.user)
      } catch { /* ignore */ }
      try {
        const collections = window.require('WAWebCollections')
        const contactModel = collections?.Contact?.get?.(lidId)
          || (collections?.Contact?.find ? await collections.Contact.find(lidId) : null)
        if (contactModel) {
          push(contactModel.phoneNumber)
          push(contactModel.__x_phoneNumber)
          push(contactModel.phoneNumberUser)
          push(contactModel.id?._serialized)
        }
      } catch { /* ignore */ }
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
      } catch { /* ignore */ }
      return out
    }, lidSerialized)

    for (const raw of candidates || []) {
      const phone = sanitizeAccountPhone(raw)
      if (phone) return phone
    }
  } catch {
    return null
  }
  return null
}

/**
 * Connected WhatsApp account identity (session), not a patient contact.
 * @param {import('whatsapp-web.js').Client} client
 */
async function resolveConnectedWhatsAppAccount(client) {
  const empty = {
    jid: '',
    jidType: 'other',
    phoneNumber: null,
    displayPhone: null,
    pushname: null,
    resolved: false,
    stableAccountId: '',
  }
  if (!client?.info) return empty

  const jid = extractWidSerialized(client)
  const classified = classifyJid(jid)
  let phoneNumber = classified.phoneNumber

  if (!phoneNumber) {
    try {
      if (jid && typeof client.getContactById === 'function') {
        const me = await client.getContactById(jid)
        phoneNumber = extractPhoneFromWaContact(me)
        if (!phoneNumber) {
          phoneNumber = await resolvePhoneFromWhatsAppContact(me, { client })
        }
      }
    } catch {
      // contact lookup optional
    }
  }

  if (!phoneNumber && classified.jidType === 'lid') {
    phoneNumber = await resolvePhoneViaWaStore(client, jid)
  }

  if (!phoneNumber) {
    phoneNumber = sanitizeAccountPhone(client.info?.wid?.user)
  }

  const resolvedPhone = sanitizeAccountPhone(phoneNumber)
  return {
    jid,
    jidType: classified.jidType,
    phoneNumber: resolvedPhone,
    displayPhone: resolvedPhone ? formatPhoneDisplay(resolvedPhone) : null,
    pushname: client.info?.pushname || null,
    resolved: Boolean(resolvedPhone),
    stableAccountId: classified.stableAccountId,
  }
}

function normalizeIncomingWhatsAppMessage(message, ownSerialized, extra = {}) {
  const direction = resolveMessageDirection(message, ownSerialized)
  const chat = classifyJid(extra.chatJid || direction.chatJid)
  const sender = classifyJid(extra.senderJid || direction.senderJid || chat.jid)
  const phoneNumber = extra.phoneNumber || chat.phoneNumber || sender.phoneNumber || null
  return {
    providerMessageId: extra.providerMessageId || null,
    chatJid: chat.jid || direction.chatJid,
    senderJid: sender.jid || direction.senderJid,
    phoneNumber,
    lid: chat.jidType === 'lid' ? chat.jid : (sender.jidType === 'lid' ? sender.jid : null),
    identityType: chat.jidType === 'lid' || sender.jidType === 'lid' ? 'lid' : (chat.jidType === 'phone' ? 'phone' : chat.jidType),
    text: extra.text || String(message?.body || ''),
    timestamp: extra.timestamp || null,
    isPrivate: chat.isPrivate,
    isGroup: chat.isGroup,
    isBroadcast: chat.isBroadcast,
    fromMe: direction.fromMe,
  }
}

module.exports = {
  serializedOf,
  jidsEqual,
  classifyJid,
  isPrivateChatJid,
  isIgnorableChatJid,
  resolveReplyDestination,
  resolveMessageDirection,
  sanitizeAccountPhone,
  resolveConnectedWhatsAppAccount,
  normalizeIncomingWhatsAppMessage,
  formatAccountPhone: formatPhoneDisplay,
}
