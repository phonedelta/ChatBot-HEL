/**
 * Dashboard auth middleware — session user + permission checks.
 */

const { hasPermission } = require('./permissions')

function forbidden(res) {
  return res.status(403).json({
    ok: false,
    error: 'forbidden',
    message: 'Vous n’avez pas l’autorisation d’effectuer cette action.',
  })
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {ReturnType<import('./users').createDashboardUsers>} users
 */
function attachDashboardUser(req, res, next, users) {
  const token = req.header('x-dashboard-token') || String(req.query?.token || '').trim() || ''
  const session = req.dashboardAuth?.getSession?.(token)
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Authentification requise' })
  }
  const user = users.resolveSessionUser(session.userId)
  if (!user) {
    req.dashboardAuth?.destroySession?.(token)
    return res.status(401).json({ ok: false, error: 'Session expirée ou compte désactivé' })
  }
  req.dashboardSession = session
  req.dashboardUser = user
  return next()
}

function createEnsureDashboardSession(dashboardAuth, users) {
  return function ensureDashboardSession(req, res, next) {
    req.dashboardAuth = dashboardAuth
    return attachDashboardUser(req, res, next, users)
  }
}

function createRequirePermission(users) {
  return function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.dashboardUser) {
        return res.status(401).json({ ok: false, error: 'Authentification requise' })
      }
      if (!hasPermission(req.dashboardUser, permission)) {
        return forbidden(res)
      }
      return next()
    }
  }
}

function assertPermission(req, res, permission) {
  if (!hasPermission(req.dashboardUser, permission)) {
    forbidden(res)
    return false
  }
  return true
}

module.exports = {
  forbidden,
  attachDashboardUser,
  createEnsureDashboardSession,
  createRequirePermission,
  assertPermission,
}
