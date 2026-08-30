/**
 * WhatsApp Contact ↔ Patients (multi-patient per phone/chat).
 * Phone identifies the contact channel — never a unique patient identity.
 */

const { toE164, formatPhoneDisplay, isValidPhone } = require('./phone')
const { validateFullName } = require('./name-validator')

function nowIso() {
  return new Date().toISOString()
}

/**
 * Conservative name normalization for matching (not display).
 */
function normalizePersonName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\u0600-\u06ff]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ensureContactPatientSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_id TEXT,
      phone_e164 TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_contacts_whatsapp_id
      ON whatsapp_contacts(whatsapp_id)
      WHERE whatsapp_id IS NOT NULL AND whatsapp_id != '';
    CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone
      ON whatsapp_contacts(phone_e164);

    CREATE TABLE IF NOT EXISTS contact_patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_contact_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      relationship_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(whatsapp_contact_id, patient_id),
      FOREIGN KEY (whatsapp_contact_id) REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_contact_patients_contact
      ON contact_patients(whatsapp_contact_id);
    CREATE INDEX IF NOT EXISTS idx_contact_patients_patient
      ON contact_patients(patient_id);
  `)

  for (const sql of [
    'ALTER TABLE conversations ADD COLUMN whatsapp_contact_id INTEGER',
    'ALTER TABLE appointments ADD COLUMN whatsapp_contact_id INTEGER',
    'ALTER TABLE whatsapp_identities ADD COLUMN whatsapp_contact_id INTEGER',
    'ALTER TABLE customers ADD COLUMN name_normalized TEXT',
    'ALTER TABLE customers ADD COLUMN created_via TEXT',
  ]) {
    try {
      db.exec(sql)
    } catch (error) {
      if (!/duplicate column/i.test(String(error?.message || error))) throw error
    }
  }

  // Phone is no longer a unique patient identity
  try {
    db.exec('DROP INDEX IF EXISTS idx_customers_phone')
  } catch { /* ignore */ }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number)')
  } catch { /* ignore */ }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_name_norm ON customers(name_normalized)')
  } catch { /* ignore */ }
}

/**
 * One-time backfill: existing customers + conversations → contacts + links.
 */
function migrateLegacyContactPatients(db) {
  ensureContactPatientSchema(db)

  // Backfill name_normalized
  const customers = db.prepare(`
    SELECT id, full_name FROM customers
    WHERE name_normalized IS NULL OR name_normalized = ''
  `).all()
  const updateNorm = db.prepare(`
    UPDATE customers SET name_normalized = ? WHERE id = ?
  `)
  for (const row of customers) {
    updateNorm.run(normalizePersonName(row.full_name), row.id)
  }

  // Each customer with a phone → contact + link (idempotent)
  const withPhone = db.prepare(`
    SELECT id, full_name, phone_number, whatsapp_chat_id FROM customers
    WHERE phone_number IS NOT NULL AND phone_number != ''
  `).all()

  for (const cust of withPhone) {
    const phone = toE164(cust.phone_number) || cust.phone_number
    const waId = cust.whatsapp_chat_id || null
    const contact = upsertWhatsAppContact(db, {
      whatsappId: waId,
      phoneE164: phone,
      displayName: cust.full_name,
    })
    linkContactPatient(db, contact.id, cust.id)
  }

  // Conversations → whatsapp_contact_id
  const convs = db.prepare(`
    SELECT id, external_key, phone_e164, customer_id
    FROM conversations
    WHERE whatsapp_contact_id IS NULL
  `).all()

  for (const conv of convs) {
    let phone = toE164(conv.phone_e164) || conv.phone_e164 || null
    let waId = conv.external_key || null
    let display = null
    if (!phone && conv.customer_id) {
      const cust = db.prepare('SELECT phone_number, whatsapp_chat_id, full_name FROM customers WHERE id = ?')
        .get(conv.customer_id)
      if (cust) {
        phone = toE164(cust.phone_number) || cust.phone_number
        waId = waId || cust.whatsapp_chat_id
        display = cust.full_name || null
      }
    }
    if (!phone && !waId) continue
    const contact = upsertWhatsAppContact(db, {
      whatsappId: waId,
      phoneE164: phone,
      displayName: display,
    })
    db.prepare(`
      UPDATE conversations SET whatsapp_contact_id = ? WHERE id = ?
    `).run(contact.id, conv.id)
    if (conv.customer_id) {
      linkContactPatient(db, contact.id, conv.customer_id)
    }
  }

  // Appointments → whatsapp_contact_id from customer link
  db.prepare(`
    UPDATE appointments
    SET whatsapp_contact_id = (
      SELECT cp.whatsapp_contact_id
      FROM contact_patients cp
      WHERE cp.patient_id = appointments.customer_id
      ORDER BY cp.id ASC
      LIMIT 1
    )
    WHERE whatsapp_contact_id IS NULL
      AND customer_id IS NOT NULL
  `).run()

  // Identities → contact
  const identities = db.prepare(`
    SELECT id, whatsapp_id, phone_e164, customer_id, push_name
    FROM whatsapp_identities
    WHERE whatsapp_contact_id IS NULL
  `).all()
  for (const idn of identities) {
    const contact = upsertWhatsAppContact(db, {
      whatsappId: idn.whatsapp_id,
      phoneE164: idn.phone_e164,
      displayName: idn.push_name,
    })
    db.prepare(`
      UPDATE whatsapp_identities SET whatsapp_contact_id = ? WHERE id = ?
    `).run(contact.id, idn.id)
    if (idn.customer_id) {
      linkContactPatient(db, contact.id, idn.customer_id)
    }
  }
}

function channelPhoneFromChat(whatsappId) {
  const raw = String(whatsappId || '').trim()
  if (!raw || /@lid/i.test(raw)) return null
  const digits = raw.replace(/^[^:]+:/, '').replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '')
  const e164 = toE164(digits)
  return e164 && isValidPhone(e164) ? e164 : null
}

function upsertWhatsAppContact(db, {
  whatsappId = null,
  phoneE164 = null,
  displayName = null,
} = {}) {
  const wa = String(whatsappId || '').trim() || null
  const phone = phoneE164 ? (toE164(phoneE164) || String(phoneE164).trim()) : null
  const display = String(displayName || '').trim() || null

  let row = null
  if (wa) {
    row = db.prepare('SELECT * FROM whatsapp_contacts WHERE whatsapp_id = ?').get(wa)
  }
  if (!row && phone) {
    row = db.prepare(`
      SELECT * FROM whatsapp_contacts
      WHERE phone_e164 = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(phone)
  }

  if (row) {
    db.prepare(`
      UPDATE whatsapp_contacts
      SET whatsapp_id = COALESCE(?, whatsapp_id),
          phone_e164 = COALESCE(?, phone_e164),
          display_name = COALESCE(?, display_name),
          updated_at = ?
      WHERE id = ?
    `).run(wa, phone, display, nowIso(), row.id)
    return db.prepare('SELECT * FROM whatsapp_contacts WHERE id = ?').get(row.id)
  }

  const result = db.prepare(`
    INSERT INTO whatsapp_contacts (whatsapp_id, phone_e164, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(wa, phone, display, nowIso(), nowIso())
  return db.prepare('SELECT * FROM whatsapp_contacts WHERE id = ?').get(result.lastInsertRowid)
}

function linkContactPatient(db, contactId, patientId, relationshipLabel = null) {
  if (!contactId || !patientId) return null
  db.prepare(`
    INSERT OR IGNORE INTO contact_patients (whatsapp_contact_id, patient_id, relationship_label, created_at)
    VALUES (?, ?, ?, ?)
  `).run(Number(contactId), Number(patientId), relationshipLabel, nowIso())
  return db.prepare(`
    SELECT * FROM contact_patients
    WHERE whatsapp_contact_id = ? AND patient_id = ?
  `).get(Number(contactId), Number(patientId))
}

function listPatientsForContact(db, contactId) {
  if (!contactId) return []
  return db.prepare(`
    SELECT c.*, cp.relationship_label, cp.created_at AS linked_at
    FROM contact_patients cp
    JOIN customers c ON c.id = cp.patient_id
    WHERE cp.whatsapp_contact_id = ?
    ORDER BY c.full_name ASC
  `).all(Number(contactId))
}

function findPatientsByContactAndName(db, contactId, fullName) {
  const norm = normalizePersonName(fullName)
  if (!contactId || !norm) return []
  return db.prepare(`
    SELECT c.*
    FROM contact_patients cp
    JOIN customers c ON c.id = cp.patient_id
    WHERE cp.whatsapp_contact_id = ?
      AND c.name_normalized = ?
    ORDER BY c.id ASC
  `).all(Number(contactId), norm)
}

/**
 * Resolve or create patient for a booking under a WhatsApp contact.
 * NEVER overwrites another patient's name because of shared phone.
 */
function resolvePatientForBooking(db, {
  contactId = null,
  patientId = null,
  forceNew = false,
  requireCollectedPhone = false,
  fullName,
  phoneNumber = null,
  city = null,
  whatsappChatId = null,
  createdVia = 'whatsapp_booking',
} = {}) {
  const safeName = validateFullName(fullName)
  if (!safeName) {
    throw new Error('Nom complet du patient invalide (prénom + nom requis)')
  }
  const phone = toE164(phoneNumber) || null
  const norm = normalizePersonName(safeName)

  let contact = contactId
    ? db.prepare('SELECT * FROM whatsapp_contacts WHERE id = ?').get(Number(contactId))
    : null

  const channelPhone = channelPhoneFromChat(whatsappChatId)
  if (!contact) {
    contact = upsertWhatsAppContact(db, {
      whatsappId: whatsappChatId,
      phoneE164: channelPhone || phone,
      displayName: null,
    })
  } else if (whatsappChatId || (channelPhone && !contact.phone_e164)) {
    contact = upsertWhatsAppContact(db, {
      whatsappId: whatsappChatId || contact.whatsapp_id,
      phoneE164: contact.phone_e164 || channelPhone,
      displayName: contact.display_name,
    })
  }

  const selectedId = patientId ? Number(patientId) : null
  if (selectedId && !forceNew) {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(selectedId)
    if (!existing) {
      throw new Error('Patient sélectionné introuvable')
    }
    db.prepare(`
      UPDATE customers
      SET city = COALESCE(?, city),
          whatsapp_chat_id = COALESCE(?, whatsapp_chat_id),
          last_contact_at = ?
      WHERE id = ?
    `).run(city || null, whatsappChatId || null, nowIso(), existing.id)
    linkContactPatient(db, contact.id, existing.id)
    return {
      contact,
      patient: db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id),
      created: false,
      reused: true,
    }
  }

  if (!forceNew) {
    const matches = findPatientsByContactAndName(db, contact.id, safeName)
    if (matches.length === 1) {
      const existing = matches[0]
      db.prepare(`
        UPDATE customers
        SET city = COALESCE(?, city),
            whatsapp_chat_id = COALESCE(?, whatsapp_chat_id),
            last_contact_at = ?
        WHERE id = ?
      `).run(city || null, whatsappChatId || null, nowIso(), existing.id)
      linkContactPatient(db, contact.id, existing.id)
      return {
        contact,
        patient: db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id),
        created: false,
        reused: true,
      }
    }
    if (matches.length > 1) {
      const existing = matches[0]
      linkContactPatient(db, contact.id, existing.id)
      return {
        contact,
        patient: existing,
        created: false,
        reused: true,
        ambiguousName: true,
      }
    }
  }

  const patientPhone = requireCollectedPhone || forceNew
    ? phone
    : (phone || contact.phone_e164)
  if (!patientPhone) {
    throw new Error(requireCollectedPhone || forceNew
      ? 'Téléphone du patient requis pour créer un nouveau patient'
      : 'Téléphone du contact WhatsApp requis pour créer un patient')
  }

  const result = db.prepare(`
    INSERT INTO customers (
      full_name, phone_number, city, whatsapp_chat_id, name_normalized,
      created_via, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'whatsapp', ?)
  `).run(
    safeName,
    patientPhone,
    city || null,
    whatsappChatId || contact.whatsapp_id || null,
    norm,
    createdVia,
    nowIso(),
  )
  const patient = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid)
  linkContactPatient(db, contact.id, patient.id)
  return { contact, patient, created: true, reused: false }
}

function findContactByWhatsAppOrPhone(db, { whatsappId = null, phone = null } = {}) {
  const wa = String(whatsappId || '').trim() || null
  const e164 = phone ? (toE164(phone) || String(phone).trim()) : null
  if (wa) {
    const byWa = db.prepare('SELECT * FROM whatsapp_contacts WHERE whatsapp_id = ?').get(wa)
    if (byWa) return byWa
  }
  if (e164) {
    return db.prepare(`
      SELECT * FROM whatsapp_contacts WHERE phone_e164 = ? ORDER BY id ASC LIMIT 1
    `).get(e164) || null
  }
  return null
}

function listPatientsReachableByPhone(db, phoneNumber) {
  const phone = toE164(phoneNumber)
  if (!phone) return []
  const contact = findContactByWhatsAppOrPhone(db, { phone })
  if (contact) {
    const linked = listPatientsForContact(db, contact.id)
    if (linked.length) return linked
  }
  // Fallback: direct phone match on customers (legacy rows)
  return db.prepare(`
    SELECT * FROM customers WHERE phone_number = ? ORDER BY id ASC
  `).all(phone)
}

function getContactForConversation(db, conversation) {
  if (!conversation) return null
  if (conversation.whatsapp_contact_id) {
    return db.prepare('SELECT * FROM whatsapp_contacts WHERE id = ?')
      .get(Number(conversation.whatsapp_contact_id))
  }
  return findContactByWhatsAppOrPhone(db, {
    whatsappId: conversation.external_key,
    phone: conversation.phone_e164,
  })
}

function enrichLinkedPatients(db, contactId) {
  const patients = listPatientsForContact(db, contactId)
  return patients.map((p) => {
    const next = db.prepare(`
      SELECT id, appointment_date, appointment_time, status
      FROM appointments
      WHERE customer_id = ?
        AND appointment_date >= date('now', 'localtime')
        AND status IN ('non_confirme', 'confirmed')
      ORDER BY appointment_date ASC, appointment_time ASC
      LIMIT 1
    `).get(p.id)
    return {
      id: p.id,
      full_name: p.full_name,
      phone_number: p.phone_number,
      phone_display: formatPhoneDisplay(p.phone_number),
      city: p.city,
      relationship_label: p.relationship_label || null,
      next_appointment: next
        ? {
          id: next.id,
          appointment_date: next.appointment_date,
          appointment_time: String(next.appointment_time || '').slice(0, 5),
          status: next.status,
        }
        : null,
    }
  })
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createContactPatientService(db) {
  migrateLegacyContactPatients(db)

  return {
    normalizePersonName,
    ensureContactPatientSchema,
    migrateLegacyContactPatients: () => migrateLegacyContactPatients(db),
    upsertWhatsAppContact: (input) => upsertWhatsAppContact(db, input),
    linkContactPatient: (contactId, patientId, label) => linkContactPatient(db, contactId, patientId, label),
    listPatientsForContact: (contactId) => listPatientsForContact(db, contactId),
    findPatientsByContactAndName: (contactId, name) => findPatientsByContactAndName(db, contactId, name),
    resolvePatientForBooking: (input) => resolvePatientForBooking(db, input),
    findContactByWhatsAppOrPhone: (input) => findContactByWhatsAppOrPhone(db, input),
    listPatientsReachableByPhone: (phone) => listPatientsReachableByPhone(db, phone),
    getContactForConversation: (conversation) => getContactForConversation(db, conversation),
    enrichLinkedPatients: (contactId) => enrichLinkedPatients(db, contactId),
  }
}

module.exports = {
  normalizePersonName,
  ensureContactPatientSchema,
  migrateLegacyContactPatients,
  channelPhoneFromChat,
  upsertWhatsAppContact,
  linkContactPatient,
  listPatientsForContact,
  findPatientsByContactAndName,
  resolvePatientForBooking,
  findContactByWhatsAppOrPhone,
  listPatientsReachableByPhone,
  getContactForConversation,
  enrichLinkedPatients,
  createContactPatientService,
  formatPhoneDisplay,
}
