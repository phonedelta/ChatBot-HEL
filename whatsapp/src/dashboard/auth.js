/**
 * Dashboard authentication — sessions + login (multi-user).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/**
 * @param {{
 *   users: ReturnType<import('./users').createDashboardUsers>,
 *   sessionsPath?: string,
 * }} deps
 */
function createDashboardAuth(deps) {
  const { users, getSessionTtlMs = null } = deps
  const sessionsPath = deps.sessionsPath
    || path.join(process.cwd(), 'storage', 'dashboard-sessions.json')
  const sessions = new Map()

  function loadSessionsFromDisk() {
    try {
      if (!fs.existsSync(sessionsPath)) return
      const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))
      const list = Array.isArray(raw?.sessions) ? raw.sessions : []
      const now = Date.now()
      for (const item of list) {
        if (!item?.token || !item?.userId || !item?.expiresAt) continue
        if (Number(item.expiresAt) <= now) continue
        sessions.set(String(item.token), {
          token: String(item.token),
          userId: Number(item.userId),
          username: String(item.username || ''),
          displayName: String(item.displayName || ''),
          role: String(item.role || ''),
          createdAt: Number(item.createdAt) || now,
          expiresAt: Number(item.expiresAt),
        })
      }
    } catch {
      /* ignore corrupt session store */
    }
  }

  function saveSessionsToDisk() {
    try {
      fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
      const list = []
      for (const session of sessions.values()) {
        list.push({
          token: session.token,
          userId: session.userId,
          username: session.username,
          displayName: session.displayName,
          role: session.role,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })
      }
      const tmp = `${sessionsPath}.tmp`
      fs.writeFileSync(tmp, `${JSON.stringify({ sessions: list }, null, 2)}\n`, 'utf8')
      fs.renameSync(tmp, sessionsPath)
    } catch {
      /* ignore disk errors */
    }
  }

  function pruneSessions() {
    const now = Date.now()
    let changed = false
    for (const [token, session] of sessions.entries()) {
      if (!session?.expiresAt || session.expiresAt <= now) {
        sessions.delete(token)
        changed = true
      }
    }
    if (changed) saveSessionsToDisk()
  }

  function sessionTtlMs() {
    if (typeof getSessionTtlMs === 'function') {
      const v = Number(getSessionTtlMs())
      if (Number.isFinite(v) && v > 0) return v
    }
    return SESSION_TTL_MS
  }

  function createSession(user) {
    pruneSessions()
    const token = crypto.randomBytes(32).toString('hex')
    const ttl = sessionTtlMs()
    const session = {
      token,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    }
    sessions.set(token, session)
    saveSessionsToDisk()
    return session
  }

  function getSession(token) {
    pruneSessions()
    const session = sessions.get(String(token || '').trim())
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessions.delete(session.token)
      saveSessionsToDisk()
      return null
    }
    return session
  }

  function destroySession(token) {
    sessions.delete(String(token || '').trim())
    saveSessionsToDisk()
  }

  function login({ accountId = null, username = null, password = null }) {
    const user = users.authenticate({ accountId, username, password })
    const session = createSession(user)
    return { session, user }
  }

  function changePassword(userId, currentPassword, newPassword) {
    return users.changeOwnPassword(userId, currentPassword, newPassword)
  }

  function destroySessionsForUser(userId) {
    const uid = Number(userId)
    let changed = false
    for (const [token, session] of sessions.entries()) {
      if (Number(session.userId) === uid) {
        sessions.delete(token)
        changed = true
      }
    }
    if (changed) saveSessionsToDisk()
    return changed
  }

  loadSessionsFromDisk()

  return {
    login,
    changePassword,
    getSession,
    destroySession,
    destroySessionsForUser,
  }
}

module.exports = {
  createDashboardAuth,
  SESSION_TTL_MS,
}
