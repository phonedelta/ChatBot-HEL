/**
 * End-to-end booking conversations through the real service (POST /incoming), with the AI
 * replaced by a scripted OpenAI-compatible server and a temporary SQLite database.
 *
 * What is verified here is the product's own logic: routing between the AI and the booking
 * workflow, memory of the details across messages, confirmation, real persistence, dashboard
 * visibility, duplicates, slot conflicts, failures and the language asked of the AI.
 * The scripted AI only stands in for the model's reading of a message.
 */

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { DatabaseSync } = require('node:sqlite')

const DASHBOARD_PASSWORD = 'E2eDashboard2026'

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** A weekday (Mon-Fri) a few days ahead, so the test never depends on a hardcoded date. */
function futureWeekday(minDaysAhead) {
  const date = new Date()
  date.setDate(date.getDate() + minDaysAhead)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  return {
    iso: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    dayMonth: `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`,
    display: `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`,
    day: String(date.getDate()),
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function freePort() {
  const server = http.createServer()
  const port = await listen(server)
  await new Promise((resolve) => server.close(resolve))
  return port
}

// ---------------------------------------------------------------------------------------------
// Scripted AI
// ---------------------------------------------------------------------------------------------

/** Stand-in for the model's contextual reading of one patient message. */
function scriptedUnderstanding(context, message) {
  const text = String(message || '').trim()
  const assistant = String(context.dernier_message_assistant || '')
  const history = (context.messages_precedents_patient || []).join(' ')
  const mentionsPain = (value) => /d[ae]rss?a|douleur|toothache/i.test(value)
  const out = {
    booking: null,
    answer: null,
    is_question: /[?؟]/.test(text),
    full_name: null,
    phone: null,
    city: null,
    service: null,
    reason: null,
    date: null,
    time: null,
    language: /hello|i want|please/i.test(text) ? 'en' : (/bonjour|je voudrais|où/i.test(text) ? 'fr' : 'darija'),
    script: 'latin',
  }

  if (/^(oui|wakha|ok|yes|ah safi)[ .!]*$/i.test(text)) {
    out.answer = 'yes'
    if (/rendez-vous|rdv|appointment/i.test(assistant) && !context.rendez_vous_deja_enregistre_a_l_instant) {
      out.booking = 'accepted_offer'
    }
  }
  if (/^(non|la|no)[ .!]*$/i.test(text)) out.answer = 'no'
  if (/\b(rdv|rendez-vous|appointment)\b/i.test(text)) out.booking = 'explicit_request'

  const phone = text.match(/(?:\+212|0)[5-7]\d{8}/)
  if (phone) out.phone = phone[0]
  const dayMonth = text.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (dayMonth) out.date = { day: Number(dayMonth[1]), month: Number(dayMonth[2]), year: null, relative: null, weekday: null }
  const hour = text.match(/\b(\d{1,2})\s*h\b/i)
  if (hour) out.time = `${pad2(hour[1])}:00`
  if (/^\d{1,2}$/.test(text)) {
    // A bare number is the day while the day is unknown, then the hour.
    if (!context.deja_connu?.date) out.date = { day: Number(text), month: null, year: null, relative: null, weekday: null }
    else out.time = `${pad2(text)}:00`
  }
  for (const city of ['Kenitra', 'Rabat', 'Casablanca', 'Tanger']) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(text)) out.city = city
  }
  const introduced = text.match(/\b(?:smiti|je m'appelle|my name is)\s+([A-Z][a-z]+ [A-Z][a-z]+)/)
  if (introduced) out.full_name = introduced[1]
  else if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(text)) out.full_name = text
  if (mentionsPain(text) || (context.reprendre_historique && mentionsPain(history))) {
    out.service = 'Urgences dentaires'
    out.reason = 'douleur dentaire'
  }
  return out
}

function scriptedConversationReply(context) {
  if (context.appointment_just_recorded) return 'Merci, à bientôt !'
  if (context.booking?.active) return 'Le cabinet se trouve à El Oulfa, Casablanca.'
  return 'Lah ychafik. Wach bghiti nakhdo lik rendez-vous ?'
}

/** A "rewording" that keeps every figure and drops Arabic-script words, like a Latin rewrite. */
function scriptedRewording(message, wantsArabicScript) {
  if (wantsArabicScript) return message
  return message
    .split('\n')
    .map((line) => line.replace(/[؀-ۿ]+/g, ' ').replace(/\s{2,}/g, ' ').trim())
    .filter((line) => /[A-Za-z0-9]/.test(line))
    .join('\n') || 'ok'
}

function createScriptedAi() {
  const state = { requests: [], down: false }
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const system = String(body.messages?.find((item) => item.role === 'system')?.content || '')
      const user = String([...(body.messages || [])].reverse().find((item) => item.role === 'user')?.content || '')
      const entry = { kind: 'other', system, user }
      state.requests.push(entry)

      if (state.down) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'model overloaded' } }))
        return
      }

      let content = '{}'
      if (system.includes('pour le moteur de réservation')) {
        entry.kind = 'understanding'
        const context = JSON.parse(user.slice(user.indexOf('{'), user.indexOf('MESSAGE DU PATIENT')).trim())
        const message = user.slice(user.lastIndexOf(':\n') + 2)
        entry.context = context
        content = JSON.stringify(scriptedUnderstanding(context, message))
      } else if (system.includes('Tu classifies l\'intention')) {
        entry.kind = 'semantic'
        content = JSON.stringify({ language: 'darija', intent: 'OTHER', confidence: 0.3, entities: {} })
      } else if (system.includes('Le moteur de réservation a préparé un MESSAGE')) {
        entry.kind = 'phrasing'
        const message = user.slice(user.indexOf('MESSAGE :\n') + 'MESSAGE :\n'.length)
        content = scriptedRewording(message, system.includes('écrite en lettres arabes'))
      } else if (system.includes('validateur de données pour un formulaire')) {
        entry.kind = 'name'
        const candidate = String(JSON.parse(user).candidate || '')
        const valid = /^[A-Za-zÀ-ÿ'-]+ [A-Za-zÀ-ÿ' -]+$/.test(candidate)
        content = JSON.stringify({ isPersonFullName: valid, confidence: valid ? 0.95 : 0.2, normalizedName: valid ? candidate : null, reason: 'scripted' })
      } else if (system.includes('IDENTITÉ ET RÔLE')) {
        entry.kind = 'conversation'
        const start = user.indexOf('{')
        const end = user.indexOf('DERNIER MESSAGE PATIENT')
        entry.context = JSON.parse(user.slice(start, end).trim())
        content = scriptedConversationReply(entry.context)
      } else {
        content = 'douleur dentaire'
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: `scripted-${state.requests.length}`,
        model: body.model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      }))
    })
  })
  return { server, state }
}

