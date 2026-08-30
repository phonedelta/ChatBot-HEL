/**
 * Aggregated conversation context for the Messages right panel.
 * Single source — avoids multiple dashboard API round-trips.
 */

const { formatPhoneDisplay } = require('../phone')
const {
  conversationStatusLabel,
  appointmentStatusLabel,
  aiActionLabel,
  intentLabel,
  sourceLabel,
  channelLabel,
  languageLabel,
  WAITLIST_PRIORITY_LABELS,
} = require('./labels')
const {
  getContactForConversation,
  enrichLinkedPatients,
  upsertWhatsAppContact,
} = require('../contact-patients')

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function tomorrowLocal() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDate(isoDate) {
  const raw = String(isoDate || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatTimeShort(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return raw.slice(0, 5)
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function formatAppointmentDisplay(dateIso, timeStr) {
  const date = String(dateIso || '').slice(0, 10)
  const time = formatTimeShort(timeStr)
  if (!date) return '—'
  const today = todayLocal()
  const tomorrow = tomorrowLocal()
  const prefix = date === today
    ? 'Aujourd’hui'
    : date === tomorrow
      ? 'Demain'
      : parseLocalDate(date)?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) || date
  return time ? `${prefix} à ${time}` : prefix
}

function formatContactDayLabel(iso) {
  const raw = String(iso || '').trim()
  if (!raw) return '—'
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return '—'

  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()

  if (sameDay(d, today)) return 'Aujourd’hui'
  if (sameDay(d, yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function formatLastContactDisplay(iso, channel = 'whatsapp') {
  const day = formatContactDayLabel(iso)
  const ch = channelLabel(channel) || 'WhatsApp'
  if (day === '—') return '—'
  return `${day} · ${ch}`
}

function firstName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  return parts[0] || 'Le patient'
}

function buildLanguageSubtitle({
  existing = false,
  activeLanguage = null,
  preferredLanguage = null,
} = {}) {
  const active = languageLabel(activeLanguage)
  const preferred = languageLabel(preferredLanguage)
  const langs = []
  if (active) langs.push(active)
  if (preferred && preferred !== active) langs.push(preferred)
  const langText = langs.length ? langs.join(' / ') : '—'
  if (existing) return `Patient existant · ${langText}`
  return `Nouveau contact WhatsApp · ${langText}`
}

const INTENT_PATTERNS = [
  { key: 'RESCHEDULE_APPOINTMENT', test: /d[eé]plac|report|changer|modifier|resched|nbeddel|nbdl|تأجيل|نبدل/i },
  { key: 'CANCEL_APPOINTMENT', test: /annul|cancel|annuler|ma bghit|ما بغي/i },
  { key: 'BOOK_APPOINTMENT', test: /rendez[- ]?vous|\brdv\b|appointment|موعد|حجز|nhjez|n7jez|nreserve|reserv/i },
  { key: 'ASK_OPENING_HOURS', test: /horaire|heure.*ouvert|ouverture|mftah|مفتوح/i },
  { key: 'ASK_ADDRESS', test: /adresse|address|فين|localisation/i },
  { key: 'DENTAL_PAIN', test: /douleur|mal aux dents|waj3|وجع|pain/i },
  { key: 'ADMIN_REQUEST', test: /facture|devis|assurance|administratif|prix|tarif/i },
]

function inferIntentFromText(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  for (const row of INTENT_PATTERNS) {
    if (row.test.test(raw)) return row.key
  }
  return null
}

function extractReasonFromSummary(aiSummary) {
  const raw = String(aiSummary || '').trim()
  if (!raw) return null
  const motif = raw.match(/^(?:motif|demande)\s*:\s*(.+)$/i)
  if (motif) return motif[1].trim()
  return null
}

function deriveContactReason(conversation, suggestion) {
  if (suggestion?.intent && suggestion.intent !== 'OTHER') {
    return {
      key: suggestion.intent,
      label: intentLabel(suggestion.intent),
    }
  }

  const fromSummary = extractReasonFromSummary(conversation?.ai_summary)
  if (fromSummary) {
    const inferred = inferIntentFromText(fromSummary) || 'OTHER'
    return {
      key: inferred,
      label: inferred === 'OTHER' ? fromSummary : intentLabel(inferred),
    }
  }

  const preview = [
    conversation?.ai_summary,
    conversation?.last_message_preview,
  ].filter(Boolean).join(' ')
  const inferred = inferIntentFromText(preview)
  if (inferred) {
    return { key: inferred, label: intentLabel(inferred) }
  }

  if (conversation?.ai_summary) {
    return { key: 'OTHER', label: String(conversation.ai_summary).slice(0, 120) }
  }

  return null
}

const MEANINGFUL_ACTIONS = new Set([
  'ai_reply',
  'human_reply_sent',
  'booking_created',
  'appointment_confirmed',
  'appointment_cancelled',
  'appointment_rescheduled',
  'followup_sent',
  'proposed_slots',
  'slots_proposed',
  'slot_recovered',
  'admin_reply',
])

function deriveActionTaken(latestAction, suggestion) {
  if (latestAction?.action_type && MEANINGFUL_ACTIONS.has(latestAction.action_type)) {
    let label = aiActionLabel(latestAction.action_type)
    const detail = String(latestAction.reason || latestAction.result || '').trim()
    if (latestAction.action_type === 'proposed_slots' || latestAction.action_type === 'slots_proposed') {
      const payload = parseJson(latestAction.payload_json, null)
      const count = payload?.slots?.length || payload?.slot_count
      if (count) label = `Proposition de ${count} créneaux`
      else if (detail) label = detail
    } else if (/propos/i.test(detail) && /cr[eé]neau/i.test(detail)) {
      label = detail
    } else if (detail && !/handoff|repris|rendu/i.test(detail)) {
      label = detail.length <= 80 ? detail : label
    }
    return { key: latestAction.action_type, label }
  }

  const next = String(suggestion?.next_action || '').trim()
  if (/cr[eé]neau/i.test(next)) {
    return { key: 'proposed_slots', label: next }
  }

  return null
}

function formatRelativeFollowup(dueAtIso) {
  const due = new Date(String(dueAtIso || '').replace(' ', 'T'))
  if (Number.isNaN(due.getTime())) return null
  const diffMs = due.getTime() - Date.now()
  if (diffMs <= 0) return 'Relance en cours'
  const hours = Math.round(diffMs / 3600000)
  if (hours < 1) {
    const mins = Math.max(1, Math.round(diffMs / 60000))
    return `Relance automatique dans ${mins} min`
  }
  if (hours <= 48) return `Relance automatique dans ${hours} h`
  return null
}

function deriveNextAction(conversation, pendingTask) {
  const explicit = String(conversation?.next_action || '').trim()
  if (explicit) {
    return { key: 'explicit', label: explicit }
  }

  if (pendingTask) {
    const relative = pendingTask.due_at
      ? formatRelativeFollowup(pendingTask.due_at)
      : null
    if (relative && /no_response|followup|confirm_appointment/.test(String(pendingTask.task_type || ''))) {
      return { key: pendingTask.task_type, label: relative }
    }
    const title = String(pendingTask.title || pendingTask.reason || '').trim()
    if (title) return { key: pendingTask.task_type || 'task', label: title }
  }

  if (conversation?.owner === 'HUMAN') {
    return { key: 'human', label: 'Répondre au patient' }
  }

  if (conversation?.status === 'WAITING_PATIENT') {
    return { key: 'wait', label: 'Attendre la réponse' }
  }

  return null
}

function waitlistPriorityLabel(key) {
  return WAITLIST_PRIORITY_LABELS[String(key || '')] || 'Normale'
}

function formatShortDate(dateIso) {
  const d = parseLocalDate(dateIso)
  if (!d) return String(dateIso || '')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function buildWaitlistDescription(entry, patientName) {
  if (!entry) return null
  const name = firstName(patientName)
  const parts = []

  if (entry.preferred_date_to) {
    parts.push(`prévenir si une place se libère avant ${formatShortDate(entry.preferred_date_to)}`)
  } else if (entry.preferred_date_from) {
    parts.push(`disponible à partir du ${formatShortDate(entry.preferred_date_from)}`)
  }

  const ranges = parseJson(entry.preferred_time_ranges, null)
  if (Array.isArray(ranges) && ranges.length) {
    parts.push(`préférence ${ranges.join(', ')}`)
  } else if (typeof ranges === 'string' && ranges.trim()) {
    parts.push(`préférence ${ranges.trim()}`)
  }

  if (entry.appointment_type) {
    parts.push(String(entry.appointment_type))
  }

  if (!parts.length && entry.notes) {
    return `${name} est inscrit en liste d’attente : ${String(entry.notes).trim()}.`
  }
  if (!parts.length) {
    return `${name} est inscrit en liste d’attente.`
  }
  return `${name} est inscrit en liste d’attente : ${parts.join(' ; ')}.`
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} deps
 */
function createConversationContextBuilder(deps) {
  const {
    db,
    getConversation,
    buildConversationSuggestion,
    listWaitlist,
    contacts,
  } = deps

  function getConversationContext(conversationId) {
    const conversation = getConversation(conversationId)
    if (!conversation) return null

    const customer = conversation.customer_id
      ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(conversation.customer_id))
      : null

    const resolved = contacts.resolveContact({
      external_key: conversation.external_key,
      whatsapp_chat_id: conversation.external_key,
      phone_number: customer?.phone_number || conversation.patient_phone || conversation.phone_e164,
      conversation_phone: conversation.phone_e164 || null,
      customer_id: conversation.customer_id,
      contact_name: customer?.full_name || conversation.patient_name || conversation.display_name,
      push_name: conversation.push_name || null,
    })

    let nextAppointment = null
    if (conversation.customer_id) {
      nextAppointment = db.prepare(`
        SELECT a.*, d.problem
        FROM appointments a
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.customer_id = ?
          AND a.appointment_date >= date('now', 'localtime')
          AND a.status != 'cancelled'
        ORDER BY a.appointment_date ASC, a.appointment_time ASC
        LIMIT 1
      `).get(Number(conversation.customer_id))
    }

    const lastContactAt = conversation.last_message_at
      || customer?.last_contact_at
      || conversation.updated_at
      || null

    const channel = conversation.channel || 'whatsapp'
    const sourceKey = customer?.source || (channel === 'whatsapp' ? 'whatsapp' : channel)

    const waitlistEntries = conversation.customer_id
      ? listWaitlist({ status: 'active', limit: 20 })
        .filter((w) => Number(w.customer_id) === Number(conversation.customer_id))
      : []
    const waitlistEntry = waitlistEntries[0] || null

    const suggestion = buildConversationSuggestion(conversation)

    const latestAction = db.prepare(`
      SELECT * FROM ai_actions
      WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(Number(conversation.id))

    const pendingTask = db.prepare(`
      SELECT * FROM tasks
      WHERE status NOT IN ('completed', 'cancelled')
        AND (conversation_id = ? OR customer_id = ?)
      ORDER BY COALESCE(due_at, created_at) ASC
      LIMIT 1
    `).get(Number(conversation.id), conversation.customer_id || null)

    const reason = deriveContactReason(conversation, suggestion)
    const action = deriveActionTaken(latestAction, suggestion)
    const status = {
      key: conversation.status,
      label: conversationStatusLabel(conversation.status),
    }
    const nextAction = deriveNextAction(conversation, pendingTask)

    const phoneDisplay = resolved.phone_display
      || (resolved.phone_e164 ? formatPhoneDisplay(resolved.phone_e164) : null)
      || 'Numéro non identifié'

    const displayName = resolved.display_name || 'Contact WhatsApp'
    const activeLanguage = conversation.active_language || conversation.language || null
    const preferredLanguage = customer?.preferred_language || null

    const hasSummary = Boolean(reason || action || nextAction)

    // WhatsApp contact + all linked patients (multi-patient household)
    let contactRow = getContactForConversation(db, conversation)
    if (!contactRow && (resolved.phone_e164 || conversation.external_key)) {
      contactRow = upsertWhatsAppContact(db, {
        whatsappId: conversation.external_key,
        phoneE164: resolved.phone_e164 || conversation.phone_e164,
        displayName: conversation.push_name || conversation.display_name,
      })
      if (contactRow?.id) {
        try {
          db.prepare(`
            UPDATE conversations SET whatsapp_contact_id = ? WHERE id = ?
          `).run(contactRow.id, conversation.id)
        } catch { /* ignore */ }
      }
    }
    const linkedPatients = contactRow
      ? enrichLinkedPatients(db, contactRow.id)
      : (customer
        ? [{
          id: customer.id,
          full_name: customer.full_name,
          phone_number: customer.phone_number,
          phone_display: formatPhoneDisplay(customer.phone_number),
          city: customer.city,
          relationship_label: null,
          next_appointment: nextAppointment
            ? {
              id: nextAppointment.id,
              appointment_date: nextAppointment.appointment_date,
              appointment_time: formatTimeShort(nextAppointment.appointment_time),
              status: nextAppointment.status,
            }
            : null,
        }]
        : [])

    const activePatientContextId = conversation.customer_id
      || linkedPatients[0]?.id
      || null

    return {
      conversation: {
        id: conversation.id,
        status: conversation.status,
        status_label: conversation.status_label || conversationStatusLabel(conversation.status),
        owner: conversation.owner,
        controller: conversation.owner,
        owner_user: conversation.owner_user || null,
        active_language: activeLanguage,
        last_contact_at: lastContactAt,
        customer_id: conversation.customer_id || null,
        whatsapp_contact_id: contactRow?.id || conversation.whatsapp_contact_id || null,
      },
      contact: {
        id: contactRow?.id || null,
        phone: contactRow?.phone_e164 || resolved.phone_e164 || null,
        phone_display: contactRow?.phone_e164
          ? formatPhoneDisplay(contactRow.phone_e164)
          : phoneDisplay,
        display_name: contactRow?.display_name || conversation.push_name || displayName,
        whatsapp_id: contactRow?.whatsapp_id || conversation.external_key || null,
      },
      linked_patients: linkedPatients,
      active_patient_context_id: activePatientContextId,
      patient: {
        id: customer?.id || activePatientContextId || null,
        display_name: customer?.full_name || displayName,
        phone: resolved.phone_e164 || contactRow?.phone_e164 || null,
        phone_display: phoneDisplay,
        source: sourceKey,
        source_label: sourceLabel(sourceKey),
        existing: Boolean(customer?.id || linkedPatients.length),
        is_new_contact: !customer?.id && !linkedPatients.length,
        preferred_language: preferredLanguage,
        active_language: activeLanguage,
        language_subtitle: buildLanguageSubtitle({
          existing: Boolean(customer?.id || linkedPatients.length),
          activeLanguage,
          preferredLanguage,
        }),
      },
      next_appointment: nextAppointment
        ? {
          id: nextAppointment.id,
          starts_at: `${nextAppointment.appointment_date}T${formatTimeShort(nextAppointment.appointment_time)}`,
          appointment_date: nextAppointment.appointment_date,
          appointment_time: formatTimeShort(nextAppointment.appointment_time),
          display: formatAppointmentDisplay(
            nextAppointment.appointment_date,
            nextAppointment.appointment_time,
          ),
          status: nextAppointment.status,
          status_label: appointmentStatusLabel(nextAppointment.status),
        }
        : null,
      last_contact: {
        at: lastContactAt,
        channel,
        display: formatLastContactDisplay(lastContactAt, channel),
      },
      summary: {
        has_summary: hasSummary,
        reason,
        action,
        status,
        next_action: nextAction,
      },
      waitlist: waitlistEntry
        ? {
          active: true,
          id: waitlistEntry.id,
          priority: waitlistEntry.priority,
          priority_label: waitlistPriorityLabel(waitlistEntry.priority),
          preferred_date_from: waitlistEntry.preferred_date_from || null,
          preferred_date_to: waitlistEntry.preferred_date_to || null,
          preferred_time_ranges: parseJson(waitlistEntry.preferred_time_ranges, null),
          appointment_type: waitlistEntry.appointment_type || null,
          description: buildWaitlistDescription(waitlistEntry, displayName),
        }
        : null,
    }
  }

  return {
    getConversationContext,
    formatAppointmentDisplay,
    formatLastContactDisplay,
    buildLanguageSubtitle,
  }
}

module.exports = {
  createConversationContextBuilder,
  formatAppointmentDisplay,
  formatLastContactDisplay,
  buildLanguageSubtitle,
  deriveContactReason,
  deriveActionTaken,
  deriveNextAction,
}
