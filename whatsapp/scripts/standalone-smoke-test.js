const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

async function findFreePort() {
  const server = http.createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  return port
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body)
    const headers = { ...(options.headers || {}) }
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(body)
    }
    const request = http.request(url, {
      method: options.method || 'GET',
      headers: Object.keys(headers).length ? headers : undefined,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let data = null
        try {
          data = raw ? JSON.parse(raw) : null
        } catch {
          return reject(new Error(`Invalid JSON response: ${raw}`))
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`HTTP ${response.statusCode}: ${raw}`))
        }

        return resolve(data)
      })
    })

    request.on('error', reject)
    if (body) {
      request.write(body)
    }
    request.end()
  })
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body)
    const request = http.request(url, {
      method: options.method || 'GET',
      headers: body
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          }
        : undefined,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')

        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`HTTP ${response.statusCode}: ${raw}`))
        }

        return resolve(raw)
      })
    })

    request.on('error', reject)
    if (body) {
      request.write(body)
    }
    request.end()
  })
}

async function waitForHealth(baseUrl, child, getLogs) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Service exited early.\n${getLogs()}`)
    }

    try {
      return await requestJson(`${baseUrl}/health`)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error(`Service did not become healthy.\n${getLogs()}`)
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iadis-wa-ai-test-'))
  const sessionDir = path.join(tempDir, 'wa-sessions')
  const openAiRequests = []
  let service = null

  fs.mkdirSync(path.join(sessionDir, 'session-iadis_demo'), { recursive: true })

  const mockOpenAi = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      openAiRequests.push(payload)
      const replyNumber = openAiRequests.length

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: `resp_test_${replyNumber}`,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: `Test reply ${replyNumber}`,
                annotations: [],
              },
            ],
          },
        ],
      }))
    })
  })

  try {
    const mockPort = await listen(mockOpenAi)
    const servicePort = await findFreePort()
    const baseUrl = `http://127.0.0.1:${servicePort}`
    const entrypoint = path.resolve(__dirname, '..', 'src', 'index.js')
    let serviceLogs = ''

    service = spawn(process.execPath, [entrypoint], {
      cwd: tempDir,
      env: {
        ...process.env,
        PORT: String(servicePort),
        CHATBOT_MODE: 'standalone',
        CRM_ENABLED: 'false',
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
        OPENAI_MODEL: 'test-model',
        AI_HISTORY_PATH: path.join(tempDir, 'ai-conversations.json'),
        AI_KNOWLEDGE_PATH: path.resolve(__dirname, '..', 'src', 'knowledge', 'centre-dentaire-hel.md'),
        WA_SESSION_PATH: sessionDir,
        WA_AUTO_START: 'false',
        WA_AUTOMATION_HISTORY_SYNC_ENABLED: 'false',
        WA_ODOO_AUTOMATION_ENABLED: 'false',
        WA_REPORTING_AUTOMATION_ENABLED: 'false',
        WHATSAPP_SERVICE_TOKEN: '',
        // Isolate from the developer machine's live .env / running instance
        CRM_DB_PATH: path.join(tempDir, 'crm.sqlite'),
        DASHBOARD_AUTH_PATH: path.join(tempDir, 'dashboard-auth.json'),
        DASHBOARD_PASSWORD: 'HelDashboard2026',
        DASHBOARD_USERNAME: 'admin',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    service.stdout.on('data', (chunk) => { serviceLogs += chunk.toString('utf8') })
    service.stderr.on('data', (chunk) => { serviceLogs += chunk.toString('utf8') })

    const health = await waitForHealth(baseUrl, service, () => serviceLogs)
    assert.strictEqual(health.chatbot.mode, 'standalone')
    assert.strictEqual(health.chatbot.configured, true)

    const dashboardHtml = await requestText(`${baseUrl}/dashboard/`)
    assert.match(dashboardHtml, /Centre Dentaire HEL|Tableau de bord|Connexion/i)

    const unauthorized = await new Promise((resolve) => {
      const request = http.request(`${baseUrl}/dashboard/api/instances`, (response) => {
        resolve(response.statusCode)
        response.resume()
      })
      request.on('error', () => resolve(0))
      request.end()
    })
    assert.strictEqual(unauthorized, 401)

    const login = await requestJson(`${baseUrl}/dashboard/api/auth/login`, {
      method: 'POST',
      body: { username: 'admin', password: 'HelDashboard2026' },
    })
    assert.strictEqual(login.ok, true)
    assert.ok(login.token)
    const dashHeaders = { 'x-dashboard-token': login.token }

    const dashboardList = await requestJson(`${baseUrl}/dashboard/api/instances`, {
      headers: dashHeaders,
    })
    assert.strictEqual(dashboardList.ok, true)
    assert.strictEqual(Array.isArray(dashboardList.instances), true)
    assert.strictEqual(dashboardList.instances.some((item) => item.instance_id === 'demo'), true)

    const overview = await requestJson(`${baseUrl}/dashboard/api/overview`, {
      headers: dashHeaders,
    })
    assert.strictEqual(overview.ok, true)
    assert.strictEqual(overview.clinic?.name, 'Centre Dentaire HEL')

    const removedDashboardInstance = await requestJson(`${baseUrl}/dashboard/api/instances/demo`, {
      method: 'DELETE',
      headers: dashHeaders,
    })
    assert.strictEqual(removedDashboardInstance.ok, true)
    assert.strictEqual(fs.existsSync(path.join(sessionDir, 'session-iadis_demo')), false)

    const first = await requestJson(`${baseUrl}/incoming`, {
      method: 'POST',
      body: { from: '+212600000001', content: 'Hello' },
    })
    assert.strictEqual(first.chatbot.reply, 'Test reply 1')
    assert.deepStrictEqual(openAiRequests[0].input.map((item) => item.role), ['user'])
    assert.match(openAiRequests[0].instructions, /Centre Dentaire HEL/i)
    assert.match(openAiRequests[0].instructions, /contact@centredentairehel\.ma/i)

    const second = await requestJson(`${baseUrl}/incoming`, {
      method: 'POST',
      body: { from: '+212600000001', content: 'What did I say?' },
    })
    assert.strictEqual(second.chatbot.reply, 'Test reply 2')
    assert.deepStrictEqual(
      openAiRequests[1].input.map((item) => item.role),
      ['user', 'assistant', 'user'],
    )

    const reset = await requestJson(`${baseUrl}/incoming`, {
      method: 'POST',
      body: { from: '+212600000001', content: '/reset' },
    })
    assert.strictEqual(reset.chatbot.reason, 'conversation_reset')
    assert.strictEqual(openAiRequests.length, 2)

    const afterReset = await requestJson(`${baseUrl}/incoming`, {
      method: 'POST',
      body: { from: '+212600000001', content: 'Hello again after reset' },
    })
    assert.ok(String(afterReset.chatbot?.reply || '').length > 0)
    if (openAiRequests.length >= 3) {
      assert.strictEqual(afterReset.chatbot.reply, 'Test reply 3')
      assert.deepStrictEqual(openAiRequests[2].input.map((item) => item.role), ['user'])
    }

    console.log('standalone chatbot smoke test: ok')
  } finally {
    if (service && service.exitCode === null) {
      await new Promise((resolve) => {
        const fallback = setTimeout(resolve, 2000)
        service.once('exit', () => {
          clearTimeout(fallback)
          resolve()
        })
        service.kill()
      })
    }
    await new Promise((resolve) => mockOpenAi.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error)
  process.exit(1)
})