// ---------------------------------------------------------------------------------------------
// Service under test
// ---------------------------------------------------------------------------------------------

async function startService(aiPort) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-booking-e2e-'))
  const port = await freePort()
  let logs = ''
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(OPENAI_|OPENROUTER_|GEMINI_|VOICE_|AI_|WA_|CRM_|DASHBOARD_|WHATSAPP_|WEBHOOK_)/.test(key)),
  )
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'src', 'index.js')], {
    cwd: tempDir,
    env: {
      ...inherited,
      PORT: String(port),
      TZ: 'Africa/Casablanca',
      CHATBOT_MODE: 'standalone',
      CRM_ENABLED: 'true',
      CRM_DB_PATH: path.join(tempDir, 'crm.sqlite'),
      OPENAI_API_KEY: 'scripted-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`,
      OPENAI_MODEL: 'scripted-model',
      AI_HISTORY_PATH: path.join(tempDir, 'ai-conversations.json'),
      DASHBOARD_AUTH_PATH: path.join(tempDir, 'dashboard-auth.json'),
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD,
      WA_SESSION_PATH: path.join(tempDir, 'wa-sessions'),
      WA_AUTO_START: 'false',
      WA_AUTOMATION_HISTORY_SYNC_ENABLED: 'false',
      WA_ODOO_AUTOMATION_ENABLED: 'false',
      WA_REPORTING_AUTOMATION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })

  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Service exited early.\n${logs.slice(-2000)}`)
    try {
      if ((await fetch(`${baseUrl}/health`)).status === 200) break
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (attempt === 99) throw new Error(`Service did not become healthy.\n${logs.slice(-2000)}`)
  }

  return {
    baseUrl,
    dbPath: path.join(tempDir, 'crm.sqlite'),
    logs: () => logs,
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

function createHelpers(service) {
  async function say(from, content) {
    const response = await fetch(`${service.baseUrl}/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, content }),
    })
    const data = await response.json()
    assert.ok(data.chatbot, `no chatbot decision for "${content}": ${JSON.stringify(data).slice(0, 200)}`)
    return data.chatbot
  }

  function query(sql, ...params) {
    const db = new DatabaseSync(service.dbPath, { readOnly: true })
    try {
      return db.prepare(sql).all(...params)
    } finally {
      db.close()
    }
  }

  const appointmentsOf = (from) => query(
    `SELECT a.id, a.appointment_date, a.appointment_time, a.status, c.full_name, c.phone_number, c.city
     FROM appointments a JOIN customers c ON c.id = a.customer_id
     WHERE a.conversation_id = ? ORDER BY a.id`,
    `webhook:${from}`,
  )
  const leadOf = (from) => query('SELECT * FROM crm_leads WHERE conversation_id = ?', `webhook:${from}`)[0] || null

  let token = null
  async function dashboard(method, route, body) {
    if (!token) {
      const login = await fetch(`${service.baseUrl}/dashboard/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: DASHBOARD_PASSWORD }),
      })
      token = (await login.json()).token
      assert.ok(token, 'dashboard login failed')
    }
    const response = await fetch(`${service.baseUrl}/dashboard/api${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, data: await response.json() }
  }

  return { say, query, appointmentsOf, leadOf, dashboard }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

async function run() {
  const day = futureWeekday(3)
  const ai = createScriptedAi()
  const aiPort = await listen(ai.server)
  const service = await startService(aiPort)
  const { say, query, appointmentsOf, leadOf, dashboard } = createHelpers(service)
  const requestsOfKind = (kind) => ai.state.requests.filter((item) => item.kind === kind)
  const passed = []
  const check = (name) => { passed.push(name); console.log(`  ok - ${name}`) }

  try {
    // --- Six separate messages, Darija in Latin letters (brief tests 2, 4, 5, 6, 8, 11, 12, 14) ---
    const salim = '+212600000001'
    let turn = await say(salim, 'Salam')
    assert.equal(turn.reason, 'ai_response')

    turn = await say(salim, 'Darssa katderni')
    assert.equal(turn.reason, 'ai_response', 'describing a pain must not open the booking by itself')
    assert.equal(leadOf(salim).stage, 'discovery')
    assert.match(turn.reply, /rendez-vous/)

    turn = await say(salim, 'Oui')
    assert.equal(turn.reason, 'crm_workflow', '"Oui" to the assistant\'s offer must start the real booking workflow')
    assert.equal(turn.crm_stage, 'awaiting_form')
    assert.match(turn.reply, /nom complet/i)
    assert.doesNotMatch(turn.reply, /téléphone|ville/i, 'one question at a time')
    assert.equal(leadOf(salim).problem, 'Urgences dentaires', 'the pain mentioned before the booking is remembered')
    check('accepting the assistant\'s offer with "Oui" starts the booking and keeps the earlier complaint')

    turn = await say(salim, 'Salim Zouhairi')
    assert.match(turn.reply, /téléphone/i)
    assert.equal(leadOf(salim).full_name, 'Salim Zouhairi')

    turn = await say(salim, '0600000000')
    assert.match(turn.reply, /ville/i)
    assert.equal(leadOf(salim).phone_number, '+212600000000')

    turn = await say(salim, 'Kenitra')
    assert.equal(turn.reason, 'crm_workflow', 'a city name is an answer, not a question about the clinic')
    assert.equal(leadOf(salim).city, 'Kénitra')
    assert.match(turn.reply, /jour/i)
    check('a patient living in another city than the clinic is accepted and the city is stored')

    turn = await say(salim, day.day)
    assert.equal(leadOf(salim).appointment_date, day.iso, 'a bare day number is the day of the appointment')
    assert.equal(leadOf(salim).full_name, 'Salim Zouhairi', 'known details are never asked again')
    assert.match(turn.reply, /heure/i)

    turn = await say(salim, '11')
    assert.equal(turn.crm_stage, 'confirmation')
    assert.equal(leadOf(salim).appointment_time, '11:00', 'a bare number after the day is the hour')
    assert.ok(turn.reply.includes(day.display) && turn.reply.includes('11:00'), 'the summary shows the exact date and time')
    assert.match(turn.reply, /Salim Zouhairi/)
    assert.doesNotMatch(turn.reply, /[\u0600-\u06FF]/, 'a patient writing in Latin letters gets the summary in Latin letters')
    assert.equal(appointmentsOf(salim).length, 0, 'nothing is saved before the explicit confirmation')
    check('"<day>" then "11" are read as the date and the time')

    turn = await say(salim, 'Oui')
    assert.equal(turn.reason, 'crm_booking_confirmed')
    let rows = appointmentsOf(salim)
    assert.equal(rows.length, 1)
    assert.deepStrictEqual(
      { date: rows[0].appointment_date, time: rows[0].appointment_time, name: rows[0].full_name, phone: rows[0].phone_number, city: rows[0].city },
      { date: day.iso, time: '11:00', name: 'Salim Zouhairi', phone: '+212600000000', city: 'Kénitra' },
    )
    assert.ok(turn.reply.includes(day.display) && turn.reply.includes('11:00'))
    assert.doesNotMatch(turn.reply, /[\u0600-\u06FF]/)
    check('details sent in six messages end in an appointment stored in the database after "Oui"')

    for (const again of ['Oui', 'Oui', 'ok']) {
      turn = await say(salim, again)
      assert.equal(turn.reason, 'ai_response', 'after the appointment is saved the booking workflow is closed')
      assert.equal(leadOf(salim).stage, 'discovery')
    }
    assert.equal(appointmentsOf(salim).length, 1, 'repeated "Oui" must not create a second appointment')
    assert.equal(requestsOfKind('conversation').at(-1).context.appointment_just_recorded, true)
    check('repeating "Oui" after the confirmation neither duplicates the appointment nor restarts the collection')

    assert.ok(requestsOfKind('phrasing').length > 0)
    assert.ok(requestsOfKind('phrasing').every((item) => item.system.includes('lettres latines')), 'Latin-script Darija is requested for every workflow reply')
    assert.equal(requestsOfKind('conversation').at(-1).context.reply_style, 'darija_latin', '"Oui" does not switch the conversation to French')
    check('a Darija conversation in Latin letters asks the AI for Latin-script Darija, even after "Oui"')

    let listed = await dashboard('GET', `/crm/appointments?from=${day.iso}`)
    assert.equal(listed.status, 200)
    assert.ok(listed.data.appointments.some((item) => item.appointment_id === rows[0].id), 'the appointment is returned by the dashboard list')
    const agenda = await dashboard('GET', `/agenda?from=${day.iso}&view=week`)
    assert.ok(JSON.stringify(agenda.data).includes('Salim Zouhairi'), 'the appointment is on the dashboard agenda')
    check('the appointment created on WhatsApp is visible through the dashboard API')

    // --- Everything in a single message (brief test 1) ---
    const karim = '+212600000002'
    turn = await say(karim, `Salam, bghit rdv. Smiti Karim Bennani, 0611223344, Rabat, dersa katderni, nhar ${day.dayMonth} m3a 15h`)
    assert.equal(turn.crm_stage, 'confirmation', 'a complete message goes straight to the summary')
    assert.equal(leadOf(karim).city, 'Rabat')
    assert.equal(leadOf(karim).problem, 'Urgences dentaires')
    turn = await say(karim, 'oui')
    assert.equal(turn.reason, 'crm_booking_confirmed')
    rows = appointmentsOf(karim)
    assert.deepStrictEqual([rows.length, rows[0].appointment_date, rows[0].appointment_time, rows[0].full_name], [1, day.iso, '15:00', 'Karim Bennani'])
    check('all details in one message lead to a stored appointment')

    // --- A question in the middle of a booking, in French (brief test 3) ---
    const yassine = '+212600000003'
    turn = await say(yassine, 'Bonjour, je voudrais prendre un rendez-vous')
    assert.equal(turn.reason, 'crm_workflow')
    await say(yassine, 'Yassine Amrani')
    turn = await say(yassine, 'Où se trouve le cabinet ?')
    assert.equal(turn.reason, 'booking_faq_interrupt')
    assert.match(turn.reply, /El Oulfa/)
    assert.equal(leadOf(yassine).full_name, 'Yassine Amrani', 'the draft survives the question')
    assert.equal(leadOf(yassine).stage, 'awaiting_form')
    turn = await say(yassine, '0622334455')
    assert.equal(turn.reason, 'crm_workflow')
    await say(yassine, 'Casablanca')
    await say(yassine, 'douleur dentaire')
    turn = await say(yassine, `${day.dayMonth} 12h`)
    assert.equal(turn.crm_stage, 'confirmation')
    turn = await say(yassine, 'oui')
    assert.equal(turn.reason, 'crm_booking_confirmed')
    assert.equal(appointmentsOf(yassine)[0].appointment_time, '12:00')
    assert.ok(requestsOfKind('phrasing').some((item) => item.system.includes('en français')))
    check('a question asked during the booking is answered and the collected details are kept')

    // --- The requested slot is already taken (brief test 9) ---
    const nadia = '+212600000004'
    turn = await say(nadia, `Bonjour, je voudrais un rendez-vous. Je m'appelle Nadia Tazi, 0633445566, Casablanca, douleur dentaire, le ${day.dayMonth} 15h`)
    assert.notEqual(turn.crm_stage, 'confirmation', 'an occupied slot is never offered for confirmation')
    assert.equal(leadOf(nadia).awaiting_field, 'slot_alternative')
    // The reply names the refused time, then the alternatives.
    const offered = [...new Set(turn.reply.match(/\b\d{2}:\d{2}\b/g) || [])].filter((time) => time !== '15:00')
    assert.ok(offered.length > 0 && !offered.includes('11:00') && !offered.includes('12:00'),
      `only really free slots are proposed, got: ${offered.join(', ')}`)
    turn = await say(nadia, offered[0])
    assert.equal(turn.crm_stage, 'confirmation')
    turn = await say(nadia, 'oui')
    assert.equal(turn.reason, 'crm_booking_confirmed')
    const sameSlot = query('SELECT appointment_time, COUNT(*) AS c FROM appointments WHERE appointment_date = ? GROUP BY appointment_time HAVING c > 1', day.iso)
    assert.deepStrictEqual(sameSlot, [], 'no slot holds two appointments')
    check('an unavailable slot gets real alternatives and no slot is booked twice')

    // --- English is answered in English ---
    const emma = '+212600000005'
    turn = await say(emma, 'Hello, I want to book an appointment please')
    assert.equal(turn.reason, 'crm_workflow')
    assert.ok(requestsOfKind('phrasing').at(-1).system.includes('en anglais'))
    check('an English message starts the booking and asks the AI for English')

    // --- Changes made from the dashboard are reflected (brief test 13) ---
    const karimAppointment = appointmentsOf(karim)[0]
    const moved = await dashboard('POST', `/agenda/appointments/${karimAppointment.id}/move`, {
      slot_date: day.iso,
      slot_time: '17:00',
      notify_patient: false,
    })
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    assert.equal(appointmentsOf(karim)[0].appointment_time, '17:00')
    const cancelled = await dashboard('PATCH', `/crm/appointments/${karimAppointment.id}`, { status: 'cancelled' })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data))
    assert.match(appointmentsOf(karim)[0].status, /annul|cancel/i)
    listed = await dashboard('GET', `/crm/appointments?from=${day.iso}`)
    const listedKarim = listed.data.appointments.find((item) => item.appointment_id === karimAppointment.id)
    assert.ok(!listedKarim || /annul|cancel/i.test(listedKarim.status), 'the dashboard no longer shows it as active')
    check('moving and cancelling an appointment from the dashboard is reflected in the database')

    // --- The AI is unavailable: the workflow still books from a clear message ---
    ai.state.down = true
    const omar = '+212600000006'
    turn = await say(omar, [
      'Je voudrais prendre un rendez-vous',
      'Nom : Omar Idrissi',
      'Téléphone : 0644556677',
      'Ville : Casablanca',
      'Problème : douleur dentaire',
      `Rendez-vous : ${day.display} à 16:30`,
    ].join('\n'))
    assert.equal(turn.crm_stage, 'confirmation', service.logs().slice(-1500))
    turn = await say(omar, 'oui')
    assert.equal(turn.reason, 'crm_booking_confirmed')
    assert.equal(appointmentsOf(omar).length, 1)
    turn = await say(omar, 'ok merci')
    assert.equal(turn.reply, null, 'no error message is sent after a saved appointment when the AI cannot answer')
    assert.equal(appointmentsOf(omar).length, 1)
    ai.state.down = false
    check('with the AI down, a clearly written request is still booked by the workflow')

    console.log(`booking-conversation-e2e-test: OK (${passed.length} scenarios)`)
  } finally {
    await service.stop()
    await new Promise((resolve) => ai.server.close(resolve))
  }
}

