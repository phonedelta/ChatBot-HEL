/**
 * Dashboard RBAC — secretary read vs action permissions + router isolation.
 */
const assert = require('assert')
const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { openCrmDatabase } = require('../src/crm/db')
const { createDashboardUsers } = require('../src/dashboard/users')
const { createUserManagementRouter } = require('../src/dashboard/user-routes')
const { createSmartCrmRouter } = require('../src/dashboard/smart-routes')
const { assertPermission } = require('../src/dashboard/auth-middleware')
const { PERMISSIONS } = require('../src/dashboard/permissions')

function attachUser(app, user) {
  app.use((req, res, next) => {
    req.dashboardUser = user
    next()
  })
}

async function request(app, method, url) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const { port } = server.address()
        const response = await fetch(`http://127.0.0.1:${port}${url}`, { method })
        const body = await response.json().catch(() => null)
        resolve({ status: response.status, body })
      } catch (error) {
        reject(error)
      } finally {
        server.close()
      }
    })
  })
}

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-rbac-test-'))
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
  db.exec('DELETE FROM dashboard_users')
  const seeded = users.hashPassword('HelDashboard2026')
  const adminInsert = db.prepare(`
    INSERT INTO dashboard_users (username, display_name, role, password_salt, password_hash, is_active)
    VALUES ('admin', 'Admin', 'admin', ?, ?, 1)
  `).run(seeded.salt, seeded.hash)
  const adminId = Number(adminInsert.lastInsertRowid)

  const readOnly = users.createUser({
    username: 'readonly.sec',
    displayName: 'Read Only',
    role: 'secretary',
    password: 'Secretary2026',
    permissions: [
      PERMISSIONS.VIEW_MESSAGES,
      PERMISSIONS.VIEW_AGENDA,
      PERMISSIONS.VIEW_PATIENTS,
      PERMISSIONS.VIEW_FOLLOWUPS,
    ],
    createdBy: adminId,
  })

  const resolvedReadOnly = users.resolveSessionUser(readOnly.id)
  const resolvedAdmin = users.resolveSessionUser(adminId)

  const mockSmart = {
    ensureConversationsFromLegacy: () => {},
    listConversations: () => [],
    getAgendaBoard: () => ({ ok: true, appointments: [], waitlist: [], waitlist_count: 0 }),
    listPatientsBoard: () => ({ ok: true, patients: [], summary: {}, pagination: {} }),
    getFollowUpsBoard: () => ({ ok: true, items: [], summary: {} }),
  }

  function buildApp(user) {
    const app = express()
    app.use(express.json())
    attachUser(app, user)
    app.use(
      '/dashboard/api',
      createUserManagementRouter({ users, recordActivity: null, destroyUserSessions: null }),
    )
    app.use(
      '/dashboard/api',
      createSmartCrmRouter({
        getSmart: () => mockSmart,
        getCrm: () => null,
        assertPermission,
      }),
    )
    return app
  }

  const readApp = buildApp(resolvedReadOnly)
  const adminApp = buildApp(resolvedAdmin)

  const readGets = [
    ['/dashboard/api/conversations', 200],
    ['/dashboard/api/patients', 200],
    ['/dashboard/api/agenda?view=week', 200],
    ['/dashboard/api/followups', 200],
  ]

  for (const [url, expected] of readGets) {
    const res = await request(readApp, 'GET', url)
    assert.strictEqual(
      res.status,
      expected,
      `GET ${url} expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`,
    )
  }

  // User-management routes must stay admin-only without blocking CRM reads.
  const usersList = await request(readApp, 'GET', '/dashboard/api/users')
  assert.strictEqual(usersList.status, 403)

  const adminUsers = await request(adminApp, 'GET', '/dashboard/api/users')
  assert.strictEqual(adminUsers.status, 200)

  // CRM read routes still work for admin.
  const adminPatients = await request(adminApp, 'GET', '/dashboard/api/patients')
  assert.strictEqual(adminPatients.status, 200)

  // Write actions remain forbidden for read-only secretary.
  const writeChecks = [
    ['POST', '/dashboard/api/conversations/1/messages', 403],
    ['POST', '/dashboard/api/patients', 403],
    ['POST', '/dashboard/api/agenda/propose', 403],
  ]

  for (const [method, url, expected] of writeChecks) {
    const app = express()
    app.use(express.json())
    attachUser(app, resolvedReadOnly)
    app.use(
      '/dashboard/api',
      createSmartCrmRouter({
        getSmart: () => ({
          ...mockSmart,
          getConversation: () => ({ id: 1, owner: 'HUMAN', phone_e164: '+212600000000' }),
        }),
        getCrm: () => null,
        assertPermission,
        sendWhatsAppText: async () => ({ ok: true }),
      }),
    )
    const res = await new Promise((resolve, reject) => {
      const server = app.listen(0, async () => {
        try {
          const { port } = server.address()
          const response = await fetch(`http://127.0.0.1:${port}${url}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: 'test', full_name: 'Test', phone_number: '+212600000000' }),
          })
          const body = await response.json().catch(() => null)
          resolve({ status: response.status, body })
        } catch (error) {
          reject(error)
        } finally {
          server.close()
        }
      })
    })
    assert.strictEqual(
      res.status,
      expected,
      `${method} ${url} expected ${expected}, got ${res.status}`,
    )
  }

  // Permission updates take effect on next resolveSessionUser (no stale JWT permissions).
  users.updateUser(readOnly.id, { permissions: [PERMISSIONS.VIEW_MESSAGES] })
  const afterRevoke = users.resolveSessionUser(readOnly.id)
  assert.ok(!afterRevoke.permissions.includes(PERMISSIONS.VIEW_PATIENTS))

  const revokedApp = buildApp(afterRevoke)
  const revokedPatients = await request(revokedApp, 'GET', '/dashboard/api/patients')
  assert.strictEqual(revokedPatients.status, 403)

  const stillMessages = await request(revokedApp, 'GET', '/dashboard/api/conversations')
  assert.strictEqual(stillMessages.status, 200)

  console.log('dashboard rbac test: ok')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
