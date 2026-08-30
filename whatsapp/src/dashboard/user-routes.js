/**
 * Dashboard user management API routes (admin only).
 */

const express = require('express')
const { PERMISSION_GROUPS, DEFAULT_SECRETARY_PERMISSIONS, PERMISSIONS } = require('./permissions')
const { forbidden } = require('./auth-middleware')
const { getAuthenticatedActor } = require('../crm/smart/activity-actors')

function targetUserSnapshot(user, extras = {}) {
  return {
    user_id: user.id,
    display_name: user.displayName,
    role: user.role,
    role_label: user.roleLabel,
    ...extras,
  }
}

/**
 * @param {{
 *   users: ReturnType<import('./users').createDashboardUsers>,
 *   recordActivity?: Function|null,
 *   destroyUserSessions?: Function|null,
 * }} deps
 */
function createUserManagementRouter(deps) {
  const router = express.Router()
  const { users } = deps

  function requireManageUsers(req, res, next) {
    if (!req.dashboardUser) {
      return res.status(401).json({ ok: false, error: 'Authentification requise' })
    }
    const { hasPermission } = require('./permissions')
    if (!hasPermission(req.dashboardUser, PERMISSIONS.MANAGE_USERS)) {
      return forbidden(res)
    }
    return next()
  }

  // Do NOT router.use(requireManageUsers) here — this router shares /dashboard/api
  // with smart CRM routes; a global middleware would block every API call.

  router.get('/permissions', requireManageUsers, (_req, res) => {
    return res.json({
      ok: true,
      groups: PERMISSION_GROUPS,
      defaultSecretaryPermissions: DEFAULT_SECRETARY_PERMISSIONS,
    })
  })

  router.get('/users', requireManageUsers, (_req, res) => {
    return res.json({ ok: true, users: users.listUsers() })
  })

  router.post('/users', requireManageUsers, (req, res) => {
    try {
      const user = users.createUser({
        username: req.body?.username,
        displayName: req.body?.display_name || req.body?.displayName,
        role: req.body?.role || 'secretary',
        password: req.body?.password,
        isActive: req.body?.is_active !== false && req.body?.isActive !== false,
        permissions: req.body?.permissions || DEFAULT_SECRETARY_PERMISSIONS,
        createdBy: req.dashboardUser?.id || null,
      })
      deps.recordActivity?.({
        event_type: 'dashboard_user_created',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Compte créé : ${user.displayName}`,
        description: `Rôle : ${user.roleLabel}`,
        metadata: targetUserSnapshot(user),
        source_event_id: `user:created:${user.id}`,
      })
      return res.status(201).json({ ok: true, user })
    } catch (error) {
      const code = error.code === 'DUPLICATE' ? 409
        : (error.code === 'WEAK_PASSWORD' || error.code === 'VALIDATION' ? 400 : 400)
      return res.status(code).json({ ok: false, error: error.message || 'Création impossible' })
    }
  })

  router.get('/users/:id', requireManageUsers, (req, res) => {
    const user = users.getUserById(req.params.id, { includeInactive: true })
    if (!user) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })
    return res.json({ ok: true, user })
  })

  router.patch('/users/:id', requireManageUsers, (req, res) => {
    try {
      const user = users.updateUser(req.params.id, {
        displayName: req.body?.display_name ?? req.body?.displayName,
        isActive: req.body?.is_active ?? req.body?.isActive,
        permissions: req.body?.permissions,
      })
      deps.recordActivity?.({
        event_type: 'dashboard_user_updated',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Accès modifiés : ${user.displayName}`,
        metadata: targetUserSnapshot(user),
        source_event_id: `user:updated:${user.id}:${Date.now()}`,
      })
      return res.json({ ok: true, user })
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 404
        : (error.code === 'ADMIN_PROTECTED' ? 403 : 400)
      return res.status(code).json({ ok: false, error: error.message || 'Mise à jour impossible' })
    }
  })

  router.put('/users/:id/permissions', requireManageUsers, (req, res) => {
    try {
      const user = users.updateUser(req.params.id, { permissions: req.body?.permissions || [] })
      deps.recordActivity?.({
        event_type: 'dashboard_user_permissions_updated',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Permissions modifiées : ${user.displayName}`,
        metadata: targetUserSnapshot(user, { permission_count: user.permissionCount }),
        source_event_id: `user:perms:${user.id}:${Date.now()}`,
      })
      return res.json({ ok: true, user })
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 404 : 400
      return res.status(code).json({ ok: false, error: error.message || 'Mise à jour impossible' })
    }
  })

  router.post('/users/:id/reset-password', requireManageUsers, (req, res) => {
    try {
      users.resetPassword(req.params.id, req.body?.password || req.body?.new_password, {
        actorId: req.dashboardUser?.id,
      })
      const target = users.getUserById(req.params.id, { includeInactive: true })
      deps.recordActivity?.({
        event_type: 'dashboard_user_password_reset',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Mot de passe réinitialisé : ${target?.displayName || req.params.id}`,
        severity: 'sensitive',
        metadata: targetUserSnapshot(target || { id: Number(req.params.id), displayName: String(req.params.id), role: 'secretary', roleLabel: 'Secrétaire' }),
        source_event_id: `user:resetpw:${req.params.id}:${Date.now()}`,
      })
      return res.json({ ok: true })
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 404
        : (error.code === 'WEAK_PASSWORD' ? 400 : 400)
      return res.status(code).json({ ok: false, error: error.message || 'Réinitialisation impossible' })
    }
  })

  router.post('/users/:id/disable', requireManageUsers, (req, res) => {
    try {
      users.assertAdminProtected(req.params.id, { isActive: false })
      const user = users.updateUser(req.params.id, { isActive: false })
      deps.recordActivity?.({
        event_type: 'dashboard_user_disabled',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Compte désactivé : ${user.displayName}`,
        metadata: targetUserSnapshot(user, {
          account_status: 'disabled',
          account_status_label: 'Compte désactivé',
        }),
        source_event_id: `user:disabled:${user.id}`,
      })
      return res.json({ ok: true, user })
    } catch (error) {
      const code = error.code === 'ADMIN_PROTECTED' ? 403
        : (error.code === 'NOT_FOUND' ? 404 : 400)
      return res.status(code).json({ ok: false, error: error.message || 'Désactivation impossible' })
    }
  })

  router.post('/users/:id/enable', requireManageUsers, (req, res) => {
    try {
      const user = users.updateUser(req.params.id, { isActive: true })
      deps.recordActivity?.({
        event_type: 'dashboard_user_enabled',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Compte réactivé : ${user.displayName}`,
        metadata: targetUserSnapshot(user, {
          account_status: 'active',
          account_status_label: 'Compte actif',
        }),
        source_event_id: `user:enabled:${user.id}`,
      })
      return res.json({ ok: true, user })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'Activation impossible' })
    }
  })

  router.delete('/users/:id', requireManageUsers, (req, res) => {
    try {
      const target = users.getUserById(req.params.id, { includeInactive: true })
      if (!target) {
        return res.status(404).json({ ok: false, error: 'Utilisateur introuvable' })
      }
      deps.recordActivity?.({
        event_type: 'dashboard_user_deleted',
        category: 'system',
        actor: getAuthenticatedActor(req.dashboardUser),
        title: `Compte utilisateur supprimé`,
        description: `${target.displayName} · ${target.roleLabel}`,
        metadata: targetUserSnapshot(target, {
          account_status: 'deleted',
          account_status_label: 'Compte supprimé',
        }),
        source_event_id: `user:deleted:${target.id}:${Date.now()}`,
        severity: 'sensitive',
      })
      users.deleteUser(req.params.id)
      deps.destroyUserSessions?.(Number(req.params.id))
      return res.json({ ok: true })
    } catch (error) {
      const code = error.code === 'NOT_FOUND' ? 404
        : (error.code === 'ADMIN_PROTECTED' ? 403 : 400)
      return res.status(code).json({ ok: false, error: error.message || 'Suppression impossible' })
    }
  })

  return router
}

module.exports = {
  createUserManagementRouter,
}
