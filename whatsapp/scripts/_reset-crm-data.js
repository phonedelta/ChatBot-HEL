/**
 * Wipe operational CRM data; keep dashboard users + clinic config seeds.
 * Usage: node scripts/_reset-crm-data.js
 */
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const root = path.join(__dirname, '..')
const dbPath = process.env.CRM_DB_PATH
  ? path.resolve(root, process.env.CRM_DB_PATH)
  : path.join(root, 'storage', 'crm.sqlite')

if (!fs.existsSync(dbPath)) {
  console.log('No DB at', dbPath, '— nothing to reset')
  process.exit(0)
}

const db = new DatabaseSync(dbPath)

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name)

console.log('DB:', dbPath)
console.log('Tables before:', tables.join(', '))

const KEEP = new Set([
  'dashboard_users',
  'dashboard_user_permissions',
  'clinic_settings',
  'automations',
  'integrations',
  'knowledge_items',
  'practitioners',
  'appointment_types',
])

const toClear = tables.filter((name) => !KEEP.has(name))

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
    console.log(`cleared ${name}: ${before} → 0`)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
db.exec('PRAGMA foreign_keys = ON')
db.exec('VACUUM')
db.close()

const aiPath = path.join(root, 'storage', 'ai-conversations.json')
if (fs.existsSync(aiPath)) {
  fs.writeFileSync(aiPath, '{}', 'utf8')
  console.log('cleared ai-conversations.json')
}

console.log('Reset OK — kept:', [...KEEP].filter((t) => tables.includes(t)).join(', '))
