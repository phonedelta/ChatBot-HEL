/**
 * Simple dashboard authentication (login + password change).
 * Credentials stored in storage/dashboard-auth.json with scrypt hashes.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DEFAULT_USERNAME = 'admin'
const DEFAULT_PASSWORD = 'HelDashboard2026'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/**
 * @param {string} authFilePath
 */
function createDashboardAuth(authFilePath) {
  const sessions = new Map()

  function ensureAuthFile() {
    const dir = path.dirname(authFilePath)
    fs.mkdirSync(dir, { recursive: true })

    if (!fs.existsSync(authFilePath)) {
      const seeded = hashPassword(
        String(process.env.DASHBOARD_PASSWORD || DEFAULT_PASSWORD),
      )
      const payload = {
        username: String(process.env.DASHBOARD_USERNAME || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME,
        password_salt: seeded.salt,
        password_hash: seeded.hash,
        updated_at: new Date().toISOString(),
      }
      fs.writeFileSync(authFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      return payload
    }

    return loadAuthFile()
  }

  function loadAuthFile() {
    try {
      const raw = fs.readFileSync(authFilePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed?.username || !parsed?.password_hash || !parsed?.password_salt) {
        throw new Error('invalid_auth_file')
      }
      return parsed
    } catch {
      fs.rmSync(authFilePath, { force: true })
      return ensureAuthFile()
    }
  }

  function saveAuthFile(payload) {
    const tmp = `${authFilePath}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, authFilePath)
  }

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex')
    return { salt, hash }
  }

  function verifyPassword(password, salt, expectedHash) {
    const { hash } = hashPassword(password, salt)
    const left = Buffer.from(hash, 'hex')
    const right = Buffer.from(String(expectedHash || ''), 'hex')
    if (left.length !== right.length) {
      return false
    }
    return crypto.timingSafeEqual(left, right)
  }

  function pruneSessions() {
    const now = Date.now()
    for (const [token, session] of sessions.entries()) {
      if (!session?.expiresAt || session.expiresAt <= now) {
        sessions.delete(token)
      }
    }
  }

  function createSession(username) {
    pruneSessions()
    const token = crypto.randomBytes(32).toString('hex')
    const session = {
      token,
      username,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    }
    sessions.set(token, session)
    return session
  }

  function getSession(token) {
    pruneSessions()
    const session = sessions.get(String(token || '').trim())
    if (!session) {
      return null
    }
    if (session.expiresAt <= Date.now()) {
      sessions.delete(session.token)
      return null
    }
    return session
  }

  function destroySession(token) {
    sessions.delete(String(token || '').trim())
  }

  function login(username, password) {
    const auth = ensureAuthFile()
    const inputUser = String(username || '').trim()
    const inputPass = String(password || '')

    if (!inputUser || !inputPass) {
      const error = new Error('Identifiant ou mot de passe manquant')
      error.code = 'AUTH_INVALID'
      throw error
    }

    if (inputUser !== auth.username || !verifyPassword(inputPass, auth.password_salt, auth.password_hash)) {
      const error = new Error('Identifiant ou mot de passe incorrect')
      error.code = 'AUTH_FAILED'
      throw error
    }

    return createSession(auth.username)
  }

  function changePassword(username, currentPassword, newPassword) {
    const auth = ensureAuthFile()
    if (String(username || '').trim() !== auth.username) {
      const error = new Error('Session invalide')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }

    if (!verifyPassword(currentPassword, auth.password_salt, auth.password_hash)) {
      const error = new Error('Mot de passe actuel incorrect')
      error.code = 'AUTH_FAILED'
      throw error
    }

    const nextPassword = String(newPassword || '')
    if (nextPassword.length < 8) {
      const error = new Error('Le nouveau mot de passe doit contenir au moins 8 caractères')
      error.code = 'AUTH_WEAK_PASSWORD'
      throw error
    }

    const hashed = hashPassword(nextPassword)
    const next = {
      ...auth,
      password_salt: hashed.salt,
      password_hash: hashed.hash,
      updated_at: new Date().toISOString(),
    }
    saveAuthFile(next)
    return { ok: true, username: next.username }
  }

  ensureAuthFile()

  return {
    login,
    changePassword,
    getSession,
    destroySession,
    ensureAuthFile,
  }
}

module.exports = {
  createDashboardAuth,
  DEFAULT_USERNAME,
  DEFAULT_PASSWORD,
}
