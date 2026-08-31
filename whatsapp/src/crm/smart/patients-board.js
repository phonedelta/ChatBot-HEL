/**
 * Patients board — operational CRM mini-fiches (not medical records).
 * Respects WhatsAppContact → many Patients model.
 */

const {
  findContactByWhatsAppOrPhone,
  listPatientsForContact,
  listPatientsReachableByPhone,
  enrichLinkedPatients,
  resolvePatientForBooking,
  formatPhoneDisplay,
} = require('../contact-patients')
const { toE164 } = require('../phone')

function nowIso() {
  return new Date().toISOString()
}

function safePhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/@lid/i.test(raw) || /@c\.us/i.test(raw) || /@g\.us/i.test(raw)) return null
  const e164 = toE164(raw)
  if (e164) return e164
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 9 && digits.length <= 15) return raw
  return null
}

function languageLabel(value) {
  const v = String(value || '').toLowerCase()
  if (v === 'darija' || v === 'ar' || v === 'darija_arab') return 'Darija'
  if (v === 'fr' || v === 'french' || v === 'français') return 'Français'
  if (v === 'en' || v === 'english') return 'Anglais'
  if (!v) return '—'
  return String(value)
}

function sourceLabel(value) {
  const v = String(value || '').toLowerCase()
  if (!v || v === 'whatsapp' || v === 'whatsapp_booking' || v === 'whatsapp_or_form') return 'WhatsApp'
  if (v === 'website' || v === 'website_form' || v === 'form') return 'Formulaire du site'
  if (v === 'manual' || v === 'dashboard' || v === 'staff' || v === 'saisie_manuelle') return 'Saisie manuelle'
  return 'WhatsApp'
}

function appointmentStatusLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'non_confirme') return 'À confirmer'
  if (s === 'confirmed') return 'Confirmé'
  if (s === 'cancelled') return 'Annulé'
  if (s === 'completed') return 'Terminé'
  if (s === 'no_show') return 'Absent'
  return status || '—'
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createPatientsBoard(db, helpers = {}) {
  const {
    listTimeline = () => [],
    listPatientNotes = () => [],
    listPatientTags = () => [],
    listWaitlist = () => [],
    listTasks = () => [],
  } = helpers

  function getContactForPatient(customerId, customer = null) {
    const c = customer || db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId))
    if (!c) return null

    // Prefer explicit contact_patients link
    try {
      const link = db.prepare(`
        SELECT wc.*
        FROM contact_patients cp
        JOIN whatsapp_contacts wc ON wc.id = cp.whatsapp_contact_id
        WHERE cp.patient_id = ?
        ORDER BY cp.id ASC
        LIMIT 1
      `).get(Number(customerId))
      if (link) return link
    } catch { /* optional */ }

    return findContactByWhatsAppOrPhone(db, {
      whatsappId: c.whatsapp_chat_id,
      phone: c.phone_number,
    })
  }

  function getNextAppointment(customerId) {
    return db.prepare(`
      SELECT a.*, d.problem
      FROM appointments a
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.customer_id = ?
        AND a.appointment_date >= date('now', 'localtime')
        AND a.status IN ('non_confirme', 'confirmed')
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 1
    `).get(Number(customerId)) || null
  }

  function listUpcomingAppointments(customerId, limit = 3) {
    return db.prepare(`
      SELECT a.*, d.problem
      FROM appointments a
      LEFT JOIN dental_cases d ON d.appointment_id = a.id
      WHERE a.customer_id = ?
        AND a.appointment_date >= date('now', 'localtime')
        AND a.status IN ('non_confirme', 'confirmed')
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT ?
    `).all(Number(customerId), Math.max(1, Math.min(10, Number(limit) || 3)))
  }

  function getOpenCallbackTask(customerId) {
    return db.prepare(`
      SELECT * FROM tasks
      WHERE customer_id = ?
        AND status NOT IN ('completed', 'cancelled')
        AND (
          status = 'to_call'
          OR task_type IN ('confirm_appointment', 'call')
        )
      ORDER BY COALESCE(due_at, created_at) ASC
      LIMIT 1
    `).get(Number(customerId)) || null
  }

  function getLastContactAt(customerId, contact = null) {
    const conv = db.prepare(`
      SELECT id, last_message_at, external_key, phone_e164
      FROM conversations
      WHERE customer_id = ?
      ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
      LIMIT 1
    `).get(Number(customerId))

    if (conv?.last_message_at) {
      return { at: conv.last_message_at, conversation_id: conv.id, channel: 'whatsapp' }
    }

    if (contact?.id) {
      try {
        const viaContact = db.prepare(`
          SELECT id, last_message_at
          FROM conversations
          WHERE phone_e164 = ?
             OR external_key = ?
             OR external_key LIKE ?
          ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
          LIMIT 1
        `).get(
          contact.phone_e164 || null,
          contact.whatsapp_id || null,
          contact.whatsapp_id ? `%${contact.whatsapp_id}%` : null,
        )
        if (viaContact?.last_message_at) {
          return {
            at: viaContact.last_message_at,
            conversation_id: viaContact.id,
            channel: 'whatsapp',
          }
        }
      } catch { /* optional */ }
    }

    const lastAppt = db.prepare(`
      SELECT created_at FROM appointments
      WHERE customer_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(Number(customerId))

    return {
      at: lastAppt?.created_at || null,
      conversation_id: conv?.id || null,
      channel: 'whatsapp',
    }
  }

  function resolveNextAction(customerId, nextAppt, callbackTask = null) {
    if (callbackTask) {
      return {
        type: 'CALL_BACK',
        label: 'Appeler le patient',
        priority: 'high',
      }
    }

    const openAdmin = db.prepare(`
      SELECT id FROM tasks
      WHERE customer_id = ?
        AND status NOT IN ('completed', 'cancelled')
        AND task_type NOT IN ('confirm_appointment', 'call', 'no_response')
      LIMIT 1
    `).get(Number(customerId))
    if (openAdmin) {
      return { type: 'ADMIN', label: 'Action administrative', priority: 'medium' }
    }

    const conv = db.prepare(`
      SELECT status, owner FROM conversations
      WHERE customer_id = ?
      ORDER BY COALESCE(last_message_at, updated_at) DESC
      LIMIT 1
    `).get(Number(customerId))
    if (conv && (conv.owner === 'HUMAN' || ['TO_PROCESS', 'TRANSFERRED', 'NEEDS_HUMAN'].includes(conv.status))) {
      return { type: 'REPLY', label: 'Répondre au patient', priority: 'medium' }
    }

    const reschedule = db.prepare(`
      SELECT id FROM tasks
      WHERE customer_id = ?
        AND task_type = 'reschedule'
        AND status NOT IN ('completed', 'cancelled')
      LIMIT 1
    `).get(Number(customerId))
    if (reschedule) {
      return { type: 'RESCHEDULE', label: 'Reprogrammer', priority: 'medium' }
    }

    if (nextAppt?.status === 'non_confirme') {
      return {
        type: 'CONFIRM_APPOINTMENT',
        label: 'Confirmer le rendez-vous',
        priority: 'medium',
      }
    }

    return {
      type: 'NONE',
      label: 'Aucune action nécessaire',
      priority: 'low',
    }
  }

  function patientSubtitle({ isNew, shared, linkedCount }) {
    if (shared && linkedCount > 1) return 'Contact partagé'
    if (isNew) return 'Nouveau patient'
    return 'Patient actif'
  }

  function serializePatient(customer) {
    const contact = getContactForPatient(customer.id, customer)
    let linkedCount = 1
    let linkedPatients = []
    if (contact?.id) {
      linkedPatients = listPatientsForContact(db, contact.id)
      linkedCount = linkedPatients.length || 1
    } else {
      const reachable = listPatientsReachableByPhone(db, customer.phone_number)
      linkedCount = Math.max(1, reachable.length)
      linkedPatients = reachable
    }

    const shared = linkedCount > 1
    const nextAppt = getNextAppointment(customer.id)
    const callbackTask = getOpenCallbackTask(customer.id)
    const nextAction = resolveNextAction(customer.id, nextAppt, callbackTask)
    const lastContact = getLastContactAt(customer.id, contact)
    const phone = safePhone(contact?.phone_e164 || customer.phone_number)
    const created = customer.created_at ? new Date(String(customer.created_at).replace(' ', 'T')) : null
    const isNew = created && (Date.now() - created.getTime()) < 7 * 24 * 3600 * 1000

    return {
      id: customer.id,
      full_name: customer.full_name,
      city: customer.city || null,
      phone_number: phone,
      phone_display: phone ? formatPhoneDisplay(phone) : null,
      language: customer.preferred_language || 'fr',
      language_label: languageLabel(customer.preferred_language),
      source: customer.source || customer.created_via || 'whatsapp',
      source_label: sourceLabel(customer.source || customer.created_via),
      created_at: customer.created_at,
      subtitle: patientSubtitle({ isNew, shared, linkedCount }),
      is_new: Boolean(isNew),
      contact: contact
        ? {
          id: contact.id,
          phone: safePhone(contact.phone_e164) || phone,
          phone_display: formatPhoneDisplay(safePhone(contact.phone_e164) || phone),
          channel: 'whatsapp',
          shared,
          linked_patients_count: linkedCount,
          whatsapp_id: contact.whatsapp_id || null,
        }
        : {
          id: null,
          phone,
          phone_display: phone ? formatPhoneDisplay(phone) : null,
          channel: phone ? 'whatsapp' : null,
          shared,
          linked_patients_count: linkedCount,
          whatsapp_id: null,
        },
      next_appointment: nextAppt
        ? {
          id: nextAppt.id,
          appointment_date: nextAppt.appointment_date,
          appointment_time: String(nextAppt.appointment_time || '').slice(0, 5),
          status: nextAppt.status,
          status_label: appointmentStatusLabel(nextAppt.status),
          type: nextAppt.problem || 'Rendez-vous',
        }
        : null,
      next_action: nextAction,
      last_contact_at: lastContact.at,
      last_contact_channel: lastContact.channel,
      conversation_id: lastContact.conversation_id,
      has_upcoming_appointment: Boolean(nextAppt),
      needs_confirmation: nextAppt?.status === 'non_confirme',
      needs_callback: Boolean(callbackTask) || nextAction.type === 'CALL_BACK',
      action_priority: nextAction.priority === 'high' ? 0 : (nextAction.type === 'NONE' ? 2 : 1),
    }
  }

  function computeSummary() {
    const patients = Number(db.prepare('SELECT COUNT(*) AS c FROM customers').get()?.c || 0)
    const appointmentsUpcoming = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE appointment_date >= date('now', 'localtime')
        AND status IN ('non_confirme', 'confirmed')
    `).get()?.c || 0)
    const toConfirm = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM appointments
      WHERE appointment_date >= date('now', 'localtime')
        AND status = 'non_confirme'
    `).get()?.c || 0)
    const toCall = Number(db.prepare(`
      SELECT COUNT(*) AS c FROM tasks
      WHERE status NOT IN ('completed', 'cancelled')
        AND (status = 'to_call' OR task_type IN ('confirm_appointment', 'call'))
    `).get()?.c || 0)
    return {
      patients,
      appointments_upcoming: appointmentsUpcoming,
      to_confirm: toConfirm,
      to_call: toCall,
    }
  }

  function listPatientsBoard({
    query = '',
    filter = 'all',
    page = 1,
    limit = 25,
    sort = 'action',
  } = {}) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 25))
    const pageNum = Math.max(1, Number(page) || 1)
    const q = String(query || '').trim()

    let customers = []
    if (q) {
      const like = `%${q}%`
      const phoneHits = listPatientsReachableByPhone(db, q)
      const byFields = db.prepare(`
        SELECT * FROM customers
        WHERE full_name LIKE ? OR phone_number LIKE ? OR city LIKE ?
           OR COALESCE(name_normalized, '') LIKE ?
           OR COALESCE(whatsapp_chat_id, '') LIKE ?
        ORDER BY full_name ASC
        LIMIT 200
      `).all(like, like, like, like, like)
      const map = new Map()
      for (const row of [...phoneHits, ...byFields]) map.set(row.id, row)
      customers = [...map.values()]
    } else {
      customers = db.prepare(`
        SELECT * FROM customers
        ORDER BY full_name ASC
        LIMIT 500
      `).all()
    }

    let items = customers.map(serializePatient)

    if (filter === 'with_appointment') {
      items = items.filter((i) => i.has_upcoming_appointment)
    } else if (filter === 'to_confirm') {
      items = items.filter((i) => i.needs_confirmation)
    } else if (filter === 'to_call' || filter === 'callback') {
      items = items.filter((i) => i.needs_callback)
    } else if (filter === 'no_appointment') {
      items = items.filter((i) => !i.has_upcoming_appointment)
    } else if (filter === 'shared_contact') {
      items = items.filter((i) => i.contact?.shared)
    }

    if (sort === 'name') {
      items.sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'fr'))
    } else if (sort === 'next_appointment') {
      items.sort((a, b) => {
        const ad = a.next_appointment?.appointment_date || '9999'
        const bd = b.next_appointment?.appointment_date || '9999'
        if (ad !== bd) return ad.localeCompare(bd)
        return String(a.next_appointment?.appointment_time || '').localeCompare(
          String(b.next_appointment?.appointment_time || ''),
        )
      })
    } else if (sort === 'last_contact') {
      items.sort((a, b) => String(b.last_contact_at || '').localeCompare(String(a.last_contact_at || '')))
    } else {
      // action first, then next appointment, then name
      items.sort((a, b) => {
        if (a.action_priority !== b.action_priority) return a.action_priority - b.action_priority
        const ad = a.next_appointment?.appointment_date || '9999'
        const bd = b.next_appointment?.appointment_date || '9999'
        if (ad !== bd) return ad.localeCompare(bd)
        return String(a.full_name).localeCompare(String(b.full_name), 'fr')
      })
    }

    const total = items.length
    const offset = (pageNum - 1) * lim
    const pageItems = items.slice(offset, offset + lim)

    return {
      ok: true,
      patients: pageItems,
      items: pageItems,
      summary: computeSummary(),
      pagination: {
        page: pageNum,
        limit: lim,
        total,
        total_pages: Math.max(1, Math.ceil(total / lim)),
        from: total === 0 ? 0 : offset + 1,
        to: Math.min(total, offset + lim),
      },
      filter,
      query: q,
    }
  }

  function getPatientContext(customerId) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId))
    if (!customer) return null

    const base = serializePatient(customer)
    const contact = getContactForPatient(customer.id, customer)
    const linked = contact?.id
      ? enrichLinkedPatients(db, contact.id)
      : listPatientsReachableByPhone(db, customer.phone_number).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone_number: p.phone_number,
        phone_display: formatPhoneDisplay(p.phone_number),
        next_appointment: null,
      }))

    const upcoming = listUpcomingAppointments(customer.id, 5)
    const timeline = (typeof listTimeline === 'function' ? listTimeline(customer.id, { limit: 20 }) : [])
      .map((ev) => ({
        id: ev.id,
        created_at: ev.created_at,
        event_type: ev.event_type,
        title: ev.title,
        detail: ev.detail,
        actor_type: ev.actor_type,
      }))

    // ACR confirmation info for next appointment
    let confirmation = null
    if (base.next_appointment?.id) {
      try {
        const req = db.prepare(`
          SELECT initial_sent_at, followup_sent_at, staff_task_id, status
          FROM appointment_confirmation_requests
          WHERE appointment_id = ?
        `).get(Number(base.next_appointment.id))
        if (req) {
          confirmation = {
            initial_sent_at: req.initial_sent_at,
            followup_sent_at: req.followup_sent_at,
            staff_task_id: req.staff_task_id,
            status: req.status,
            label: req.staff_task_id
              ? 'À rappeler par l’équipe'
              : req.followup_sent_at
                ? 'Relance envoyée'
                : req.initial_sent_at
                  ? 'Confirmation envoyée'
                  : 'Confirmation programmée (24 h avant)',
          }
        } else if (base.next_appointment.status === 'non_confirme') {
          confirmation = {
            label: 'Confirmation programmée (24 h avant)',
          }
        }
      } catch { /* optional */ }
    }

    return {
      ok: true,
      patient: {
        id: customer.id,
        full_name: customer.full_name,
        city: customer.city,
        phone_number: base.phone_number,
        phone_display: base.phone_display,
        language: base.language,
        language_label: base.language_label,
        source: base.source,
        source_label: base.source_label,
        created_at: customer.created_at,
        subtitle: base.subtitle,
      },
      contact: base.contact,
      linked_patients: linked.filter((p) => Number(p.id) !== Number(customer.id)),
      linked_patients_all: linked,
      next_appointment: base.next_appointment,
      upcoming_appointments: upcoming.map((a) => ({
        id: a.id,
        appointment_date: a.appointment_date,
        appointment_time: String(a.appointment_time || '').slice(0, 5),
        status: a.status,
        status_label: appointmentStatusLabel(a.status),
        type: a.problem || 'Rendez-vous',
      })),
      next_action: base.next_action,
      confirmation,
      last_contact_at: base.last_contact_at,
      conversation_id: base.conversation_id,
      timeline,
      notes: typeof listPatientNotes === 'function' ? listPatientNotes(customer.id) : [],
      tags: typeof listPatientTags === 'function' ? listPatientTags(customer.id) : [],
      waitlist: typeof listWaitlist === 'function'
        ? listWaitlist({ status: 'active', limit: 20 }).filter((w) => Number(w.customer_id) === Number(customer.id))
        : [],
    }
  }

  function createManualPatient({
    fullName,
    phoneNumber = null,
    city = null,
    language = 'fr',
    linkContactPhone = null,
  } = {}) {
    const name = String(fullName || '').trim()
    const phone = safePhone(phoneNumber) || safePhone(linkContactPhone)
    if (!name || name.length < 2) {
      const err = new Error('Le nom est obligatoire')
      err.code = 'VALIDATION'
      throw err
    }
    if (name.length > 100) {
      const err = new Error('Le nom est trop long (100 caractères max.)')
      err.code = 'VALIDATION'
      throw err
    }
    if (!phone) {
      const err = new Error('Un numéro de téléphone ou contact WhatsApp est requis')
      err.code = 'VALIDATION'
      throw err
    }

    const { upsertWhatsAppContact, linkContactPatient, normalizePersonName } = require('../contact-patients')
    const norm = normalizePersonName(name)
    const createdAt = new Date().toISOString()

    const contact = upsertWhatsAppContact(db, {
      whatsappId: null,
      phoneE164: phone,
      displayName: name,
    })

    const existing = db.prepare(`
      SELECT c.*
      FROM contact_patients cp
      JOIN customers c ON c.id = cp.patient_id
      WHERE cp.whatsapp_contact_id = ?
        AND c.name_normalized = ?
      ORDER BY c.id ASC
      LIMIT 1
    `).get(contact.id, norm)

    let patientRow = existing
    let created = false

    if (!patientRow) {
      const insert = db.prepare(`
        INSERT INTO customers (
          full_name, phone_number, city, preferred_language,
          name_normalized, source, created_via, created_at, last_contact_at
        ) VALUES (?, ?, ?, ?, ?, 'manual', 'manual', ?, ?)
      `).run(name, phone, city || null, language || 'fr', norm, createdAt, createdAt)
      patientRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(insert.lastInsertRowid)
      linkContactPatient(db, contact.id, patientRow.id)
      created = true
    } else {
      db.prepare(`
        UPDATE customers
        SET preferred_language = COALESCE(?, preferred_language),
            city = COALESCE(?, city),
            source = COALESCE(source, 'manual'),
            created_via = COALESCE(created_via, 'manual'),
            last_contact_at = ?
        WHERE id = ?
      `).run(language || 'fr', city || null, createdAt, patientRow.id)
      linkContactPatient(db, contact.id, patientRow.id)
      patientRow = db.prepare('SELECT * FROM customers WHERE id = ?').get(patientRow.id)
    }

    return {
      ok: true,
      patient: serializePatient(patientRow),
      contact: contact || null,
      created,
    }
  }

  return {
    listPatientsBoard,
    getPatientContext,
    createManualPatient,
    serializePatient,
    computeSummary,
    languageLabel,
    sourceLabel,
    appointmentStatusLabel,
  }
}

module.exports = {
  createPatientsBoard,
  languageLabel,
  sourceLabel,
  appointmentStatusLabel,
}
