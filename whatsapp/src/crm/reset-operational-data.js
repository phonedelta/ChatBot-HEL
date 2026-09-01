/**
 * Wipe operational CRM data; keep dashboard users + clinic config seeds.
 */
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const KEEP_TABLES = new Set([
  'dashboard_users',
  'dashboard_user_permissions',
  'clinic_settings',
  'automations',
  'integrations',
  'knowledge_items',
  'practitioners',
  'appointment_types',
])

function resolveDbPath(rootDir = process.cwd()) {
  return process.env.CRM_DB_PATH
    ? path.resolve(rootDir, process.env.CRM_DB_PATH)
    : path.join(rootDir, 'storage', 'crm.sqlite')
}

function resetOperationalCrmData(options = {}) {
  const rootDir = options.rootDir || process.cwd()
  const dbPath = resolveDbPath(rootDir)
  const clearMedia = Boolean(options.clearMedia)
  const clearAiHistory = options.clearAiHistory !== false
  const clearDashboardSessions = options.clearDashboardSessions !== false

  if (!fs.existsSync(dbPath)) {
    return {
      ok: true,
      dbPath,
      skipped: true,
      reason: 'database_missing',
      clearedTables: [],
    }
  }

  const db = new DatabaseSync(dbPath)
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name)

  const toClear = tables.filter((name) => !KEEP_TABLES.has(name))
  const clearedTables = []

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    for (const name of toClear) {
      const before = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c
      db.exec(`DELETE FROM "${name}"`)
      try {
        db.exec(`DELETE FROM sqlite_sequence WHERE name = '${name}'`)
      } catch {
        /* no autoincrement */
      }
      clearedTables.push({ table: name, rows: before })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('VACUUM')
  db.close()

  const extras = []

  if (clearAiHistory) {
    const aiPath = path.join(rootDir, 'storage', 'ai-conversations.json')
    if (fs.existsSync(aiPath)) {
      fs.writeFileSync(aiPath, '{}', 'utf8')
      extras.push('ai-conversations.json')
    }
  }

  if (clearDashboardSessions) {
    const sessionsPath = path.join(rootDir, 'storage', 'dashboard-sessions.json')
    if (fs.existsSync(sessionsPath)) {
      fs.writeFileSync(sessionsPath, '{}', 'utf8')
      extras.push('dashboard-sessions.json')
    }
  }

  if (clearMedia) {
    const mediaDir = process.env.CRM_MEDIA_DIR
      ? path.resolve(rootDir, process.env.CRM_MEDIA_DIR)
      : path.join(rootDir, 'storage', 'media')
    if (fs.existsSync(mediaDir)) {
      fs.rmSync(mediaDir, { recursive: true, force: true })
      fs.mkdirSync(mediaDir, { recursive: true })
      extras.push('storage/media')
    }
  }

  return {
    ok: true,
    dbPath,
    clearedTables,
    keptTables: tables.filter((name) => KEEP_TABLES.has(name)),
    extras,
  }
}

module.exports = {
  KEEP_TABLES,
  resetOperationalCrmData,
  resolveDbPath,
}
