/**
 * Appointment WhatsApp confirmation engine (24h / 4h follow-up / 24h staff task).
 * Booking OUI creates non_confirme; this flow confirms later via patient reply.
 */

const { isConfirmationYes, isConfirmationNo } = require('../extract')
const { parseYesNoReply } = require('../binary-confirmation')
const { formatPhoneDisplay } = require('../phone')
const { formatDateDisplay, isDarija, formatDateTimeLocalized } = require('../messages')
const { resolvePatientLanguageFromRow } = require('./resolve-patient-language')
const { assistantAiActor } = require('./activity-actors')

function nowIso() {
  return new Date().toISOString()
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

function parseAppointmentStart(dateIso, timeStr) {
  const d = String(dateIso || '').slice(0, 10)
  const t = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!d || !t) return null
  const hh = t[1].padStart(2, '0')
  const mm = t[2]
  // Local wall time as ISO-like (Africa/Casablanca ≈ system local for HEL)
  const dt = new Date(`${d}T${hh}:${mm}:00`)
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

function minutesUntil(dateIso, timeStr) {
  const start = parseAppointmentStart(dateIso, timeStr)
  if (!start) return null
  return Math.round((start.getTime() - Date.now()) / 60000)
}

function confirmationAskMessage(appointment, customer, language = 'fr') {
  const name = customer?.full_name || 'Patient'
  const date = formatDateDisplay(appointment.appointment_date)
  const time = String(appointment.appointment_time || '').slice(0, 5)
  if (isDarija(language)) {
    return [
      'مرحبا،',
      '',
      `كنذكروك بموعد ${name} فـ مركز طب الأسنان HEL :`,
      '',
      `📅 ${date}`,
      `🕐 ${time}`,
      '',
      'عافاك جاوب بـ :',
      '',
      'نعم — باش نأكد',
      'لا — باش نلغي',
    ].join('\n')
  }
  return [
    'Bonjour,',
    '',
    `Merci de confirmer le rendez-vous de ${name} :`,
    '',
    `📅 ${date}`,
    `🕐 ${time}`,
    '',
    'Merci de répondre :',
    '',
    'OUI — pour confirmer',
    'NON — pour annuler',
  ].join('\n')
}

function confirmationClarifyMessage(appointment, language = 'fr') {
  const slot = formatDateTimeLocalized(
    appointment.appointment_date,
    appointment.appointment_time,
    language,
  )
  if (isDarija(language)) {
    return `ما فهمتش مزيان. واش بغيتي تأكد الموعد ديال ${slot} ولا تلغيه؟ جاوب بـ نعم أو لا.`
  }
  return `Je n’ai pas bien compris. Souhaitez-vous confirmer ou annuler le rendez-vous du ${slot} ? Répondez OUI ou NON.`
}

function confirmationFollowupMessage(appointment, customer, language = 'fr') {
  const name = customer?.full_name || 'Patient'
  const first = String(name).trim().split(/\s+/)[0] || name
  const date = formatDateDisplay(appointment.appointment_date)
  const time = String(appointment.appointment_time || '').slice(0, 5)
  if (isDarija(language)) {
    return [
      `مرحبا ${first}،`,
      '',
      `مازال ما توصلناش بتأكيد ديالك لموعد ${date} مع ${time}.`,
      '',
      'عافاك جاوب بـ نعم باش نأكد، ولا لا باش نلغي.',
    ].join('\n')
  }
  return [
    `Bonjour ${first},`,
    '',
    `Nous n’avons pas encore reçu votre confirmation pour votre rendez-vous du ${date} à ${time}.`,
    '',
    'Merci de répondre OUI pour confirmer ou NON pour annuler.',
  ].join('\n')
}

function confirmationAckMessage(appointment, language = 'fr') {
  const date = formatDateDisplay(appointment.appointment_date)
  const time = String(appointment.appointment_time || '').slice(0, 5)
  if (isDarija(language)) {
    return `شكراً. موعدك نهار ${date} مع ${time} تأكد دابا.`
  }
  return `Merci. Votre rendez-vous du ${date} à ${time} est maintenant confirmé.`
}

function cancellationAckMessage(appointment, language = 'fr') {
  const date = formatDateDisplay(appointment.appointment_date)
  const time = String(appointment.appointment_time || '').slice(0, 5)
  if (isDarija(language)) {
    return `تم إلغاء موعدك نهار ${date} مع ${time}. إلى بغيتي موعد جديد، عافاك صيفط لينا.`
  }
  return `Votre rendez-vous du ${date} à ${time} a été annulé. Si vous souhaitez un nouveau créneau, écrivez-nous.`
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createAppointmentConfirmationEngine(db, helpers = {}) {
  const {
    addTimelineEvent = null,
    logAiAction = null,
    createTask = null,
    updateTask = null,
    createNotification = null,
    trackWhatsAppTurn = null,
    getOrCreateConversation = null,
    canAiAutoReply = null,
    matchWaitlistForSlot = null,
    notifySlotReleased = null,
    getActiveConversationLanguage = null,
    getRemindersSettings = null,
    isAutomationEnabled = null,
    isWithinSendWindow = null,
  } = helpers

  function remindersConfig() {
    return typeof getRemindersSettings === 'function'
      ? getRemindersSettings()
      : {
        confirmationEnabled: true,
        confirmationHoursBefore: 24,
        firstReminderEnabled: true,
        firstReminderHoursAfter: 4,
        secondReminderEnabled: true,
        secondReminderHoursAfter: 24,
        dayOfReminderEnabled: false,
        dayOfReminderHoursBefore: 2,
      }
  }

  function cabinetAutomationOk(key) {
    if (typeof isAutomationEnabled !== 'function') return true
    const map = {
      confirm_24h_before: 'confirmation',
      no_response_4h: 'followups',
      no_response_24h_task: 'followups',
    }
    return isAutomationEnabled(map[key] || key)
  }

  function sendWindowOk() {
    if (typeof isWithinSendWindow !== 'function') return true
    return isWithinSendWindow(new Date())
  }

  function ensureTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS appointment_confirmation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER NOT NULL UNIQUE,
        customer_id INTEGER,
        conversation_id INTEGER,
        chat_key TEXT,
        language TEXT DEFAULT 'fr',
        status TEXT NOT NULL DEFAULT 'pending',
        initial_sent_at TEXT,
        followup_sent_at TEXT,
        staff_task_id INTEGER,
        confirmed_at TEXT,
        cancelled_at TEXT,
        confirmation_source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_acr_status ON appointment_confirmation_requests(status, initial_sent_at);
      CREATE INDEX IF NOT EXISTS idx_acr_chat ON appointment_confirmation_requests(chat_key);
    `)
    for (const sql of [
      'ALTER TABLE appointments ADD COLUMN confirmed_at TEXT',
      'ALTER TABLE appointments ADD COLUMN confirmation_source TEXT',
    ]) {
      try { db.exec(sql) } catch (e) {
        if (!/duplicate column/i.test(String(e?.message || e))) throw e
      }
    }
  }

  ensureTables()

  function getAutomation(key) {
    return db.prepare('SELECT * FROM automations WHERE key = ?').get(key) || null
  }

  function isAutomationActive(key) {
    if (!cabinetAutomationOk(key)) return false
    const row = getAutomation(key)
    return Boolean(row && row.status === 'active')
  }

  function claimAutomationRun(automationKey, uniqueKey, result = null) {
    const auto = getAutomation(automationKey)
    if (!auto || auto.status !== 'active') return { claimed: false, reason: 'inactive' }
    try {
      db.prepare(`
        INSERT INTO automation_runs (automation_id, unique_key, status, result_json, created_at)
        VALUES (?, ?, 'ok', ?, ?)
      `).run(auto.id, uniqueKey, result ? JSON.stringify(result) : null, nowIso())
      return { claimed: true, automation_id: auto.id }
    } catch (error) {
      if (/UNIQUE/i.test(String(error?.message || error))) {
        return { claimed: false, reason: 'already_run' }
      }
      throw error
    }
  }

  function getRequestByAppointment(appointmentId) {
    return db.prepare(`
      SELECT * FROM appointment_confirmation_requests WHERE appointment_id = ?
    `).get(Number(appointmentId)) || null
  }

  function listPendingRequestsForChat(chatKey) {
    const key = String(chatKey || '').trim()
    if (!key) return []
    return db.prepare(`
      SELECT r.*, a.appointment_date, a.appointment_time, c.full_name
      FROM appointment_confirmation_requests r
      JOIN appointments a ON a.id = r.appointment_id
      JOIN customers c ON c.id = a.customer_id
      WHERE r.status = 'pending'
        AND r.initial_sent_at IS NOT NULL
        AND (r.chat_key = ? OR r.chat_key = ?)
        AND a.status = 'non_confirme'
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `).all(key, key.replace(/^[^:]+:/, ''))
  }

  function getPendingRequestForChat(chatKey, customerId = null) {
    const pending = listPendingRequestsForChat(chatKey)
    if (pending.length === 1) return pending[0]
    if (pending.length > 1) {
      return { ambiguous: true, pending }
    }
    if (customerId) {
      return db.prepare(`
        SELECT r.*
        FROM appointment_confirmation_requests r
        JOIN appointments a ON a.id = r.appointment_id
        WHERE r.status = 'pending'
          AND r.initial_sent_at IS NOT NULL
          AND r.customer_id = ?
          AND a.status = 'non_confirme'
        ORDER BY r.initial_sent_at DESC
        LIMIT 1
      `).get(Number(customerId)) || null
    }
    return null
  }

  function disambiguationMessage(pending, language = 'fr') {
    const lines = pending.map((p, i) => {
      const date = formatDateDisplay(p.appointment_date)
      const time = String(p.appointment_time || '').slice(0, 5)
      return `${i + 1}. ${p.full_name} — ${date} à ${time}`
    })
    if (isDarija(language)) {
      return [
        'عندك عدة مواعيد للتأكيد:',
        '',
        ...lines,
        '',
        'عافاك حدد شكون (بالرقم أو بالسمية).',
      ].join('\n')
    }
    return [
      'Vous avez plusieurs rendez-vous en attente de confirmation :',
      '',
      ...lines,
      '',
      'Lequel souhaitez-vous confirmer ou annuler ? (indiquez le numéro ou le nom)',
    ].join('\n')
  }

  function loadAppointmentBundle(appointmentId) {
    return db.prepare(`
      SELECT
        a.*,
        c.full_name, c.phone_number, c.preferred_language, c.whatsapp_chat_id,
        d.problem
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(Number(appointmentId)) || null
  }

  function resolveLanguage(row, chatKey = null) {
    return resolvePatientLanguageFromRow(row, {
      chatKey: chatKey || row?.whatsapp_chat_id || row?.chat_key || row?.conversation_id,
      getActiveConversationLanguage,
    }).language
  }

  function ensureRequestForAppointment(appointmentId, extras = {}) {
    const existing = getRequestByAppointment(appointmentId)
    if (existing) {
      if (extras.chat_key || extras.conversation_id || extras.language) {
        db.prepare(`
          UPDATE appointment_confirmation_requests
          SET chat_key = COALESCE(?, chat_key),
              conversation_id = COALESCE(?, conversation_id),
              language = COALESCE(?, language),
              updated_at = ?
          WHERE id = ?
        `).run(
          extras.chat_key || null,
          extras.conversation_id || null,
          extras.language || null,
          nowIso(),
          existing.id,
        )
        return getRequestByAppointment(appointmentId)
      }
      return existing
    }
    const appt = loadAppointmentBundle(appointmentId)
    if (!appt) return null
    const chatKey = extras.chat_key || appt.whatsapp_chat_id || appt.conversation_id || null
    const language = extras.language || resolveLanguage(appt, chatKey)
    db.prepare(`
      INSERT INTO appointment_confirmation_requests (
        appointment_id, customer_id, conversation_id, chat_key, language, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      Number(appointmentId),
      appt.customer_id,
      extras.conversation_id || null,
      chatKey,
      language,
      nowIso(),
      nowIso(),
    )
    return getRequestByAppointment(appointmentId)
  }

  /**
   * Called right after booking OUI creates the appointment.
   */
  function registerBookingCreated(appointmentId, {
    chatKey = null,
    conversationId = null,
    language = null,
  } = {}) {
    const req = ensureRequestForAppointment(appointmentId, {
      chat_key: chatKey,
      conversation_id: conversationId,
      language,
    })
    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: req?.customer_id || null,
          appointment_id: appointmentId,
          conversation_id: conversationId,
          event_type: 'APPOINTMENT_CREATED',
          title: 'Rendez-vous créé',
          detail: 'Statut : À confirmer',
          actor_type: 'system',
        })
      } catch { /* optional */ }
    }
    return req
  }

  async function sendOutbound({
    chatKey,
    phone,
    text,
    appointmentId,
    customerId,
    conversationId,
    kind,
  }) {
    const sendFn = helpers.sendWhatsAppText
    if (typeof sendFn !== 'function') {
      throw new Error('sendWhatsAppText unavailable')
    }
    const sent = await sendFn({
      chatId: chatKey,
      phone,
      text,
    })

    if (typeof trackWhatsAppTurn === 'function' && chatKey) {
      try {
        trackWhatsAppTurn({
          chatId: chatKey,
          customerId,
          outboundText: text,
          outboundAuthor: 'ai',
          outboundMessageId: sent?.messageId || null,
          phoneNumber: phone,
        })
      } catch { /* optional */ }
    } else if (conversationId && helpers.addMessage) {
      try {
        helpers.addMessage(conversationId, {
          direction: 'outbound',
          author_type: 'ai',
          author_name: 'Assistant IA',
          body: text,
          message_type: 'text',
          external_message_id: sent?.messageId || null,
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        logAiAction({
          conversation_id: conversationId,
          customer_id: customerId,
          action_type: kind === 'followup' ? 'followup_sent' : 'confirmation_request_sent',
          reason: kind === 'followup'
            ? 'Relance confirmation WhatsApp (4 h)'
            : 'Demande de confirmation WhatsApp',
          result: String(appointmentId),
          source: 'automation',
          actor: assistantAiActor(),
          payload: { appointment_id: appointmentId, kind },
        })
      } catch { /* optional */ }
    }

    return sent
  }

  function conversationAllowsAutomation(chatKey) {
    if (!chatKey) return true
    if (typeof canAiAutoReply === 'function') {
      return canAiAutoReply(chatKey) !== false
    }
    return true
  }

  async function sendInitialConfirmation(appointmentId, { force = false } = {}) {
    const reminders = remindersConfig()
    if (!reminders.confirmationEnabled && !force) {
      return { ok: false, reason: 'confirmation_disabled' }
    }
    if (!sendWindowOk() && !force) {
      return { ok: false, reason: 'outside_send_window' }
    }
    if (!isAutomationActive('confirm_24h_before') && !force) {
      return { ok: false, reason: 'automation_paused' }
    }
    const claim = claimAutomationRun(
      'confirm_24h_before',
      `confirmation_initial:${appointmentId}`,
      { appointment_id: appointmentId },
    )
    if (!claim.claimed) return { ok: false, reason: claim.reason }

    const appt = loadAppointmentBundle(appointmentId)
    if (!appt || appt.status !== 'non_confirme') {
      return { ok: false, reason: 'not_eligible' }
    }
    const until = minutesUntil(appt.appointment_date, appt.appointment_time)
    if (until != null && until <= 0) {
      return { ok: false, reason: 'past' }
    }

    let req = ensureRequestForAppointment(appointmentId)
    const chatKey = req?.chat_key || appt.whatsapp_chat_id || appt.conversation_id
    if (!conversationAllowsAutomation(chatKey)) {
      // Allow retry later: delete the claim? Keep claim to avoid spam during HUMAN —
      // actually during HUMAN we should NOT claim permanently. Roll back by deleting run.
      db.prepare(`
        DELETE FROM automation_runs WHERE automation_id = ? AND unique_key = ?
      `).run(claim.automation_id, `confirmation_initial:${appointmentId}`)
      return { ok: false, reason: 'human_handoff' }
    }

    const language = resolveLanguage(appt, chatKey)
    const text = confirmationAskMessage(appt, appt, language)

    try {
      await sendOutbound({
        chatKey,
        phone: appt.phone_number,
        text,
        appointmentId,
        customerId: appt.customer_id,
        conversationId: req?.conversation_id,
        kind: 'initial',
      })
    } catch (error) {
      db.prepare(`
        DELETE FROM automation_runs WHERE automation_id = ? AND unique_key = ?
      `).run(claim.automation_id, `confirmation_initial:${appointmentId}`)
      throw error
    }

    db.prepare(`
      UPDATE appointment_confirmation_requests
      SET initial_sent_at = ?, language = ?, chat_key = COALESCE(?, chat_key), updated_at = ?
      WHERE appointment_id = ?
    `).run(nowIso(), language, chatKey || null, nowIso(), Number(appointmentId))

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          conversation_id: req?.conversation_id,
          event_type: 'APPOINTMENT_CONFIRMATION_SENT',
          title: 'Confirmation envoyée',
          detail: 'Demande de confirmation WhatsApp',
          actor_type: 'ai',
        })
      } catch { /* optional */ }
    }

    if (createNotification) {
      try {
        createNotification({
          type: 'confirmation_sent',
          title: 'Confirmation WhatsApp envoyée',
          body: `${appt.full_name} · ${appt.appointment_date} ${String(appt.appointment_time).slice(0, 5)}`,
          link_path: '/agenda',
        })
      } catch { /* optional */ }
    }

    return { ok: true, text }
  }

  async function sendFollowupConfirmation(appointmentId) {
    if (!isAutomationActive('no_response_4h')) {
      return { ok: false, reason: 'automation_paused' }
    }
    const claim = claimAutomationRun(
      'no_response_4h',
      `confirmation_followup_4h:${appointmentId}`,
      { appointment_id: appointmentId },
    )
    if (!claim.claimed) return { ok: false, reason: claim.reason }

    const appt = loadAppointmentBundle(appointmentId)
    const req = getRequestByAppointment(appointmentId)
    if (!appt || appt.status !== 'non_confirme' || !req?.initial_sent_at || req.followup_sent_at) {
      return { ok: false, reason: 'not_eligible' }
    }
    const until = minutesUntil(appt.appointment_date, appt.appointment_time)
    // Don't send follow-up if appointment already started or < 30 min left
    if (until != null && until < 30) {
      return { ok: false, reason: 'too_close' }
    }

    const chatKey = req.chat_key || appt.whatsapp_chat_id
    if (!conversationAllowsAutomation(chatKey)) {
      db.prepare(`
        DELETE FROM automation_runs WHERE automation_id = ? AND unique_key = ?
      `).run(claim.automation_id, `confirmation_followup_4h:${appointmentId}`)
      return { ok: false, reason: 'human_handoff' }
    }

    const language = resolveLanguage(appt, chatKey)
    const text = confirmationFollowupMessage(appt, appt, language)
    try {
      await sendOutbound({
        chatKey,
        phone: appt.phone_number,
        text,
        appointmentId,
        customerId: appt.customer_id,
        conversationId: req.conversation_id,
        kind: 'followup',
      })
    } catch (error) {
      db.prepare(`
        DELETE FROM automation_runs WHERE automation_id = ? AND unique_key = ?
      `).run(claim.automation_id, `confirmation_followup_4h:${appointmentId}`)
      throw error
    }

    db.prepare(`
      UPDATE appointment_confirmation_requests
      SET followup_sent_at = ?, updated_at = ?
      WHERE appointment_id = ?
    `).run(nowIso(), nowIso(), Number(appointmentId))

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          event_type: 'APPOINTMENT_CONFIRMATION_FOLLOWUP',
          title: 'Relance confirmation',
          detail: 'Relance WhatsApp après 4 h sans réponse',
          actor_type: 'ai',
        })
      } catch { /* optional */ }
    }

    return { ok: true, text }
  }

  function createStaffConfirmationTask(appointmentId) {
    if (!isAutomationActive('no_response_24h_task')) {
      return { ok: false, reason: 'automation_paused' }
    }
    const claim = claimAutomationRun(
      'no_response_24h_task',
      `confirmation_staff_task_24h:${appointmentId}`,
      { appointment_id: appointmentId },
    )
    if (!claim.claimed) return { ok: false, reason: claim.reason }

    const appt = loadAppointmentBundle(appointmentId)
    const req = getRequestByAppointment(appointmentId)
    if (!appt || appt.status !== 'non_confirme' || !req?.initial_sent_at || req.staff_task_id) {
      return { ok: false, reason: 'not_eligible' }
    }

    if (typeof createTask !== 'function') {
      return { ok: false, reason: 'no_task_api' }
    }

    const task = createTask({
      customer_id: appt.customer_id,
      appointment_id: appointmentId,
      conversation_id: req.conversation_id,
      task_type: 'confirm_appointment',
      title: `Confirmation de rendez-vous — ${appt.full_name}`,
      reason: `Aucune réponse après les messages WhatsApp de confirmation. RDV ${appt.appointment_date} ${String(appt.appointment_time).slice(0, 5)}. Action recommandée : appeler le patient (${formatPhoneDisplay(appt.phone_number) || appt.phone_number}).`,
      priority: 'haute',
      status: 'to_call',
      due_at: nowIso(),
    })

    db.prepare(`
      UPDATE appointment_confirmation_requests
      SET staff_task_id = ?, status = CASE WHEN status = 'pending' THEN 'staff_task' ELSE status END, updated_at = ?
      WHERE appointment_id = ?
    `).run(task.id, nowIso(), Number(appointmentId))

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          event_type: 'CONFIRMATION_STAFF_TASK',
          title: 'Tâche assistante créée',
          detail: 'Appeler le patient — aucune réponse WhatsApp',
          actor_type: 'system',
        })
      } catch { /* optional */ }
    }

    if (createNotification) {
      try {
        createNotification({
          type: 'confirmation_call',
          title: 'À rappeler — confirmation',
          body: `${appt.full_name} · ${appt.appointment_date} ${String(appt.appointment_time).slice(0, 5)}`,
          link_path: '/relances',
        })
      } catch { /* optional */ }
    }

    return { ok: true, task }
  }

  function completeOpenConfirmationTasks(appointmentId, reason) {
    const open = db.prepare(`
      SELECT id FROM tasks
      WHERE appointment_id = ?
        AND task_type = 'confirm_appointment'
        AND status NOT IN ('completed', 'cancelled')
    `).all(Number(appointmentId))
    for (const row of open) {
      if (typeof updateTask === 'function') {
        updateTask(row.id, { status: 'completed', reason })
      } else {
        db.prepare(`
          UPDATE tasks SET status = 'completed', reason = COALESCE(?, reason), updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(reason, nowIso(), nowIso(), row.id)
      }
    }
  }

  function confirmAppointment(appointmentId, {
    source = 'whatsapp_patient',
    actorName = null,
    actor = null,
  } = {}) {
    const appt = loadAppointmentBundle(appointmentId)
    if (!appt) return { ok: false, reason: 'not_found' }
    if (appt.status === 'confirmed') {
      return { ok: true, already: true, appointment: appt }
    }
    if (appt.status !== 'non_confirme') {
      return { ok: false, reason: 'invalid_status', status: appt.status }
    }

    const tx = () => {
      db.prepare(`
        UPDATE appointments
        SET status = 'confirmed', confirmed_at = ?, confirmation_source = ?
        WHERE id = ? AND status = 'non_confirme'
      `).run(nowIso(), source, Number(appointmentId))

      db.prepare(`
        UPDATE appointment_confirmation_requests
        SET status = 'confirmed', confirmed_at = ?, confirmation_source = ?, updated_at = ?
        WHERE appointment_id = ?
      `).run(nowIso(), source, nowIso(), Number(appointmentId))
    }
    runInTransaction(db, tx)

    completeOpenConfirmationTasks(appointmentId, source === 'staff'
      ? 'Confirmé manuellement par l’équipe'
      : 'Patient confirmé via WhatsApp')

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          event_type: 'APPOINTMENT_CONFIRMED',
          title: 'Patient confirmé',
          detail: source === 'staff'
            ? `Confirmé par ${actorName || 'l’équipe'}`
            : 'Confirmé automatiquement après réponse WhatsApp',
          actor_type: source === 'staff' ? 'human' : 'patient',
          actor_name: actorName,
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        const auditActor = source === 'staff'
          ? (actor || {
            type: 'dashboard_user',
            userId: null,
            displayName: actorName || 'Utilisateur',
            role: null,
          })
          : assistantAiActor()
        logAiAction({
          customer_id: appt.customer_id,
          action_type: 'appointment_confirmed',
          reason: source === 'staff' ? 'Confirmation manuelle' : 'Confirmation WhatsApp patient',
          result: String(appointmentId),
          source: source === 'staff' ? 'dashboard' : 'whatsapp',
          actor: auditActor,
          payload: {
            appointment_id: appointmentId,
            origin: source === 'staff' ? 'dashboard' : 'whatsapp_patient',
            actor_user_id: auditActor.userId ?? null,
            actor_display_name: auditActor.displayName,
            actor_role: auditActor.role ?? null,
          },
        })
      } catch { /* optional */ }
    }

    return { ok: true, appointment: loadAppointmentBundle(appointmentId) }
  }

  /**
   * Central appointment cancellation (WhatsApp patient, 24h NON, staff).
   * Idempotent: second call on already-cancelled returns { already: true } without
   * creating a duplicate slot notification.
   */
  function cancelAppointmentFromConfirmation(appointmentId, {
    source = 'whatsapp_patient',
    actorName = null,
    actor = null,
  } = {}) {
    const appt = loadAppointmentBundle(appointmentId)
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
          appointment_time: String(appt.appointment_time || '').slice(0, 5),
        },
      }
    }
    if (!['non_confirme', 'confirmed'].includes(String(appt.status || ''))) {
      return { ok: false, reason: 'not_cancellable', appointment: appt }
    }

    runInTransaction(db, () => {
      db.prepare(`
        UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status IN ('non_confirme', 'confirmed')
      `).run(Number(appointmentId))
      db.prepare(`
        UPDATE appointment_confirmation_requests
        SET status = 'cancelled', cancelled_at = ?, confirmation_source = ?, updated_at = ?
        WHERE appointment_id = ?
      `).run(nowIso(), source, nowIso(), Number(appointmentId))
      try {
        db.prepare(`
          UPDATE slot_proposals
          SET status = 'cancelled', updated_at = ?
          WHERE appointment_id = ? AND status = 'pending'
        `).run(nowIso(), Number(appointmentId))
      } catch { /* table may not exist yet */ }
    })

    completeOpenConfirmationTasks(appointmentId, 'Rendez-vous annulé')

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
        console.warn('[CONFIRM] slot notification after cancel failed', error.message || error)
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
          actor_type: source === 'whatsapp_patient' ? 'patient' : (source === 'staff_dashboard' ? 'human' : 'system'),
          actor_name: actorName,
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        const auditActor = source === 'whatsapp_patient'
          ? assistantAiActor()
          : (actor || {
            type: 'dashboard_user',
            userId: null,
            displayName: actorName || 'Utilisateur',
            role: null,
          })
        logAiAction({
          customer_id: appt.customer_id,
          action_type: 'appointment_cancelled',
          reason: source === 'whatsapp_patient'
            ? 'Annulation WhatsApp patient'
            : (source === 'staff_dashboard' ? 'Annulation agenda' : 'Annulation'),
          result: String(appointmentId),
          source: source === 'whatsapp_patient' ? 'whatsapp' : 'dashboard',
          actor: auditActor,
          payload: {
            appointment_id: appointmentId,
            origin: source === 'whatsapp_patient' ? 'whatsapp_patient' : 'dashboard',
            actor_user_id: auditActor.userId ?? null,
            actor_display_name: auditActor.displayName,
            actor_role: auditActor.role ?? null,
          },
        })
      } catch { /* optional */ }
    }

    let waitlistMatch = null
    // Policy: never auto-message waitlist after cancel — match for staff UI only
    if (typeof matchWaitlistForSlot === 'function') {
      try {
        waitlistMatch = matchWaitlistForSlot({
          slot_date: appt.appointment_date,
          slot_time: String(appt.appointment_time).slice(0, 5),
          limit: 10,
        })
      } catch { /* optional */ }
    }

    const refreshed = loadAppointmentBundle(appointmentId)
    return {
      ok: true,
      appointment: refreshed,
      waitlistMatch,
      item: {
        appointment_id: refreshed?.id || Number(appointmentId),
        patient_id: refreshed?.customer_id || appt.customer_id,
        full_name: refreshed?.full_name || appt.full_name,
        appointment_date: refreshed?.appointment_date || appt.appointment_date,
        appointment_time: String(refreshed?.appointment_time || appt.appointment_time || '').slice(0, 5),
      },
    }
  }

  /**
   * Handle inbound patient message when a confirmation is pending.
   * Returns null if not applicable.
   */
  async function handleInboundConfirmationReply({
    chatKey = null,
    customerId = null,
    text = '',
    skipIfBookingForm = false,
  } = {}) {
    if (skipIfBookingForm) return null
    const raw = String(text || '').trim()
    if (!raw) return null

    const req = getPendingRequestForChat(chatKey, customerId)
    if (!req) return null

    if (req.ambiguous && Array.isArray(req.pending)) {
      const lang = req.pending[0]?.language || 'fr'
      return {
        handled: true,
        action: 'disambiguate',
        forceReply: disambiguationMessage(req.pending, lang),
        shouldSkipLlm: true,
        pendingCount: req.pending.length,
      }
    }

    const appt = loadAppointmentBundle(req.appointment_id)
    if (!appt || appt.status !== 'non_confirme') return null

    const language = resolveLanguage(appt, req.chat_key || appt.whatsapp_chat_id || appt.conversation_id)
    const parsed = parseYesNoReply(raw, { allowTypoYes: true })

    if (parsed.value === 'yes') {
      const result = confirmAppointment(req.appointment_id, { source: 'whatsapp_patient' })
      return {
        handled: true,
        action: 'confirmed',
        appointmentId: req.appointment_id,
        forceReply: confirmationAckMessage(appt, language),
        shouldSkipLlm: true,
        result,
      }
    }

    if (parsed.value === 'no') {
      const result = cancelAppointmentFromConfirmation(req.appointment_id, {
        source: 'whatsapp_patient',
      })
      return {
        handled: true,
        action: 'cancelled',
        appointmentId: req.appointment_id,
        forceReply: cancellationAckMessage(appt, language),
        shouldSkipLlm: true,
        result,
      }
    }

    // Unknown — stay in confirmation context, never fall through to booking
    return {
      handled: true,
      action: 'clarify',
      forceReply: confirmationClarifyMessage(appt, language),
      shouldSkipLlm: true,
      appointmentId: req.appointment_id,
    }
  }

  /**
   * Periodic scheduler tick.
   */
  async function runConfirmationTick() {
    const summary = {
      initial: 0,
      followup: 0,
      staff_task: 0,
      errors: [],
    }
    const reminders = remindersConfig()

    // Candidates: future non_confirme appointments
    const rows = db.prepare(`
      SELECT a.id, a.appointment_date, a.appointment_time, a.status,
             a.conversation_id AS legacy_conversation_id,
             c.whatsapp_chat_id, c.phone_number, c.preferred_language,
             r.id AS request_id, r.initial_sent_at, r.followup_sent_at, r.staff_task_id, r.status AS req_status
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN appointment_confirmation_requests r ON r.appointment_id = a.id
      WHERE a.status = 'non_confirme'
        AND a.appointment_date >= date('now', 'localtime')
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 80
    `).all()

    for (const row of rows) {
      const until = minutesUntil(row.appointment_date, row.appointment_time)
      if (until == null || until <= 0) continue

      try {
        // Ensure request row exists
        if (!row.request_id) {
          ensureRequestForAppointment(row.id, {
            chat_key: row.whatsapp_chat_id || row.legacy_conversation_id,
            language: row.preferred_language,
          })
        }

        const needsInitial = !row.initial_sent_at
        const confirmWindowMin = reminders.confirmationHoursBefore * 60
        if (needsInitial && reminders.confirmationEnabled && until <= confirmWindowMin) {
          const out = await sendInitialConfirmation(row.id)
          if (out.ok) summary.initial += 1
        }

        const req = getRequestByAppointment(row.id)
        if (!req?.initial_sent_at || req.status !== 'pending' && req.status !== 'staff_task') {
          // still allow staff task path below if pending-like
        }

        if (
          req?.initial_sent_at
          && !req.followup_sent_at
          && (req.status === 'pending' || req.status === 'staff_task')
          && reminders.firstReminderEnabled
        ) {
          const sentAt = new Date(String(req.initial_sent_at).replace(' ', 'T')).getTime()
          const ageMin = Number.isFinite(sentAt) ? (Date.now() - sentAt) / 60000 : 0
          if (ageMin >= reminders.firstReminderHoursAfter * 60 && until >= 30) {
            const out = await sendFollowupConfirmation(row.id)
            if (out.ok) summary.followup += 1
          }
        }

        const req2 = getRequestByAppointment(row.id)
        if (
          req2?.initial_sent_at
          && !req2.staff_task_id
          && reminders.secondReminderEnabled
        ) {
          const sentAt = new Date(String(req2.initial_sent_at).replace(' ', 'T')).getTime()
          const ageMin = Number.isFinite(sentAt) ? (Date.now() - sentAt) / 60000 : 0
          if (ageMin >= reminders.secondReminderHoursAfter * 60 || (until <= 120 && ageMin >= 60)) {
            const out = createStaffConfirmationTask(row.id)
            if (out.ok) summary.staff_task += 1
          }
        }

        if (
          reminders.dayOfReminderEnabled
          && req2?.initial_sent_at
          && req2?.status === 'pending'
          && until <= reminders.dayOfReminderHoursBefore * 60
          && until > 0
          && !req2.followup_sent_at
        ) {
          const out = await sendFollowupConfirmation(row.id)
          if (out.ok) summary.followup += 1
        }
      } catch (error) {
        summary.errors.push({
          appointment_id: row.id,
          error: error.message || String(error),
        })
      }
    }

    return summary
  }

  return {
    ensureTables,
    registerBookingCreated,
    ensureRequestForAppointment,
    sendInitialConfirmation,
    sendFollowupConfirmation,
    createStaffConfirmationTask,
    confirmAppointment,
    cancelAppointmentFromConfirmation,
    handleInboundConfirmationReply,
    runConfirmationTick,
    getPendingRequestForChat,
    getRequestByAppointment,
    confirmationAskMessage,
    confirmationFollowupMessage,
    confirmationAckMessage,
  }
}

module.exports = {
  createAppointmentConfirmationEngine,
  confirmationAskMessage,
  confirmationFollowupMessage,
  confirmationAckMessage,
  cancellationAckMessage,
}
