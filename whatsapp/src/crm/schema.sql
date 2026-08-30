-- Centre Dentaire HEL — CRM schema (SQLite)
-- Relations: customers 1—N dental_cases, customers 1—N appointments

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  city TEXT,
  whatsapp_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone
  ON customers(phone_number);

CREATE INDEX IF NOT EXISTS idx_customers_name
  ON customers(full_name);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'non_confirme',
  conversation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointments_date
  ON appointments(appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS idx_appointments_customer
  ON appointments(customer_id);

CREATE TABLE IF NOT EXISTS dental_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  appointment_id INTEGER,
  problem TEXT NOT NULL,
  description TEXT,
  urgency TEXT NOT NULL DEFAULT 'moyenne',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dental_cases_customer
  ON dental_cases(customer_id);

CREATE INDEX IF NOT EXISTS idx_dental_cases_problem
  ON dental_cases(problem);

CREATE TABLE IF NOT EXISTS conversation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  whatsapp_chat_id TEXT,
  customer_id INTEGER,
  direction TEXT NOT NULL,
  message_text TEXT,
  extracted_json TEXT,
  appointment_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_conversation
  ON conversation_logs(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS staff_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_json TEXT,
  sent_whatsapp INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS crm_leads (
  conversation_id TEXT PRIMARY KEY,
  whatsapp_chat_id TEXT,
  phone_number TEXT,
  full_name TEXT,
  city TEXT,
  problem TEXT,
  problem_details TEXT,
  urgency TEXT DEFAULT 'moyenne',
  appointment_date TEXT,
  appointment_time TEXT,
  stage TEXT NOT NULL DEFAULT 'discovery',
  awaiting_field TEXT,
  language TEXT DEFAULT 'fr',
  booking_intent INTEGER NOT NULL DEFAULT 0,
  selected_patient_id INTEGER,
  booking_target TEXT,
  pending_duplicate_patient_id INTEGER,
  allow_duplicate_name INTEGER NOT NULL DEFAULT 0,
  correction_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Smart Mini CRM IA — additive tables (non-destructive)
-- =============================================================================

CREATE TABLE IF NOT EXISTS clinic_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'TO_PROCESS',
  owner TEXT NOT NULL DEFAULT 'AI',
  owner_user TEXT,
  language TEXT DEFAULT 'fr',
  last_message_preview TEXT,
  last_message_at TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  next_action TEXT,
  phone_e164 TEXT,
  whatsapp_lid TEXT,
  candidate_language TEXT,
  candidate_language_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_status
  ON conversations(status, last_message_at);

CREATE INDEX IF NOT EXISTS idx_conversations_customer
  ON conversations(customer_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_name TEXT,
  body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  external_message_id TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_filename TEXT,
  media_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id
  ON messages(external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  conversation_id INTEGER,
  appointment_id INTEGER,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_name TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_customer
  ON timeline_events(customer_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  appointment_id INTEGER,
  conversation_id INTEGER,
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'planned',
  due_at TEXT,
  owner_user TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due
  ON tasks(status, due_at);

CREATE TABLE IF NOT EXISTS waiting_list_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  practitioner_id INTEGER,
  appointment_type TEXT,
  preferred_date_from TEXT,
  preferred_date_to TEXT,
  preferred_time_ranges TEXT,
  priority TEXT NOT NULL DEFAULT 'normale',
  current_appointment_id INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status
  ON waiting_list_entries(status, priority);

CREATE TABLE IF NOT EXISTS waiting_list_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waiting_list_id INTEGER NOT NULL,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  offer_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  locked_until TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  FOREIGN KEY (waiting_list_id) REFERENCES waiting_list_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  customer_id INTEGER,
  action_type TEXT NOT NULL,
  reason TEXT,
  result TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  source TEXT DEFAULT 'automation',
  actor_type TEXT DEFAULT 'ai',
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_actions_created
  ON ai_actions(created_at);

CREATE TABLE IF NOT EXISTS activity_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  actor_name TEXT,
  actor_user_id INTEGER,
  actor_role TEXT,
  actor_display_name TEXT,
  source TEXT DEFAULT 'crm',
  patient_id INTEGER,
  conversation_id INTEGER,
  appointment_id INTEGER,
  task_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  old_value_json TEXT,
  new_value_json TEXT,
  metadata_json TEXT,
  source_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_history_created ON activity_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_category ON activity_history(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_actor ON activity_history(actor_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_actor_user ON activity_history(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_patient ON activity_history(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_conversation ON activity_history(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_appointment ON activity_history(appointment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_severity ON activity_history(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_event_type ON activity_history(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  action_type TEXT NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL,
  unique_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(automation_id, unique_key),
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS practitioners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  specialty TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT,
  status TEXT NOT NULL DEFAULT 'empty',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, key)
);

CREATE TABLE IF NOT EXISTS patient_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(customer_id, tag),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_configuration',
  is_source_of_truth INTEGER NOT NULL DEFAULT 0,
  synced_entities TEXT,
  last_sync_at TEXT,
  config_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(read_at, created_at);

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

-- WhatsApp contact (channel) ≠ many patients (beneficiaries)
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

-- Dashboard users (multi-user auth — separate from patients/customers)
CREATE TABLE IF NOT EXISTS dashboard_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'secretary',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  created_by INTEGER,
  deleted_at TEXT,
  FOREIGN KEY (created_by) REFERENCES dashboard_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_active ON dashboard_users(is_active);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users(role);

CREATE TABLE IF NOT EXISTS dashboard_user_permissions (
  user_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission),
  FOREIGN KEY (user_id) REFERENCES dashboard_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dashboard_user_permissions_user ON dashboard_user_permissions(user_id);

