/**
 * CRM repository — customers, appointments, dental_cases, logs, leads.
 */

const { toE164, formatPhoneDisplay } = require('./phone')

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
      full_name: pick('full_name', null),
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
      created_at: existing?.created_at || nowIso(),
      updated_at: nowIso(),
    }

    db.prepare(`
      INSERT INTO crm_leads (
        conversation_id, whatsapp_chat_id, phone_number, full_name, city,
        problem, problem_details, urgency, appointment_date, appointment_time,
        stage, awaiting_field, language, booking_intent, created_at, updated_at
      ) VALUES (
        @conversation_id, @whatsapp_chat_id, @phone_number, @full_name, @city,
        @problem, @problem_details, @urgency, @appointment_date, @appointment_time,
        @stage, @awaiting_field, @language, @booking_intent, @created_at, @updated_at
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
        updated_at = excluded.updated_at
    `).run(merged)

    return getLead(conversationId)
  }

  function clearLead(conversationId) {
    db.prepare('DELETE FROM crm_leads WHERE conversation_id = ?').run(conversationId)
  }

  function findCustomerByPhone(phoneNumber) {
    const phone = toE164(phoneNumber)
    if (!phone) return null
    return db.prepare('SELECT * FROM customers WHERE phone_number = ?').get(phone) || null
  }

  function createOrUpdateCustomer({ full_name, phone_number, city, whatsapp_chat_id }) {
    const phone = toE164(phone_number)
    if (!phone || !full_name) {
      throw new Error('Customer requires full_name and phone_number')
    }

    const existing = findCustomerByPhone(phone)
    if (existing) {
      db.prepare(`
        UPDATE customers
        SET full_name = ?, city = COALESCE(?, city), whatsapp_chat_id = COALESCE(?, whatsapp_chat_id)
        WHERE id = ?
      `).run(full_name, city || null, whatsapp_chat_id || null, existing.id)
      return db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id)
    }

    const result = db.prepare(`
      INSERT INTO customers (full_name, phone_number, city, whatsapp_chat_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(full_name, phone, city || null, whatsapp_chat_id || null, nowIso())

    return db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid)
  }

  /**
   * Persist confirmed booking. Never call without explicit patient confirmation.
   */
  function saveConfirmedBooking(lead) {
    if (!lead?.full_name || !lead?.phone_number || !lead?.appointment_date || !lead?.appointment_time) {
      throw new Error('Incomplete lead — cannot save booking')
    }

    const customer = createOrUpdateCustomer({
      full_name: lead.full_name,
      phone_number: lead.phone_number,
      city: lead.city,
      whatsapp_chat_id: lead.whatsapp_chat_id,
    })

    const appointmentInsert = db.prepare(`
      INSERT INTO appointments (
        customer_id, appointment_date, appointment_time, status, conversation_id, created_at
      ) VALUES (?, ?, ?, 'non_confirme', ?, ?)
    `).run(
      customer.id,
      lead.appointment_date,
      lead.appointment_time,
      lead.conversation_id || null,
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

    const notificationBody = [
      'Nouveau rendez-vous :',
      '',
      `Client : ${customer.full_name}`,
      `Téléphone : ${formatPhoneDisplay(customer.phone_number)}`,
      `Ville : ${customer.city || '—'}`,
      `Problème (IA) : ${dentalCase.problem}`,
      `Message client : ${dentalCase.description || '—'}`,
      `Date : ${appointment.appointment_date}`,
      `Heure : ${appointment.appointment_time}`,
      `Statut : Non confirmé (à confirmer par appel téléphonique)`,
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
        appointment_id: appointmentId,
        dental_case_id: dentalCase.id,
      }),
      nowIso(),
    )

    return {
      customer,
      appointment,
      dentalCase,
      staffNotification: db.prepare('SELECT * FROM staff_notifications WHERE id = ?').get(notif.lastInsertRowid),
    }
  }

  /**
   * Create an appointment from the admin dashboard (manual entry).
   */
  function createManualAppointment(payload = {}) {
    const fullName = String(payload.full_name || '').trim()
    const phone = toE164(payload.phone_number)
    const city = String(payload.city || '').trim() || null
    const date = String(payload.appointment_date || '').trim()
    const time = String(payload.appointment_time || '').trim()
    const problemAi = String(payload.problem || '').trim() || 'consultation générale'
    const problemClient = String(payload.problem_details || payload.problem || '').trim() || problemAi
    const status = String(payload.status || 'non_confirme').trim()
    const allowed = new Set(['non_confirme', 'confirmed', 'cancelled'])

    if (!fullName || !phone || !date || !time) {
      throw new Error('Nom, téléphone, date et heure sont obligatoires')
    }
    if (!allowed.has(status)) {
      throw new Error('Statut invalide')
    }

    const customer = createOrUpdateCustomer({
      full_name: fullName,
      phone_number: phone,
      city,
    })

    const appointmentInsert = db.prepare(`
      INSERT INTO appointments (
        customer_id, appointment_date, appointment_time, status, conversation_id, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).run(customer.id, date, time, status, nowIso())

    const appointmentId = Number(appointmentInsert.lastInsertRowid)
    const caseInsert = db.prepare(`
      INSERT INTO dental_cases (
        customer_id, appointment_id, problem, description, urgency, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customer.id,
      appointmentId,
      problemAi.slice(0, 120),
      problemClient.slice(0, 280),
      payload.urgency || 'moyenne',
      nowIso(),
    )

    const row = db.prepare(`
      SELECT
        a.id, a.appointment_date, a.appointment_time, a.status, a.created_at,
        c.id AS customer_id, c.full_name, c.phone_number, c.city,
        d.problem, d.description AS problem_details, d.urgency
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(appointmentId)

    return {
      customer,
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId),
      dentalCase: db.prepare('SELECT * FROM dental_cases WHERE id = ?').get(caseInsert.lastInsertRowid),
      order: serializeOrderRow(row),
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
    if (q) {
      const like = `%${q}%`
      return db.prepare(`
        SELECT * FROM customers
        WHERE full_name LIKE ? OR phone_number LIKE ? OR city LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(like, like, like, Math.max(1, Number(limit) || 50))
    }
    return db.prepare(`
      SELECT * FROM customers
      ORDER BY created_at DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit) || 50))
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

    const fullName = String(patch.full_name ?? current.full_name ?? '').trim()
    const phone = toE164(patch.phone_number ?? current.phone_number)
    const city = String(patch.city ?? current.city ?? '').trim() || null
    const date = String(patch.appointment_date ?? current.appointment_date ?? '').trim()
    const time = String(patch.appointment_time ?? current.appointment_time ?? '').trim()
    const problem = String(patch.problem ?? current.problem ?? 'consultation générale').trim()
    const details = String(patch.problem_details ?? current.problem_details ?? '').trim() || null

    if (!fullName || !phone || !date || !time) {
      throw new Error('Nom, téléphone, date et heure sont obligatoires')
    }

    db.prepare(`
      UPDATE customers
      SET full_name = ?, phone_number = ?, city = ?
      WHERE id = ?
    `).run(fullName, phone, city, current.customer_id)

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
        c.id AS customer_id, c.full_name, c.phone_number, c.city,
        d.problem, d.description AS problem_details, d.urgency
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.id = ?
    `).get(id)
    return row ? serializeOrderRow(row) : null
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
    createOrUpdateCustomer,
    saveConfirmedBooking,
    createManualAppointment,
    updateDentalCaseAiMotif,
    updateAppointment,
    deleteAppointment,
    logConversation,
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
