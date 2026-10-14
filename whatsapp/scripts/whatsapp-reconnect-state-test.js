/**
 * WhatsApp connection state after a brief network drop.
 *
 * whatsapp-web.js emits "ready" once per session. When the socket drops for a moment it reports
 * OPENING / TIMEOUT and then CONNECTED again: the service must show "ready" again, otherwise the
 * dashboard reports WhatsApp as not connected and refuses to send messages.
 *
 * Boots the real service with a fake whatsapp-web.js (no browser), drives the client's events and
 * reads the state the dashboard reads (/health).
 */
const assert = require('assert')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

// ---------------------------------------------------------------------------------------------
// Fake whatsapp-web.js, loaded inside the service process (node --require <this file>)
// ---------------------------------------------------------------------------------------------

function installFakeWhatsApp() {
  const { EventEmitter } = require('events')
  const Module = require('module')
  const clients = []

  class Client extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.initializeCalls = 0
      this.info = { wid: { _serialized: '212600000000@c.us', user: '212600000000', server: 'c.us' }, pushname: 'Test' }
      clients.push(this)
    }

    // A stored session: no QR code, "authenticated" first, "ready" when the test says so.
    async initialize() {
      this.initializeCalls += 1
      this.emit('authenticated')
    }

    async getState() {
      return 'CONNECTED'
    }

    async destroy() {}
  }

  class LocalAuth {
    constructor(options) {
      this.options = options
    }
  }

  class MessageMedia {}

  const fake = { Client, LocalAuth, MessageMedia }
  const load = Module._load
  Module._load = function loadWithFakeWhatsApp(request, ...rest) {
    return request === 'whatsapp-web.js' ? fake : load.call(this, request, ...rest)
  }

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const client = clients[clients.length - 1]
    if (client && url.pathname === '/emit') {
      client.emit(url.searchParams.get('event'), url.searchParams.get('value') || undefined)
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ initializeCalls: client ? client.initializeCalls : 0 }))
  }).listen(Number(process.env.HEL_FAKE_WHATSAPP_PORT), '127.0.0.1')
}

// ---------------------------------------------------------------------------------------------
// Service under test
// ---------------------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function startService({ pingIntervalMs }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-wa-state-'))
  const port = await freePort()
  const controlPort = await freePort()
  let logs = ''
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(OPENAI_|OPENROUTER_|GEMINI_|VOICE_|AI_|WA_|CRM_|DASHBOARD_|WHATSAPP_|WEBHOOK_|NODE_OPTIONS)/.test(key)),
  )
  const child = spawn(process.execPath, ['--require', __filename, path.resolve(__dirname, '..', 'src', 'index.js')], {
    cwd: tempDir,
    env: {
      ...inherited,
      HEL_FAKE_WHATSAPP: '1',
      HEL_FAKE_WHATSAPP_PORT: String(controlPort),
      PORT: String(port),
      TZ: 'Africa/Casablanca',
      CHATBOT_MODE: 'standalone',
      CRM_DB_PATH: path.join(tempDir, 'crm.sqlite'),
      OPENAI_API_KEY: 'unused-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
      AI_HISTORY_PATH: path.join(tempDir, 'ai-conversations.json'),
      DASHBOARD_AUTH_PATH: path.join(tempDir, 'dashboard-auth.json'),
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'StateTest2026',
      WA_SESSION_PATH: path.join(tempDir, 'wa-sessions'),
      WA_AUTO_START: 'true',
      WA_INSTANCE_PING_INTERVAL_MS: String(pingIntervalMs),
      WA_AUTOMATION_HISTORY_SYNC_ENABLED: 'false',
      WA_ODOO_AUTOMATION_ENABLED: 'false',
      WA_REPORTING_AUTOMATION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })

  const baseUrl = `http://127.0.0.1:${port}`
  const controlUrl = `http://127.0.0.1:${controlPort}`
  const fail = (message) => new Error(`${message}\n${logs.slice(-2000)}`)

  async function state() {
    const health = await (await fetch(`${baseUrl}/health`)).json()
    return health.whatsapp.main_state
  }

  async function control(pathname = '/') {
    return (await fetch(`${controlUrl}${pathname}`)).json()
  }

  // Up when the service answers and the WhatsApp client has been initialized.
  for (let attempt = 0; ; attempt += 1) {
    if (child.exitCode !== null) throw fail('Service exited early.')
    try {
      if ((await fetch(`${baseUrl}/health`)).status === 200 && (await control()).initializeCalls >= 1) break
    } catch { /* not listening yet */ }
    if (attempt === 150) throw fail('Service did not start its WhatsApp client.')
    await sleep(100)
  }

  return {
    state,
    emit: (event, value) => control(`/emit?event=${event}${value ? `&value=${value}` : ''}`),
    async waitForState(expected, label, timeoutMs = 3000) {
      const startedAt = Date.now()
      let actual = await state()
      while (actual !== expected && Date.now() - startedAt < timeoutMs) {
        await sleep(50)
        actual = await state()
      }
      assert.equal(actual, expected, label)
    },
    async stop() {
      child.kill()
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(() => { child.kill('SIGKILL'); resolve() }, 3000)),
      ])
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

// Health checks are too far apart to run: only the client's events can change the state.
async function testStateChangeEvents() {
  const service = await startService({ pingIntervalMs: 600000 })
  try {
    await service.waitForState('authenticated', 'a stored session starts as authenticated')

    await service.emit('change_state', 'CONNECTED')
    assert.equal(await service.state(), 'connecting', 'CONNECTED before the first "ready" is not ready yet')

    await service.emit('ready')
    assert.equal(await service.state(), 'ready')

    for (const drop of ['OPENING', 'TIMEOUT']) {
      await service.emit('change_state', drop)
      assert.equal(await service.state(), 'connecting', `${drop} shows as connecting`)
      await service.emit('change_state', 'CONNECTED')
      assert.equal(await service.state(), 'ready', `CONNECTED after ${drop} is ready again`)
    }

    await service.emit('auth_failure', 'session expired')
    assert.equal(await service.state(), 'auth_failure')
    await service.emit('change_state', 'CONNECTED')
    assert.equal(await service.state(), 'connecting', 'a failed session is not ready until it emits "ready" again')
    console.log('ok - CONNECTED after a brief drop restores "ready", but never before the session was ready')
  } finally {
    await service.stop()
  }
}

// The drop is over before anyone looks: only the periodic health check can notice it.
async function testHealthCheck() {
  const pingIntervalMs = 150
  const service = await startService({ pingIntervalMs })
  try {
    await service.waitForState('authenticated', 'a stored session starts as authenticated')

    await service.emit('change_state', 'CONNECTED')
    await sleep(pingIntervalMs * 4)
    assert.equal(await service.state(), 'connecting', 'the health check does not mark a starting session as ready')

    await service.emit('ready')
    assert.equal(await service.state(), 'ready')

    await service.emit('change_state', 'TIMEOUT')
    await service.waitForState('ready', 'the health check restores "ready" after a brief drop')
    console.log('ok - the health check restores "ready" after a brief drop, but not while the session starts')
  } finally {
    await service.stop()
  }
}

async function main() {
  await testStateChangeEvents()
  await testHealthCheck()
  console.log('whatsapp-reconnect-state-test: OK')
}

if (process.env.HEL_FAKE_WHATSAPP === '1') {
  installFakeWhatsApp()
} else {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
