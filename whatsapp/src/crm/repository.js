/**
 * CRM repository — customers, appointments, dental_cases, logs, leads.
 */

const { toE164, formatPhoneDisplay, isValidPhone } = require('./phone')
const { validateFullName } = require('./name-validator')
const {
  validateAppointmentHours,
  outsideWorkingHoursError,
} = require('./working-hours')
const {
  resolvePatientForBooking,
  listPatientsReachableByPhone,
  listPatientsForContact,
  findContactByWhatsAppOrPhone,
  normalizePersonName,
  channelPhoneFromChat,
} = require('./contact-patients')

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createCrmRepository(db) {
  function nowIso() {
    return new Date().toISOString()
  }

  function getLead(conversationId) {
    return db.prepare('SELECT * FROM crm_leads WHERE conversation_id = ?').get(conversationId) || null
  }

  function upsertLead(conversationId, patch = {}) {
    const existing = getLead(conversationId)
    // undefined = keep existing; null = explicit clear
    const pick = (key, fallback = null) => (
      Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : (existing?.[key] ?? fallback)
    )
    const merged = {
      conversation_id: conversationId,
      whatsapp_chat_id: pick('whatsapp_chat_id', null),
      phone_number: pick('phone_number', null),
      full_name: (() => {
        const raw = pick('full_name', null)
        if (raw == null || raw === '') return raw
        const safe = validateFullName(raw)
        if (safe) return safe
        // Never persist conversational phrases as lead identity
        const existingSafe = existing?.full_name ? validateFullName(existing.full_name) : null
        return existingSafe || null
      })(),
      city: pick('city', null),
      problem: pick('problem', null),
      problem_details: pick('problem_details', null),
      urgency: pick('urgency', 'moyenne') || 'moyenne',
      appointment_date: pick('appointment_date', null),
      appointment_time: pick('appointment_time', null),
      stage: pick('stage', 'discovery') || 'discovery',
      awaiting_field: pick('awaiting_field', null),
      language: pick('language', 'fr') || 'fr',
      booking_intent: patch.booking_intent !== undefined
        ? (patch.booking_intent ? 1 : 0)
        : (existing?.booking_intent || 0),
      selected_patient_id: pick('selected_patient_id', null) == null
        ? null
        : Number(pick('selected_patient_id', null)),
      booking_target: pick('booking_target', null),
      pending_duplicate_patient_id: pick('pending_duplicate_patient_id', null) == null
        ? null
        : Number(pick('pending_duplicate_patient_id', null)),
      allow_duplicate_name: patch.allow_duplicate_name !== undefined
        ? (patch.allow_duplicate_name ? 1 : 0)
        : (existing?.allow_duplicate_name || 0),
      correction_json: (() => {
        if (!Object.prototype.hasOwnProperty.call(patch, 'correction_json')) {
          return existing?.correction_json ?? null
        }
        if (patch.correction_json == null || patch.correction_json === '') return null
        return typeof patch.correction_json === 'string'
          ? patch.correction_json
          : JSON.stringify(patch.correction_json)
      })(),
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    }

    db.prepare(`
      INSERT INTO crm_leads (
        conversation_id, whatsapp_chat_id, phone_number, full_name, city,
        problem, problem_details, urgency, appointment_date, appointment_time,
        stage, awaiting_field, language, booking_intent,
        selected_patient_id, booking_target, pending_duplicate_patient_id, allow_duplicate_name,
        correction_json,
        created_at, updated_at
      ) VALUES (
        @conversation_id, @whatsapp_chat_id, @phone_number, @full_name, @city,
        @problem, @problem_details, @urgency, @appointment_date, @appointment_time,
        @stage, @awaiting_field, @language, @booking_intent,
        @selected_patient_id, @booking_target, @pending_duplicate_patient_id, @allow_duplicate_name,
        @correction_json,
        @created_at, @updated_at
      )
      ON CONFLICT(conversation_id) DO UPDATE SET
        whatsapp_chat_id = excluded.whatsapp_chat_id,
        phone_number = excluded.phone_number,
        full_name = excluded.full_name,
        city = excluded.city,
        problem = excluded.problem,
        problem_details = excluded.problem_details,
        urgency = excluded.urgency,
        appointment_date = excluded.appointment_date,
        appointment_time = excluded.appointment_time,
        stage = excluded.stage,
        awaiting_field = excluded.awaiting_field,
        language = excluded.language,
        booking_intent = excluded.booking_intent,
        selected_patient_id = excluded.selected_patient_id,
        booking_target = excluded.booking_target,
        pending_duplicate_patient_id = excluded.pending_duplicate_patient_id,
        allow_duplicate_name = excluded.allow_duplicate_name,
        correction_json = excluded.correction_json,
        updated_at = excluded.updated_at
    `).run(merged)

    return getLead(conversationId)
  }

  function clearLead(conversationId) {
    db.prepare('DELETE FROM crm_leads WHERE conversation_id = ?').run(conversationId)
  }

  /** @deprecated Phone is not a unique patient key — prefer listPatientsReachableByPhone */
  function findCustomerByPhone(phoneNumber) {
    const rows = listPatientsReachableByPhone(db, phoneNumber)
    return rows[0] || null
  }

  function findCustomersByPhone(phoneNumber) {
    return listPatientsReachableByPhone(db, phoneNumber)
  }

  /**
   * Resolve patient for booking: contact + full name (never overwrite by phone alone).
   */
  function createOrUpdateCustomer({
    full_name,
    phone_number,
    city,
    whatsapp_chat_id,
    contact_id = null,
    created_via = 'whatsapp_booking',
  }) {
    const resolved = resolvePatientForBooking(db, {
      contactId: contact_id,
      fullName: full_name,
      phoneNumber: phone_number,
      city,
      whatsappChatId: whatsapp_chat_id,
      createdVia: created_via,
    })
    return resolved.patient
  }

  function getCustomerById(patientId) {
    if (!patientId) return null
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(patientId)) || null
  }

  function isWhatsAppLid(value) {
    return /@lid/i.test(String(value || ''))
  }

  function findContactForChat(chatId, conversationId = null) {
    const keys = [...new Set([
      ...conversationKeyVariants(chatId),
      ...conversationKeyVariants(conversationId),
    ])].filter(Boolean)

    try {
      if (keys.length) {
        const placeholders = keys.map(() => '?').join(',')
        const conv = db.prepare(`
          SELECT whatsapp_contact_id, phone_e164, external_key
          FROM conversations
          WHERE external_key IN (${placeholders})
          LIMIT 1
        `).get(...keys)
        if (conv?.whatsapp_contact_id) {
          const byId = db.prepare('SELECT * FROM whatsapp_contacts WHERE id = ?')
            .get(Number(conv.whatsapp_contact_id))
          if (byId) return byId
        }
      }
    } catch { /* conversations table may be missing in isolated tests */ }

    for (const key of keys) {
      const bare = String(key).replace(/^[^:]+:/, '')
      const byWa = db.prepare(`
        SELECT * FROM whatsapp_contacts
        WHERE whatsapp_id = ? OR whatsapp_id = ?
        ORDER BY id ASC LIMIT 1
      `).get(key, bare)
      if (byWa) return byWa
    }

    let phone = null
    try {
      if (keys.length) {
        const placeholders = keys.map(() => '?').join(',')
        const conv = db.prepare(`
          SELECT phone_e164 FROM conversations
          WHERE external_key IN (${placeholders})
          LIMIT 1
        `).get(...keys)
        if (conv?.phone_e164 && !isWhatsAppLid(conv.phone_e164) && isValidPhone(conv.phone_e164)) {
          phone = toE164(conv.phone_e164)
        }
      }
    } catch { /* ignore */ }

    if (!phone && chatId && !isWhatsAppLid(chatId)) {
      phone = channelPhoneFromChat(chatId)
    }
    if (phone) {
      return findContactByWhatsAppOrPhone(db, { phone })
    }
    return null
  }

  function listAppointmentsForPatient(patientId) {
    if (!patientId) return []
    return db.prepare(`
      SELECT id, customer_id, appointment_date, appointment_time, status
      FROM appointments
      WHERE customer_id = ?
      ORDER BY appointment_date DESC, appointment_time DESC, id DESC
    `).all(Number(patientId))
  }

  function listLinkedPatientsForChat({ chatId = null, conversationId = null } = {}) {
    const contact = findContactForChat(chatId, conversationId)
    if (!contact) return []
    const patients = listPatientsForContact(db, contact.id)
    return patients
      .slice()
      .sort((a, b) => {
        const linked = String(a.linked_at || '').localeCompare(String(b.linked_at || ''))
        if (linked) return linked
        return Number(a.id) - Number(b.id)
      })
      .map((patient) => ({
        ...patient,
        appointments: listAppointmentsForPatient(patient.id),
      }))
  }

  /**
   * Persist confirmed booking. Never call without explicit patient confirmation.
   */
  function saveConfirmedBooking(lead) {
    if (!lead?.full_name || !lead?.phone_number || !lead?.appointment_date || !lead?.appointment_time) {
      throw new Error('Incomplete lead — cannot save booking')
    }

    const bookingTarget = String(lead.booking_target || '').trim()
    const selectedId = lead.selected_patient_id ? Number(lead.selected_patient_id) : null
    const forceNew = Boolean(Number(lead.allow_duplicate_name)) && bookingTarget === 'new_patient'
    const existingSelected = bookingTarget === 'existing_patient' && selectedId
      ? selectedId
      : null

    const resolved = resolvePatientForBooking(db, {
      patientId: existingSelected,
      forceNew,
      requireCollectedPhone: bookingTarget === 'new_patient' || forceNew,
      fullName: lead.full_name,
      phoneNumber: lead.phone_number,
      city: lead.city,
      whatsappChatId: lead.whatsapp_chat_id,
      createdVia: 'whatsapp_booking',
    })
    const customer = resolved.patient
    const contactId = resolved.contact?.id || null

    const appointmentInsert = db.prepare(`
      INSERT INTO appointments (
        customer_id, appointment_date, appointment_time, status, conversation_id,
        whatsapp_contact_id, created_at
      ) VALUES (?, ?, ?, 'non_confirme', ?, ?, ?)
    `).run(
      customer.id,
      lead.appointment_date,
      lead.appointment_time,
      lead.conversation_id || null,
      contactId,
      nowIso(),
    )

    const appointmentId = Number(appointmentInsert.lastInsertRowid)
    const caseInsert = db.prepare(`
      INSERT INTO dental_cases (
        customer_id, appointment_id, problem, description, urgency, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customer.id,
      appointmentId,
      lead.problem || lead.problem_details || 'consultation générale',
      lead.problem_details || lead.problem || null,
      lead.urgency || 'moyenne',
      nowIso(),
    )

    const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId)
    const dentalCase = db.prepare('SELECT * FROM dental_cases WHERE id = ?').get(caseInsert.lastInsertRowid)

    // Bind conversation to contact + active patient context (not exclusive ownership)
    if (lead.conversation_id || lead.whatsapp_chat_id) {
      try {
        const chatKey = lead.whatsapp_chat_id || lead.conversation_id
        db.prepare(`
          UPDATE conversations
          SET whatsapp_contact_id = COALESCE(?, whatsapp_contact_id),
              customer_id = ?,
              phone_e164 = COALESCE(phone_e164, ?)
          WHERE external_key = ? OR external_key = ?
        `).run(
          contactId,
          customer.id,
          toE164(lead.phone_number) || lead.phone_number,
          chatKey,
          String(chatKey || '').replace(/^[^:]+:/, ''),
        )
      } catch { /* optional if conversations table absent mid-test */ }
    }

    const notificationBody = [
      'Nouveau rendez-vous :',
      '',
      `Patient : ${customer.full_name}`,
      `Contact WhatsApp : ${formatPhoneDisplay(lead.phone_number || customer.phone_number)}`,
      `Ville : ${customer.city || '—'}`,
      `Problème (IA) : ${dentalCase.problem}`,
      `Message client : ${dentalCase.description || '—'}`,
      `Date : ${appointment.appointment_date}`,
      `Heure : ${appointment.appointment_time}`,
      `Statut : À confirmer (confirmation WhatsApp 24 h avant)`,
    ].join('\n')

    const notif = db.prepare(`
      INSERT INTO staff_notifications (appointment_id, title, body, payload_json, sent_whatsapp, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      appointmentId,
      'Nouveau rendez-vous',
      notificationBody,
      JSON.stringify({
        customer_id: customer.id,
        whatsapp_contact_id: contactId,
        appointment_id: appointmentId,
        dental_case_id: dentalCase.id,
      }),
      nowIso(),
    )

    return {
      customer,
      contact: resolved.contact,
      appointment,
      dentalCase,
      staffNotification: db.prepare('SELECT * FROM staff_notifications WHERE id = ?').get(notif.lastInsertRowid),
    }
  }

  /**
   * Create an appointment from the admin dashboard (manual entry).
   */
  function createManualAppointment(payload = {}) {
    const fullName = validateFullName(String(payload.full_name || '').trim())
    const phone = toE164(payload.phone_number)
    const city = String(payload.city || '').trim() || null
    const date = String(payload.appointment_date || '').trim()
    const time = String(payload.appointment_time || '').trim()
    const problemAi = String(payload.problem || '').trim() || 'consultation générale'
    const problemClient = problemAi
    const status = 'confirmed'

    if (!fullName || !phone || !date || !time) {
      throw new Error('Nom, téléphone, date et heure sont obligatoires')
    }
    const hours = validateAppointmentHours(date, time)
    if (!hours.ok) {
      throw new Error(outsideWorkingHoursError(hours))
    }

    const resolved = resolvePatientForBooking(db, {
      contactId: payload.whatsapp_contact_id || payload.contact_id || null,
      fullName,
      phoneNumber: phone,
      city,
      createdVia: 'dashboard_manual',
    })
    const customer = resolved.patient
    const contactId = resolved.contact?.id || null

    const createdAt = nowIso()
    const appointmentInsert = db.prepare(`
      INSERT INTO appointments (
        customer_id, appointment_date, appointment_time, status, conversation_id,
        whatsapp_contact_id, confirmed_at, confirmation_source, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'staff', ?)
    `).run(customer.id, date, time, status, contactId, createdAt, createdAt)

    const appointmentId = Number(appointmentInsert.lastInsertRowid)
    const caseInsert = db.prepare(`
      INSERT INTO dental_cases (
        customer_id, appointment_id, problem, description, urgency, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customer.id,
      appointmentId,
      problemAi.slice(0, 120),
      problemClient,
      'moyenne',
      createdAt,
    )

    return {
      appointment_id: appointmentId,
      customer_id: customer.id,
      full_name: customer.full_name,
      phone_number: customer.phone_number,
      customer,
      contact: resolved.contact,
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId),
      dentalCase: db.prepare('SELECT * FROM dental_cases WHERE id = ?').get(caseInsert.lastInsertRowid),
      order: serializeOrderRow(db.prepare(`
        SELECT
          a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
          c.id AS customer_id, c.full_name, c.phone_number, c.city,
          d.problem, d.description AS problem_details, d.urgency
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.id = ?
      `).get(appointmentId)),
    }
  }

  function updateDentalCaseAiMotif(caseId, aiMotif) {
    const id = Number(caseId)
    const motif = String(aiMotif || '').trim().slice(0, 120)
    if (!id || !motif) return null
    db.prepare('UPDATE dental_cases SET problem = ? WHERE id = ?').run(motif, id)
    return db.prepare('SELECT * FROM dental_cases WHERE id = ?').get(id)
  }

  function logConversation({
    conversation_id,
    whatsapp_chat_id,
    customer_id = null,
    direction,
    message_text,
    extracted = null,
    appointment_status = null,
  }) {
    db.prepare(`
      INSERT INTO conversation_logs (
        conversation_id, whatsapp_chat_id, customer_id, direction,
        message_text, extracted_json, appointment_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conversation_id || null,
      whatsapp_chat_id || null,
      customer_id || null,
      direction,
      message_text || '',
      extracted ? JSON.stringify(extracted) : null,
      appointment_status || null,
      nowIso(),
    )
  }

  function conversationKeyVariants(value) {
    const raw = String(value || '').trim()
    if (!raw) return []
    const bare = raw.replace(/^[^:]+:/, '')
    return [...new Set([raw, bare, `main:${bare}`].filter(Boolean))]
  }

  /**
   * Recent PATIENT inbound texts only — never assistant / outbound.
   */
  function listRecentInboundTexts({ conversationId = null, chatId = null, limit = 30 } = {}) {
    const cap = Math.max(1, Math.min(80, Number(limit) || 30))
    const keys = [...new Set([
      ...conversationKeyVariants(conversationId),
      ...conversationKeyVariants(chatId),
    ])]
    if (!keys.length) return []

    const rows = []
    const placeholders = keys.map(() => '?').join(',')

    const lastSave = db.prepare(`
      SELECT created_at FROM conversation_logs
      WHERE direction = 'system'
        AND message_text = 'appointment_request_saved_pending_staff_call'
        AND (
          conversation_id IN (${placeholders})
          OR whatsapp_chat_id IN (${placeholders})
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(...keys, ...keys)
    const since = lastSave?.created_at || null

    try {
      const logs = db.prepare(`
        SELECT message_text, created_at, id
        FROM conversation_logs
        WHERE direction = 'inbound'
          AND (
            conversation_id IN (${placeholders})
            OR whatsapp_chat_id IN (${placeholders})
          )
          ${since ? 'AND created_at > ?' : ''}
        ORDER BY created_at ASC, id ASC
      `).all(...keys, ...keys, ...(since ? [since] : []))
      for (const row of logs) {
        const raw = String(row.message_text || '').trim()
        if (!raw) continue
        rows.push({
          text: raw,
          created_at: row.created_at,
          isVoice: /^\[vocal\]/i.test(raw) || /\bmessage vocal\b/i.test(raw),
        })
      }
    } catch {
      // conversation_logs always exists in this schema
    }

    try {
      const convs = db.prepare(`
        SELECT id FROM conversations WHERE external_key IN (${placeholders})
      `).all(...keys)
      for (const conv of convs) {
        const msgs = db.prepare(`
          SELECT body, message_type, created_at, id
          FROM messages
          WHERE conversation_id = ?
            AND direction = 'inbound'
            AND LOWER(author_type) IN ('patient', 'user', 'customer')
            ${since ? 'AND created_at > ?' : ''}
          ORDER BY created_at ASC, id ASC
        `).all(...(since ? [conv.id, since] : [conv.id]))
        for (const msg of msgs) {
          const raw = String(msg.body || '').trim()
          if (!raw) continue
          rows.push({
            text: raw,
            created_at: msg.created_at,
            isVoice: String(msg.message_type || '') === 'voice' || /^\[vocal\]/i.test(raw),
          })
        }
      }
    } catch {
      // messages table may be missing on very old DBs
    }

    rows.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const seen = new Set()
    const unique = []
    for (const row of rows) {
      const key = `${row.isVoice ? 'v' : 't'}:${row.text}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(row)
    }
    return unique.slice(-cap)
  }

  function isConversationHumanControlled(conversationId, chatId = null) {
    const keys = [...new Set([
      ...conversationKeyVariants(conversationId),
      ...conversationKeyVariants(chatId),
    ])]
    if (!keys.length) return false
    try {
      const placeholders = keys.map(() => '?').join(',')
      const row = db.prepare(`
        SELECT owner, status FROM conversations
        WHERE external_key IN (${placeholders})
        LIMIT 1
      `).get(...keys)
      if (!row) return false
      return row.owner === 'HUMAN' || String(row.status || '') === 'HUMAN_CONTROLLED'
    } catch {
      return false
    }
  }

  function markStaffNotificationSent(id) {
    db.prepare('UPDATE staff_notifications SET sent_whatsapp = 1 WHERE id = ?').run(id)
  }

  function listAppointments({ limit = 50, fromDate = null } = {}) {
    expireUnconfirmedAppointments()

    const sql = `
      SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        a.created_at,
        c.id AS customer_id,
        c.full_name,
        c.phone_number,
        c.city,
        d.problem,
        d.description AS problem_details,
        d.urgency
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE (? IS NULL OR a.appointment_date >= ?)
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT ?
    `
    return db.prepare(sql).all(fromDate, fromDate, Math.max(1, Number(limit) || 50)).map(serializeOrderRow)
  }

  function listCustomers({ limit = 50, query = '' } = {}) {
    const q = String(query || '').trim()
    const lim = Math.max(1, Number(limit) || 50)
    if (!q) {
      return db.prepare(`
        SELECT * FROM customers
        ORDER BY created_at DESC
        LIMIT ?
      `).all(lim)
    }

    const like = `%${q}%`
    const phoneHits = listPatientsReachableByPhone(db, q)
    const byFields = db.prepare(`
      SELECT * FROM customers
      WHERE full_name LIKE ? OR phone_number LIKE ? OR city LIKE ?
         OR COALESCE(name_normalized, '') LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(like, like, like, `%${normalizePersonName(q)}%`, lim)

    const map = new Map()
    for (const row of [...phoneHits, ...byFields]) {
      map.set(row.id, row)
    }
    return [...map.values()].slice(0, lim)
  }

  function listDentalCases({ limit = 50 } = {}) {
    return db.prepare(`
      SELECT d.*, c.full_name, c.phone_number, c.city
      FROM dental_cases d
      JOIN customers c ON c.id = d.customer_id
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit) || 50))
  }

  function frequentProblems(limit = 8) {
    return db.prepare(`
      SELECT problem, COUNT(*) AS count
      FROM dental_cases
      GROUP BY problem
      ORDER BY count DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit) || 8))
  }

  function listStaffNotifications({ limit = 30, unreadOnly = false } = {}) {
    if (unreadOnly) {
      return db.prepare(`
        SELECT * FROM staff_notifications
        WHERE read_at IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `).all(Math.max(1, Number(limit) || 30))
    }
    return db.prepare(`
      SELECT * FROM staff_notifications
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit) || 30))
  }

  /**
   * Auto-cancel unconfirmed appointments on the 2nd day after their date.
   * Example: RDV on 28 → still non_confirme on 30 → cancelled.
   */
  function expireUnconfirmedAppointments() {
    const result = db.prepare(`
      UPDATE appointments
      SET status = 'cancelled'
      WHERE status = 'non_confirme'
        AND appointment_date <= date('now', 'localtime', '-2 days')
    `).run()

    return {
      cancelled: Number(result.changes || 0),
    }
  }

  function getCrmStats() {
    expireUnconfirmedAppointments()

    const customers = db.prepare('SELECT COUNT(*) AS c FROM customers').get()?.c || 0
    const appointments = db.prepare('SELECT COUNT(*) AS c FROM appointments').get()?.c || 0
    const confirmedUpcoming = db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'confirmed' AND appointment_date >= date('now', 'localtime')
    `).get()?.c || 0
    const cases = db.prepare('SELECT COUNT(*) AS c FROM dental_cases').get()?.c || 0
    const appointmentsToday = db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE appointment_date = date('now', 'localtime')
        AND status = 'confirmed'
    `).get()?.c || 0
    const messagesTotal = db.prepare('SELECT COUNT(*) AS c FROM conversation_logs').get()?.c || 0
    const pendingAppointments = db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE status = 'non_confirme'
    `).get()?.c || 0
    const weeklyRows = db.prepare(`
      SELECT appointment_date AS day, COUNT(*) AS count
      FROM appointments
      WHERE status = 'confirmed'
        AND appointment_date >= date('now', 'localtime', '-6 days')
        AND appointment_date <= date('now', 'localtime')
      GROUP BY appointment_date
      ORDER BY appointment_date ASC
    `).all()

    return {
      customers: Number(customers),
      appointments: Number(appointments),
      upcoming_confirmed: Number(confirmedUpcoming),
      dental_cases: Number(cases),
      appointments_today: Number(appointmentsToday),
      messages_total: Number(messagesTotal),
      pending_appointments: Number(pendingAppointments),
      weekly_appointments: weeklyRows.map((row) => ({
        day: String(row.day || ''),
        count: Number(row.count || 0),
      })),
    }
  }

  function serializeOrderRow(row) {
    const aiMotif = String(row.problem || '').trim() || '—'
    const clientMotif = String(row.problem_details || '').trim() || aiMotif
    return {
      id: `rdv-${row.id}`,
      appointment_id: row.id,
      customer_id: row.customer_id,
      full_name: row.full_name,
      phone_number: row.phone_number,
      phone_display: formatPhoneDisplay(row.phone_number),
      city: row.city,
      problem: aiMotif,
      problem_details: clientMotif,
      problem_ai: aiMotif,
      problem_client: clientMotif,
      urgency: row.urgency || 'moyenne',
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      status: row.status,
      created_at: row.created_at,
      type: 'appointment',
    }
  }

  /**
   * Update appointment + linked customer/case from dashboard.
   * @param {number} appointmentId
   * @param {object} patch
   */
  function updateAppointment(appointmentId, patch = {}) {
    const id = Number(appointmentId)
    if (!id) {
      throw new Error('Invalid appointment id')
    }

    const current = db.prepare(`
      SELECT
        a.id, a.customer_id, a.appointment_date, a.appointment_time, a.status,
        c.full_name, c.phone_number, c.city,
        d.id AS case_id, d.problem, d.description AS problem_details
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(id)

    if (!current) {
      const error = new Error('Rendez-vous introuvable')
      error.code = 'NOT_FOUND'
      throw error
    }

    const nextStatus = String(patch.status || current.status || 'non_confirme').trim()
    const allowed = new Set(['non_confirme', 'confirmed', 'cancelled'])
    if (!allowed.has(nextStatus)) {
      throw new Error('Statut invalide')
    }

    // Status-only update from the table dropdown — do not re-validate schedule/hours.
    const patchKeys = Object.keys(patch || {})
    const statusOnly = patchKeys.length === 1 && patchKeys[0] === 'status'
    if (statusOnly) {
      const previousStatus = current.status
      db.prepare(`
        UPDATE appointments
        SET status = ?,
            confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END,
            confirmation_source = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmation_source, 'staff') ELSE confirmation_source END
        WHERE id = ?
      `).run(nextStatus, nextStatus, nowIso(), nextStatus, id)

      // Sync confirmation request if present
      if (nextStatus === 'confirmed') {
        try {
          db.prepare(`
            UPDATE appointment_confirmation_requests
            SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?), confirmation_source = COALESCE(confirmation_source, 'staff'), updated_at = ?
            WHERE appointment_id = ?
          `).run(nowIso(), nowIso(), id)
        } catch { /* table may not exist yet */ }
        try {
          db.prepare(`
            UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ?
            WHERE appointment_id = ? AND task_type = 'confirm_appointment' AND status NOT IN ('completed', 'cancelled')
          `).run(nowIso(), nowIso(), id)
        } catch { /* optional */ }
      }
      if (nextStatus === 'cancelled') {
        try {
          db.prepare(`
            UPDATE appointment_confirmation_requests
            SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE appointment_id = ? AND status IN ('pending', 'staff_task')
          `).run(nowIso(), nowIso(), id)
        } catch { /* optional */ }
      }

      const row = db.prepare(`
        SELECT
          a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
          a.duration_minutes,
          c.id AS customer_id, c.full_name, c.phone_number, c.city,
          d.problem, d.description AS problem_details, d.urgency
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE a.id = ?
      `).get(id)

      // Flag for callers to create slot_released notification
      const serialized = row ? serializeOrderRow(row) : null
      if (serialized && nextStatus === 'cancelled' && previousStatus !== 'cancelled') {
        serialized._slot_released = {
          slot_date: row.appointment_date,
          slot_time: row.appointment_time,
          appointment_id: row.id,
          duration_minutes: row.duration_minutes || 30,
          source_event: 'appointment_cancelled',
        }
      }
      return serialized
    }

    const fullName = validateFullName(String(patch.full_name ?? current.full_name ?? '').trim())
    const phone = toE164(patch.phone_number ?? current.phone_number)
    const city = String(patch.city ?? current.city ?? '').trim() || null
    const date = String(patch.appointment_date ?? current.appointment_date ?? '').trim()
    const time = String(patch.appointment_time ?? current.appointment_time ?? '').trim()
    const problem = String(patch.problem ?? current.problem ?? 'consultation générale').trim()
    const details = String(patch.problem_details ?? current.problem_details ?? '').trim() || null

    if (!fullName || !phone || !date || !time) {
      throw new Error('Nom, téléphone, date et heure sont obligatoires')
    }
    const hours = validateAppointmentHours(date, time)
    if (!hours.ok) {
      throw new Error(outsideWorkingHoursError(hours))
    }

    db.prepare(`
      UPDATE customers
      SET full_name = ?, phone_number = ?, city = ?
      WHERE id = ?
    `).run(fullName, phone, city, current.customer_id)

    const previousStatus = current.status
    const oldDate = String(current.appointment_date || '').trim()
    const oldTime = String(current.appointment_time || '').slice(0, 5)
    const becameCancelled = nextStatus === 'cancelled' && previousStatus !== 'cancelled'

    db.prepare(`
      UPDATE appointments
      SET appointment_date = ?, appointment_time = ?, status = ?
      WHERE id = ?
    `).run(date, time, nextStatus, id)

    if (current.case_id) {
      db.prepare(`
        UPDATE dental_cases
        SET problem = ?, description = ?
        WHERE id = ?
      `).run(problem, details, current.case_id)
    } else {
      db.prepare(`
        INSERT INTO dental_cases (customer_id, appointment_id, problem, description, urgency, created_at)
        VALUES (?, ?, ?, ?, 'moyenne', ?)
      `).run(current.customer_id, id, problem, details, nowIso())
    }

    const row = db.prepare(`
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        a.duration_minutes,
        c.id AS customer_id, c.full_name, c.phone_number, c.city,
        d.problem, d.description AS problem_details, d.urgency
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(id)
    const serialized = row ? serializeOrderRow(row) : null
    if (serialized && previousStatus !== 'cancelled') {
      if (becameCancelled) {
        serialized._slot_released = {
          slot_date: oldDate,
          slot_time: oldTime,
          appointment_id: id,
          duration_minutes: row.duration_minutes || 30,
          source_event: 'appointment_cancelled',
        }
      }
      // Moves never create bell notifications — old slot simply becomes available in Agenda
    }
    return serialized
  }

  /**
   * Delete an appointment and its linked dental case / notifications.
   * Keeps the customer record.
   * @param {number} appointmentId
   */
  function deleteAppointment(appointmentId) {
    const id = Number(appointmentId)
    if (!id) {
      throw new Error('Invalid appointment id')
    }

    const current = db.prepare('SELECT id FROM appointments WHERE id = ?').get(id)
    if (!current) {
      const error = new Error('Rendez-vous introuvable')
      error.code = 'NOT_FOUND'
      throw error
    }

    db.prepare('DELETE FROM staff_notifications WHERE appointment_id = ?').run(id)
    db.prepare('DELETE FROM dental_cases WHERE appointment_id = ?').run(id)
    db.prepare('DELETE FROM appointments WHERE id = ?').run(id)

    return { id, deleted: true }
  }

  function searchOrders({ q = '', limit = 80 } = {}) {
    expireUnconfirmedAppointments()
    const query = String(q || '').trim()
    const like = `%${query}%`
    const sql = query
      ? `
        SELECT
          a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
          c.id AS customer_id, c.full_name, c.phone_number, c.city,
          d.problem, d.description AS problem_details, d.urgency
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        WHERE c.full_name LIKE ? OR c.phone_number LIKE ? OR c.city LIKE ? OR d.problem LIKE ?
        ORDER BY a.created_at ASC
        LIMIT ?
      `
      : `
        SELECT
          a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
          c.id AS customer_id, c.full_name, c.phone_number, c.city,
          d.problem, d.description AS problem_details, d.urgency
        FROM appointments a
        JOIN customers c ON c.id = a.customer_id
        LEFT JOIN dental_cases d ON d.appointment_id = a.id
        ORDER BY a.created_at ASC
        LIMIT ?
      `

    const rows = query
      ? db.prepare(sql).all(like, like, like, like, Math.max(1, Number(limit) || 80))
      : db.prepare(sql).all(Math.max(1, Number(limit) || 80))

    return rows.map(serializeOrderRow)
  }

  return {
    getLead,
    upsertLead,
    clearLead,
    findCustomerByPhone,
    findCustomersByPhone,
    getCustomerById,
    listLinkedPatientsForChat,
    listAppointmentsForPatient,
    findContactForChat,
    createOrUpdateCustomer,
    saveConfirmedBooking,
    createManualAppointment,
    updateDentalCaseAiMotif,
    updateAppointment,
    deleteAppointment,
    logConversation,
    listRecentInboundTexts,
    isConversationHumanControlled,
    markStaffNotificationSent,
    listAppointments,
    listCustomers,
    listDentalCases,
    frequentProblems,
    listStaffNotifications,
    getCrmStats,
    searchOrders,
    expireUnconfirmedAppointments,
  }
}

module.exports = {
  createCrmRepository,
}
