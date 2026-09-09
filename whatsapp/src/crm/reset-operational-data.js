/**
 * Reset operational data through explicit allowlists.
 * WhatsApp LocalAuth, dashboard sessions, users and clinic configuration are never touched.
 */
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const RESET_TABLES = Object.freeze([
  'waiting_list_offers',
  'appointment_confirmation_requests',
  'slot_proposals',
  'contact_patients',
  'patient_notes',
  'patient_tags',
  'dental_cases',
  'staff_notifications',
  'tasks',
  'messages',
  'conversation_logs',
  'timeline_events',
  'activity_history',
  'notifications',
  'automation_runs',
  'ai_actions',
  'appointment_cancel_requests',
  'appointment_confirmation_chat_state',
  'availability_chat_state',
  'crm_leads',
  'waiting_list_entries',
  'appointments',
  'conversations',
  'whatsapp_identities',
  'customers',
  'whatsapp_contacts',
])

const PRESERVE_TABLES = Object.freeze([
  'dashboard_users',
  'dashboard_user_permissions',
  'clinic_settings',
  'automations',
  'integrations',
  'knowledge_items',
  'practitioners',
  'appointment_types',
])

const KEEP_TABLES = new Set(PRESERVE_TABLES)
const RESET_CONFIRMATION = 'RESET HEL'

function resolveDbPath(rootDir = process.cwd()) {
  return process.env.CRM_DB_PATH
    ? path.resolve(rootDir, process.env.CRM_DB_PATH)
    : path.join(rootDir, 'storage', 'crm.sqlite')
}

function resolvedProtectedPaths(rootDir) {
  const configured = process.env.WA_SESSION_PATH
    ? path.resolve(rootDir, process.env.WA_SESSION_PATH)
    : path.join(rootDir, 'storage', 'wa-auth')
  return [
    configured,
    path.join(rootDir, 'storage', 'sessions'),
    path.join(rootDir, 'storage', 'wa-auth'),
    path.join(rootDir, 'wa-auth'),
    path.join(rootDir, '.whatsapp_auth'),
  ].map((item) => path.resolve(item))
}

function assertNotWhatsappPath(targetPath, rootDir) {
  const target = path.resolve(targetPath)
  for (const protectedPath of resolvedProtectedPaths(rootDir)) {
    if (
      target === protectedPath
      || target.startsWith(`${protectedPath}${path.sep}`)
      || protectedPath.startsWith(`${target}${path.sep}`)
    ) {
      const error = new Error('Refusing to modify WhatsApp authentication storage')
      error.code = 'WHATSAPP_SESSION_PROTECTED'
      throw error
    }
  }
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tempPath, filePath)
}

