/**
 * WhatsApp patient-initiated appointment cancellation.
 * Never cancels without explicit OUI confirmation.
 * Multi-patient / multi-appointment safe.
 */

const { parseBinaryConfirmation } = require('../binary-confirmation')
const { formatDateDisplay, isDarija } = require('../messages')
const { resolvePatientLanguageFromRow } = require('./resolve-patient-language')
const { assistantAiActor } = require('./activity-actors')
const {
  findContactByWhatsAppOrPhone,
} = require('../contact-patients')

function nowIso() {
  return new Date().toISOString()
}

function formatTime(value) {
  return String(value || '').slice(0, 5)
}

function runInTransaction(db, fn) {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)()
  }
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* ignore */ }
    throw error
  }
}

function normalizeKey(chatKey) {
  return String(chatKey || '').trim()
}

function stripInstance(chatKey) {
  return normalizeKey(chatKey).replace(/^[^:]+:/, '')
}

function looksLikeCancelIntent(text, routerIntent = null) {
  const intent = String(routerIntent || '').toUpperCase()
  if (
    intent === 'CANCEL_APPOINTMENT'
    || intent === 'ANNULATION_RENDEZ_VOUS'
    || intent === 'ANNULATION'
  ) {
    return true
  }
  const t = String(text || '').trim()
  if (!t) return false
  // Explicit cancel — not vague "maybe I can't come"
  return (
    /\b(annul(er|e|ation)?|cancel(led|lation)?)\b/i.test(t)
    || /\b(je\s+(ne\s+)?(pourrai|peux)\s+pas\s+venir)\b/i.test(t)
    || /(نلغي|نبغي نلغي|بغيت نلغي|ما غاديش نجي|مانقدش نجي)/i.test(t)
    || /\bnbddl\b.*\b(rdv|rendez|موعد)/i.test(t)
    || /\b(rdv|rendez|موعد).{0,24}\b(annul|cancel|نلغي)/i.test(t)
  )
}

function isVagueMaybeCancel(text) {
  const t = String(text || '').trim()
  return /je\s+(ne\s+)?sais\s+pas|peut[-\s]?être|attendez|غادي نشوف|ممكن/i.test(t)
    && !/\b(annul|cancel|نلغي)\b/i.test(t)
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/).filter(Boolean)[0] || fullName || 'Patient'
}

function slotLabel(date, time, language = 'fr') {
  const d = formatDateDisplay(date)
  const t = formatTime(time)
  if (isDarija(language)) return `${d} فـ ${t}`
  return `${d} à ${t}`
}

/* ---------- Templates ---------- */

function msgNoAppointments(language = 'fr') {
  if (isDarija(language)) {
    return 'ما لقيت حتى موعد جاي مرتبط بهاد الرقم.'
  }
  return 'Je ne trouve aucun rendez-vous à venir associé à ce contact.'
}

function msgAlreadyCancelled(language = 'fr') {
  if (isDarija(language)) {
    return 'هاد الموعد أصلاً ملغي.'
  }
  return 'Ce rendez-vous est déjà annulé.'
}

function msgListAppointments(items, language = 'fr') {
  const lines = items.map((item, i) => (
    `${i + 1}. ${item.full_name} — ${slotLabel(item.appointment_date, item.appointment_time, language)}`
  ))
  if (isDarija(language)) {
    return [
      'عندك عدة مواعيد جاية :',
      '',
      ...lines,
      '',
      'شكون بغيتي تلغي ؟ جاوب بالرقم ولا بالسمية.',
    ].join('\n')
  }
  return [
    'Vous avez plusieurs rendez-vous à venir :',
    '',
    ...lines,
    '',
    'Lequel souhaitez-vous annuler ?',
  ].join('\n')
}

function msgConfirmCancel(item, language = 'fr') {
  const when = slotLabel(item.appointment_date, item.appointment_time, language)
  if (isDarija(language)) {
    return [
      `بغيتي تلغي موعد ${item.full_name} نهار ${when}.`,
      '',
      'واش كتأكد الإلغاء ؟',
      '',
      'جاوب بـ نعم باش تلغي، ولا لا باش تبقا فالموعد.',
    ].join('\n')
  }
  return [
    `Vous souhaitez annuler le rendez-vous de ${item.full_name} prévu le ${when}.`,
    '',
    'Confirmez-vous l’annulation ?',
    '',
    'Répondez OUI pour annuler ou NON pour conserver le rendez-vous.',
  ].join('\n')
}

