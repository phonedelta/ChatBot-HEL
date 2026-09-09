const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const express = require('express')
const { createCrmService } = require('../src/crm')
const { createDashboardUsers } = require('../src/dashboard/users')
const { createSmartCrmRouter } = require('../src/dashboard/smart-routes')
const { createPlatformResetGate } = require('../src/crm/platform-reset-gate')
const {
  PRESERVE_TABLES,
  RESET_TABLES,
  assertNotWhatsappPath,
  resetOperationalCrmData,
} = require('../src/crm/reset-operational-data')

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count || 0)
}

function seedOperationalData(db) {
  const customer = db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, whatsapp_chat_id)
    VALUES ('Patient Test', '+212600000001', 'Casablanca', '212600000001@c.us')
  `).run()
  const appointment = db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status)
    VALUES (?, '2099-01-10', '11:00', 'confirmed')
  `).run(customer.lastInsertRowid)
  const conversation = db.prepare(`
    INSERT INTO conversations (external_key, customer_id, last_message_preview)
    VALUES ('212600000001@c.us', ?, 'Message patient')
  `).run(customer.lastInsertRowid)
  db.prepare(`
    INSERT INTO messages (conversation_id, direction, author_type, body)
    VALUES (?, 'inbound', 'patient', 'Salam')
  `).run(conversation.lastInsertRowid)
  db.prepare(`
    INSERT INTO crm_leads (conversation_id, stage, awaiting_field, booking_intent)
    VALUES ('reset-test', 'awaiting_form', 'phone_number', 1)
  `).run()
  db.prepare(`
    INSERT INTO notifications (type, title, body, unique_key)
    VALUES ('test', 'Notification test', 'Ancienne notification', 'reset-test-notification')
  `).run()
  db.prepare(`
    INSERT INTO activity_history (
      event_type, category, actor_type, actor_name, source, title, severity, source_event_id
    ) VALUES (
      'test_event', 'system', 'dashboard_user', 'Admin', 'dashboard',
      'Ancien historique', 'info', 'reset-test-history'
    )
  `).run()
  db.prepare(`
    INSERT INTO staff_notifications (appointment_id, title, body)
    VALUES (?, 'Ancien rappel', 'À supprimer')
  `).run(appointment.lastInsertRowid)
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-platform-reset-'))
  const storageDir = path.join(rootDir, 'storage')
  fs.mkdirSync(storageDir, { recursive: true })
  const crm = createCrmService({ dbPath: path.join(storageDir, 'crm.sqlite') })
  createDashboardUsers(crm.db, path.join(storageDir, 'dashboard-auth.json'))
  seedOperationalData(crm.db)

  const sessionDir = path.join(storageDir, 'sessions', 'session-iadis_main')
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'auth-marker'), 'preserve')
  fs.writeFileSync(path.join(storageDir, 'dashboard-sessions.json'), '{"sessions":[{"token":"keep"}]}\n')
  fs.writeFileSync(path.join(storageDir, 'ai-conversations.json'), '{"patient":[{"role":"user","content":"Salam"}]}\n')
  for (const directory of ['media', 'voice-nlu-logs', 'tmp-uploads']) {
    const fullPath = path.join(storageDir, directory)
    fs.mkdirSync(fullPath, { recursive: true })
    fs.writeFileSync(path.join(fullPath, 'patient-data.txt'), 'delete')
  }

  return { rootDir, storageDir, sessionDir, crm }
}

async function listen(app) {
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  }
}

async function request(url, role, confirmation = 'RESET HEL') {
  const response = await fetch(`${url}/dashboard/api/settings/reset-platform`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { 'x-test-role': role } : {}),
    },
    body: JSON.stringify({ confirmation }),
  })
  return { status: response.status, body: await response.json() }
}

