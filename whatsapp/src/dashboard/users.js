/**
 * Dashboard users — SQLite persistence, migration, CRUD.
 */

const fs = require('fs')
const crypto = require('crypto')
const {
  sanitizePermissions,
  DEFAULT_SECRETARY_PERMISSIONS,
  roleLabel,
  hasPermission,
  PERMISSIONS,
} = require('./permissions')

const ROLES = new Set(['admin', 'secretary'])

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt)
  const left = Buffer.from(hash, 'hex')
  const right = Buffer.from(String(expectedHash || ''), 'hex')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} authFilePath
 */
function createDashboardUsers(db, authFilePath) {
  function ensureTables() {
    db.exec(`
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
    `)
    try { db.exec('ALTER TABLE dashboard_users ADD COLUMN deleted_at TEXT') } catch (e) {
      if (!/duplicate column name/i.test(String(e?.message || e))) throw e
    }
  }

  function loadLegacyAuthFile() {
    try {
      if (!fs.existsSync(authFilePath)) return null
      const parsed = JSON.parse(fs.readFileSync(authFilePath, 'utf8'))
      if (!parsed?.username || !parsed?.password_hash || !parsed?.password_salt) return null
      return parsed
    } catch {
      return null
    }
  }

  function seedLegacyAuthFile(username, password) {
    const dir = require('path').dirname(authFilePath)
    fs.mkdirSync(dir, { recursive: true })
    const seeded = hashPassword(password)
    const payload = {
      username,
      password_salt: seeded.salt,
      password_hash: seeded.hash,
      updated_at: new Date().toISOString(),
    }
    fs.writeFileSync(authFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return payload
  }

  function bootstrapFromLegacyAuth() {
    ensureTables()
    const existing = db.prepare('SELECT COUNT(*) AS c FROM dashboard_users').get()
    if (Number(existing?.c || 0) > 0) return null

    const defaultUsername = String(process.env.DASHBOARD_USERNAME || 'admin').trim() || 'admin'
    const defaultPassword = String(process.env.DASHBOARD_PASSWORD || 'HelDashboard2026')
    let legacy = loadLegacyAuthFile()
    if (!legacy) {
      legacy = seedLegacyAuthFile(defaultUsername, defaultPassword)
    }

    const displayName = legacy.username === 'admin' ? 'Admin' : legacy.username
    const row = db.prepare(`
      INSERT INTO dashboard_users (
        username, display_name, role, password_salt, password_hash, is_active, created_at, updated_at
      ) VALUES (?, ?, 'admin', ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      String(legacy.username).trim(),
      displayName,
      legacy.password_salt,
      legacy.password_hash,
    )

    return Number(row.lastInsertRowid)
  }

  function mapPublicUser(row) {
    if (!row) return null
    return {
      id: Number(row.id),
      displayName: row.display_name,
      role: row.role,
      initials: initialsFromName(row.display_name),
    }
  }

  function mapUser(row, permissions = []) {
    if (!row) return null
    return {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      roleLabel: roleLabel(row.role),
      isActive: Boolean(row.is_active),
      isPrimaryAdmin: isPrimaryAdmin(Number(row.id)),
      permissions: row.role === 'admin' ? [] : permissions,
      permissionCount: row.role === 'admin' ? null : permissions.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
      initials: initialsFromName(row.display_name),
    }
  }

  function getPermissions(userId) {
    return db.prepare(`
      SELECT permission FROM dashboard_user_permissions WHERE user_id = ?
    `).all(Number(userId)).map((r) => r.permission)
  }

  function setPermissions(userId, permissions, { useTransaction = true } = {}) {
    const uid = Number(userId)
    const clean = sanitizePermissions(permissions)
    const run = () => {
      db.prepare('DELETE FROM dashboard_user_permissions WHERE user_id = ?').run(uid)
      const insert = db.prepare(`
        INSERT INTO dashboard_user_permissions (user_id, permission) VALUES (?, ?)
      `)
      for (const perm of clean) insert.run(uid, perm)
      db.prepare(`UPDATE dashboard_users SET updated_at = datetime('now') WHERE id = ?`).run(uid)
    }
    if (useTransaction) {
      db.exec('BEGIN')
      try {
        run()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    } else {
      run()
    }
    return clean
  }

  function getUserById(id, { includeInactive = false } = {}) {
    const row = db.prepare('SELECT * FROM dashboard_users WHERE id = ?').get(Number(id))
    if (!row || isDeletedRow(row)) return null
    if (!includeInactive && !row.is_active) return null
    const perms = row.role === 'admin' ? [] : getPermissions(row.id)
    return mapUser(row, perms)
  }

  function getUserRowById(id) {
    return db.prepare('SELECT * FROM dashboard_users WHERE id = ?').get(Number(id)) || null
  }

  function getUserByUsername(username) {
    return db.prepare('SELECT * FROM dashboard_users WHERE username = ?').get(String(username || '').trim()) || null
  }

  function getPrimaryAdminId() {
    const row = db.prepare(`
      SELECT id FROM dashboard_users
      WHERE role = 'admin' AND deleted_at IS NULL
      ORDER BY id ASC LIMIT 1
    `).get()
    return row ? Number(row.id) : null
  }

  function isPrimaryAdmin(userId) {
    const primaryId = getPrimaryAdminId()
    return primaryId != null && Number(userId) === primaryId
  }

  function isDeletedRow(row) {
    return Boolean(row?.deleted_at)
  }

  function listActivePublicAccounts() {
    const rows = db.prepare(`
      SELECT id, display_name, role FROM dashboard_users
      WHERE is_active = 1 AND deleted_at IS NULL
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, display_name ASC
    `).all()
    return rows.map(mapPublicUser)
  }

  function listUsers() {
    const rows = db.prepare(`
      SELECT * FROM dashboard_users
      WHERE deleted_at IS NULL
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, display_name ASC
    `).all()
    return rows.map((row) => {
      const perms = row.role === 'admin' ? [] : getPermissions(row.id)
      return mapUser(row, perms)
    })
  }

  function countActiveAdmins(excludeUserId = null) {
    const row = db.prepare(`
      SELECT COUNT(*) AS c FROM dashboard_users
      WHERE role = 'admin' AND is_active = 1 AND deleted_at IS NULL
      ${excludeUserId ? 'AND id != ?' : ''}
    `).get(...(excludeUserId ? [Number(excludeUserId)] : []))
    return Number(row?.c || 0)
  }

  function assertAdminProtected(userId, patch = {}) {
    const row = getUserRowById(userId)
    if (!row || isDeletedRow(row)) {
      const error = new Error('Utilisateur introuvable')
      error.code = 'NOT_FOUND'
      throw error
    }
    if (row.role !== 'admin') return row

    const willDeactivate = patch.isActive === false || patch.is_active === 0
    const willDemote = patch.role && String(patch.role).toLowerCase() !== 'admin'
    if (willDeactivate || willDemote) {
      const others = countActiveAdmins(row.id)
      if (others === 0) {
        const error = new Error('Impossible de modifier le dernier administrateur actif.')
        error.code = 'ADMIN_PROTECTED'
        throw error
      }
    }
    return row
  }

  function createUser({
    username,
    displayName,
    role = 'secretary',
    password,
    isActive = true,
    permissions = DEFAULT_SECRETARY_PERMISSIONS,
    createdBy = null,
  }) {
    const uname = String(username || '').trim().toLowerCase()
    const dname = String(displayName || '').trim()
    const r = String(role || 'secretary').toLowerCase()

    if (!uname || !dname) {
      const error = new Error('Nom affiché et identifiant requis.')
      error.code = 'VALIDATION'
      throw error
    }
    if (!ROLES.has(r) || r === 'admin') {
      const error = new Error('Rôle invalide.')
      error.code = 'VALIDATION'
      throw error
    }
    const pass = String(password || '')
    if (pass.length < 8) {
      const error = new Error('Le mot de passe doit contenir au moins 8 caractères.')
      error.code = 'WEAK_PASSWORD'
      throw error
    }
    if (getUserByUsername(uname)) {
      const error = new Error('Cet identifiant est déjà utilisé.')
      error.code = 'DUPLICATE'
      throw error
    }

    const hashed = hashPassword(pass)
    db.exec('BEGIN')
    try {
      const result = db.prepare(`
        INSERT INTO dashboard_users (
          username, display_name, role, password_salt, password_hash, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(uname, dname, r, hashed.salt, hashed.hash, isActive ? 1 : 0, createdBy ? Number(createdBy) : null)
      const userId = Number(result.lastInsertRowid)
      setPermissions(userId, permissions, { useTransaction: false })
      db.exec('COMMIT')
      return getUserById(userId, { includeInactive: true })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function updateUser(userId, patch = {}) {
    const row = assertAdminProtected(userId, patch)
    if (row.role === 'admin' && patch.role && String(patch.role).toLowerCase() !== 'admin') {
      assertAdminProtected(userId, { role: 'secretary' })
    }

    const fields = []
    const params = []

    if (patch.displayName != null) {
      fields.push('display_name = ?')
      params.push(String(patch.displayName).trim())
    }
    if (patch.isActive != null) {
      fields.push('is_active = ?')
      params.push(patch.isActive ? 1 : 0)
    }
    if (fields.length) {
      fields.push('updated_at = datetime(\'now\')')
      params.push(Number(userId))
      db.prepare(`UPDATE dashboard_users SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    }

    if (patch.permissions != null && row.role !== 'admin') {
      setPermissions(userId, patch.permissions)
    }

    return getUserById(userId, { includeInactive: true })
  }

  function resetPassword(userId, newPassword, { actorId = null, allowSelf = false } = {}) {
    const row = getUserRowById(userId)
    if (!row) {
      const error = new Error('Utilisateur introuvable')
      error.code = 'NOT_FOUND'
      throw error
    }
    if (!allowSelf && actorId && Number(actorId) === Number(userId)) {
      const error = new Error('Utilisez le changement de mot de passe pour modifier le vôtre.')
      error.code = 'VALIDATION'
      throw error
    }
    const pass = String(newPassword || '')
    if (pass.length < 8) {
      const error = new Error('Le mot de passe doit contenir au moins 8 caractères.')
      error.code = 'WEAK_PASSWORD'
      throw error
    }
    const hashed = hashPassword(pass)
    db.prepare(`
      UPDATE dashboard_users
      SET password_salt = ?, password_hash = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(hashed.salt, hashed.hash, Number(userId))
    return { ok: true }
  }

  function changeOwnPassword(userId, currentPassword, newPassword) {
    const row = getUserRowById(userId)
    if (!row || !row.is_active) {
      const error = new Error('Session invalide')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }
    if (!verifyPassword(currentPassword, row.password_salt, row.password_hash)) {
      const error = new Error('Mot de passe actuel incorrect')
      error.code = 'AUTH_FAILED'
      throw error
    }
    const pass = String(newPassword || '')
    if (verifyPassword(pass, row.password_salt, row.password_hash)) {
      const error = new Error('Le nouveau mot de passe doit être différent de l’ancien.')
      error.code = 'VALIDATION'
      throw error
    }
    return resetPassword(userId, newPassword, { allowSelf: true })
  }

  function deleteUser(userId) {
    const row = getUserRowById(userId)
    if (!row || isDeletedRow(row)) {
      const error = new Error('Utilisateur introuvable')
      error.code = 'NOT_FOUND'
      throw error
    }
    if (isPrimaryAdmin(userId)) {
      const error = new Error('Le compte administrateur principal ne peut pas être supprimé.')
      error.code = 'ADMIN_PROTECTED'
      throw error
    }
    if (row.role === 'admin' && countActiveAdmins(row.id) === 0) {
      const error = new Error('Impossible de supprimer le dernier administrateur actif.')
      error.code = 'ADMIN_PROTECTED'
      throw error
    }

    db.prepare(`
      UPDATE dashboard_users
      SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(Number(userId))

    const perms = row.role === 'admin' ? [] : getPermissions(row.id)
    return mapUser({ ...row, deleted_at: new Date().toISOString(), is_active: 0 }, perms)
  }

  function authenticate({ accountId = null, username = null, password = null }) {
    let row = null
    if (accountId) {
      row = getUserRowById(Number(accountId))
    } else if (username) {
      row = getUserByUsername(username)
    }
    if (!row) {
      const error = new Error('Impossible de vous connecter avec ce compte.')
      error.code = 'AUTH_FAILED'
      throw error
    }
    if (isDeletedRow(row)) {
      const error = new Error('Ce compte n’existe plus.')
      error.code = 'AUTH_FAILED'
      throw error
    }
    if (!row.is_active) {
      const error = new Error('Ce compte est désactivé.')
      error.code = 'AUTH_DISABLED'
      throw error
    }
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      const error = new Error('Mot de passe incorrect.')
      error.code = 'AUTH_FAILED'
      throw error
    }
    db.prepare(`UPDATE dashboard_users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id)
    const perms = row.role === 'admin' ? [] : getPermissions(row.id)
    return mapUser(row, perms)
  }

  function resolveSessionUser(userId) {
    const row = getUserRowById(userId)
    if (!row || isDeletedRow(row) || !row.is_active) return null
    const user = getUserById(userId, { includeInactive: true })
    if (!user) return null
    if (user.role === 'admin') {
      return { ...user, permissions: require('./permissions').ALL_PERMISSION_KEYS }
    }
    return user
  }

  ensureTables()
  bootstrapFromLegacyAuth()

  return {
    hashPassword,
    verifyPassword,
    bootstrapFromLegacyAuth,
    listActivePublicAccounts,
    listUsers,
    getUserById,
    getUserRowById,
    createUser,
    updateUser,
    resetPassword,
    changeOwnPassword,
    deleteUser,
    authenticate,
    resolveSessionUser,
    setPermissions,
    getPermissions,
    countActiveAdmins,
    assertAdminProtected,
    isPrimaryAdmin,
    getPrimaryAdminId,
    roleLabel,
    hasPermission,
  }
}

module.exports = {
  createDashboardUsers,
  hashPassword,
  verifyPassword,
  initialsFromName,
}
