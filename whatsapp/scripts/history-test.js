/**
 * Activity history tests — human-only Historique + actor attribution.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { openCrmDatabase } = require('../src/crm/db')
const { createSmartCrm } = require('../src/crm/smart')
const { createDashboardUsers } = require('../src/dashboard/users')
const { sanitizeHistoryMetadata } = require('../src/crm/smart/activity-history')
const { getAuthenticatedActor, assistantAiActor } = require('../src/crm/smart/activity-actors')

async function run() {
  const tmpDb = path.join(os.tmpdir(), `hel-history-test-${Date.now()}.sqlite`)
  const db = openCrmDatabase(tmpDb)
  const smart = createSmartCrm(db)
  const users = createDashboardUsers(db, path.join(os.tmpdir(), `hel-history-auth-${Date.now()}.json`))

  db.exec('DELETE FROM dashboard_users')
  const adminPw = users.hashPassword('AdminPass2026')
  const adminInsert = db.prepare(`
    INSERT INTO dashboard_users (username, display_name, role, password_salt, password_hash, is_active)
    VALUES ('admin', 'Admin', 'admin', ?, ?, 1)
  `).run(adminPw.salt, adminPw.hash)
  const adminId = Number(adminInsert.lastInsertRowid)

  const sarah = users.createUser({
    username: 'sarah.a',
    displayName: 'Sarah A.',
    role: 'secretary',
    password: 'SarahPass2026',
    permissions: [],
    createdBy: adminId,
  })

  const adminUser = users.resolveSessionUser(adminId)
  const sarahUser = users.resolveSessionUser(sarah.id)
  const adminActor = getAuthenticatedActor(adminUser)
  const sarahActor = getAuthenticatedActor(sarahUser)

  const customer = db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, whatsapp_chat_id, created_at)
    VALUES ('Yasmine El Amrani', '+212612345678', 'Casablanca', '212612345678@c.us', datetime('now'))
  `).run()
  const customerId = Number(customer.lastInsertRowid)

  const conv = db.prepare(`
    INSERT INTO conversations (external_key, customer_id, channel, status, owner, created_at, updated_at)
    VALUES ('212612345678@c.us', ?, 'whatsapp', 'AI_IN_PROGRESS', 'AI', datetime('now'), datetime('now'))
  `).run(customerId)
  const conversationId = Number(conv.lastInsertRowid)

  const appt = db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, conversation_id, created_at)
    VALUES (?, '2026-08-30', '09:00', 'non_confirme', ?, datetime('now'))
  `).run(customerId, conversationId)
  const appointmentId = Number(appt.lastInsertRowid)

  // --- Seed: mix of human + AI events ---
  smart.logAiAction({
    conversation_id: conversationId,
    customer_id: customerId,
    action_type: 'appointment_confirmed',
    reason: 'Confirmé automatiquement',
    actor: assistantAiActor(),
    source: 'whatsapp',
    payload: { appointment_id: appointmentId, origin: 'whatsapp_patient' },
  })

  smart.setHandoff(conversationId, { owner: 'HUMAN', owner_user: sarahActor.displayName, actor: sarahActor })

  smart.recordActivity({
    event_type: 'appointment_rescheduled',
    category: 'appointment',
    actor: adminActor,
    origin: 'dashboard',
    patient_id: customerId,
    appointment_id: appointmentId,
    title: 'Rendez-vous déplacé',
    old_value: { date: '2026-08-30', time: '14:30' },
    new_value: { date: '2026-08-31', time: '10:30' },
    source_event_id: 'test:reschedule:admin',
  })

  smart.recordActivity({
    event_type: 'note_added',
    category: 'patient',
    actor: sarahActor,
    origin: 'dashboard',
    patient_id: customerId,
    title: 'Note patient ajoutée',
    description: 'Rappeler demain',
    source_event_id: 'test:note:sarah',
  })

  smart.recordActivity({
    event_type: 'appointment_moved_manually',
    category: 'appointment',
    actor: sarahActor,
    actor_user_id: adminId,
    actor_display_name: 'Admin',
    actor_name: 'Admin',
    patient_id: customerId,
    appointment_id: appointmentId,
    title: 'Tentative usurpation',
    source_event_id: 'test:anti-usurpation',
  })

  smart.logAiAction({
    customer_id: customerId,
    appointment_id: appointmentId,
    action_type: 'appointment_cancelled',
    reason: 'Annulé par le patient',
    actor: assistantAiActor(),
    source: 'whatsapp',
  })

  smart.updateAssistantSettings({ active: false }, { actor: adminActor })

  smart.recordActivity({
    event_type: 'functional_error',
    category: 'error',
    severity: 'error',
    actor: assistantAiActor(),
    title: 'Échec de l’envoi de la relance WhatsApp',
    description: 'Une erreur technique est survenue lors de l’envoi.',
    source_event_id: 'test:error:1',
  })

  smart.recordActivity({
    event_type: 'manual_confirmation_sent',
    category: 'whatsapp',
    actor: assistantAiActor(),
    origin: 'automation',
    patient_id: customerId,
    appointment_id: appointmentId,
    title: 'manual_confirmation_sent',
    description: 'Confirmation WhatsApp création manuelle dashboard',
    source_event_id: 'test:manual_confirmation_sent',
  })

  const clean = sanitizeHistoryMetadata({ api_key: 'secret', password: 'x', note: 'ok' })
  assert.strictEqual(clean.api_key, undefined)
  assert.strictEqual(clean.password, undefined)
  assert.strictEqual(clean.note, 'ok')

  // --- Internal list (no humansOnly): still sees AI for debug ---
  const allList = smart.listActivityHistory({ days: 30, page: 1, limit: 50 })
  assert.ok(allList.items.length >= 5)
  const aiInAll = allList.items.filter((i) => i.actor?.type === 'assistant_ai')
  assert.ok(aiInAll.length >= 1, 'internal list must still expose AI events when humansOnly is off')

  for (const item of allList.items) {
    const actorType = item.actor?.type
    assert.ok(
      actorType === 'dashboard_user' || actorType === 'assistant_ai',
      `invalid actor type in list: ${actorType} (${item.title})`,
    )
    assert.notStrictEqual(item.actor?.displayName, 'Patient')
    assert.notStrictEqual(item.actor?.displayName, 'Système')
    assert.notStrictEqual(item.actor?.displayName, 'Équipe')
  }

  // --- TEST 1 + 2: humansOnly allowlist ---
  const humanList = smart.listActivityHistory({ days: 30, page: 1, limit: 50, humansOnly: true })
  assert.ok(humanList.items.length >= 1)
  assert.ok(
    humanList.items.every((i) => i.actor?.type === 'dashboard_user'),
    'humansOnly list must contain only dashboard_user',
  )
  assert.ok(
    !humanList.items.some((i) => i.actor?.type === 'assistant_ai'),
    'humansOnly must hide Assistant IA',
  )
  assert.ok(
    !humanList.items.some((i) => String(i.event_type) === 'manual_confirmation_sent'),
    'automation confirmation must be hidden from human Historique',
  )
  assert.ok(
    !humanList.items.some((i) => String(i.event_type) === 'appointment_cancelled' && i.actor?.type === 'assistant_ai'),
    'WhatsApp patient cancel must be hidden',
  )

  const humanTotal = humanList.pagination.total
  const allTotal = allList.pagination.total
  assert.ok(humanTotal < allTotal, `human total (${humanTotal}) must be < all total (${allTotal})`)
  assert.strictEqual(
    humanList.items.filter((i) => i.actor?.type === 'dashboard_user').length,
    humanList.items.length,
  )

  const summaryHuman = smart.getActivitySummary({ days: 30, humansOnly: true })
  assert.strictEqual(summaryHuman.period.total, humanTotal)
  assert.strictEqual(summaryHuman.period.ai, 0, 'humansOnly summary must not count AI')

  // --- Attribution / anti-usurpation (human events) ---
  const adminEvents = humanList.items.filter((i) => i.executedBy?.userId === adminId)
  assert.ok(adminEvents.length >= 1, 'admin events expected')
  assert.strictEqual(adminEvents[0].executedBy.displayName, 'Admin')
  assert.strictEqual(adminEvents[0].executedBy.role, 'admin')

  const sarahEvents = humanList.items.filter((i) => i.executedBy?.userId === sarah.id)
  assert.ok(sarahEvents.length >= 2, 'sarah events expected')
  for (const ev of sarahEvents) {
    assert.strictEqual(ev.executedBy.displayName, 'Sarah A.')
    assert.strictEqual(ev.executedBy.role, 'secretary')
  }

  const usurp = humanList.items.find((i) => i.source_event_id === 'test:anti-usurpation' || i.title === 'Tentative usurpation')
  assert.ok(usurp)
  assert.strictEqual(usurp.executedBy.userId, sarah.id)
  assert.strictEqual(usurp.executedBy.displayName, 'Sarah A.')
  assert.notStrictEqual(usurp.executedBy.userId, adminId)

  const bySarah = smart.listActivityHistory({ days: 30, actorUserId: sarah.id, humansOnly: true })
  assert.ok(bySarah.items.every((i) => i.executedBy?.userId === sarah.id))
  assert.ok(bySarah.items.every((i) => i.actor?.type === 'dashboard_user'))

  const searchSarah = smart.listActivityHistory({ search: 'Sarah', days: 30, humansOnly: true })
  assert.ok(searchSarah.items.some((i) => i.executedBy?.displayName?.includes('Sarah')))

  // --- TEST 4: search text only present on AI event ---
  const searchAiOnly = smart.listActivityHistory({
    search: 'Erreur technique est survenue',
    days: 30,
    humansOnly: true,
  })
  assert.strictEqual(searchAiOnly.pagination.total, 0, 'AI-only text must not surface via humansOnly search')
  assert.strictEqual(searchAiOnly.items.length, 0)

  // Internal AI filter still works without humansOnly
  const aiOnly = smart.listActivityHistory({ days: 30, actorType: 'assistant_ai' })
  assert.ok(aiOnly.items.every((i) => i.actor?.type === 'assistant_ai'))
  assert.ok(aiOnly.items.length >= 1)

  // Conflicting: humansOnly + actorType assistant_ai → empty
  const conflict = smart.listActivityHistory({ days: 30, humansOnly: true, actorType: 'assistant_ai' })
  assert.strictEqual(conflict.pagination.total, 0)
  assert.strictEqual(conflict.items.length, 0)

  // --- TEST 5: actor dropdown — humans only ---
  const groups = smart.listHistoryActorFilters()
  assert.ok(groups.some((g) => g.group === 'Équipe'))
  assert.ok(!groups.some((g) => g.group === 'Exécutants'), 'legacy Exécutants group with AI must be gone')
  const allActorIds = groups.flatMap((g) => g.items || []).map((i) => i.id)
  assert.ok(!allActorIds.includes('assistant_ai'), 'dropdown must not offer Assistant IA')
  assert.ok(groups.every((g) => (g.items || []).every((i) => i.type === 'dashboard_user')))
  const teamItems = groups.find((g) => g.group === 'Équipe')?.items || []
  assert.ok(teamItems.some((i) => i.userId === sarah.id))
  assert.ok(teamItems.some((i) => i.userId === adminId))

  // --- TEST 6: CSV humans only ---
  const csvAll = smart.exportActivityCsv({ days: 30 })
  assert.ok(csvAll.includes('Assistant IA'), 'internal CSV without humansOnly may include AI')

  const csv = smart.exportActivityCsv({ days: 30, humansOnly: true })
  assert.ok(csv.includes('Exécuté par'))
  assert.ok(csv.includes('Origine'))
  assert.ok(csv.includes('Sarah A.') || csv.includes('Admin'))
  const csvDataRows = csv.split('\n').slice(1).filter(Boolean)
  for (const line of csvDataRows) {
    // Columns: Date, Heure, Action, Catégorie, Patient, Exécuté par, Rôle, Origine, Description
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g) || []
    const executedByCol = (cols[5] || '').replace(/^"|"$/g, '').replace(/""/g, '"')
    assert.notStrictEqual(executedByCol, 'Assistant IA', `CSV Exécuté par must not be Assistant IA: ${line}`)
    assert.notStrictEqual(executedByCol, 'Automatisation')
    assert.notStrictEqual(executedByCol, 'Scheduler')
    assert.notStrictEqual(executedByCol, 'Système')
    assert.notStrictEqual(executedByCol, 'Équipe')
  }
  assert.ok(!csv.includes('secret'))
  assert.ok(!csv.includes('manual_confirmation_sent'))

  // --- TEST 7: PDF humans only ---
  const pdf = smart.exportActivityPdf({ days: 30, humansOnly: true })
  assert.ok(Buffer.isBuffer(pdf) || typeof pdf === 'string' || pdf instanceof Uint8Array)
  const pdfText = Buffer.isBuffer(pdf) || pdf instanceof Uint8Array
    ? Buffer.from(pdf).toString('latin1')
    : String(pdf)
  // Human action titles may mention "Assistant IA" (e.g. pause settings); actor column must not.
  assert.ok(!/\| Assistant IA \|/.test(pdfText), 'PDF must not list Assistant IA as executor')
  assert.ok(!/\| Scheduler \|/.test(pdfText), 'PDF must not list Scheduler as executor')
  assert.ok(!/\| Automatisation \|/.test(pdfText), 'PDF must not list Automatisation as executor')

  // --- TEST 3: pagination applies humansOnly before LIMIT ---
  db.exec('DELETE FROM activity_history')
  for (let i = 0; i < 15; i += 1) {
    smart.recordActivity({
      event_type: 'appointment_confirmed',
      category: 'appointment',
      actor: assistantAiActor(),
      origin: 'whatsapp_patient',
      title: `AI confirm ${i}`,
      source_event_id: `test:ai:pad:${i}`,
    })
  }
  for (let i = 0; i < 10; i += 1) {
    smart.recordActivity({
      event_type: 'appointment_created',
      category: 'appointment',
      actor: adminActor,
      origin: 'dashboard',
      title: `Human create ${i}`,
      source_event_id: `test:human:pad:${i}`,
    })
  }
  const page1 = smart.listActivityHistory({ days: 30, page: 1, limit: 10, humansOnly: true })
  assert.strictEqual(page1.pagination.total, 10)
  assert.strictEqual(page1.items.length, 10)
  assert.ok(page1.items.every((i) => i.actor?.type === 'dashboard_user'))
  assert.ok(page1.items.every((i) => String(i.title || '').startsWith('Human create')))

  // --- TEST 8: human create + AI secondary automation ---
  db.exec('DELETE FROM activity_history')
  const { createCrmRepository } = require('../src/crm/repository')
  const repo = createCrmRepository(db)
  const manual = repo.createManualAppointment({
    full_name: 'Karim Benali',
    phone_number: '0611223344',
    city: 'Rabat',
    problem: 'controle',
    appointment_date: '2026-09-10',
    appointment_time: '11:00',
  })
  assert.ok(manual.appointment_id, 'createManualAppointment must expose appointment_id')
  assert.ok(manual.customer_id, 'createManualAppointment must expose customer_id')
  smart.recordActivity({
    event_type: 'appointment_created',
    category: 'appointment',
    actor: sarahActor,
    origin: 'dashboard',
    source: 'dashboard',
    patient_id: manual.customer_id,
    appointment_id: manual.appointment_id,
    title: 'Rendez-vous créé',
    description: `${manual.full_name} — 2026-09-10 11:00`,
    new_value: {
      date: '2026-09-10',
      time: '11:00',
      status: 'confirmed',
      created_via: 'dashboard_manual',
    },
    metadata: {
      actor_user_id: sarahActor.userId,
      actor_display_name: sarahActor.displayName,
      actor_role: sarahActor.role,
      account_username: 'sarah.a',
    },
    source_event_id: `appointment:created:${manual.appointment_id}`,
  })
  smart.recordActivity({
    event_type: 'manual_confirmation_sent',
    category: 'whatsapp',
    actor: assistantAiActor(),
    origin: 'automation',
    patient_id: manual.customer_id,
    appointment_id: manual.appointment_id,
    title: 'manual_confirmation_sent',
    description: 'Confirmation WhatsApp création manuelle dashboard',
    source_event_id: `appointment:manual_confirmation:${manual.appointment_id}`,
  })

  const afterCreate = smart.listActivityHistory({ days: 30, humansOnly: true })
  assert.strictEqual(afterCreate.pagination.total, 1)
  assert.strictEqual(afterCreate.items.length, 1)
  assert.strictEqual(afterCreate.items[0].event_type, 'appointment_created')
  assert.strictEqual(afterCreate.items[0].executedBy.userId, sarah.id)
  assert.strictEqual(afterCreate.items[0].executedBy.displayName, 'Sarah A.')
  assert.ok(String(afterCreate.items[0].description || '').includes('Karim Benali'))

  // --- TEST 9: patient WhatsApp confirm → no human Historique line ---
  smart.logAiAction({
    customer_id: manual.customer_id,
    appointment_id: manual.appointment_id,
    action_type: 'appointment_confirmed',
    reason: 'Patient a répondu OUI',
    actor: assistantAiActor(),
    source: 'whatsapp',
    payload: { origin: 'whatsapp_patient' },
  })
  const afterConfirm = smart.listActivityHistory({ days: 30, humansOnly: true })
  assert.strictEqual(afterConfirm.pagination.total, 1, 'WhatsApp patient confirm must not add human Historique row')
  assert.strictEqual(afterConfirm.items[0].event_type, 'appointment_created')

  // Full internal still has AI rows
  const afterConfirmAll = smart.listActivityHistory({ days: 30 })
  assert.ok(afterConfirmAll.pagination.total >= 3)

  console.log('history test: ok')

  try { fs.unlinkSync(tmpDb) } catch { /* ignore */ }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