async function run() {
  const gate = createPlatformResetGate()
  let markTaskStarted
  let releaseTask
  const taskStarted = new Promise((resolve) => { markTaskStarted = resolve })
  const taskHold = new Promise((resolve) => { releaseTask = resolve })
  const runningTask = gate.run(async () => {
    markTaskStarted()
    await taskHold
  })
  await taskStarted
  let drainCompleted = false
  const drain = gate.begin().then(() => { drainCompleted = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drainCompleted, false)
  releaseTask()
  await Promise.all([runningTask, drain])
  assert.equal(gate.isActive(), true)
  let queuedTaskRan = false
  const queuedTask = gate.run(() => { queuedTaskRan = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(queuedTaskRan, false)
  gate.end()
  await queuedTask
  assert.equal(queuedTaskRan, true)

  const previousSessionPath = process.env.WA_SESSION_PATH
  process.env.WA_SESSION_PATH = './storage/sessions'

  const rollbackFixture = createFixture()
  const beforeRollback = {
    customers: count(rollbackFixture.crm.db, 'customers'),
    messages: count(rollbackFixture.crm.db, 'messages'),
    history: count(rollbackFixture.crm.db, 'activity_history'),
  }
  assert.throws(
    () => resetOperationalCrmData({
      db: rollbackFixture.crm.db,
      rootDir: rollbackFixture.rootDir,
      createBackup: false,
      failAfterTable: 'crm_leads',
    }),
    /Injected reset failure/,
  )
  assert.equal(count(rollbackFixture.crm.db, 'customers'), beforeRollback.customers)
  assert.equal(count(rollbackFixture.crm.db, 'messages'), beforeRollback.messages)
  assert.equal(count(rollbackFixture.crm.db, 'activity_history'), beforeRollback.history)
  rollbackFixture.crm.db.close()
  fs.rmSync(rollbackFixture.rootDir, { recursive: true, force: true })

  const fixture = createFixture()
  const preservedCounts = Object.fromEntries(
    PRESERVE_TABLES.map((table) => [table, count(fixture.crm.db, table)]),
  )
  assert.throws(
    () => assertNotWhatsappPath(fixture.sessionDir, fixture.rootDir),
    (error) => error.code === 'WHATSAPP_SESSION_PROTECTED',
  )

  let runtimeResetCount = 0
  let runtimeGateReleaseCount = 0
  let whatsappReady = false
  let releaseFirstReset
  const resetGate = new Promise((resolve) => { releaseFirstReset = resolve })
  let gateUsed = false
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const role = req.header('x-test-role')
    if (role) {
      req.dashboardUser = {
        id: role === 'admin' ? 1 : 2,
        username: role,
        displayName: role === 'admin' ? 'Admin Test' : 'Secrétaire Test',
        role,
      }
    }
    next()
  })
  app.use('/dashboard/api', createSmartCrmRouter({
    getSmart: () => fixture.crm.smart,
    getCrm: () => fixture.crm,
    getWhatsappStatus: () => ({ ready: whatsappReady, connected: whatsappReady }),
    resetRuntimeData: () => { runtimeResetCount += 1 },
    platformRootDir: fixture.rootDir,
    beforePlatformReset: async () => {
      if (gateUsed) return
      gateUsed = true
      await resetGate
    },
    afterPlatformReset: () => { runtimeGateReleaseCount += 1 },
  }))
  const listener = await listen(app)

  assert.equal((await request(listener.url, null)).status, 401)
  assert.equal((await request(listener.url, 'secretary')).status, 403)
  assert.equal((await request(listener.url, 'admin', 'reset')).status, 400)
  assert.equal((await request(listener.url, 'admin')).status, 409)
  assert.equal(count(fixture.crm.db, 'customers'), 1)

  whatsappReady = true
  const firstReset = request(listener.url, 'admin')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const concurrent = await request(listener.url, 'admin')
  assert.equal(concurrent.status, 409)
  releaseFirstReset()
  const completed = await firstReset
  assert.equal(completed.status, 200)
  assert.equal(completed.body.report.whatsappReadyBefore, true)
  assert.equal(completed.body.report.whatsappReadyAfter, true)
  assert.equal(runtimeResetCount, 1)
  assert.equal(runtimeGateReleaseCount, 1)

  for (const table of RESET_TABLES) {
    const expected = table === 'activity_history' ? 1 : 0
    assert.equal(count(fixture.crm.db, table), expected, `${table} should contain ${expected} rows`)
  }
  for (const [table, before] of Object.entries(preservedCounts)) {
    assert.equal(count(fixture.crm.db, table), before, `${table} must be preserved`)
  }
  assert.equal(fs.readFileSync(path.join(fixture.sessionDir, 'auth-marker'), 'utf8'), 'preserve')
  assert.match(fs.readFileSync(path.join(fixture.storageDir, 'dashboard-sessions.json'), 'utf8'), /keep/)
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(fixture.storageDir, 'ai-conversations.json'), 'utf8')),
    {},
  )
  for (const directory of ['media', 'voice-nlu-logs', 'tmp-uploads']) {
    assert.deepStrictEqual(fs.readdirSync(path.join(fixture.storageDir, directory)), [])
  }
  assert.ok(completed.body.report.backupFile)
  assert.ok(fs.existsSync(path.join(fixture.storageDir, 'backups', completed.body.report.backupFile)))

  const freshTurn = await fixture.crm.processCrmTurn({
    conversationId: 'fresh-after-reset',
    chatId: '212600000099@c.us',
    userText: 'Bghit rendez-vous',
    languageHint: 'darija',
    router: {
      intent: 'BOOK_APPOINTMENT',
      intentConfidence: 0.99,
      bookAppointment: true,
    },
  })
  assert.equal(freshTurn.lead?.conversation_id, 'fresh-after-reset')
  assert.equal(count(fixture.crm.db, 'crm_leads'), 1)
  assert.equal(count(fixture.crm.db, 'customers'), 0)

  await new Promise((resolve) => listener.server.close(resolve))
  fixture.crm.db.close()
  fs.rmSync(fixture.rootDir, { recursive: true, force: true })
  if (previousSessionPath === undefined) delete process.env.WA_SESSION_PATH
  else process.env.WA_SESSION_PATH = previousSessionPath

  console.log('platform-reset-test: OK')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
