/**
 * Dashboard multi-user auth tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { openCrmDatabase } = require('../src/crm/db')
const { createDashboardUsers } = require('../src/dashboard/users')
const { createDashboardAuth } = require('../src/dashboard/auth')
const { hasPermission, PERMISSIONS } = require('../src/dashboard/permissions')

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-auth-test-'))
  const dbPath = path.join(tmpDir, 'crm.sqlite')
  const authFile = path.join(tmpDir, 'dashboard-auth.json')

  fs.writeFileSync(authFile, `${JSON.stringify({
    username: 'admin',
    password_salt: 'abc',
    password_hash: 'def',
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`)

  const db = openCrmDatabase(dbPath)
  const users = createDashboardUsers(db, authFile)

  // 1. bootstrap admin from legacy file won't work with fake hash - seed properly
  db.exec('DELETE FROM dashboard_users')
  const seeded = users.hashPassword('HelDashboard2026')
  const adminInsert = db.prepare(`
    INSERT INTO dashboard_users (username, display_name, role, password_salt, password_hash, is_active)
    VALUES ('admin', 'Admin', 'admin', ?, ?, 1)
  `).run(seeded.salt, seeded.hash)
  const adminId = Number(adminInsert.lastInsertRowid)

  const auth = createDashboardAuth({ users, sessionsPath: path.join(tmpDir, 'sessions.json') })

  // 2. login admin by account id
  const adminLogin = auth.login({ accountId: adminId, password: 'HelDashboard2026' })
  assert.ok(adminLogin.session.token)
  assert.strictEqual(adminLogin.user.role, 'admin')
  assert.ok(hasPermission(adminLogin.user, PERMISSIONS.MANAGE_USERS))

  // 3. create secretary
  const sarah = users.createUser({
    username: 'sarah.a',
    displayName: 'Sarah A.',
    role: 'secretary',
    password: 'Secretary2026',
    permissions: [
      PERMISSIONS.VIEW_MESSAGES,
      PERMISSIONS.VIEW_AGENDA,
      PERMISSIONS.VIEW_PATIENTS,
    ],
    createdBy: adminId,
  })
  assert.strictEqual(sarah.displayName, 'Sarah A.')

  // 4. login secretary
  const sarahLogin = auth.login({ accountId: sarah.id, password: 'Secretary2026' })
  assert.ok(sarahLogin.session.token)

  // 5. wrong password
  assert.throws(() => auth.login({ accountId: sarah.id, password: 'wrong' }), (e) => e.code === 'AUTH_FAILED')

  // 6. public accounts — no secrets
  const publicAccounts = users.listActivePublicAccounts()
  assert.ok(publicAccounts.some((a) => a.id === adminId))
  assert.ok(publicAccounts.some((a) => a.id === sarah.id))
  for (const a of publicAccounts) {
    assert.ok(!('password_hash' in a))
    assert.ok(!('permissions' in a))
  }

  // 7. secretary permissions
  const resolvedSarah = users.resolveSessionUser(sarah.id)
  assert.ok(hasPermission(resolvedSarah, PERMISSIONS.VIEW_MESSAGES))
  assert.ok(!hasPermission(resolvedSarah, PERMISSIONS.MANAGE_USERS))
  assert.ok(!hasPermission(resolvedSarah, PERMISSIONS.VIEW_ANALYTICS))

  // 8. disable secretary
  users.updateUser(sarah.id, { isActive: false })
  assert.throws(() => auth.login({ accountId: sarah.id, password: 'Secretary2026' }), (e) => e.code === 'AUTH_DISABLED')
  const activeOnly = users.listActivePublicAccounts()
  assert.ok(!activeOnly.some((a) => a.id === sarah.id))

  // 9. reset password
  users.updateUser(sarah.id, { isActive: true })
  users.resetPassword(sarah.id, 'NewSecret2026', { actorId: adminId })
  const sarahRelogin = auth.login({ accountId: sarah.id, password: 'NewSecret2026' })
  assert.ok(sarahRelogin.session.token)

  // 10. change own password
  users.changeOwnPassword(sarah.id, 'NewSecret2026', 'SarahPass2026')
  auth.login({ accountId: sarah.id, password: 'SarahPass2026' })
  assert.throws(
    () => users.changeOwnPassword(sarah.id, 'SarahPass2026', 'SarahPass2026'),
    (e) => e.code === 'VALIDATION',
  )

  // 11. admin protected
  assert.throws(() => users.updateUser(adminId, { isActive: false }), (e) => e.code === 'ADMIN_PROTECTED')

  // 12. permission update
  users.updateUser(sarah.id, { permissions: [PERMISSIONS.VIEW_MESSAGES, PERMISSIONS.VIEW_ANALYTICS] })
  const updated = users.resolveSessionUser(sarah.id)
  assert.ok(hasPermission(updated, PERMISSIONS.VIEW_ANALYTICS))

  // 13. delete secretary — soft delete
  const sarahSession = auth.login({ accountId: sarah.id, password: 'SarahPass2026' })
  assert.ok(sarahSession.session.token)
  users.deleteUser(sarah.id)
  auth.destroySessionsForUser(sarah.id)
  assert.throws(() => auth.login({ accountId: sarah.id, password: 'SarahPass2026' }), (e) => e.code === 'AUTH_FAILED')
  assert.ok(!users.listActivePublicAccounts().some((a) => a.id === sarah.id))
  assert.ok(!users.listUsers().some((u) => u.id === sarah.id))
  assert.strictEqual(users.resolveSessionUser(sarah.id), null)
  assert.strictEqual(auth.getSession(sarahSession.session.token), null)
  assert.throws(() => users.deleteUser(adminId), (e) => e.code === 'ADMIN_PROTECTED')
  assert.ok(users.isPrimaryAdmin(adminId))

  console.log('dashboard auth test: ok')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
