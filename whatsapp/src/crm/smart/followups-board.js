/**
 * Relances / Follow-ups board — aggregated operational cockpit.
 * All counts and rows come from live CRM data (no mock patients).
 */

const { formatPhoneDisplay, toE164 } = require('../phone')
const { formatDateDisplay, isDarija } = require('../messages')
const { confirmationFollowupMessage } = require('./appointment-confirmation')
const { resolvePatientLanguageFromRow } = require('./resolve-patient-language')

const CATEGORIES = [
  { key: 'unconfirmed', label: 'Rendez-vous non confirmés', icon: 'CalendarClock', accent: 'warning' },
  { key: 'no_response', label: 'Patients sans réponse', icon: 'MessageCircle', accent: 'danger' },
  { key: 'reschedule', label: 'Annulés à reprogrammer', icon: 'CalendarX', accent: 'cyan' },
  { key: 'callback', label: 'Patients à rappeler', icon: 'Phone', accent: 'navy' },
  { key: 'administrative', label: 'Demandes administratives', icon: 'FileText', accent: 'info' },
]

function nowIso() {
  return new Date().toISOString()
}

function formatTime(value) {
  return String(value || '').slice(0, 5)
}

function parseTs(value) {
  if (!value) return null
  const t = new Date(String(value).replace(' ', 'T')).getTime()
  return Number.isFinite(t) ? t : null
}

function relativeFr(fromIso) {
  const ts = parseTs(fromIso)
  if (ts == null) return null
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (diffMin < 1) return 'à l’instant'
  if (diffMin < 60) return `il y a ${diffMin} min`
  const h = Math.floor(diffMin / 60)
  if (h < 48) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  return `il y a ${d} j`
}

function weekdayShortFr(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return formatDateDisplay(isoDate)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  try {
    const w = d.toLocaleDateString('fr-FR', { weekday: 'short' })
    const day = d.getDate()
    return `${w.charAt(0).toUpperCase()}${w.slice(1, 3)} ${day}`
  } catch {
    return formatDateDisplay(isoDate)
  }
}

function appointmentTypeLabel(problem) {
  const p = String(problem || '').trim()
  if (!p) return 'Rendez-vous'
  if (p.length > 28) return `${p.slice(0, 26)}…`
  return p
}

function safePhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/@lid/i.test(raw) || /@c\.us/i.test(raw) || /@g\.us/i.test(raw)) return null
  const e164 = toE164(raw)
  if (e164) return e164
  // Keep digits-only local numbers that look like phones
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 9 && digits.length <= 15) return raw
  return null
}

