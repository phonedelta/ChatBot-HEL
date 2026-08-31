/**
 * SQLite persistence for the dental CRM (Node built-in node:sqlite).
 */

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { migrateLegacyContactPatients } = require('./contact-patients')

/**
 * Add columns on existing databases before schema.sql indexes reference them.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function preMigrateExistingTables(db) {
  const activityHistory = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'activity_history'",
  ).get()
  if (activityHistory) {
    for (const sql of [
      'ALTER TABLE activity_history ADD COLUMN actor_user_id INTEGER',
      'ALTER TABLE activity_history ADD COLUMN actor_role TEXT',
      'ALTER TABLE activity_history ADD COLUMN actor_display_name TEXT',
    ]) {
      try {
        db.exec(sql)
      } catch (error) {
        const msg = String(error?.message || error || '')
        if (!/duplicate column name/i.test(msg)) throw error
      }
    }
  }

  const dashboardUsers = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_users'",
  ).get()
  if (dashboardUsers) {
    try {
      db.exec('ALTER TABLE dashboard_users ADD COLUMN deleted_at TEXT')
    } catch (error) {
      const msg = String(error?.message || error || '')
      if (!/duplicate column name/i.test(msg)) throw error
    }
  }
}

/**
 * Additive column migrations — safe to re-run (ignores duplicate column errors).
 * @param {import('node:sqlite').DatabaseSync} db
 */
function migrateSchemaColumns(db) {
  const alterations = [
    'ALTER TABLE appointments ADD COLUMN practitioner_id INTEGER',
    'ALTER TABLE appointments ADD COLUMN appointment_type TEXT',
    'ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER DEFAULT 30',
    'ALTER TABLE customers ADD COLUMN preferred_language TEXT DEFAULT \'fr\'',
    'ALTER TABLE customers ADD COLUMN preferred_channel TEXT DEFAULT \'whatsapp\'',
    'ALTER TABLE customers ADD COLUMN source TEXT DEFAULT \'whatsapp\'',
    'ALTER TABLE customers ADD COLUMN last_contact_at TEXT',
    'ALTER TABLE conversations ADD COLUMN phone_e164 TEXT',
    'ALTER TABLE conversations ADD COLUMN whatsapp_lid TEXT',
    'ALTER TABLE conversations ADD COLUMN candidate_language TEXT',
    'ALTER TABLE conversations ADD COLUMN candidate_language_count INTEGER DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN media_path TEXT',
    'ALTER TABLE messages ADD COLUMN media_mime TEXT',
    'ALTER TABLE messages ADD COLUMN media_filename TEXT',
    'ALTER TABLE messages ADD COLUMN media_size INTEGER',
    'ALTER TABLE appointments ADD COLUMN confirmed_at TEXT',
    'ALTER TABLE appointments ADD COLUMN confirmation_source TEXT',
    'ALTER TABLE appointments ADD COLUMN cancelled_at TEXT',
    'ALTER TABLE appointments ADD COLUMN updated_at TEXT',
    'ALTER TABLE notifications ADD COLUMN unique_key TEXT',
    'ALTER TABLE notifications ADD COLUMN slot_date TEXT',
    'ALTER TABLE notifications ADD COLUMN slot_time TEXT',
    'ALTER TABLE notifications ADD COLUMN appointment_id INTEGER',
    'ALTER TABLE notifications ADD COLUMN source_event TEXT',
    'ALTER TABLE notifications ADD COLUMN metadata_json TEXT',
    'ALTER TABLE crm_leads ADD COLUMN selected_patient_id INTEGER',
    'ALTER TABLE crm_leads ADD COLUMN booking_target TEXT',
    'ALTER TABLE crm_leads ADD COLUMN pending_duplicate_patient_id INTEGER',
    'ALTER TABLE crm_leads ADD COLUMN allow_duplicate_name INTEGER DEFAULT 0',
    'ALTER TABLE crm_leads ADD COLUMN correction_json TEXT',
  ]

  for (const sql of alterations) {
    try {
      db.exec(sql)
    } catch (error) {
      const msg = String(error?.message || error || '')
      if (!/duplicate column name/i.test(msg)) {
        throw error
      }
    }
  }

  // Persistent WhatsApp identity ↔ phone / customer mapping (never invent phones from @lid)
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_id TEXT NOT NULL UNIQUE,
      whatsapp_lid TEXT,
      customer_id INTEGER,
      phone_e164 TEXT,
      push_name TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wa_identities_phone ON whatsapp_identities(phone_e164);
    CREATE INDEX IF NOT EXISTS idx_wa_identities_customer ON whatsapp_identities(customer_id);
    CREATE INDEX IF NOT EXISTS idx_wa_identities_lid ON whatsapp_identities(whatsapp_lid);
  `)

  // Multi-patient per WhatsApp contact (non-destructive)
  migrateLegacyContactPatients(db)

  // One active booking per exact date+time (race-condition safety net).
  // Overlapping durations are still enforced in appointment-slots.js.
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_slot
      ON appointments(appointment_date, appointment_time)
      WHERE status IN ('non_confirme', 'pending_confirmation', 'confirmed')
    `)
  } catch (error) {
    const msg = String(error?.message || error || '')
    if (!/already exists/i.test(msg)) {
      console.warn('[crm] idx_appointments_active_slot skipped:', msg)
    }
  }
}

/**
 * @param {string} dbPath
 * @returns {DatabaseSync}
 */
function openCrmDatabase(dbPath) {
  const absolute = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })

  const db = new DatabaseSync(absolute)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')

  const schemaPath = path.join(__dirname, 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  preMigrateExistingTables(db)
  db.exec(schema)
  migrateSchemaColumns(db)

  return db
}

module.exports = {
  openCrmDatabase,
  migrateSchemaColumns,
  preMigrateExistingTables,
}
