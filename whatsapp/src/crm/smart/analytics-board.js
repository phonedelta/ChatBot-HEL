/**
 * Analytics board — period-scoped operational metrics (no fictional trends).
 */

const INTENT_LABELS = {
  BOOK_APPOINTMENT: 'Prise de rendez-vous',
  RESCHEDULE_APPOINTMENT: 'Déplacement de rendez-vous',
  CANCEL_APPOINTMENT: 'Annulation',
  ASK_OPENING_HOURS: 'Horaires',
  ASK_HOURS: 'Horaires',
  ASK_LOCATION: 'Adresse',
  ASK_ADDRESS: 'Adresse',
  ASK_PRICE: 'Prix',
  DENTAL_PAIN: 'Douleur dentaire',
  DENTAL_EMERGENCY: 'Urgence dentaire',
  GREETING: 'Salutation',
  THANKS: 'Remerciement',
  OTHER: 'Autres demandes',
  UNKNOWN: 'Autres demandes',
  NONE: 'Autres demandes',
}

const MINUTES_SAVED = {
  ai_reply: 2,
  confirmation_request_sent: 3,
  followup_sent: 3,
  followup_manual_sent: 2,
  appointment_confirmed: 4,
}

function intentLabel(raw) {
  const key = String(raw || '').trim().toUpperCase()
  if (INTENT_LABELS[key]) return INTENT_LABELS[key]
  // dental case problems already human
  const soft = String(raw || '').trim()
  if (!soft) return 'Autres demandes'
  return soft.charAt(0).toUpperCase() + soft.slice(1)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Local calendar YYYY-MM-DD */
function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseIsoDate(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + days)
  return d
}

function resolvePeriod({ days = 14, from = null, to = null } = {}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let end = parseIsoDate(to) || today
  let start
  if (from) {
    start = parseIsoDate(from) || addDays(end, -(Math.max(1, Number(days) || 14) - 1))
  } else {
    const span = Math.max(1, Math.min(365, Number(days) || 14))
    start = addDays(end, -(span - 1))
  }

  if (start > end) {
    const tmp = start
    start = end
    end = tmp
  }

  const dayCount = Math.round((end - start) / 86400000) + 1
  const prevEnd = addDays(start, -1)
  const prevStart = addDays(prevEnd, -(dayCount - 1))

  return {
    from: formatLocalDate(start),
    to: formatLocalDate(end),
    days: dayCount,
    previous_from: formatLocalDate(prevStart),
    previous_to: formatLocalDate(prevEnd),
  }
}

function eachDay(fromIso, toIso) {
  const out = []
  let cur = parseIsoDate(fromIso)
  const end = parseIsoDate(toIso)
  if (!cur || !end) return out
  while (cur <= end) {
    out.push(formatLocalDate(cur))
    cur = addDays(cur, 1)
  }
  return out
}