function clearDirectoryContents(directoryPath, rootDir) {
  assertNotWhatsappPath(directoryPath, rootDir)
  if (!fs.existsSync(directoryPath)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    fs.rmSync(path.join(directoryPath, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function createDatabaseBackup(db, rootDir, options = {}) {
  if (options.createBackup === false) return null
  const backupDir = path.join(rootDir, 'storage', 'backups')
  assertNotWhatsappPath(backupDir, rootDir)
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `crm-before-reset-${stamp}.sqlite`)
  db.exec(`VACUUM INTO ${sqlString(backupPath)}`)

  const keep = Math.max(1, Number(options.backupRetention || 5))
  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^crm-before-reset-.*\.sqlite$/i.test(name))
    .sort()
    .reverse()
  for (const stale of backups.slice(keep)) {
    fs.unlinkSync(path.join(backupDir, stale))
  }
  return backupPath
}

function assertSchemaClassified(tables) {
  const reset = new Set(RESET_TABLES)
  const preserve = new Set(PRESERVE_TABLES)
  const unclassified = tables.filter((name) => !reset.has(name) && !preserve.has(name))
  if (unclassified.length) {
    const error = new Error(`Reset refused: unclassified tables: ${unclassified.join(', ')}`)
    error.code = 'RESET_SCHEMA_UNCLASSIFIED'
    error.tables = unclassified
    throw error
  }
}

function insertResetAudit(db, actor = {}) {
  const displayName = String(actor.displayName || actor.username || 'Administrateur').slice(0, 120)
  const role = String(actor.role || 'admin').slice(0, 40)
  const actorUserId = Number(actor.userId || actor.id || 0) || null
  db.prepare(`
    INSERT INTO activity_history (
      event_type, category, actor_type, actor_name, actor_user_id,
      actor_role, actor_display_name, source, title, description,
      severity, source_event_id, created_at, origin
    ) VALUES (
      'platform_reset', 'system', 'dashboard_user', ?, ?,
      ?, ?, 'dashboard', 'Plateforme réinitialisée',
      'Les données opérationnelles ont été supprimées. La session WhatsApp et la configuration ont été conservées.',
      'warning', ?, datetime('now'), 'dashboard'
    )
  `).run(
    displayName,
    actorUserId,
    role,
    displayName,
    `platform-reset:${Date.now()}`,
  )
}

function resetOperationalCrmData(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd())
  const dbPath = resolveDbPath(rootDir)
  const ownsDatabase = !options.db
  if (!options.db && !fs.existsSync(dbPath)) {
    return {
      ok: true,
      skipped: true,
      reason: 'database_missing',
      clearedTables: [],
      keptTables: [],
      extras: [],
    }
  }

  const db = options.db || new DatabaseSync(dbPath)
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name)
  assertSchemaClassified(tables)
  const backupPath = createDatabaseBackup(db, rootDir, options)
  const existing = new Set(tables)
  const clearedTables = []

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const name of RESET_TABLES) {
      if (!existing.has(name)) continue
      const rows = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count || 0)
      db.exec(`DELETE FROM "${name}"`)
      clearedTables.push({ table: name, rows })
      if (options.failAfterTable === name) {
        throw new Error(`Injected reset failure after ${name}`)
      }
    }
    if (existing.has('sqlite_sequence')) {
      const resetSequence = db.prepare('DELETE FROM sqlite_sequence WHERE name = ?')
      for (const name of RESET_TABLES) resetSequence.run(name)
    } else {
      try {
        const resetSequence = db.prepare('DELETE FROM sqlite_sequence WHERE name = ?')
        for (const name of RESET_TABLES) resetSequence.run(name)
      } catch {
        // Database has no AUTOINCREMENT sequence table.
      }
    }
    if (existing.has('activity_history') && options.recordResetAudit !== false) {
      insertResetAudit(db, options.actor)
    }
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeyErrors.length) {
      const error = new Error('Foreign key validation failed during reset')
      error.code = 'RESET_FOREIGN_KEY_ERROR'
      throw error
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* transaction already closed */ }
    if (ownsDatabase) db.close()
    throw error
  }

  const extras = []
  const warnings = []
  const resetFile = (label, action) => {
    try {
      action()
      extras.push(label)
    } catch (error) {
      warnings.push({ target: label, code: error.code || 'RESET_FILE_ERROR' })
    }
  }

  if (options.clearAiHistory !== false) {
    const aiPath = options.aiHistoryPath || path.join(rootDir, 'storage', 'ai-conversations.json')
    assertNotWhatsappPath(aiPath, rootDir)
    resetFile('ai-conversations.json', () => writeJsonAtomically(aiPath, {}))
  }
  if (options.clearMedia !== false) {
    const mediaDir = options.mediaDir
      || process.env.CRM_MEDIA_DIR
      || path.join(rootDir, 'storage', 'media')
    resetFile('storage/media', () => clearDirectoryContents(path.resolve(rootDir, mediaDir), rootDir))
  }
  if (options.clearVoiceLogs !== false) {
    const voiceLogs = options.voiceLogDir || path.join(rootDir, 'storage', 'voice-nlu-logs')
    resetFile('storage/voice-nlu-logs', () => clearDirectoryContents(voiceLogs, rootDir))
  }
  if (options.clearTempUploads !== false) {
    resetFile('storage/tmp-uploads', () => clearDirectoryContents(
      path.join(rootDir, 'storage', 'tmp-uploads'),
      rootDir,
    ))
  }

  if (ownsDatabase) db.close()
  return {
    ok: true,
    dbPath,
    clearedTables,
    keptTables: tables.filter((name) => KEEP_TABLES.has(name)),
    extras,
    warnings,
    backupFile: backupPath ? path.basename(backupPath) : null,
    whatsappSessionPreserved: true,
    dashboardSessionsPreserved: true,
  }
}

module.exports = {
  KEEP_TABLES,
  PRESERVE_TABLES,
  RESET_CONFIRMATION,
  RESET_TABLES,
  assertNotWhatsappPath,
  assertSchemaClassified,
  resetOperationalCrmData,
  resolveDbPath,
  resolvedProtectedPaths,
}
