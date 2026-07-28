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

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