function changePercent(current, previous) {
  if (previous == null || previous === 0) {
    if (current === 0) return null
    return null // not enough baseline
  }
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function changeAbsolute(current, previous) {
  if (previous == null) return null
  return current - previous
}

function safeCount(db, sql, params = []) {
  try {
    return Number(db.prepare(sql).get(...params)?.c || 0)
  } catch {
    return 0
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [helpers]
 */
function createAnalyticsBoard(db, helpers = {}) {
  const { listAiActions = null, frequentProblems = null } = helpers

  function countInboundMessages(from, to) {
    const smart = safeCount(db, `
      SELECT COUNT(*) AS c FROM messages
      WHERE direction = 'inbound'
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
    const legacy = safeCount(db, `
      SELECT COUNT(*) AS c FROM conversation_logs
      WHERE direction = 'inbound'
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
    // Prefer smart messages; add legacy only if smart empty for period to avoid double-count
    return smart > 0 ? smart : legacy
  }

  function countAiOutbound(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM messages
      WHERE direction = 'outbound'
        AND author_type IN ('ai', 'automation', 'system')
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
  }

  function countAppointmentsCreated(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
  }

  function countAppointmentsCreatedConfirmed(from, to) {
    // Cohort: created in period AND currently confirmed
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
        AND status = 'confirmed'
    `, [from, to])
  }

  function countPendingInCreatedCohort(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
        AND status = 'non_confirme'
        AND appointment_date >= date('now', 'localtime')
    `, [from, to])
  }

  function countConfirmationMessagesSent(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM ai_actions
      WHERE action_type IN ('confirmation_request_sent', 'followup_sent')
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
  }

  function countAutoConfirmed(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'confirmed'
        AND confirmation_source = 'whatsapp_patient'
        AND date(COALESCE(confirmed_at, created_at), 'localtime') >= date(?)
        AND date(COALESCE(confirmed_at, created_at), 'localtime') <= date(?)
    `, [from, to])
  }

  function countFollowupsSent(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM ai_actions
      WHERE action_type IN ('followup_sent', 'followup_manual_sent')
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
  }

  function countHandoffs(from, to) {
    return safeCount(db, `
      SELECT COUNT(*) AS c FROM ai_actions
      WHERE action_type = 'handoff_to_human'
        AND date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
    `, [from, to])
  }

  function countConversationsTouched(from, to) {
    return safeCount(db, `
      SELECT COUNT(DISTINCT conversation_id) AS c FROM messages
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
        AND conversation_id IS NOT NULL
    `, [from, to])
  }

  function countRecoveredSlots(from, to) {
    // Cancelled in period whose slot was later filled by another active appointment
    return safeCount(db, `
      SELECT COUNT(*) AS c
      FROM appointments cancelled
      WHERE cancelled.status = 'cancelled'
        AND date(COALESCE(cancelled.cancelled_at, cancelled.created_at), 'localtime') >= date(?)
        AND date(COALESCE(cancelled.cancelled_at, cancelled.created_at), 'localtime') <= date(?)
        AND EXISTS (
          SELECT 1 FROM appointments filled
          WHERE filled.status IN ('non_confirme', 'confirmed')
            AND filled.appointment_date = cancelled.appointment_date
            AND substr(filled.appointment_time, 1, 5) = substr(cancelled.appointment_time, 1, 5)
            AND filled.id != cancelled.id
            AND filled.created_at >= COALESCE(cancelled.cancelled_at, cancelled.created_at)
        )
    `, [from, to])
  }

  function dailyAppointmentSeries(from, to) {
    const days = eachDay(from, to)
    const createdRows = db.prepare(`
      SELECT date(created_at, 'localtime') AS day, COUNT(*) AS c
      FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
      GROUP BY date(created_at, 'localtime')
    `).all(from, to)
    const confirmedRows = db.prepare(`
      SELECT date(created_at, 'localtime') AS day, COUNT(*) AS c
      FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
        AND status = 'confirmed'
      GROUP BY date(created_at, 'localtime')
    `).all(from, to)
    const pendingRows = db.prepare(`
      SELECT date(created_at, 'localtime') AS day, COUNT(*) AS c
      FROM appointments
      WHERE date(created_at, 'localtime') >= date(?)
        AND date(created_at, 'localtime') <= date(?)
        AND status = 'non_confirme'
      GROUP BY date(created_at, 'localtime')
    `).all(from, to)

    const createdMap = new Map(createdRows.map((r) => [r.day, Number(r.c)]))
    const confirmedMap = new Map(confirmedRows.map((r) => [r.day, Number(r.c)]))
    const pendingMap = new Map(pendingRows.map((r) => [r.day, Number(r.c)]))

    return days.map((day) => ({
      date: day,
      day,
      created: createdMap.get(day) || 0,
      confirmed: confirmedMap.get(day) || 0,
      pending: pendingMap.get(day) || 0,
      // legacy key for old UI
      count: createdMap.get(day) || 0,
    }))
  }

  function topIntents(from, to) {
    // Prefer ai_actions with intent-like reasons / results if stored
    let rows = []
    try {
      rows = db.prepare(`
        SELECT
          CASE
            WHEN upper(COALESCE(result, '')) IN ('BOOK_APPOINTMENT','RESCHEDULE_APPOINTMENT','CANCEL_APPOINTMENT','ASK_HOURS','ASK_OPENING_HOURS','ASK_ADDRESS','ASK_LOCATION','ASK_PRICE','DENTAL_PAIN','DENTAL_EMERGENCY','GREETING','THANKS','OTHER','UNKNOWN','NONE')
              THEN upper(result)
            WHEN upper(COALESCE(reason, '')) IN ('BOOK_APPOINTMENT','RESCHEDULE_APPOINTMENT','CANCEL_APPOINTMENT','ASK_HOURS','ASK_OPENING_HOURS','ASK_ADDRESS','ASK_LOCATION','ASK_PRICE','DENTAL_PAIN','DENTAL_EMERGENCY','GREETING','THANKS','OTHER','UNKNOWN','NONE')
              THEN upper(reason)
            WHEN action_type LIKE '%book%' OR reason LIKE '%rendez-vous%' OR reason LIKE '%BOOK%' THEN 'BOOK_APPOINTMENT'
            WHEN action_type LIKE '%cancel%' OR reason LIKE '%annul%' THEN 'CANCEL_APPOINTMENT'
            WHEN action_type LIKE '%resched%' OR reason LIKE '%déplac%' OR reason LIKE '%deplac%' THEN 'RESCHEDULE_APPOINTMENT'
            WHEN reason LIKE '%horaire%' THEN 'ASK_HOURS'
            WHEN reason LIKE '%adresse%' OR reason LIKE '%localisation%' THEN 'ASK_ADDRESS'
            WHEN reason LIKE '%prix%' THEN 'ASK_PRICE'
            ELSE NULL
          END AS intent,
          COUNT(*) AS c
        FROM ai_actions
        WHERE date(created_at, 'localtime') >= date(?)
          AND date(created_at, 'localtime') <= date(?)
        GROUP BY intent
        HAVING intent IS NOT NULL
        ORDER BY c DESC
        LIMIT 12
      `).all(from, to)
    } catch {
      rows = []
    }

    const map = new Map()
    for (const row of rows) {
      const label = intentLabel(row.intent)
      map.set(label, (map.get(label) || 0) + Number(row.c || 0))
    }

    // Fallback / supplement: dental case problems created in period
    try {
      const problems = db.prepare(`
        SELECT problem, COUNT(*) AS c FROM dental_cases
        WHERE date(created_at, 'localtime') >= date(?)
          AND date(created_at, 'localtime') <= date(?)
          AND problem IS NOT NULL AND trim(problem) != ''
        GROUP BY problem
        ORDER BY c DESC
        LIMIT 8
      `).all(from, to)
      for (const row of problems) {
        const label = intentLabel(row.problem)
        if (/consultation g[eé]n[eé]rale|motif patient|^—$/i.test(label)) continue
        if (/^[A-Z_]+$/.test(label)) continue
        map.set(label, (map.get(label) || 0) + Number(row.c || 0))
      }
    } catch { /* optional */ }

    if (!map.size && typeof frequentProblems === 'function') {
      for (const row of frequentProblems(6) || []) {
        const label = intentLabel(row.problem)
        if (/^[A-Z_]+$/.test(label)) continue
        map.set(label, Number(row.count || 0))
      }
    }

    return [...map.entries()]
      .map(([label, count]) => ({ label, count, problem: label }))
      .filter((row) => row.label && !/^[A-Z_]+$/.test(row.label))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }

  function recentActivity(limit = 8) {
    if (typeof listAiActions === 'function') {
      return (listAiActions({ limit }) || []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        action_type: row.action_type,
        reason: row.reason,
        label: formatActivityLabel(row),
      }))
    }
    try {
      return db.prepare(`
        SELECT id, created_at, action_type, reason, result, actor_type
        FROM ai_actions
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(Math.max(1, Math.min(20, Number(limit) || 8)))
        .map((row) => ({
          id: row.id,
          created_at: row.created_at,
          action_type: row.action_type,
          reason: row.reason,
          label: formatActivityLabel(row),
        }))
    } catch {
      return []
    }
  }

  function formatActivityLabel(row) {
    const type = String(row.action_type || '')
    if (type === 'appointment_confirmed' || type === 'followup_sent') {
      return row.reason || 'Relance / confirmation envoyée'
    }
    if (type === 'confirmation_request_sent') return 'Demande de confirmation envoyée'
    if (type === 'followup_manual_sent') return 'Relance manuelle envoyée'
    if (type === 'handoff_to_human') return 'Conversation transférée à l’équipe'
    if (type === 'handoff_to_ai') return 'Conversation rendue à l’IA'
    if (type === 'ai_reply' || type === 'human_reply_sent') {
      return row.reason || (type === 'ai_reply' ? 'Réponse automatique envoyée' : 'Réponse de l’équipe envoyée')
    }
    if (type === 'appointment_cancelled') return 'Rendez-vous annulé'
    return row.reason || type.replace(/_/g, ' ')
  }

  function estimateHoursSaved(from, to) {
    let minutes = 0
    try {
      const rows = db.prepare(`
        SELECT action_type, COUNT(*) AS c FROM ai_actions
        WHERE date(created_at, 'localtime') >= date(?)
          AND date(created_at, 'localtime') <= date(?)
          AND (actor_type IS NULL OR actor_type IN ('ai', 'system', 'automation'))
        GROUP BY action_type
      `).all(from, to)
      for (const row of rows) {
        const per = MINUTES_SAVED[row.action_type]
        if (per) minutes += per * Number(row.c || 0)
      }
    } catch { /* optional */ }
    return Math.round((minutes / 60) * 10) / 10
  }

  function watchItems({ pendingConfirm, noResponseFollowups, handoffs }) {
    const items = []
    if (pendingConfirm > 0) {
      items.push({
        key: 'to_confirm',
        label: `${pendingConfirm} rendez-vous encore à confirmer`,
        link: '/relances?category=unconfirmed',
      })
    }
    if (noResponseFollowups > 0) {
      items.push({
        key: 'followups',
        label: `${noResponseFollowups} relances envoyées sans réponse récente`,
        link: '/relances?category=no_response',
      })
    }
    if (handoffs > 0) {
      items.push({
        key: 'handoff',
        label: `${handoffs} conversation${handoffs > 1 ? 's' : ''} transférée${handoffs > 1 ? 's' : ''} à l’équipe`,
        link: '/messages?status=TRANSFERRED',
      })
    }
    return items
  }

  function metricsForRange(from, to) {
    const patientMessages = countInboundMessages(from, to)
    const aiOutbound = countAiOutbound(from, to)
    const appointmentsCreated = countAppointmentsCreated(from, to)
    const appointmentsConfirmedCohort = countAppointmentsCreatedConfirmed(from, to)
    const pendingConfirm = countPendingInCreatedCohort(from, to)
    const confirmationMessagesSent = countConfirmationMessagesSent(from, to)
    const automaticConfirmed = countAutoConfirmed(from, to)
    const followupsSent = countFollowupsSent(from, to)
    const handoffs = countHandoffs(from, to)
    const conversationsTouched = countConversationsTouched(from, to)
    const recoveredSlots = countRecoveredSlots(from, to)
    const hoursSaved = estimateHoursSaved(from, to)

    const autoHandledRate = patientMessages > 0
      ? Math.round((Math.min(aiOutbound, patientMessages) / patientMessages) * 1000) / 10
      : 0

    const confirmationRate = appointmentsCreated > 0
      ? Math.round((appointmentsConfirmedCohort / appointmentsCreated) * 1000) / 10
      : 0

    const handoffRate = conversationsTouched > 0
      ? Math.round((handoffs / conversationsTouched) * 1000) / 10
      : 0

    return {
      patientMessages,
      aiOutbound,
      autoHandledRate,
      appointmentsCreated,
      appointmentsConfirmedCohort,
      pendingConfirm,
      confirmationMessagesSent,
      automaticConfirmed,
      confirmationRate,
      followupsSent,
      handoffs,
      handoffRate,
      conversationsTouched,
      recoveredSlots,
      hoursSaved,
    }
  }

  function getAnalyticsSummary(options = {}) {
    const daysOpt = Number(options.days || options.period || 14)
    const period = resolvePeriod({
      days: daysOpt,
      from: options.from || null,
      to: options.to || null,
    })

    const current = metricsForRange(period.from, period.to)
    const previous = metricsForRange(period.previous_from, period.previous_to)
    const trend = dailyAppointmentSeries(period.from, period.to)
    const intents = topIntents(period.from, period.to)
    const activity = recentActivity(8)
    const watch = watchItems({
      pendingConfirm: current.pendingConfirm,
      noResponseFollowups: 0,
      handoffs: current.handoffs,
    })

    return {
      ok: true,
      period: {
        from: period.from,
        to: period.to,
        days: period.days,
        previous_from: period.previous_from,
        previous_to: period.previous_to,
      },
      formulas: {
        patient_messages: 'messages inbound dans la période',
        auto_handled_rate: 'réponses IA outbound ÷ messages patients inbound × 100',
        appointments_created: 'appointments.created_at dans la période',
        confirmation_rate: 'créés dans la période et status=confirmed ÷ créés dans la période × 100 (cohorte)',
        recovered_slots: 'annulations dont le créneau a été réattribué à un autre RDV',
        handoff_rate: 'handoff_to_human ÷ conversations touchées dans la période × 100',
        hours_saved: 'somme (actions auto × minutes configurées) / 60',
      },
      kpis: {
        patient_messages: {
          value: current.patientMessages,
          previous: previous.patientMessages,
          change_percent: changePercent(current.patientMessages, previous.patientMessages),
          change_absolute: changeAbsolute(current.patientMessages, previous.patientMessages),
        },
        auto_handled_rate: {
          value: current.autoHandledRate,
          previous: previous.autoHandledRate,
          change_percent: changePercent(current.autoHandledRate, previous.autoHandledRate),
          detail: `${current.aiOutbound} réponses automatiques`,
        },
        appointments_created: {
          value: current.appointmentsCreated,
          previous: previous.appointmentsCreated,
          change_percent: changePercent(current.appointmentsCreated, previous.appointmentsCreated),
          change_absolute: changeAbsolute(current.appointmentsCreated, previous.appointmentsCreated),
        },
        confirmation_rate: {
          value: current.confirmationRate,
          previous: previous.confirmationRate,
          change_percent: changePercent(current.confirmationRate, previous.confirmationRate),
          detail: `${current.appointmentsConfirmedCohort} confirmé${current.appointmentsConfirmedCohort > 1 ? 's' : ''} sur ${current.appointmentsCreated} créé${current.appointmentsCreated > 1 ? 's' : ''}`,
        },
      },
      appointments_trend: trend,
      // legacy alias
      volume_by_day: trend,
      appointment_confirmation: {
        created: current.appointmentsCreated,
        pending: current.pendingConfirm,
        confirmation_messages_sent: current.confirmationMessagesSent,
        confirmed: current.appointmentsConfirmedCohort,
        automatic_confirmed: current.automaticConfirmed,
      },
      automation: {
        messages_handled_automatically: current.aiOutbound,
        automatic_followups: current.followupsSent,
        automatic_confirmations: current.automaticConfirmed,
        handoffs: current.handoffs,
        handoff_rate: current.handoffRate,
        auto_handled_rate: current.autoHandledRate,
      },
      impact: {
        automatic_confirmations: current.automaticConfirmed,
        followups_sent: current.followupsSent,
        recovered_slots: current.recoveredSlots,
        handoffs: current.handoffs,
        estimated_hours_saved: current.hoursSaved,
      },
      top_intents: intents,
      frequent_requests: intents,
      recent_activity: activity,
      watch,
      // legacy flat fields for old consumers
      messages_patients: current.patientMessages,
      auto_handled_rate: current.autoHandledRate,
      appointments_created: current.appointmentsCreated,
      appointments_confirmed: current.appointmentsConfirmedCohort,
      appointments_pending_confirmation: current.pendingConfirm,
      confirmations_automatic: current.automaticConfirmed,
      confirmation_rate: current.confirmationRate,
      followups: current.followupsSent,
      slots_recovered: current.recoveredSlots,
      transfer_rate: current.handoffRate,
    }
  }

  return {
    getAnalyticsSummary,
    resolvePeriod,
    dailyAppointmentSeries,
    INTENT_LABELS,
  }
}

module.exports = {
  createAnalyticsBoard,
  resolvePeriod,
  intentLabel,
  INTENT_LABELS,
}