function msgCancelledOk(item, language = 'fr') {
  const when = slotLabel(item.appointment_date, item.appointment_time, language)
  if (isDarija(language)) {
    return `تمام. موعد ${item.full_name} ديال ${when} تلغى بنجاح.`
  }
  return `C’est noté. Le rendez-vous de ${item.full_name} du ${when} a bien été annulé.`
}

/**
 * Message sent to the patient when staff cancels from the dashboard/agenda.
 */
function msgStaffCancelledPatient(item, language = 'fr') {
  const when = slotLabel(item.appointment_date, item.appointment_time, language)
  const name = firstName(item.full_name)
  if (isDarija(language)) {
    return [
      `السلام عليكم ${name}،`,
      '',
      `الموعد ديالكم نهار ${when} عند مركز طب الأسنان HEL تم إلغاؤه.`,
      '',
      'إلا بغيتي تعاودو تحجزو موعد، كتبوا لينا هنا على واتساب.',
    ].join('\n')
  }
  return [
    `Bonjour ${name},`,
    '',
    `Votre rendez-vous du ${when} au Centre Dentaire HEL a été annulé.`,
    '',
    'Pour reprendre un rendez-vous, écrivez-nous ici sur WhatsApp.',
  ].join('\n')
}

function msgKept(itemOrLanguage = 'fr', languageMaybe = undefined) {
  const language = typeof itemOrLanguage === 'string' && languageMaybe === undefined
    ? itemOrLanguage
    : (languageMaybe || 'fr')
  const item = typeof itemOrLanguage === 'object' && itemOrLanguage
    ? itemOrLanguage
    : null
  const when = item?.appointment_date
    ? slotLabel(item.appointment_date, item.appointment_time, language)
    : null
  if (isDarija(language)) {
    if (when) {
      return `مزيان، الموعد ديالك ديال ${when} باقي كيف ما هو.`
    }
    return 'مزيان، الموعد ديالك باقي كيف ما هو.'
  }
  if (when) {
    return `Très bien, votre rendez-vous du ${when} est conservé.`
  }
  return 'D’accord, votre rendez-vous est conservé.'
}

function msgConfirmClarify(language = 'fr') {
  if (isDarija(language)) {
    return 'ما فهمتش الجواب مزيان. واش بغيتي نلغي الموعد؟ جاوب بـ نعم أو لا.'
  }
  return 'Je n’ai pas bien compris. Souhaitez-vous annuler le rendez-vous ? Répondez OUI ou NON.'
}

function msgConfirmAmbiguous(language = 'fr') {
  if (isDarija(language)) {
    return 'باش نتأكد: واش بغيتي نلغي الموعد ولا نخليه كيف ما هو؟'
  }
  return 'Pour être sûr : souhaitez-vous annuler le rendez-vous ou le conserver ?'
}

function msgClarify(language = 'fr') {
  if (isDarija(language)) {
    return 'عافاك وضّح شكون الموعد اللي بغيتي تلغي (بالرقم ولا بالسمية).'
  }
  return 'Pouvez-vous préciser quel rendez-vous vous souhaitez annuler ?'
}

function msgCancelFailed(language = 'fr') {
  if (isDarija(language)) {
    return 'ما قدرتش نلغي الموعد دابا. الموعد بقا بحالو.'
  }
  return 'Je n’ai pas pu annuler ce rendez-vous pour le moment. Votre rendez-vous reste inchangé.'
}