/**
 * The appointment cannot be saved (brief test 10): no confirmation is announced, the draft
 * stays at the summary, and a new "oui" retries without asking anything again.
 */
async function runSaveFailure() {
  const { createCrmService } = require('../src/crm')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hel-booking-save-'))
  const day = futureWeekday(4)
  const log = console.log
  console.log = () => {}
  try {
    const crm = createCrmService({ dbPath: path.join(tempDir, 'crm.sqlite') })
    const conversationId = 'main:212600000099@c.us'
    const send = (userText) => crm.processCrmTurn({ conversationId, chatId: '212600000099@c.us', userText, languageHint: 'fr' })

    let turn = await send([
      'Je voudrais prendre un rendez-vous',
      'Nom : Amine Benali',
      'Téléphone : 0612345678',
      'Ville : Casablanca',
      'Problème : douleur dentaire',
      `Rendez-vous : ${day.display} à 15:30`,
    ].join('\n'))
    assert.equal(turn.lead.stage, 'confirmation')

    const save = crm.repo.saveConfirmedBooking
    crm.repo.saveConfirmedBooking = () => { throw new Error('database is unavailable') }
    const silenced = console.error
    console.error = () => {}
    turn = await send('oui')
    console.error = silenced
    assert.equal(turn.booking, null)
    assert.equal(turn.saveFailed, true)
    assert.match(turn.forceReply, /pas pu enregistrer/)
    assert.doesNotMatch(turn.forceReply, /bien été enregistré|✅/)
    assert.equal(turn.lead.stage, 'confirmation', 'the draft is kept for a retry')
    assert.equal(turn.lead.full_name, 'Amine Benali')
    assert.equal(crm.repo.getCrmStats().appointments, 0)

    crm.repo.saveConfirmedBooking = save
    turn = await send('oui')
    assert.ok(turn.booking, 'the retry saves the appointment without asking for the details again')
    assert.equal(crm.repo.getCrmStats().appointments, 1)
    log('  ok - a failed save announces no confirmation, keeps the details and can be retried')
  } finally {
    console.log = log
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

run()
  .then(runSaveFailure)
  .catch((error) => {
    console.error(error.stack || error)
    process.exitCode = 1
  })