function formatAppointmentLine(date, time, problem) {
  const type = appointmentTypeLabel(problem)
  const when = `${weekdayShortFr(date)} à ${formatTime(time)}`
  return `${type} · ${when}`
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createFollowupsBoard(db, helpers = {}) {
  const {
    listTasks = () => [],
    createTask = null,
    updateTask = null,
    listAutomations = () => [],
    listWaitlist = () => [],
    addMessage = null,
    getOrCreateConversation = null,
    logAiAction = null,
    addTimelineEvent = null,
    getActiveConversationLanguage = null,
    sendWhatsAppText = null,
    trackWhatsAppTurn = null,
  } = helpers

  function getAutomationMap() {
    const list = typeof listAutomations === 'function' ? listAutomations() : []
    const map = {}
    for (const row of list) {
      map[row.key] = row
    }
    return map
  }

  function isAutoActive(key, map) {
    const row = map[key]
    return Boolean(row && row.status === 'active')
  }

  function contactPatientCount(customerId) {
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS c
        FROM contact_patients cp
        WHERE cp.whatsapp_contact_id IN (
          SELECT whatsapp_contact_id FROM contact_patients WHERE patient_id = ?
          UNION
          SELECT id FROM whatsapp_contacts wc
          WHERE wc.phone_e164 = (SELECT phone_number FROM customers WHERE id = ?)
             OR wc.whatsapp_id = (SELECT whatsapp_chat_id FROM customers WHERE id = ?)
        )
      `).get(Number(customerId), Number(customerId), Number(customerId))
      return Number(row?.c || 0)
    } catch {
      return 1
    }
  }

  function resolveConversationForCustomer(customerId, chatKey = null) {
    if (chatKey && typeof getOrCreateConversation === 'function') {
      try {
        return getOrCreateConversation({
          external_key: chatKey,
          channel: 'whatsapp',
          customer_id: customerId,
        })
      } catch { /* fall through */ }
    }
    return db.prepare(`
      SELECT * FROM conversations
      WHERE customer_id = ?
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT 1
    `).get(Number(customerId)) || null
  }

  function buildActivityForConfirmation(row) {
    if (row.staff_task_id) {
      return {
        activity: 'À rappeler par l’équipe',
        status_key: 'callback',
        status_label: 'À rappeler',
      }
    }
    if (row.followup_sent_at) {
      const rel = relativeFr(row.followup_sent_at)
      const count = Number(row.followup_count || 1)
      return {
        activity: count > 1
          ? `${count} relances envoyées`
          : (rel ? `Relance envoyée ${rel}` : 'Relance envoyée'),
        status_key: 'no_response',
        status_label: 'Sans réponse',
      }
    }
    if (row.initial_sent_at) {
      const age = parseTs(row.initial_sent_at)
      const hours = age != null ? (Date.now() - age) / 3600000 : 0
      if (hours >= 4) {
        return {
          activity: 'Message envoyé, pas de réponse',
          status_key: 'no_response',
          status_label: 'Sans réponse',
        }
      }
      return {
        activity: 'En attente de confirmation',
        status_key: 'waiting',
        status_label: 'Sans réponse',
      }
    }
    // Not yet in 24h window — planned
    return {
      activity: 'Relance programmée (24 h avant)',
      status_key: 'planned',
      status_label: 'Planifiée',
    }
  }

  function listUnconfirmedAppointments({ limit = 80 } = {}) {
    return db.prepare(`
      SELECT
        a.id AS appointment_id,
        a.customer_id AS patient_id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        a.conversation_id AS legacy_conversation_id,
        c.full_name AS patient_name,
        c.phone_number,
        c.whatsapp_chat_id,
        c.preferred_language,
        d.problem,
        r.id AS request_id,
        r.initial_sent_at,
        r.followup_sent_at,
        r.staff_task_id,
        r.chat_key,
        r.conversation_id AS request_conversation_id,
        r.language AS request_language,
        r.status AS request_status
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      LEFT JOIN appointment_confirmation_requests r ON r.appointment_id = a.id
      WHERE a.status = 'non_confirme'
        AND a.appointment_date >= date('now', 'localtime')
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(200, Number(limit) || 80)))
  }

  function serializeUnconfirmed(row) {
    const activity = buildActivityForConfirmation(row)
    const phone = safePhone(row.phone_number)
    const multi = contactPatientCount(row.patient_id) > 1
    return {
      id: `appt-${row.appointment_id}`,
      kind: 'appointment',
      category: 'unconfirmed',
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      patient_phone: phone,
      phone_display: phone ? formatPhoneDisplay(phone) : null,
      appointment_date: row.appointment_date,
      appointment_time: formatTime(row.appointment_time),
      appointment_label: formatAppointmentLine(row.appointment_date, row.appointment_time, row.problem),
      problem: row.problem || null,
      activity: activity.activity,
      status_key: activity.status_key,
      status_label: activity.status_label,
      conversation_id: row.request_conversation_id || null,
      chat_key: row.chat_key || row.whatsapp_chat_id || row.legacy_conversation_id || null,
      language: row.request_language || row.preferred_language || 'fr',
      multi_patient_contact: multi,
      actions: {
        remind: true,
        call: Boolean(phone),
        open_patient: true,
        open_agenda: true,
        open_messages: true,
        reschedule: false,
        complete_task: false,
      },
      task_id: row.staff_task_id || null,
      requires_validation: Boolean(row.staff_task_id),
      source: 'confirmation_pipeline',
    }
  }

  function listNoResponseItems(unconfirmedSerialized) {
    // Subset: confirmation already sent, still waiting, no staff task yet
    const fromConfirm = unconfirmedSerialized.filter((item) => (
      item.status_key === 'no_response' || item.status_key === 'waiting'
    )).map((item) => ({
      ...item,
      id: `nr-${item.appointment_id}`,
      category: 'no_response',
    }))

    const apptIds = new Set(fromConfirm.map((i) => Number(i.appointment_id)).filter(Boolean))
    const fromTasks = listTasks({ limit: 100 }).filter((t) => (
      t.status !== 'completed'
      && t.status !== 'cancelled'
      && t.task_type === 'no_response'
      && !(t.appointment_id && apptIds.has(Number(t.appointment_id)))
    )).map((t) => {
      const patient = t.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(t.customer_id))
        : null
      const phone = safePhone(patient?.phone_number || t.patient_phone)
      return {
        id: `nr-task-${t.id}`,
        kind: 'task',
        category: 'no_response',
        task_id: t.id,
        appointment_id: t.appointment_id || null,
        patient_id: t.customer_id || null,
        patient_name: patient?.full_name || t.patient_name || 'Patient',
        patient_phone: phone,
        phone_display: phone ? formatPhoneDisplay(phone) : null,
        appointment_label: t.title || 'Sans réponse',
        activity: t.reason || 'Message envoyé, pas de réponse',
        status_key: 'no_response',
        status_label: 'Sans réponse',
        conversation_id: t.conversation_id || null,
        actions: {
          remind: Boolean(t.appointment_id),
          call: Boolean(phone),
          open_patient: Boolean(t.customer_id),
          open_agenda: Boolean(t.appointment_id),
          open_messages: Boolean(t.conversation_id),
          reschedule: false,
          complete_task: true,
        },
        requires_validation: true,
        source: 'no_response_task',
      }
    })

    return [...fromConfirm, ...fromTasks]
  }

  function listCallbackItems() {
    const tasks = listTasks({ limit: 100 }).filter((t) => (
      t.status !== 'completed'
      && t.status !== 'cancelled'
      && (
        t.status === 'to_call'
        || t.task_type === 'call'
        || t.task_type === 'confirm_appointment'
      )
    ))

    return tasks.map((t) => {
      const appt = t.appointment_id
        ? db.prepare(`
            SELECT a.*, c.full_name, c.phone_number, d.problem
            FROM appointments a
            JOIN customers c ON c.id = a.customer_id
            LEFT JOIN dental_cases d ON d.appointment_id = a.id
            WHERE a.id = ?
          `).get(Number(t.appointment_id))
        : null
      const patient = t.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(t.customer_id))
        : null
      const name = appt?.full_name || patient?.full_name || t.patient_name || 'Patient'
      const phone = safePhone(appt?.phone_number || patient?.phone_number || t.patient_phone)
      return {
        id: `task-${t.id}`,
        kind: 'task',
        category: 'callback',
        task_id: t.id,
        appointment_id: t.appointment_id || null,
        patient_id: t.customer_id || appt?.customer_id || null,
        patient_name: name,
        patient_phone: phone,
        phone_display: phone ? formatPhoneDisplay(phone) : null,
        appointment_date: appt?.appointment_date || null,
        appointment_time: appt ? formatTime(appt.appointment_time) : null,
        appointment_label: appt
          ? formatAppointmentLine(appt.appointment_date, appt.appointment_time, appt.problem)
          : (t.title || 'À rappeler'),
        activity: t.reason || 'Tâche assistante — appeler le patient',
        status_key: 'callback',
        status_label: 'À rappeler',
        conversation_id: t.conversation_id || null,
        actions: {
          remind: Boolean(appt && appt.status === 'non_confirme'),
          call: Boolean(phone),
          open_patient: true,
          open_agenda: Boolean(appt),
          open_messages: Boolean(t.conversation_id),
          reschedule: false,
          complete_task: true,
        },
        requires_validation: true,
        source: 'staff_task',
      }
    })
  }

  function listRescheduleItems() {
    const fromTasks = listTasks({ limit: 100 }).filter((t) => (
      t.status !== 'completed'
      && t.status !== 'cancelled'
      && t.task_type === 'reschedule'
    )).map((t) => {
      const appt = t.appointment_id
        ? db.prepare(`
            SELECT a.*, c.full_name, c.phone_number, d.problem
            FROM appointments a
            JOIN customers c ON c.id = a.customer_id
            LEFT JOIN dental_cases d ON d.appointment_id = a.id
            WHERE a.id = ?
          `).get(Number(t.appointment_id))
        : null
      const patient = t.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(t.customer_id))
        : null
      const name = appt?.full_name || patient?.full_name || 'Patient'
      const phone = safePhone(appt?.phone_number || patient?.phone_number)
      return {
        id: `reschedule-task-${t.id}`,
        kind: 'task',
        category: 'reschedule',
        task_id: t.id,
        appointment_id: t.appointment_id || null,
        patient_id: t.customer_id || null,
        patient_name: name,
        patient_phone: phone,
        phone_display: phone ? formatPhoneDisplay(phone) : null,
        appointment_date: appt?.appointment_date || null,
        appointment_time: appt ? formatTime(appt.appointment_time) : null,
        appointment_label: appt
          ? `Ancien RDV · ${formatAppointmentLine(appt.appointment_date, appt.appointment_time, appt.problem)}`
          : (t.title || 'À reprogrammer'),
        activity: t.reason || 'Reprogrammation demandée',
        status_key: 'reschedule',
        status_label: 'À reprogrammer',
        conversation_id: t.conversation_id || null,
        actions: {
          remind: false,
          call: Boolean(phone),
          open_patient: true,
          open_agenda: true,
          open_messages: Boolean(t.conversation_id),
          reschedule: true,
          complete_task: true,
        },
        requires_validation: true,
        source: 'reschedule_task',
      }
    })

    // Explicit timeline signal: patient asked for new slot after cancel
    let fromTimeline = []
    try {
      fromTimeline = db.prepare(`
        SELECT
          a.id AS appointment_id,
          a.customer_id AS patient_id,
          a.appointment_date,
          a.appointment_time,
          c.full_name AS patient_name,
          c.phone_number,
          d.problem,
          te.detail,
          te.created_at
        FROM timeline_events te
        JOIN appointments a ON a.id = te.appointment_id
        JOIN customers c ON c.id = a.customer_id
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.status = 'cancelled'
          AND te.event_type IN ('RESCHEDULE_REQUESTED', 'NEEDS_RESCHEDULE')
          AND date(a.appointment_date) >= date('now', '-60 days')
        ORDER BY te.created_at DESC
        LIMIT 40
      `).all()
    } catch {
      fromTimeline = []
    }

    const taskApptIds = new Set(fromTasks.map((x) => Number(x.appointment_id)).filter(Boolean))
    const fromTimelineItems = fromTimeline
      .filter((row) => !taskApptIds.has(Number(row.appointment_id)))
      .map((row) => {
        const phone = safePhone(row.phone_number)
        return {
          id: `reschedule-appt-${row.appointment_id}`,
          kind: 'appointment',
          category: 'reschedule',
          appointment_id: row.appointment_id,
          patient_id: row.patient_id,
          patient_name: row.patient_name,
          patient_phone: phone,
          phone_display: phone ? formatPhoneDisplay(phone) : null,
          appointment_date: row.appointment_date,
          appointment_time: formatTime(row.appointment_time),
          appointment_label: `Ancien RDV · ${formatAppointmentLine(row.appointment_date, row.appointment_time, row.problem)}`,
          activity: row.detail || 'Annulé — à reprogrammer',
          status_key: 'reschedule',
          status_label: 'À reprogrammer',
          conversation_id: null,
          actions: {
            remind: false,
            call: Boolean(phone),
            open_patient: true,
            open_agenda: true,
            open_messages: true,
            reschedule: true,
            complete_task: false,
          },
          requires_validation: true,
          source: 'reschedule_signal',
        }
      })

    return [...fromTasks, ...fromTimelineItems]
  }

  function listAdministrativeItems() {
    const tasks = listTasks({ limit: 100 }).filter((t) => (
      t.status !== 'completed'
      && t.status !== 'cancelled'
      && !['confirm_appointment', 'call', 'reschedule', 'no_response'].includes(String(t.task_type || ''))
    ))

    const fromTasks = tasks.map((t) => {
      const patient = t.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(t.customer_id))
        : null
      const phone = safePhone(patient?.phone_number || t.patient_phone)
      return {
        id: `admin-task-${t.id}`,
        kind: 'task',
        category: 'administrative',
        task_id: t.id,
        appointment_id: t.appointment_id || null,
        patient_id: t.customer_id || null,
        patient_name: patient?.full_name || t.patient_name || 'Contact',
        patient_phone: phone,
        phone_display: phone ? formatPhoneDisplay(phone) : null,
        appointment_label: t.title || 'Demande administrative',
        activity: t.reason || 'Action administrative en attente',
        status_key: 'admin',
        status_label: 'Administrative',
        conversation_id: t.conversation_id || null,
        actions: {
          remind: false,
          call: Boolean(phone),
          open_patient: Boolean(t.customer_id),
          open_agenda: false,
          open_messages: Boolean(t.conversation_id),
          reschedule: false,
          complete_task: true,
        },
        requires_validation: true,
        source: 'admin_task',
      }
    })

    // Conversations waiting on staff (HUMAN / TO_PROCESS) without open confirm tasks
    let fromConv = []
    try {
      const convs = db.prepare(`
        SELECT
          conv.id,
          conv.customer_id,
          conv.patient_name,
          conv.phone_e164,
          conv.last_message_preview,
          conv.status,
          conv.owner,
          c.full_name,
          c.phone_number
        FROM conversations conv
        LEFT JOIN customers c ON c.id = conv.customer_id
        WHERE conv.status IN ('TO_PROCESS', 'NEEDS_HUMAN')
          AND conv.owner = 'HUMAN'
        ORDER BY COALESCE(conv.last_message_at, conv.updated_at) DESC
        LIMIT 30
      `).all()
      fromConv = convs.map((conv) => {
        const phone = safePhone(conv.phone_e164 || conv.phone_number)
        return {
          id: `admin-conv-${conv.id}`,
          kind: 'conversation',
          category: 'administrative',
          conversation_id: conv.id,
          patient_id: conv.customer_id || null,
          patient_name: conv.full_name || conv.patient_name || 'Contact',
          patient_phone: phone,
          phone_display: phone ? formatPhoneDisplay(phone) : null,
          appointment_label: 'Conversation à traiter',
          activity: conv.last_message_preview || 'Demande en attente de réponse',
          status_key: 'admin',
          status_label: 'Administrative',
          actions: {
            remind: false,
            call: Boolean(phone),
            open_patient: Boolean(conv.customer_id),
            open_agenda: false,
            open_messages: true,
            reschedule: false,
            complete_task: false,
          },
          requires_validation: true,
          source: 'human_handoff',
        }
      })
    } catch {
      fromConv = []
    }

    return [...fromTasks, ...fromConv]
  }

  function buildAutomationSummary(autoMap) {
    return {
      confirmation: {
        key: 'confirm_24h_before',
        title: 'Confirmation',
        when: '24 h avant le rendez-vous',
        then: 'message WhatsApp',
        active: isAutoActive('confirm_24h_before', autoMap),
      },
      followup: {
        key: 'no_response_4h',
        title: 'Sans réponse',
        when: 'Après 4 h',
        then: 'relance automatique',
        active: isAutoActive('no_response_4h', autoMap),
      },
      staff_task: {
        key: 'no_response_24h_task',
        title: 'Toujours sans réponse',
        when: 'Après 24 h',
        then: 'tâche pour l’assistante',
        active: isAutoActive('no_response_24h_task', autoMap),
      },
      cancellation: {
        key: 'cancellation_slot_release',
        title: 'Annulation',
        when: 'Le créneau est libéré',
        then: 'notification à l’équipe — la secrétaire choisit la suite',
        active: true,
      },
    }
  }

  function weekBounds(weeksAgo = 0) {
    const now = new Date()
    const day = now.getDay() || 7 // Mon=1..Sun=7 style
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - weeksAgo * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    const fmt = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${dd}`
    }
    return { from: fmt(monday), to: fmt(sunday) }
  }

  function computeImpact() {
    const thisWeek = weekBounds(0)
    const lastWeek = weekBounds(1)

    const countUnconfirmedInRange = (from, to) => Number(db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'non_confirme'
        AND appointment_date >= ? AND appointment_date <= ?
    `).get(from, to)?.c || 0)

    // Snapshot approximation: appointments that WERE non_confirme during week is hard;
    // use current non_confirme dated in week vs previous week window of future RDVs created then.
    // Better proxy: count of appointments created in week still non_confirme vs previous.
    const unconfirmedThis = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'non_confirme'
        AND date(created_at) >= ? AND date(created_at) <= ?
    `).get(thisWeek.from, thisWeek.to)?.c || 0)

    const unconfirmedLast = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'non_confirme'
        AND date(created_at) >= ? AND date(created_at) <= ?
    `).get(lastWeek.from, lastWeek.to)?.c || 0)

    let unconfirmedChangePercent = null
    if (unconfirmedLast > 0) {
      unconfirmedChangePercent = Math.round(
        ((unconfirmedThis - unconfirmedLast) / unconfirmedLast) * 100,
      )
    } else if (unconfirmedThis === 0 && unconfirmedLast === 0) {
      unconfirmedChangePercent = null
    } else {
      unconfirmedChangePercent = null
    }

    // Recovered slots: cancelled this week where another active appointment occupies same date+time
    const recoveredSlots = Number(db.prepare(`
      SELECT COUNT(*) AS c
      FROM appointments cancelled
      WHERE cancelled.status = 'cancelled'
        AND date(cancelled.created_at) >= ?
        AND date(cancelled.created_at) <= ?
        AND EXISTS (
          SELECT 1 FROM appointments filled
          WHERE filled.status IN ('non_confirme', 'confirmed')
            AND filled.appointment_date = cancelled.appointment_date
            AND substr(filled.appointment_time, 1, 5) = substr(cancelled.appointment_time, 1, 5)
            AND filled.id != cancelled.id
        )
    `).get(thisWeek.from, thisWeek.to)?.c || 0)

    // Hours saved: automated confirmation + followup messages this week × 3 minutes
    let autoMessages = 0
    try {
      autoMessages = Number(db.prepare(`
        SELECT COUNT(*) AS c FROM ai_actions
        WHERE action_type IN ('confirmation_request_sent', 'followup_sent', 'appointment_confirmed')
          AND date(created_at) >= ? AND date(created_at) <= ?
          AND (actor_type IS NULL OR actor_type IN ('system', 'ai', 'automation'))
      `).get(thisWeek.from, thisWeek.to)?.c || 0)
    } catch {
      autoMessages = 0
    }
    const estimatedHoursSaved = Math.round((autoMessages * 3) / 60 * 10) / 10

    return {
      unconfirmed_change_percent: unconfirmedChangePercent,
      recovered_slots: recoveredSlots,
      estimated_hours_saved: estimatedHoursSaved,
      formula: {
        unconfirmed_change: 'non_confirme créés cette semaine vs semaine précédente',
        recovered_slots: 'annulations cette semaine dont le créneau a été réattribué',
        hours_saved: 'messages auto (confirm/relance/confirmés) × 3 min',
      },
      period: { this_week: thisWeek, last_week: lastWeek },
      raw: {
        unconfirmed_this_week: unconfirmedThis,
        unconfirmed_last_week: unconfirmedLast,
        auto_messages: autoMessages,
        unconfirmed_dated_this_week: countUnconfirmedInRange(thisWeek.from, thisWeek.to),
      },
    }
  }

  function getFollowUpsBoard({ category = null, limit = 80 } = {}) {
    const autoMap = getAutomationMap()
    const unconfirmedRows = listUnconfirmedAppointments({ limit })
    const unconfirmed = unconfirmedRows.map(serializeUnconfirmed)
    const noResponse = listNoResponseItems(unconfirmed)
    const callback = listCallbackItems()
    const reschedule = listRescheduleItems()
    const administrative = listAdministrativeItems()

    // Avoid double-counting appointments that already have staff callback task in unconfirmed list display
    // (they stay in unconfirmed AND appear in callback — OK for category filters; badge uses unique validation set)

    const categories = {
      unconfirmed: {
        key: 'unconfirmed',
        label: 'Rendez-vous non confirmés',
        count: unconfirmed.length,
        items: unconfirmed,
      },
      no_response: {
        key: 'no_response',
        label: 'Patients sans réponse',
        count: noResponse.length,
        items: noResponse,
      },
      reschedule: {
        key: 'reschedule',
        label: 'Annulés à reprogrammer',
        count: reschedule.length,
        items: reschedule,
      },
      callback: {
        key: 'callback',
        label: 'Patients à rappeler',
        count: callback.length,
        items: callback,
      },
      administrative: {
        key: 'administrative',
        label: 'Demandes administratives',
        count: administrative.length,
        items: administrative,
      },
    }

    // Legacy key alias used by older UI
    categories.to_call = categories.callback
    categories.rebook = categories.reschedule
    categories.admin = categories.administrative

    const selectedKey = category && categories[category] ? category : 'unconfirmed'
    const selected = categories[selectedKey]

    const validationTaskIds = new Set()
    for (const cat of [callback, reschedule, administrative]) {
      for (const item of cat) {
        if (item.requires_validation && item.task_id) {
          validationTaskIds.add(Number(item.task_id))
        }
      }
    }
    // Staff confirmation tasks already in callback
    const requiresValidation = validationTaskIds.size
      || [...callback, ...reschedule, ...administrative].filter((i) => i.requires_validation).length

    // Unique human interventions for badge: open staff tasks + HUMAN conversations needing action
    const badgeCount = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM tasks
      WHERE status NOT IN ('completed', 'cancelled')
        AND (
          status = 'to_call'
          OR task_type IN ('confirm_appointment', 'call', 'reschedule', 'admin', 'followup')
        )
    `).get()?.c || 0)

    const totalPrepared = unconfirmed.length
      + noResponse.length
      + reschedule.length
      + callback.length
      + administrative.length

    return {
      ok: true,
      categories,
      category: selectedKey,
      items: selected.items.slice(0, Math.max(1, Math.min(200, Number(limit) || 80))),
      counts: {
        unconfirmed: unconfirmed.length,
        no_response: noResponse.length,
        noResponse: noResponse.length,
        reschedule: reschedule.length,
        callback: callback.length,
        callBack: callback.length,
        administrative: administrative.length,
      },
      category_meta: CATEGORIES,
      summary: {
        total_prepared: totalPrepared,
        requires_validation: requiresValidation,
        badge_count: badgeCount || requiresValidation,
      },
      requiresValidation,
      automation_summary: buildAutomationSummary(autoMap),
      automations_explained: Object.values(buildAutomationSummary(autoMap)).map((b) => ({
        title: b.title,
        when: b.when,
        then: b.then,
        active: b.active,
      })),
      impact: computeImpact(),
      waitlist: typeof listWaitlist === 'function' ? listWaitlist({ status: 'active', limit: 20 }) : [],
    }
  }

  function buildManualFollowupPreview(appointmentId) {
    const appt = db.prepare(`
      SELECT a.*, c.full_name, c.phone_number, c.preferred_language, c.whatsapp_chat_id,
             d.problem
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(Number(appointmentId))
    if (!appt) return { ok: false, reason: 'not_found' }
    if (appt.status === 'confirmed') {
      return { ok: false, reason: 'already_confirmed', error: 'Ce rendez-vous a déjà été confirmé.' }
    }
    if (appt.status === 'cancelled') {
      return { ok: false, reason: 'cancelled', error: 'Ce rendez-vous a été annulé.' }
    }
    if (appt.status !== 'non_confirme') {
      return { ok: false, reason: 'not_eligible', error: 'Ce rendez-vous ne peut pas être relancé.' }
    }

    const req = db.prepare(`
      SELECT * FROM appointment_confirmation_requests WHERE appointment_id = ?
    `).get(Number(appointmentId))

    const language = resolvePatientLanguageFromRow(appt, {
      chatKey: req?.chat_key || appt.whatsapp_chat_id,
      getActiveConversationLanguage,
    }).language

    const multi = contactPatientCount(appt.customer_id) > 1
    let text = confirmationFollowupMessage(appt, appt, language)
    if (multi) {
      if (isDarija(language)) {
        text = [
          `مرحبا،`,
          '',
          `مازال ما توصلناش بتأكيد موعد ${appt.full_name} نهار ${formatDateDisplay(appt.appointment_date)} مع ${formatTime(appt.appointment_time)}.`,
          '',
          'عافاك جاوب بـ نعم باش نأكد، ولا لا باش نلغي.',
        ].join('\n')
      } else {
        text = [
          'Bonjour,',
          '',
          `Nous attendons toujours votre confirmation pour le rendez-vous de ${appt.full_name}`,
          `du ${formatDateDisplay(appt.appointment_date)} à ${formatTime(appt.appointment_time)}.`,
          '',
          'Merci de répondre OUI pour confirmer ou NON pour annuler.',
        ].join('\n')
      }
    }

    return {
      ok: true,
      appointment_id: appt.id,
      patient_name: appt.full_name,
      patient_phone: safePhone(appt.phone_number),
      language,
      multi_patient_contact: multi,
      message: text,
    }
  }

  async function sendManualFollowup(appointmentId, {
    actorName = null,
    actor = null,
    textOverride = null,
  } = {}) {
    const actorObj = actor || (actorName ? { type: 'human', displayName: actorName, role: null } : null)
    const actorLabel = actorObj?.displayName || actorName
    const preview = buildManualFollowupPreview(appointmentId)
    if (!preview.ok) return preview

    // Cooldown 45s against double-click
    const req = db.prepare(`
      SELECT * FROM appointment_confirmation_requests WHERE appointment_id = ?
    `).get(Number(appointmentId))
    if (req?.followup_sent_at) {
      const age = Date.now() - (parseTs(req.followup_sent_at) || 0)
      if (age >= 0 && age < 45_000) {
        return { ok: false, reason: 'cooldown', error: 'Une relance vient d’être envoyée. Réessayez dans un instant.' }
      }
    }

    const appt = db.prepare(`
      SELECT a.*, c.full_name, c.phone_number, c.whatsapp_chat_id
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ?
    `).get(Number(appointmentId))

    const chatKey = req?.chat_key || appt.whatsapp_chat_id || appt.conversation_id
    const phone = safePhone(appt.phone_number)
    if (!chatKey && !phone) {
      return { ok: false, reason: 'no_contact', error: 'Aucun contact WhatsApp disponible.' }
    }
    if (typeof sendWhatsAppText !== 'function') {
      return { ok: false, reason: 'no_sender', error: 'Envoi WhatsApp indisponible.' }
    }

    const text = String(textOverride || preview.message || '').trim()
    if (!text) return { ok: false, reason: 'empty', error: 'Message vide.' }

    let sent
    try {
      sent = await sendWhatsAppText({
        chatId: chatKey,
        phone,
        text,
      })
    } catch (error) {
      return {
        ok: false,
        reason: 'send_failed',
        error: error.message || 'Impossible d’envoyer la relance WhatsApp.',
      }
    }

    let conversation = null
    if (typeof getOrCreateConversation === 'function') {
      try {
        conversation = getOrCreateConversation({
          external_key: chatKey || phone,
          channel: 'whatsapp',
          customer_id: appt.customer_id,
          phone_e164: phone,
        })
      } catch { /* optional */ }
    }
    if (!conversation) {
      conversation = resolveConversationForCustomer(appt.customer_id, chatKey)
    }

    if (conversation && typeof addMessage === 'function') {
      try {
        addMessage(conversation.id, {
          direction: 'outbound',
          author_type: 'human',
          author_name: actorLabel || 'Assistante',
          body: text,
          message_type: 'text',
          external_message_id: sent?.messageId || null,
        })
      } catch { /* optional */ }
    }

    // Ensure ACR row and stamp followup
    try {
      if (!req) {
        db.prepare(`
          INSERT INTO appointment_confirmation_requests (
            appointment_id, customer_id, conversation_id, chat_key, language, status,
            initial_sent_at, followup_sent_at, confirmation_source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'staff_manual', ?, ?)
        `).run(
          Number(appointmentId),
          appt.customer_id,
          conversation?.id || null,
          chatKey || null,
          preview.language || 'fr',
          nowIso(),
          nowIso(),
          nowIso(),
          nowIso(),
        )
      } else {
        db.prepare(`
          UPDATE appointment_confirmation_requests
          SET followup_sent_at = ?,
              confirmation_source = COALESCE(confirmation_source, 'staff_manual'),
              updated_at = ?
          WHERE appointment_id = ?
        `).run(nowIso(), nowIso(), Number(appointmentId))
      }
    } catch { /* optional */ }

    if (typeof logAiAction === 'function') {
      try {
        logAiAction({
          customer_id: appt.customer_id,
          conversation_id: conversation?.id || null,
          action_type: 'followup_manual_sent',
          reason: 'Relance manuelle depuis Relances',
          result: String(appointmentId),
          source: 'dashboard',
          actor_type: 'human',
          actor: actorObj,
        })
      } catch { /* optional */ }
    }

    if (typeof addTimelineEvent === 'function') {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          conversation_id: conversation?.id || null,
          event_type: 'FOLLOWUP_MANUAL_SENT',
          title: 'Relance manuelle',
          detail: actorLabel ? `Relance envoyée par ${actorLabel}` : 'Relance envoyée par l’équipe',
          actor_type: 'human',
          actor_name: actorLabel,
        })
      } catch { /* optional */ }
    }

    if (typeof trackWhatsAppTurn === 'function') {
      try {
        trackWhatsAppTurn({
          chatId: chatKey,
          conversationId: conversation?.external_key || chatKey,
          outboundText: text,
          outboundAuthor: 'human',
        })
      } catch { /* optional */ }
    }

    return {
      ok: true,
      appointment_id: appointmentId,
      message: text,
      provider_message_id: sent?.messageId || null,
    }
  }

  function validatePendingTasks(taskIds = [], { actorName = null, actor = null } = {}) {
    const actorObj = actor || (actorName ? { type: 'human', displayName: actorName, role: null } : null)
    const actorLabel = actorObj?.displayName || actorName
    const ids = [...new Set((taskIds || []).map(Number).filter(Boolean))]
    const results = []
    for (const id of ids) {
      try {
        const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
        if (!before) {
          results.push({ id, ok: false, reason: 'not_found' })
          continue
        }
        if (before.status === 'completed') {
          results.push({ id, ok: true, already: true })
          continue
        }
        if (typeof updateTask === 'function') {
          updateTask(id, {
            status: 'completed',
            reason: actorLabel ? `Validé par ${actorLabel}` : 'Validé',
            actor: actorObj,
          })
        } else {
          db.prepare(`
            UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?
          `).run(nowIso(), nowIso(), id)
        }
        if (typeof logAiAction === 'function') {
          try {
            logAiAction({
              customer_id: before.customer_id,
              action_type: 'followup_validated',
              reason: 'Validation Relances',
              result: String(id),
              source: 'dashboard',
              actor_type: 'human',
              actor: actorObj,
            })
          } catch { /* optional */ }
        }
        results.push({ id, ok: true })
      } catch (error) {
        results.push({ id, ok: false, reason: error.message || 'error' })
      }
    }
    const okCount = results.filter((r) => r.ok).length
    const failCount = results.filter((r) => !r.ok).length
    return {
      ok: true,
      validated: okCount,
      failed: failCount,
      results,
    }
  }

  function listValidationCandidates() {
    const board = getFollowUpsBoard({ limit: 200 })
    const items = [
      ...board.categories.callback.items,
      ...board.categories.reschedule.items,
      ...board.categories.administrative.items,
    ].filter((i) => i.requires_validation && i.task_id)
    const byType = { whatsapp: 0, tasks: 0, admin: 0 }
    for (const item of items) {
      if (item.category === 'administrative') byType.admin += 1
      else if (item.actions?.remind) byType.whatsapp += 1
      else byType.tasks += 1
    }
    return {
      count: items.length,
      task_ids: items.map((i) => i.task_id),
      breakdown: byType,
      items,
    }
  }

  return {
    getFollowUpsBoard,
    buildManualFollowupPreview,
    sendManualFollowup,
    validatePendingTasks,
    listValidationCandidates,
    CATEGORIES,
  }
}

module.exports = {
  createFollowupsBoard,
  CATEGORIES,
}
