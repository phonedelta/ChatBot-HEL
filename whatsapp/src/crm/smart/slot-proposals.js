/**
 * Manual slot proposals & appointment moves (staff-driven only).
 * No compatibility matching — any patient with an active RDV can be chosen.
 */

const { isConfirmationYes, isConfirmationNo } = require('../extract')
const { parseYesNoReply } = require('../binary-confirmation')
const { formatPhoneDisplay } = require('../phone')
const { formatDateTimeLocalized, formatLongDateFr, isDarija } = require('../messages')
const { validateAppointmentHours } = require('../working-hours')
const { resolvePatientLanguageFromRow } = require('./resolve-patient-language')
const { assistantAiActor, getAuthenticatedActor } = require('./activity-actors')

function buildSlotProposalMessage(args) {
  return proposalWhatsAppMessage(args)
}

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

function proposalWhatsAppMessage({
  patientName,
  slotDate,
  slotTime,
  currentDate,
  currentTime,
  language = 'fr',
}) {
  const firstName = String(patientName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || 'Patient'
  const proposedLabel = formatDateTimeLocalized(slotDate, slotTime, language)
  const currentLabel = currentDate
    ? formatDateTimeLocalized(currentDate, currentTime, language)
    : null

  if (isDarija(language)) {
    return [
      `السلام عليكم ${firstName}،`,
      '',
      `كاين موعد متاح نهار ${proposedLabel}.`,
      '',
      currentLabel
        ? `واش بغيتي تبدّل الموعد ديالك الحالي ديال ${currentLabel} لهاد الموعد الجديد؟`
        : 'واش بغيتي تحجز هاد الموعد؟',
      '',
      'جاوب بـ نعم باش تقبل الموعد الجديد، أو لا باش تخلي الموعد الحالي ديالك.',
    ].join('\n')
  }

  if (currentLabel) {
    return [
      `Bonjour ${firstName},`,
      '',
      `Un créneau est disponible le ${proposedLabel}.`,
      '',
      `Souhaitez-vous déplacer votre rendez-vous actuel du ${currentLabel} vers ce nouveau créneau ?`,
      '',
      'Répondez OUI pour accepter ou NON pour garder votre rendez-vous actuel.',
    ].join('\n')
  }

  return [
    `Bonjour ${firstName},`,
    '',
    `Un créneau est disponible le ${proposedLabel}.`,
    '',
    'Souhaitez-vous prendre ce créneau ?',
    '',
    'Répondez OUI pour accepter ou NON pour refuser.',
  ].join('\n')
}

function slotTakenMessage(language = 'fr') {
  if (isDarija(language)) {
    return 'للأسف، هاد الموعد ما بقاش متاح. الموعد ديالك الحالي باقي كيف ما هو.'
  }
  return 'Ce créneau n’est malheureusement plus disponible. Votre rendez-vous actuel reste inchangé.'
}

function proposalDeclinedAck(language = 'fr') {
  if (isDarija(language)) {
    return 'تمام. الموعد ديالك الحالي باقي كيف ما هو.'
  }
  return 'D’accord. Votre rendez-vous actuel reste inchangé.'
}

function moveAcceptedAck({ slotDate, slotTime, language = 'fr' }) {
  const label = formatDateTimeLocalized(slotDate, slotTime, language)
  if (isDarija(language)) {
    return `شكراً. موعدك تنقل لـ ${label}.`
  }
  return `Merci. Votre rendez-vous a été déplacé au ${label}.`
}

function slotProposalClarifyMessage(proposal, language = 'fr') {
  const slot = formatDateTimeLocalized(proposal.slot_date, proposal.slot_time, language)
  if (isDarija(language)) {
    return `ما فهمتش مزيان. واش بغيتي تقبل الموعد الجديد ديال ${slot}؟ جاوب بـ نعم أو لا.`
  }
  return `Je n’ai pas bien compris. Souhaitez-vous accepter le nouveau créneau du ${slot} ? Répondez OUI ou NON.`
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createSlotProposalEngine(db, helpers = {}) {
  const {
    addTimelineEvent = null,
    logAiAction = null,
    createNotification = null,
    trackWhatsAppTurn = null,
    getOrCreateConversation = null,
    registerBookingCreated = null,
    notifySlotReleased = null,
    getActiveConversationLanguage = null,
    conversationKeyVariants = null,
    getAppointmentsSettings = null,
  } = helpers

  function proposalExpired(proposal) {
    const validity = Number(getAppointmentsSettings?.()?.proposalValidityMinutes) || 60
    if (validity <= 0) return false
    const raw = String(proposal?.created_at || '').trim()
    if (!raw) return false
    const created = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}:00`).getTime()
    if (!Number.isFinite(created)) return false
    return Date.now() - created > validity * 60000
  }

  function markProposalExpired(proposalId) {
    db.prepare(`
      UPDATE slot_proposals SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'
    `).run(nowIso(), Number(proposalId))
  }

  function getSendWhatsAppText() {
    return typeof helpers.sendWhatsAppText === 'function' ? helpers.sendWhatsAppText : null
  }

  function emitSlotReleased() {
    // Slot-availability notifications are ONLY created on appointment cancellation.
    // Moves / proposal acceptance must never notify the bell.
    return null
  }

  function ensureTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS slot_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        appointment_id INTEGER NOT NULL,
        conversation_id INTEGER,
        chat_key TEXT,
        slot_date TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        practitioner_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        language TEXT DEFAULT 'fr',
        whatsapp_message_id TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_slot_proposals_status
        ON slot_proposals(status, slot_date, slot_time);
      CREATE INDEX IF NOT EXISTS idx_slot_proposals_chat
        ON slot_proposals(chat_key, status);
      CREATE INDEX IF NOT EXISTS idx_slot_proposals_appt
        ON slot_proposals(appointment_id, status);
    `)
  }

  ensureTables()

  function getProposal(id) {
    return db.prepare('SELECT * FROM slot_proposals WHERE id = ?').get(Number(id)) || null
  }

  function listPendingProposalsForChat(chatKey) {
    const key = String(chatKey || '').trim()
    if (!key) return []
    return db.prepare(`
      SELECT p.*, a.appointment_date AS current_date, a.appointment_time AS current_time, c.full_name
      FROM slot_proposals p
      JOIN appointments a ON a.id = p.appointment_id
      JOIN customers c ON c.id = p.customer_id
      WHERE p.status = 'pending'
        AND (p.chat_key = ? OR p.chat_key = ?)
      ORDER BY p.created_at ASC
    `).all(key, key.replace(/^[^:]+:/, ''))
  }

  function getPendingForChat(chatKey) {
    const pending = listPendingProposalsForChat(chatKey)
    if (pending.length === 1) return pending[0]
    if (pending.length > 1) return { ambiguous: true, pending }
    return null
  }

  function proposalDisambiguationMessage(pending, language = 'fr') {
    const lines = pending.map((p, i) => {
      const slot = formatDateTimeLocalized(p.slot_date, p.slot_time, language)
      return `${i + 1}. ${p.full_name} → ${slot}`
    })
    if (isDarija(language)) {
      return [
        'عندك عدة اقتراحات ديال الكرنو:',
        '',
        ...lines,
        '',
        'عافاك حدد شكون (بالرقم أو بالسمية).',
      ].join('\n')
    }
    return [
      'Plusieurs propositions de créneau sont en attente :',
      '',
      ...lines,
      '',
      'Laquelle souhaitez-vous accepter ou refuser ? (numéro ou nom)',
    ].join('\n')
  }

  function getActiveAppointment(customerId) {
    return db.prepare(`
      SELECT a.*, c.full_name, c.phone_number, c.preferred_language, c.whatsapp_chat_id
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.customer_id = ?
        AND a.status IN ('non_confirme', 'confirmed')
        AND a.appointment_date >= date('now', 'localtime')
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 1
    `).get(Number(customerId)) || null
  }

  function loadAppointmentBundle(appointmentId) {
    return db.prepare(`
      SELECT
        a.*,
        c.full_name, c.phone_number, c.preferred_language, c.whatsapp_chat_id, c.city
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ?
    `).get(Number(appointmentId)) || null
  }

  function isSlotFree(slotDate, slotTime, { excludeAppointmentId = null, durationMinutes = 30 } = {}) {
    const date = String(slotDate || '').trim()
    const time = String(slotTime || '').slice(0, 5)
    if (!date || !time) return false

    const hoursCheck = validateAppointmentHours(date, time)
    if (!hoursCheck.ok) return false

    // Past check
    const today = new Date()
    const y = today.getFullYear()
    const mo = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const todayIso = `${y}-${mo}-${dd}`
    if (date < todayIso) return false
    if (date === todayIso) {
      const [hh, mm] = time.split(':').map(Number)
      if ((hh * 60 + mm) <= (today.getHours() * 60 + today.getMinutes())) return false
    }

    const busy = db.prepare(`
      SELECT id, appointment_time, COALESCE(duration_minutes, 30) AS duration_minutes
      FROM appointments
      WHERE appointment_date = ?
        AND status IN ('non_confirme', 'confirmed')
        ${excludeAppointmentId ? 'AND id != ?' : ''}
    `).all(...(excludeAppointmentId ? [date, Number(excludeAppointmentId)] : [date]))

    const startMin = (() => {
      const p = time.match(/^(\d{1,2}):(\d{2})/)
      return p ? Number(p[1]) * 60 + Number(p[2]) : null
    })()
    if (startMin == null) return false
    const endMin = startMin + Math.max(15, Number(durationMinutes) || 30)

    for (const row of busy) {
      const t = String(row.appointment_time || '').slice(0, 5)
      const p = t.match(/^(\d{1,2}):(\d{2})/)
      if (!p) continue
      const otherStart = Number(p[1]) * 60 + Number(p[2])
      const otherEnd = otherStart + Math.max(15, Number(row.duration_minutes) || 30)
      if (startMin < otherEnd && endMin > otherStart) return false
    }
    return true
  }

  function searchPatientsForSlot(query, { limit = 20 } = {}) {
    const q = String(query || '').trim()
    if (q.length < 2) return []
    const lim = Math.max(1, Math.min(40, Number(limit) || 20))

    // Multi-token: "Adam Mait" → each token must match name or phone
    const tokens = q.split(/\s+/).filter((t) => t.length >= 1).slice(0, 6)
    const params = []
    const clauses = tokens.map((token) => {
      const like = `%${token}%`
      params.push(like, like)
      return '(c.full_name LIKE ? COLLATE NOCASE OR c.phone_number LIKE ?)'
    })

    const rows = db.prepare(`
      SELECT
        c.id AS customer_id,
        c.full_name,
        c.phone_number,
        c.preferred_language,
        c.whatsapp_chat_id,
        a.id AS appointment_id,
        a.appointment_date,
        a.appointment_time,
        a.status AS appointment_status,
        a.duration_minutes,
        a.practitioner_id,
        a.appointment_type,
        CASE WHEN w.id IS NOT NULL THEN 1 ELSE 0 END AS on_waitlist
      FROM customers c
      LEFT JOIN appointments a ON a.id = (
        SELECT a2.id FROM appointments a2
        WHERE a2.customer_id = c.id
          AND a2.status IN ('non_confirme', 'confirmed')
          AND a2.appointment_date >= date('now', 'localtime')
        ORDER BY a2.appointment_date ASC, a2.appointment_time ASC
        LIMIT 1
      )
      LEFT JOIN waiting_list_entries w ON w.customer_id = c.id AND w.status = 'active'
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE WHEN a.id IS NOT NULL THEN 0 ELSE 1 END,
        c.full_name ASC
      LIMIT ?
    `).all(...params, lim)

    return rows.map((r) => ({
      customer_id: r.customer_id,
      full_name: r.full_name,
      phone_number: r.phone_number,
      phone_display: formatPhoneDisplay(r.phone_number),
      preferred_language: r.preferred_language || 'fr',
      on_waitlist: Boolean(r.on_waitlist),
      active_appointment: r.appointment_id
        ? {
          id: r.appointment_id,
          appointment_date: r.appointment_date,
          appointment_time: String(r.appointment_time || '').slice(0, 5),
          status: r.appointment_status,
          duration_minutes: Number(r.duration_minutes) || 30,
          practitioner_id: r.practitioner_id || null,
          appointment_type: r.appointment_type || null,
        }
        : null,
    }))
  }

  function resolveLanguageForPatient(appt, chatKey = null, { conversationDbId = null } = {}) {
    return resolvePatientLanguageFromRow(appt, {
      chatKey: chatKey || appt?.whatsapp_chat_id || appt?.conversation_id,
      conversationDbId,
      customerId: appt?.customer_id,
      getActiveConversationLanguage,
      db,
      conversationKeyVariants,
    })
  }

  function expirePendingForAppointment(appointmentId, reason = 'superseded') {
    db.prepare(`
      UPDATE slot_proposals
      SET status = 'cancelled', updated_at = ?
      WHERE appointment_id = ? AND status = 'pending'
    `).run(nowIso(), Number(appointmentId))
    return reason
  }

  function expirePendingForSlot(slotDate, slotTime, exceptId = null) {
    if (exceptId) {
      db.prepare(`
        UPDATE slot_proposals
        SET status = 'expired', updated_at = ?, responded_at = ?
        WHERE slot_date = ? AND substr(slot_time, 1, 5) = ?
          AND status = 'pending' AND id != ?
      `).run(nowIso(), nowIso(), slotDate, String(slotTime).slice(0, 5), Number(exceptId))
    } else {
      db.prepare(`
        UPDATE slot_proposals
        SET status = 'expired', updated_at = ?, responded_at = ?
        WHERE slot_date = ? AND substr(slot_time, 1, 5) = ?
          AND status = 'pending'
      `).run(nowIso(), nowIso(), slotDate, String(slotTime).slice(0, 5))
    }
  }

  /**
   * Staff sends a WhatsApp proposal — does NOT move the appointment yet.
   */
  async function createAndSendProposal({
    customerId,
    appointmentId,
    slotDate,
    slotTime,
    durationMinutes = null,
    practitionerId = null,
    createdBy = null,
    actor = null,
    chatKey = null,
  } = {}) {
    const appt = loadAppointmentBundle(appointmentId)
    if (!appt || Number(appt.customer_id) !== Number(customerId)) {
      const err = new Error('Rendez-vous introuvable pour ce patient')
      err.code = 'NOT_FOUND'
      throw err
    }
    if (!['non_confirme', 'confirmed'].includes(appt.status)) {
      const err = new Error('Ce rendez-vous n’est pas actif')
      err.code = 'INACTIVE'
      throw err
    }

    const date = String(slotDate || '').trim()
    const time = String(slotTime || '').slice(0, 5)
    const duration = Number(durationMinutes) || Number(appt.duration_minutes) || 30

    if (!isSlotFree(date, time, { excludeAppointmentId: appointmentId, durationMinutes: duration })) {
      const err = new Error('Ce créneau n’est plus disponible')
      err.code = 'SLOT_TAKEN'
      throw err
    }

    // One pending proposal per appointment
    expirePendingForAppointment(appointmentId)

    let resolvedChat = chatKey || appt.whatsapp_chat_id || appt.conversation_id || null
    let conversationId = null
    if (resolvedChat) {
      const variants = typeof conversationKeyVariants === 'function'
        ? conversationKeyVariants(resolvedChat)
        : [resolvedChat, String(resolvedChat).replace(/^[^:]+:/, '')]
      for (const variant of variants) {
        const existing = db.prepare('SELECT id FROM conversations WHERE external_key = ?').get(variant)
        if (existing?.id) {
          conversationId = existing.id
          break
        }
      }
    }

    const langResult = resolveLanguageForPatient(appt, resolvedChat, { conversationDbId: conversationId })
    const language = langResult.language

    if (typeof getOrCreateConversation === 'function' && resolvedChat) {
      try {
        const conv = getOrCreateConversation({
          external_key: resolvedChat,
          customer_id: customerId,
          phone_number: appt.phone_number,
        })
        conversationId = conv?.id || conversationId
        resolvedChat = conv?.external_key || resolvedChat
      } catch { /* optional */ }
    }

    if (process.env.CRM_DEBUG_LANGUAGE === '1' || process.env.NODE_ENV !== 'production') {
      console.log('[SLOT_PROPOSAL]', {
        patientId: customerId,
        appointmentId,
        conversationId,
        chatKey: resolvedChat,
        resolvedLanguage: language,
        languageSource: langResult.source,
        languageFallback: Boolean(langResult.languageFallback),
        patient: appt.full_name,
      })
    }
    const text = buildSlotProposalMessage({
      patientName: appt.full_name,
      slotDate: date,
      slotTime: time,
      currentDate: appt.appointment_date,
      currentTime: appt.appointment_time,
      language,
    })

    if (typeof getSendWhatsAppText() !== 'function') {
      const err = new Error('Envoi WhatsApp indisponible')
      err.code = 'WA_UNAVAILABLE'
      throw err
    }

    if (process.env.CRM_DEBUG_LANGUAGE === '1' || process.env.NODE_ENV !== 'production') {
      console.log('[SLOT_PROPOSAL_SEND]', {
        language,
        languageSource: langResult.source,
        recipient: resolvedChat,
        messageTemplate: isDarija(language) ? 'slot_proposal_darija' : 'slot_proposal_fr',
        patientId: customerId,
      })
    }

    const sent = await getSendWhatsAppText()({
      chatId: resolvedChat,
      phone: appt.phone_number,
      text,
    })

    const insert = db.prepare(`
      INSERT INTO slot_proposals (
        customer_id, appointment_id, conversation_id, chat_key,
        slot_date, slot_time, duration_minutes, practitioner_id,
        status, language, whatsapp_message_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      Number(customerId),
      Number(appointmentId),
      conversationId,
      resolvedChat,
      date,
      time,
      duration,
      practitionerId || appt.practitioner_id || null,
      language,
      sent?.messageId || null,
      createdBy || null,
      nowIso(),
      nowIso(),
    )

    const proposal = getProposal(insert.lastInsertRowid)

    if (typeof trackWhatsAppTurn === 'function' && resolvedChat) {
      try {
        trackWhatsAppTurn({
          chatId: resolvedChat,
          customerId,
          outboundText: text,
          outboundAuthor: 'human',
          outboundMessageId: sent?.messageId || null,
          phoneNumber: appt.phone_number,
        })
      } catch { /* optional */ }
    }

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: customerId,
          appointment_id: appointmentId,
          conversation_id: conversationId,
          event_type: 'SLOT_PROPOSAL_SENT',
          title: 'Proposition de créneau envoyée',
          detail: createdBy
            ? `Proposition manuelle par ${createdBy} — ${date} ${time}`
            : `Proposition manuelle — ${date} ${time}`,
          actor_type: 'human',
          actor_name: createdBy,
        })
      } catch { /* optional */ }
    }

    const actorObj = actor || (createdBy ? { type: 'dashboard_user', displayName: createdBy, role: null } : null)
    const actorLabel = actorObj?.displayName || createdBy

    if (logAiAction) {
      try {
        logAiAction({
          conversation_id: conversationId,
          customer_id: customerId,
          action_type: 'slot_proposal_sent',
          reason: `Proposition créneau ${date} ${time}`,
          result: String(proposal.id),
          source: 'dashboard',
          actor: actorObj,
          origin: 'dashboard',
          payload: {
            proposal_id: proposal.id,
            slot_date: date,
            slot_time: time,
            created_by: actorLabel,
            manual: true,
            actor_user_id: actorObj?.userId || null,
            actor_display_name: actorLabel,
            actor_role: actorObj?.role || null,
          },
        })
      } catch { /* optional */ }
    }

    // Never create a dashboard bell notification for slot proposals (audit only via logAiAction)

    return { proposal, message: text, messageId: sent?.messageId || null }
  }

  /**
   * Direct staff move — no WhatsApp proposal required.
   */
  function moveAppointmentDirect({
    appointmentId,
    slotDate,
    slotTime,
    practitionerId = undefined,
    actorName = null,
    actor = null,
    notifyPatient = false,
  } = {}) {
    const appt = loadAppointmentBundle(appointmentId)
    if (!appt) {
      const err = new Error('Rendez-vous introuvable')
      err.code = 'NOT_FOUND'
      throw err
    }
    if (!['non_confirme', 'confirmed'].includes(appt.status)) {
      const err = new Error('Ce rendez-vous n’est pas actif')
      err.code = 'INACTIVE'
      throw err
    }

    const date = String(slotDate || '').trim()
    const time = String(slotTime || '').slice(0, 5)
    const duration = Number(appt.duration_minutes) || 30

    if (!isSlotFree(date, time, { excludeAppointmentId: appointmentId, durationMinutes: duration })) {
      const err = new Error('Ce créneau n’est plus disponible')
      err.code = 'SLOT_TAKEN'
      throw err
    }

    const hoursCheck = validateAppointmentHours(date, time)
    if (!hoursCheck.ok) {
      const err = new Error(hoursCheck.message || 'Horaire hors plage cabinet')
      err.code = 'OUTSIDE_HOURS'
      throw err
    }

    const actorObj = actor || (actorName ? { type: 'human', displayName: actorName, role: null } : null)
    const actorLabel = actorObj?.displayName || actorName

    const oldDate = appt.appointment_date
    const oldTime = String(appt.appointment_time).slice(0, 5)
    const wasConfirmed = appt.status === 'confirmed'
    const nextPractitioner = practitionerId !== undefined
      ? (practitionerId || null)
      : (appt.practitioner_id || null)

    runInTransaction(db, () => {
      // Re-check inside transaction
      if (!isSlotFree(date, time, { excludeAppointmentId: appointmentId, durationMinutes: duration })) {
        const err = new Error('Ce créneau n’est plus disponible')
        err.code = 'SLOT_TAKEN'
        throw err
      }

      db.prepare(`
        UPDATE appointments
        SET appointment_date = ?,
            appointment_time = ?,
            practitioner_id = ?,
            status = 'non_confirme',
            confirmed_at = NULL,
            confirmation_source = NULL
        WHERE id = ?
      `).run(date, time, nextPractitioner, Number(appointmentId))

      // Reset confirmation request so 24h WhatsApp can re-run for new slot
      try {
        db.prepare(`
          UPDATE appointment_confirmation_requests
          SET status = 'pending',
              initial_sent_at = NULL,
              followup_sent_at = NULL,
              staff_task_id = NULL,
              confirmed_at = NULL,
              cancelled_at = NULL,
              confirmation_source = NULL,
              updated_at = ?
          WHERE appointment_id = ?
        `).run(nowIso(), Number(appointmentId))
      } catch { /* optional */ }

      expirePendingForAppointment(appointmentId)
      expirePendingForSlot(date, time)
    })

    if (typeof registerBookingCreated === 'function') {
      try {
        registerBookingCreated(appointmentId, {
          chatKey: appt.whatsapp_chat_id || appt.conversation_id,
          language: resolveLanguageForPatient(appt, appt.whatsapp_chat_id || appt.conversation_id).language,
        })
      } catch { /* optional */ }
    }

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: appt.customer_id,
          appointment_id: appointmentId,
          event_type: 'APPOINTMENT_MOVED_MANUALLY',
          title: 'Rendez-vous déplacé',
          detail: actorLabel
            ? `Déplacé manuellement par ${actorLabel} : ${oldDate} ${oldTime} → ${date} ${time}`
            : `Déplacé : ${oldDate} ${oldTime} → ${date} ${time}`,
          actor_type: 'human',
          actor_name: actorLabel,
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        logAiAction({
          customer_id: appt.customer_id,
          action_type: 'appointment_moved_manually',
          reason: `Déplacement ${oldDate} ${oldTime} → ${date} ${time}`,
          result: String(appointmentId),
          source: 'dashboard',
          actor_type: 'human',
          actor: actorObj,
          payload: {
            from: { date: oldDate, time: oldTime },
            to: { date, time },
            was_confirmed: wasConfirmed,
            actor_user_id: actorObj?.userId ?? null,
            actor_display_name: actorObj?.displayName ?? actorLabel,
            actor_role: actorObj?.role ?? null,
          },
        })
      } catch { /* optional */ }
    }

    const updated = loadAppointmentBundle(appointmentId)
    emitSlotReleased(oldDate, oldTime, appointmentId, 'appointment_moved')
    return {
      appointment: updated,
      previous: { date: oldDate, time: oldTime },
      released_slot: { slot_date: oldDate, slot_time: oldTime, kind: 'released' },
      notifyPatient,
    }
  }

  function resolveLanguageForProposal(proposal) {
    if (!proposal) return 'fr'
    const appt = loadAppointmentBundle(proposal.appointment_id)
    const chatKey = proposal.chat_key || appt?.whatsapp_chat_id || appt?.conversation_id
    const resolved = resolveLanguageForPatient(appt, chatKey, {
      conversationDbId: proposal.conversation_id,
    })
    return resolved.language || proposal.language || 'fr'
  }

  /**
   * Apply acceptance of a pending proposal (patient OUI).
   */
  function acceptProposal(proposalId, { source = 'whatsapp_patient' } = {}) {
    const proposal = getProposal(proposalId)
    if (!proposal) return { ok: false, reason: 'not_found' }
    if (proposal.status !== 'pending') {
      return { ok: false, reason: 'not_pending', status: proposal.status }
    }

    const duration = Number(proposal.duration_minutes) || 30
    const language = resolveLanguageForProposal(proposal)
    let releasedOld = null

    try {
      runInTransaction(db, () => {
        const fresh = getProposal(proposalId)
        if (!fresh || fresh.status !== 'pending') {
          const err = new Error('Proposition déjà traitée')
          err.code = 'NOT_PENDING'
          throw err
        }

        if (!isSlotFree(fresh.slot_date, fresh.slot_time, {
          excludeAppointmentId: fresh.appointment_id,
          durationMinutes: duration,
        })) {
          db.prepare(`
            UPDATE slot_proposals SET status = 'expired', responded_at = ?, updated_at = ? WHERE id = ?
          `).run(nowIso(), nowIso(), Number(proposalId))
          const err = new Error('Ce créneau n’est plus disponible')
          err.code = 'SLOT_TAKEN'
          throw err
        }

        const appt = loadAppointmentBundle(fresh.appointment_id)
        if (!appt || !['non_confirme', 'confirmed'].includes(appt.status)) {
          db.prepare(`
            UPDATE slot_proposals SET status = 'cancelled', updated_at = ? WHERE id = ?
          `).run(nowIso(), Number(proposalId))
          const err = new Error('Rendez-vous inactif')
          err.code = 'INACTIVE'
          throw err
        }

        const oldDate = appt.appointment_date
        const oldTime = String(appt.appointment_time).slice(0, 5)
        releasedOld = { date: oldDate, time: oldTime, appointmentId: fresh.appointment_id }
        const confirmedAt = nowIso()

        db.prepare(`
          UPDATE appointments
          SET appointment_date = ?,
              appointment_time = ?,
              practitioner_id = COALESCE(?, practitioner_id),
              status = 'confirmed',
              confirmed_at = ?,
              confirmation_source = 'slot_proposal_accept'
          WHERE id = ?
        `).run(
          fresh.slot_date,
          String(fresh.slot_time).slice(0, 5),
          fresh.practitioner_id || null,
          confirmedAt,
          fresh.appointment_id,
        )

        try {
          const acr = db.prepare(`
            SELECT id FROM appointment_confirmation_requests WHERE appointment_id = ?
          `).get(fresh.appointment_id)
          if (acr) {
            db.prepare(`
              UPDATE appointment_confirmation_requests
              SET status = 'confirmed',
                  confirmed_at = ?,
                  confirmation_source = 'slot_proposal_accept',
                  chat_key = COALESCE(?, chat_key),
                  updated_at = ?
              WHERE appointment_id = ?
            `).run(
              confirmedAt,
              fresh.chat_key || null,
              confirmedAt,
              fresh.appointment_id,
            )
          } else {
            db.prepare(`
              INSERT INTO appointment_confirmation_requests (
                appointment_id, customer_id, conversation_id, chat_key, language,
                status, confirmed_at, confirmation_source, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, 'slot_proposal_accept', ?, ?)
            `).run(
              fresh.appointment_id,
              fresh.customer_id,
              fresh.conversation_id,
              fresh.chat_key,
              fresh.language || 'fr',
              confirmedAt,
              confirmedAt,
              confirmedAt,
            )
          }
        } catch { /* optional */ }

        db.prepare(`
          UPDATE slot_proposals
          SET status = 'accepted', responded_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nowIso(), nowIso(), Number(proposalId))

        expirePendingForSlot(fresh.slot_date, fresh.slot_time, proposalId)
        expirePendingForAppointment(fresh.appointment_id)

        // Store old slot on proposal row via timeline only
        fresh._old = { date: oldDate, time: oldTime }
      })
    } catch (error) {
      if (error.code === 'SLOT_TAKEN') {
        return {
          ok: false,
          reason: 'slot_taken',
          forceReply: slotTakenMessage(language),
          shouldSkipLlm: true,
        }
      }
      throw error
    }

    if (releasedOld) {
      emitSlotReleased(releasedOld.date, releasedOld.time, releasedOld.appointmentId, 'appointment_moved')
    }

    const accepted = getProposal(proposalId)
    const appt = loadAppointmentBundle(accepted.appointment_id)

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: accepted.customer_id,
          appointment_id: accepted.appointment_id,
          event_type: 'SLOT_PROPOSAL_ACCEPTED',
          title: 'Créneau accepté',
          detail: `Patient a accepté ${accepted.slot_date} ${String(accepted.slot_time).slice(0, 5)}`,
          actor_type: 'patient',
        })
        addTimelineEvent({
          customer_id: accepted.customer_id,
          appointment_id: accepted.appointment_id,
          event_type: 'APPOINTMENT_MOVED_MANUALLY',
          title: 'Rendez-vous déplacé',
          detail: 'Déplacé automatiquement après acceptation du patient',
          actor_type: 'system',
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        logAiAction({
          customer_id: accepted.customer_id,
          action_type: 'slot_proposal_accepted',
          reason: `Acceptation proposition #${proposalId}`,
          result: String(accepted.appointment_id),
          source: 'whatsapp',
          actor: assistantAiActor(),
          payload: { origin: 'whatsapp_patient', proposal_id: proposalId },
        })
      } catch { /* optional */ }
    }

    return {
      ok: true,
      proposal: accepted,
      appointment: appt,
      forceReply: moveAcceptedAck({
        slotDate: accepted.slot_date,
        slotTime: accepted.slot_time,
        language,
      }),
      shouldSkipLlm: true,
      handled: true,
      action: 'accepted',
    }
  }

  function declineProposal(proposalId) {
    const proposal = getProposal(proposalId)
    if (!proposal || proposal.status !== 'pending') {
      return { ok: false, reason: 'not_pending' }
    }
    db.prepare(`
      UPDATE slot_proposals
      SET status = 'declined', responded_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(nowIso(), nowIso(), Number(proposalId))

    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: proposal.customer_id,
          appointment_id: proposal.appointment_id,
          event_type: 'SLOT_PROPOSAL_DECLINED',
          title: 'Proposition refusée',
          detail: 'Le patient a conservé son rendez-vous actuel',
          actor_type: 'patient',
        })
      } catch { /* optional */ }
    }

    if (logAiAction) {
      try {
        logAiAction({
          customer_id: proposal.customer_id,
          action_type: 'slot_proposal_declined',
          reason: `Refus proposition #${proposalId}`,
          result: String(proposal.appointment_id),
          source: 'whatsapp',
          actor: assistantAiActor(),
          payload: { origin: 'whatsapp_patient', proposal_id: proposalId },
        })
      } catch { /* optional */ }
    }

    return {
      ok: true,
      handled: true,
      action: 'declined',
      forceReply: proposalDeclinedAck(resolveLanguageForProposal(proposal)),
      shouldSkipLlm: true,
      proposalId,
    }
  }

  function cancelProposal(proposalId, { actorName = null, actor = null } = {}) {
    const actorObj = actor || (actorName ? { type: 'human', displayName: actorName, role: null } : null)
    const actorLabel = actorObj?.displayName || actorName
    const proposal = getProposal(proposalId)
    if (!proposal) return { ok: false, reason: 'not_found' }
    if (proposal.status !== 'pending') return { ok: true, already: true }
    db.prepare(`
      UPDATE slot_proposals SET status = 'cancelled', updated_at = ? WHERE id = ?
    `).run(nowIso(), Number(proposalId))
    if (addTimelineEvent) {
      try {
        addTimelineEvent({
          customer_id: proposal.customer_id,
          appointment_id: proposal.appointment_id,
          event_type: 'SLOT_PROPOSAL_EXPIRED',
          title: 'Proposition annulée',
          detail: actorLabel ? `Annulée par ${actorLabel}` : 'Annulée',
          actor_type: 'human',
          actor_name: actorLabel,
        })
      } catch { /* optional */ }
    }
    return { ok: true, proposal: getProposal(proposalId) }
  }

  async function handleInboundProposalReply({ chatKey = null, text = '' } = {}) {
    const raw = String(text || '').trim()
    if (!raw) return null

    const pending = getPendingForChat(chatKey)

    if (!pending) {
      const yes = isConfirmationYes(raw)
      if (yes) {
        const recent = db.prepare(`
          SELECT * FROM slot_proposals
          WHERE status IN ('expired')
            AND (chat_key = ? OR chat_key = ?)
          ORDER BY updated_at DESC LIMIT 1
        `).get(String(chatKey || ''), String(chatKey || '').replace(/^[^:]+:/, ''))
        if (recent) {
          return {
            handled: true,
            action: 'expired',
            forceReply: slotTakenMessage(resolveLanguageForProposal(recent)),
            shouldSkipLlm: true,
            appointmentId: recent.appointment_id,
          }
        }
      }
      return null
    }

    if (pending.ambiguous && Array.isArray(pending.pending)) {
      return {
        handled: true,
        action: 'disambiguate',
        forceReply: proposalDisambiguationMessage(
          pending.pending,
          resolveLanguageForProposal(pending.pending[0]),
        ),
        shouldSkipLlm: true,
        pendingCount: pending.pending.length,
      }
    }

    const proposal = pending
    const language = resolveLanguageForProposal(proposal)

    if (proposalExpired(proposal)) {
      markProposalExpired(proposal.id)
      const expiredMsg = isDarija(language)
        ? 'هاد العرض ديال الموعد ما بقاش متاح. نقدر نشوف ليك المواعيد المتاحة دابا إلا بغيتي.'
        : 'Cette proposition n’est plus disponible. Je peux vérifier les créneaux actuels si vous le souhaitez.'
      return {
        handled: true,
        action: 'expired',
        forceReply: expiredMsg,
        shouldSkipLlm: true,
        appointmentId: proposal.appointment_id,
      }
    }

    const parsed = parseYesNoReply(raw, { allowTypoYes: true })

    if (process.env.CRM_DEBUG_CONTEXT === '1' || process.env.NODE_ENV !== 'production') {
      console.log('[SLOT_PROPOSAL_REPLY]', {
        chatKey,
        text: raw,
        parsed: parsed.value,
        reason: parsed.reason,
        proposalId: proposal.id,
      })
    }

    if (parsed.value === 'yes') {
      const result = acceptProposal(proposal.id)
      return {
        handled: Boolean(result.ok || result.forceReply),
        ...result,
        appointmentId: proposal.appointment_id,
      }
    }

    if (parsed.value === 'no') {
      return declineProposal(proposal.id)
    }

    // Unknown — stay in slot proposal context, NEVER fall through to booking
    return {
      handled: true,
      action: 'clarify',
      forceReply: slotProposalClarifyMessage(proposal, language),
      shouldSkipLlm: true,
      appointmentId: proposal.appointment_id,
      proposalId: proposal.id,
    }
  }

  return {
    ensureTables,
    searchPatientsForSlot,
    isSlotFree,
    createAndSendProposal,
    moveAppointmentDirect,
    acceptProposal,
    declineProposal,
    cancelProposal,
    handleInboundProposalReply,
    getPendingForChat,
    getProposal,
    getActiveAppointment,
    proposalWhatsAppMessage,
    buildSlotProposalMessage,
    formatLongDateFr,
  }
}

module.exports = {
  createSlotProposalEngine,
  proposalWhatsAppMessage,
  buildSlotProposalMessage,
  formatLongDateFr,
}