function msgAmbiguousCancel(language = 'fr') {
  if (isDarija(language)) {
    return 'إلا بغيتي تلغي موعد، قولي بوضوح « بغيت نلغي الموعد ».'
  }
  return 'Si vous souhaitez annuler un rendez-vous, dites-le clairement, par exemple : « Je veux annuler mon rendez-vous ».'
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createWhatsappCancelEngine(db, helpers = {}) {
  const {
    getOrCreateConversation = null,
    addTimelineEvent = null,
    logAiAction = null,
    notifySlotReleased = null,
    cancelAppointmentCore = null,
    getActiveConversationLanguage = null,
    getAppointmentsSettings = null,
    canCancelOrReschedule = null,
    getSendWhatsAppText = null,
    trackWhatsAppTurn = null,
  } = helpers

  function isStaffCancelSource(source) {
    const s = String(source || '').toLowerCase()
    return s === 'staff_dashboard'
      || s === 'dashboard'
      || s === 'staff'
      || s === 'agenda'
      || s === 'manual'
  }

  function resolveCancelNotifyLanguage(appt) {
    return resolvePatientLanguageFromRow(
      {
        preferred_language: appt?.preferred_language,
        whatsapp_chat_id: appt?.whatsapp_chat_id,
        language: appt?.language,
      },
      {
        chatKey: appt?.whatsapp_chat_id || null,
        getActiveConversationLanguage,
        inboundLanguageHint: appt?.preferred_language || 'fr',
      },
    ).language
  }

  /**
   * Notify patient on WhatsApp after a staff/manual cancellation.
   * Never used for patient self-cancel (they already get an in-chat reply).
   */
  async function notifyPatientOfStaffCancellation(appointment, {
    source = 'staff_dashboard',
    actorName = null,
  } = {}) {
    const whatsapp = {
      attempted: false,
      sent: false,
      skipped: false,
      messageId: null,
      error: null,
      disconnected: false,
    }

    if (!isStaffCancelSource(source)) {
      whatsapp.skipped = true
      whatsapp.error = 'not_staff_source'
      return whatsapp
    }

    const appt = appointment && appointment.id
      ? appointment
      : null
    if (!appt) {
      whatsapp.error = 'missing_appointment'
      return whatsapp
    }

    const phone = appt.phone_number || null
    const chatKey = appt.whatsapp_chat_id || null

    // Prefer stored WhatsApp chat id; fall back to phone digits for send layer
    let resolvedChat = chatKey
    if (!resolvedChat && phone) {
      try {
        const contact = findContactByWhatsAppOrPhone(db, { phone })
        resolvedChat = contact?.whatsapp_id || contact?.whatsapp_chat_id || null
      } catch { /* optional */ }
    }
    if (!resolvedChat && phone) {
      const digits = String(phone).replace(/\D/g, '')
      if (digits) resolvedChat = `${digits}@c.us`
    }

    if (!resolvedChat && !phone) {
      whatsapp.error = 'no_patient_channel'
      return whatsapp
    }

    const sendFn = typeof getSendWhatsAppText === 'function' ? getSendWhatsAppText() : null
    if (typeof sendFn !== 'function') {
      whatsapp.error = 'WhatsApp sender unavailable'
      return whatsapp
    }

    const language = resolveCancelNotifyLanguage(appt)
    const text = msgStaffCancelledPatient(appt, language)
    whatsapp.attempted = true

    try {
      const sent = await sendFn({
        chatId: resolvedChat,
        phone,
        text,
      })
      whatsapp.sent = true
      whatsapp.messageId = sent?.messageId || null
      const outboundChatId = sent?.chatId || resolvedChat

      if (typeof trackWhatsAppTurn === 'function') {
        try {
          trackWhatsAppTurn({
            chatId: outboundChatId,
            customerId: appt.customer_id || null,
            outboundText: text,
            outboundAuthor: 'ai',
            outboundMessageId: sent?.messageId || null,
            phoneNumber: phone,
            contactName: appt.full_name || null,
          })
        } catch { /* optional */ }
      }

      if (typeof logAiAction === 'function') {
        try {
          logAiAction({
            customer_id: appt.customer_id || null,
            action_type: 'staff_cancellation_notified',
            reason: actorName
              ? `Notification annulation agenda (${actorName})`
              : 'Notification annulation agenda',
            result: String(appt.id),
            source: 'dashboard',
            payload: {
              appointment_id: appt.id,
              recipient: phone,
              language,
            },
          })
        } catch { /* optional */ }
      }
    } catch (error) {
      whatsapp.sent = false
      whatsapp.error = error?.message || String(error)
      if (error?.code === 'WA_NOT_READY') {
        whatsapp.disconnected = true
      }
      console.warn('[CANCEL] staff cancellation WhatsApp notify failed', {
        appointment_id: appt.id,
        reason: whatsapp.error,
        code: error?.code || null,
      })
    }

    return whatsapp
  }

  /**
   * Cancel + optional patient WhatsApp notify for staff sources.
   */
  async function executeCancelAndNotify(appointmentId, opts = {}) {
    const result = executeCancel(appointmentId, opts)
    if (!result?.ok || result.already) {
      return { ...result, whatsapp: { attempted: false, sent: false, skipped: true } }
    }
    if (!isStaffCancelSource(opts.source)) {
      return { ...result, whatsapp: { attempted: false, sent: false, skipped: true } }
    }
    const whatsapp = await notifyPatientOfStaffCancellation(result.appointment, {
      source: opts.source,
      actorName: opts.actorName || null,
    })
    return { ...result, whatsapp }
  }

  function ensureTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS appointment_cancel_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_key TEXT NOT NULL,
        conversation_id INTEGER,
        whatsapp_contact_id INTEGER,
        appointment_id INTEGER,
        patient_id INTEGER,
        step TEXT NOT NULL DEFAULT 'SELECT_APPOINTMENT',
        candidates_json TEXT,
        language TEXT DEFAULT 'fr',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cancel_req_chat
        ON appointment_cancel_requests(chat_key, status);
    `)
    for (const sql of [
      'ALTER TABLE appointment_cancel_requests ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0',
    ]) {
      try { db.exec(sql) } catch { /* column exists */ }
    }
  }

  ensureTables()

  function getPending(chatKey) {
    const key = normalizeKey(chatKey)
    if (!key) return null
    return db.prepare(`
      SELECT * FROM appointment_cancel_requests
      WHERE status = 'pending'
        AND (chat_key = ? OR chat_key = ?)
      ORDER BY id DESC
      LIMIT 1
    `).get(key, stripInstance(key)) || null
  }

  function abandonPending(chatKey) {
    const key = normalizeKey(chatKey)
    if (!key) return
    db.prepare(`
      UPDATE appointment_cancel_requests
      SET status = 'abandoned', updated_at = ?
      WHERE status = 'pending' AND (chat_key = ? OR chat_key = ?)
    `).run(nowIso(), key, stripInstance(key))
  }

  function savePending(row) {
    if (row.id) {
      db.prepare(`
        UPDATE appointment_cancel_requests
        SET appointment_id = ?, patient_id = ?, step = ?, candidates_json = ?,
            language = ?, status = ?, retry_count = COALESCE(?, retry_count), updated_at = ?
        WHERE id = ?
      `).run(
        row.appointment_id || null,
        row.patient_id || null,
        row.step,
        row.candidates_json || null,
        row.language || 'fr',
        row.status || 'pending',
        row.retry_count != null ? Number(row.retry_count) : null,
        nowIso(),
        row.id,
      )
      return getPending(row.chat_key) || db.prepare('SELECT * FROM appointment_cancel_requests WHERE id = ?').get(row.id)
    }
    const result = db.prepare(`
      INSERT INTO appointment_cancel_requests (
        chat_key, conversation_id, whatsapp_contact_id, appointment_id, patient_id,
        step, candidates_json, language, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      row.chat_key,
      row.conversation_id || null,
      row.whatsapp_contact_id || null,
      row.appointment_id || null,
      row.patient_id || null,
      row.step,
      row.candidates_json || null,
      row.language || 'fr',
      nowIso(),
      nowIso(),
    )
    return db.prepare('SELECT * FROM appointment_cancel_requests WHERE id = ?').get(result.lastInsertRowid)
  }

  function resolveContactId(chatKey, conversation = null) {
    if (conversation?.whatsapp_contact_id) return Number(conversation.whatsapp_contact_id)
    const contact = findContactByWhatsAppOrPhone(db, {
      whatsappId: chatKey,
      phone: conversation?.phone_e164 || null,
    })
    return contact?.id || null
  }

  function listCancellableAppointments({ chatKey, contactId = null, customerId = null } = {}) {
    const params = []
    let where = `
      a.status IN ('non_confirme', 'confirmed')
      AND a.appointment_date >= date('now', 'localtime')
    `
    if (contactId) {
      where += ` AND a.customer_id IN (
        SELECT patient_id FROM contact_patients WHERE whatsapp_contact_id = ?
      )`
      params.push(Number(contactId))
    } else if (customerId) {
      where += ' AND a.customer_id = ?'
      params.push(Number(customerId))
    } else {
      // Fallback: appointments linked via conversation chat key / customer whatsapp
      where += ` AND (
        a.conversation_id = ? OR a.conversation_id = ?
        OR c.whatsapp_chat_id = ? OR c.whatsapp_chat_id = ?
      )`
      const key = normalizeKey(chatKey)
      params.push(key, stripInstance(key), key, stripInstance(key))
    }

    return db.prepare(`
      SELECT
        a.id AS appointment_id,
        a.customer_id AS patient_id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        a.duration_minutes,
        c.full_name,
        c.phone_number
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE ${where}
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 12
    `).all(...params).map((r) => ({
      appointment_id: r.appointment_id,
      patient_id: r.patient_id,
      appointment_date: r.appointment_date,
      appointment_time: formatTime(r.appointment_time),
      status: r.status,
      duration_minutes: Number(r.duration_minutes) || 30,
      full_name: r.full_name,
      phone_number: r.phone_number,
    }))
  }

  function matchCandidate(text, candidates) {
    const raw = String(text || '').trim()
    if (!raw || !candidates?.length) return null

    // Numeric choice
    const num = raw.match(/^(\d{1,2})\s*[.)]?$/)
    if (num) {
      const idx = Number(num[1]) - 1
      if (idx >= 0 && idx < candidates.length) return candidates[idx]
    }

    const lower = raw.toLowerCase()
    // By patient name fragment
    const byName = candidates.filter((c) => {
      const full = String(c.full_name || '').toLowerCase()
      const first = firstName(c.full_name).toLowerCase()
      return full.includes(lower) || lower.includes(first) || lower.includes(full)
    })
    if (byName.length === 1) return byName[0]

    // Weekday / date hints
    const weekdayMap = {
      dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
      الأحد: 0, الإثنين: 1, الثلاثاء: 2, الأربعاء: 3, الخميس: 4, الجمعة: 5, السبت: 6,
    }
    for (const [word, day] of Object.entries(weekdayMap)) {
      if (!lower.includes(word)) continue
      const hits = candidates.filter((c) => {
        const d = new Date(`${c.appointment_date}T12:00:00`)
        return d.getDay() === day
      })
      if (hits.length === 1) return hits[0]
    }

    // Day of month "31"
    const dayNum = raw.match(/\b(\d{1,2})\b/)
    if (dayNum) {
      const dd = String(Number(dayNum[1])).padStart(2, '0')
      const hits = candidates.filter((c) => String(c.appointment_date).endsWith(`-${dd}`))
      if (hits.length === 1) return hits[0]
    }

    return null
  }

  function parseHintsFromCancelText(text, candidates) {
    if (!candidates?.length) return null
    if (candidates.length === 1) return candidates[0]
    return matchCandidate(text, candidates)
  }

  /**
   * Central cancel used by WhatsApp (and reusable).
   */
  function executeCancel(appointmentId, {
    source = 'whatsapp_patient',
    actorName = null,
    actor = null,
  } = {}) {
    if (typeof cancelAppointmentCore === 'function') {
      return cancelAppointmentCore(appointmentId, { source, actorName, actor })
    }

    const appt = db.prepare(`
      SELECT a.*, c.full_name, c.phone_number, c.preferred_language, c.whatsapp_chat_id
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ?
    `).get(Number(appointmentId))

    if (!appt) return { ok: false, reason: 'not_found' }
    if (appt.status === 'cancelled') {
      return {
        ok: true,
        already: true,
        appointment: appt,
        item: {
          appointment_id: appt.id,
          patient_id: appt.customer_id,
          full_name: appt.full_name,
          appointment_date: appt.appointment_date,
          appointment_time: formatTime(appt.appointment_time),
        },
      }
    }
    if (!['non_confirme', 'confirmed'].includes(appt.status)) {
      return { ok: false, reason: 'not_cancellable', appointment: appt }
    }

    const minCancel = Number(getAppointmentsSettings?.()?.minCancelLeadMinutes) || 0
    if (minCancel > 0 && typeof canCancelOrReschedule === 'function') {
      const gate = canCancelOrReschedule(appt.appointment_date, appt.appointment_time, minCancel)
      if (!gate.ok) {
        const lang = appt.preferred_language || 'fr'
        const forceReply = isDarija(lang)
          ? 'ما يمكنش نلغي الموعد دابا حيت قرب بزاف. عافاك تواصل مع المركز.'
          : 'L’annulation automatique n’est plus possible si proche du rendez-vous. Merci de contacter le cabinet.'
        return { ok: false, reason: 'cancel_too_late', forceReply, appointment: appt }
      }
    }

    runInTransaction(db, () => {
      db.prepare(`
        UPDATE appointments
        SET status = 'cancelled'
        WHERE id = ? AND status IN ('non_confirme', 'confirmed')
      `).run(Number(appointmentId))

      try {
        db.prepare(`
          UPDATE appointment_confirmation_requests
          SET status = 'cancelled', cancelled_at = ?, confirmation_source = ?, updated_at = ?
          WHERE appointment_id = ? AND status IN ('pending', 'staff_task')
        `).run(nowIso(), source, nowIso(), Number(appointmentId))
      } catch { /* optional */ }

      try {
        db.prepare(`
          UPDATE slot_proposals
          SET status = 'cancelled', updated_at = ?
          WHERE appointment_id = ? AND status = 'pending'
        `).run(nowIso(), Number(appointmentId))
      } catch { /* optional */ }

      try {
        db.prepare(`
          UPDATE tasks
          SET status = 'cancelled', completed_at = ?, updated_at = ?
          WHERE appointment_id = ?
            AND status NOT IN ('completed', 'cancelled')
        `).run(nowIso(), nowIso(), Number(appointmentId))
      } catch { /* optional */ }
    })

    if (typeof notifySlotReleased === 'function') {
      try {
        notifySlotReleased({
          slotDate: appt.appointment_date,
          slotTime: appt.appointment_time,
          appointmentId,
          sourceEvent: 'appointment_cancelled',
          durationMinutes: appt.duration_minutes || 30,
        })
      } catch (error) {
        console.warn('[CANCEL] slot notification failed', error.message || error)
      }
    }

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          event_type: 'APPOINTMENT_CANCELLED',
          title: 'Rendez-vous annulé',
          detail: source === 'whatsapp_patient'
            ? 'Annulé par le patient via WhatsApp'
            : (actorName ? `Annulé par ${actorName}` : 'Annulé'),
          actor_type: source === 'whatsapp_patient' ? 'patient' : 'human',
          actor_name: actorName,
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        logAiAction({
          customer_id: appt.customer_id,
          action_type: 'appointment_cancelled',
          reason: source === 'whatsapp_patient' ? 'Annulation WhatsApp patient' : 'Annulation',
          result: String(appointmentId),
          source: source === 'whatsapp_patient' ? 'whatsapp' : 'dashboard',
          actor: source === 'whatsapp_patient' ? assistantAiActor() : {
            type: 'dashboard_user',
            userId: null,
            displayName: actorName || 'Utilisateur',
            role: null,
          },
        })
      } catch { /* optional */ }
    }

    const refreshed = db.prepare(`
      SELECT a.*, c.full_name, c.phone_number
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ?
    `).get(Number(appointmentId))

    return {
      ok: true,
      appointment: refreshed,
      item: {
        appointment_id: refreshed.id,
        patient_id: refreshed.customer_id,
        full_name: refreshed.full_name,
        appointment_date: refreshed.appointment_date,
        appointment_time: formatTime(refreshed.appointment_time),
      },
    }
  }

  function resolveCancelLanguage({ chatKey, conversation = null, fallback = 'fr', preferredLanguage = null } = {}) {
    return resolvePatientLanguageFromRow(
      {
        preferred_language: preferredLanguage,
        whatsapp_chat_id: chatKey,
        language: conversation?.language,
      },
      {
        chatKey,
        getActiveConversationLanguage,
        inboundLanguageHint: fallback,
      },
    ).language
  }

  function startCancelFlow({
    chatKey,
    text = '',
    language = 'fr',
    conversation = null,
  } = {}) {
    const key = normalizeKey(chatKey)
    if (!key) return null

    abandonPending(key)

    let conv = conversation
    if (!conv && typeof getOrCreateConversation === 'function') {
      try {
        conv = getOrCreateConversation({
          external_key: key,
          channel: 'whatsapp',
        })
      } catch { /* optional */ }
    }

    const contactId = resolveContactId(key, conv)
    const candidates = listCancellableAppointments({
      chatKey: key,
      contactId,
      customerId: conv?.customer_id || null,
    })

    const resolvedLanguage = resolveCancelLanguage({
      chatKey: key,
      conversation: conv,
      fallback: language,
      preferredLanguage: candidates[0]?.preferred_language,
    })

    if (!candidates.length) {
      return {
        handled: true,
        action: 'none',
        forceReply: msgNoAppointments(resolvedLanguage),
        shouldSkipLlm: true,
      }
    }

    const hinted = parseHintsFromCancelText(text, candidates)
    if (hinted) {
      savePending({
        chat_key: key,
        conversation_id: conv?.id || null,
        whatsapp_contact_id: contactId,
        appointment_id: hinted.appointment_id,
        patient_id: hinted.patient_id,
        step: 'WAITING_CONFIRMATION',
        candidates_json: JSON.stringify(candidates),
        language: resolvedLanguage,
      })
      return {
        handled: true,
        action: 'confirm',
        forceReply: msgConfirmCancel(hinted, resolvedLanguage),
        shouldSkipLlm: true,
        appointmentId: hinted.appointment_id,
      }
    }

    if (candidates.length === 1) {
      const only = candidates[0]
      savePending({
        chat_key: key,
        conversation_id: conv?.id || null,
        whatsapp_contact_id: contactId,
        appointment_id: only.appointment_id,
        patient_id: only.patient_id,
        step: 'WAITING_CONFIRMATION',
        candidates_json: JSON.stringify(candidates),
        language: resolvedLanguage,
      })
      return {
        handled: true,
        action: 'confirm',
        forceReply: msgConfirmCancel(only, resolvedLanguage),
        shouldSkipLlm: true,
        appointmentId: only.appointment_id,
      }
    }

    savePending({
      chat_key: key,
      conversation_id: conv?.id || null,
      whatsapp_contact_id: contactId,
      appointment_id: null,
      patient_id: null,
      step: 'SELECT_APPOINTMENT',
      candidates_json: JSON.stringify(candidates),
      language: resolvedLanguage,
    })
    return {
      handled: true,
      action: 'select',
      forceReply: msgListAppointments(candidates, resolvedLanguage),
      shouldSkipLlm: true,
      pendingCount: candidates.length,
    }
  }

  /**
   * Inbound handler — pending cancel first, then new cancel intents.
   */
  function handleInboundCancel({
    chatKey = null,
    text = '',
    language = 'fr',
    routerIntent = null,
    conversation = null,
  } = {}) {
    const key = normalizeKey(chatKey)
    const raw = String(text || '').trim()
    if (!key || !raw) return null

    const pending = getPending(key)
    const lang = pending?.language || resolveCancelLanguage({
      chatKey: key,
      conversation,
      fallback: language,
    })
    const candidates = (() => {
      try {
        return pending?.candidates_json ? JSON.parse(pending.candidates_json) : []
      } catch {
        return []
      }
    })()

    // --- Pending SELECT ---
    if (pending && pending.step === 'SELECT_APPOINTMENT') {
      const chosen = matchCandidate(raw, candidates)
      if (chosen) {
        savePending({
          ...pending,
          appointment_id: chosen.appointment_id,
          patient_id: chosen.patient_id,
          step: 'WAITING_CONFIRMATION',
          candidates_json: JSON.stringify(candidates),
          language: lang,
          status: 'pending',
        })
        return {
          handled: true,
          action: 'confirm',
          forceReply: msgConfirmCancel(chosen, lang),
          shouldSkipLlm: true,
          appointmentId: chosen.appointment_id,
        }
      }
      if (parseBinaryConfirmation({ text: raw, context: 'cancel_confirmation' }).value === 'no') {
        abandonPending(key)
        return {
          handled: true,
          action: 'aborted',
          forceReply: msgKept(lang),
          shouldSkipLlm: true,
        }
      }
      return {
        handled: true,
        action: 'clarify',
        forceReply: `${msgClarify(lang)}\n\n${msgListAppointments(candidates, lang)}`,
        shouldSkipLlm: true,
      }
    }

    // --- Pending WAITING_CONFIRMATION ---
    if (pending && pending.step === 'WAITING_CONFIRMATION' && pending.appointment_id) {
      const item = candidates.find((c) => Number(c.appointment_id) === Number(pending.appointment_id))
        || {
          appointment_id: pending.appointment_id,
          patient_id: pending.patient_id,
          full_name: 'Patient',
          appointment_date: null,
          appointment_time: null,
        }

      // Load fresh names/dates
      const fresh = db.prepare(`
        SELECT a.id AS appointment_id, a.customer_id AS patient_id,
               a.appointment_date, a.appointment_time, a.status, c.full_name
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        WHERE a.id = ?
      `).get(Number(pending.appointment_id))

      const target = fresh
        ? {
          appointment_id: fresh.appointment_id,
          patient_id: fresh.patient_id,
          full_name: fresh.full_name,
          appointment_date: fresh.appointment_date,
          appointment_time: formatTime(fresh.appointment_time),
          status: fresh.status,
        }
        : item

      const parsed = parseBinaryConfirmation({ text: raw, context: 'cancel_confirmation' })
      if (process.env.CRM_DEBUG_CANCEL === '1') {
        console.log('[CANCEL_CONFIRMATION]', {
          chatKey: key,
          text: raw,
          parsed: parsed.value,
          reason: parsed.reason,
          appointmentId: pending.appointment_id,
          language: lang,
        })
      }

      if (parsed.value === 'ambiguous') {
        return {
          handled: true,
          action: 'clarify_ambiguous',
          forceReply: msgConfirmAmbiguous(lang),
          shouldSkipLlm: true,
          appointmentId: target.appointment_id,
        }
      }

      if (parsed.value === 'yes') {
        if (fresh?.status === 'cancelled') {
          abandonPending(key)
          db.prepare(`
            UPDATE appointment_cancel_requests SET status = 'completed', updated_at = ? WHERE id = ?
          `).run(nowIso(), pending.id)
          return {
            handled: true,
            action: 'already_cancelled',
            forceReply: msgAlreadyCancelled(lang),
            shouldSkipLlm: true,
            appointmentId: target.appointment_id,
          }
        }

        let result
        try {
          result = executeCancel(target.appointment_id, { source: 'whatsapp_patient' })
        } catch (error) {
          console.warn('[CANCEL] execute failed', error.message || error)
          return {
            handled: true,
            action: 'error',
            forceReply: msgCancelFailed(lang),
            shouldSkipLlm: true,
          }
        }

        if (!result.ok && result.reason === 'cancel_too_late') {
          abandonPending(key)
          return {
            handled: true,
            action: 'cancel_too_late',
            forceReply: result.forceReply || msgCancelFailed(lang),
            shouldSkipLlm: true,
            appointmentId: target.appointment_id,
          }
        }

        db.prepare(`
          UPDATE appointment_cancel_requests SET status = 'completed', updated_at = ? WHERE id = ?
        `).run(nowIso(), pending.id)

        if (!result.ok && result.reason === 'not_cancellable') {
          return {
            handled: true,
            action: 'not_cancellable',
            forceReply: msgCancelFailed(lang),
            shouldSkipLlm: true,
          }
        }

        const successItem = result.item || target
        return {
          handled: true,
          action: result.already ? 'already_cancelled' : 'cancelled',
          forceReply: result.already
            ? msgAlreadyCancelled(lang)
            : msgCancelledOk(successItem, lang),
          shouldSkipLlm: true,
          appointmentId: successItem.appointment_id,
          result,
        }
      }

      if (parsed.value === 'no') {
        abandonPending(key)
        if (process.env.CRM_DEBUG_CANCEL === '1') {
          console.log('[CANCEL_CONFIRMATION]', {
            action: 'keep_appointment',
            pendingCleared: true,
            appointmentId: target.appointment_id,
          })
        }
        return {
          handled: true,
          action: 'kept',
          forceReply: msgKept(target, lang),
          shouldSkipLlm: true,
          appointmentId: target.appointment_id,
        }
      }

      // Unknown — short clarification, never repeat the full confirmation block
      const retryCount = Number(pending.retry_count || 0) + 1
      savePending({
        ...pending,
        chat_key: key,
        retry_count: retryCount,
      })
      return {
        handled: true,
        action: 'confirm_clarify',
        forceReply: msgConfirmClarify(lang),
        shouldSkipLlm: true,
        appointmentId: target.appointment_id,
        retryCount,
      }
    }

    // --- New cancel intent ---
    if (isVagueMaybeCancel(raw) && !looksLikeCancelIntent(raw, routerIntent)) {
      return null
    }

    if (!looksLikeCancelIntent(raw, routerIntent)) {
      return null
    }

    return startCancelFlow({
      chatKey: key,
      text: raw,
      language,
      conversation,
    })
  }

  return {
    ensureTables,
    getPending,
    abandonPending,
    listCancellableAppointments,
    executeCancel,
    executeCancelAndNotify,
    notifyPatientOfStaffCancellation,
    startCancelFlow,
    handleInboundCancel,
    looksLikeCancelIntent,
    // templates exported for tests
    msgConfirmCancel,
    msgCancelledOk,
    msgStaffCancelledPatient,
    msgListAppointments,
    msgNoAppointments,
    msgKept,
  }
}

module.exports = {
  createWhatsappCancelEngine,
  looksLikeCancelIntent,
  msgConfirmCancel,
  msgCancelledOk,
  msgStaffCancelledPatient,
  msgListAppointments,
  msgNoAppointments,
  msgKept,
}
