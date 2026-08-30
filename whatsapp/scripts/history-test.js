/**
 * Activity history tests — actor attribution & anti-usurpation.
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

  const clean = sanitizeHistoryMetadata({ api_key: 'secret', password: 'x', note: 'ok' })
  assert.strictEqual(clean.api_key, undefined)
  assert.strictEqual(clean.password, undefined)
  assert.strictEqual(clean.note, 'ok')

  const list = smart.listActivityHistory({ days: 30, page: 1, limit: 50 })
  assert.ok(list.items.length >= 5)

  for (const item of list.items) {
    const actorType = item.actor?.type
    assert.ok(
      actorType === 'dashboard_user' || actorType === 'assistant_ai',
      `invalid actor type in list: ${actorType} (${item.title})`,
    )
    assert.notStrictEqual(item.actor?.displayName, 'Patient')
    assert.notStrictEqual(item.actor?.displayName, 'Système')
    assert.notStrictEqual(item.actor?.displayName, 'Équipe')
  }

  const adminEvents = list.items.filter((i) => i.executedBy?.userId === adminId)
  assert.ok(adminEvents.length >= 1, 'admin events expected')
  assert.strictEqual(adminEvents[0].executedBy.displayName, 'Admin')
  assert.strictEqual(adminEvents[0].executedBy.role, 'admin')

  const sarahEvents = list.items.filter((i) => i.executedBy?.userId === sarah.id)
  assert.ok(sarahEvents.length >= 2, 'sarah events expected')
  for (const ev of sarahEvents) {
    assert.strictEqual(ev.executedBy.displayName, 'Sarah A.')
    assert.strictEqual(ev.executedBy.role, 'secretary')
  }

  const autoEvent = list.items.find((i) => i.actor?.type === 'assistant_ai')
  assert.ok(autoEvent, 'assistant event expected')
  assert.strictEqual(autoEvent.actor.displayName, 'Assistant IA')

  const patientLike = list.items.find((i) => i.event_type === 'appointment_cancelled')
  assert.ok(patientLike)
  assert.strictEqual(patientLike.actor.type, 'assistant_ai')
  assert.strictEqual(patientLike.actor.displayName, 'Assistant IA')

  const usurp = list.items.find((i) => i.source_event_id === 'test:anti-usurpation' || i.title === 'Tentative usurpation')
  assert.ok(usurp)
  assert.strictEqual(usurp.executedBy.userId, sarah.id)
  assert.strictEqual(usurp.executedBy.displayName, 'Sarah A.')
  assert.notStrictEqual(usurp.executedBy.userId, adminId)

  const bySarah = smart.listActivityHistory({ days: 30, actorUserId: sarah.id })
  assert.ok(bySarah.items.every((i) => i.executedBy?.userId === sarah.id))

  const searchSarah = smart.listActivityHistory({ search: 'Sarah', days: 30 })
  assert.ok(searchSarah.items.some((i) => i.executedBy?.displayName?.includes('Sarah')))

  const aiOnly = smart.listActivityHistory({ days: 30, actorType: 'assistant_ai' })
  assert.ok(aiOnly.items.every((i) => i.actor?.type === 'assistant_ai'))

  const groups = smart.listHistoryActorFilters()
  assert.ok(groups.some((g) => g.group === 'Exécutants'))
  assert.ok(groups.some((g) => g.group === 'Équipe'))
  const executants = groups.find((g) => g.group === 'Exécutants')?.items || []
  assert.ok(executants.some((i) => i.id === 'assistant_ai'))
  const teamItems = groups.find((g) => g.group === 'Équipe')?.items || []
  assert.ok(teamItems.some((i) => i.userId === sarah.id))

  const csv = smart.exportActivityCsv({ days: 30 })
  assert.ok(csv.includes('Exécuté par'))
  assert.ok(csv.includes('Origine'))
  assert.ok(csv.includes('Sarah A.'))
  assert.ok(csv.includes('Assistant IA'))
  assert.ok(!csv.includes('secret'))
  assert.ok(!csv.includes(',"Système",'), 'CSV must not list Système as Exécuté par')
  assert.ok(!csv.includes(',"Équipe",'), 'CSV must not list Équipe as Exécuté par')

  const summary = smart.getActivitySummary({ days: 30 })
  assert.ok(summary.period.total >= 5)
  assert.ok(typeof summary.errors === 'number')

  // Manual dashboard appointment must land in history with the executing account
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
  const createdEv = smart.listActivityHistory({ days: 30, eventType: 'appointment_created' })
  const manualEv = (createdEv.items || createdEv).find?.((i) => i.appointment_id === manual.appointment_id)
    || smart.listActivityHistory({ days: 30 }).items.find((i) => (
      i.event_type === 'appointment_created' && Number(i.appointment_id) === Number(manual.appointment_id)
    ))
  assert.ok(manualEv, 'manual appointment_created must appear in history')
  assert.strictEqual(manualEv.executedBy.userId, sarah.id)
  assert.strictEqual(manualEv.executedBy.displayName, 'Sarah A.')
  assert.strictEqual(manualEv.executedBy.role, 'secretary')
  assert.ok(String(manualEv.description || '').includes('Karim Benali'))

  console.log('history test: ok')

  try { fs.unlinkSync(tmpDb) } catch { /* ignore */ }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
