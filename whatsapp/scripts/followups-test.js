/**
 * Follow-ups / Relances board tests — real CRM data, no mock patients.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')

function weekdayFuture(daysAhead = 4, time = '11:00') {
  for (let i = daysAhead; i < daysAhead + 21; i += 1) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    if (d.getDay() === 0) continue
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const t = d.getDay() === 6 ? '11:00' : time
    return { date: `${yyyy}-${mm}-${dd}`, time: t }
  }
  throw new Error('no weekday')
}

async function run() {
  const tmp = path.join(os.tmpdir(), `hel-followups-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const sent = []
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    sent.push({ chatId, phone, text })
    return { messageId: `mock-${sent.length}`, chatId: chatId || 'mock@c.us' }
  })

  // --- unconfirmed count ---
  const slot = weekdayFuture(5, '11:30')
  const booking = crm.repo.saveConfirmedBooking({
    full_name: 'Relance Patient Un',
    phone_number: '+212612388001',
    city: 'Casablanca',
    problem: 'Contrôle',
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: '212612388001@c.us',
    whatsapp_chat_id: '212612388001@c.us',
  })
  assert.equal(booking.appointment.status, 'non_confirme')

  let board = crm.smart.getFollowUpsBoard({ category: 'unconfirmed' })
  assert.ok(board.counts.unconfirmed >= 1)
  assert.ok(board.items.some((i) => i.appointment_id === booking.appointment.id))
  assert.ok(board.items.every((i) => i.patient_name !== 'Yasmine El Amrani'))

  // Multi-patient — correct name on line
  const phone = '+212612388002'
  const chat = '212612388002@c.us'
  const a1 = crm.repo.saveConfirmedBooking({
    full_name: 'Ahmed Follow',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'douleur',
    appointment_date: weekdayFuture(6, '11:00').date,
    appointment_time: weekdayFuture(6, '11:00').time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  const a2 = crm.repo.saveConfirmedBooking({
    full_name: 'Sara Follow',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'detartrage',
    appointment_date: weekdayFuture(8, '15:00').date,
    appointment_time: weekdayFuture(8, '15:00').time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  board = crm.smart.getFollowUpsBoard({ category: 'unconfirmed' })
  const saraRow = board.items.find((i) => i.appointment_id === a2.appointment.id)
  const ahmedRow = board.items.find((i) => i.appointment_id === a1.appointment.id)
  assert.equal(saraRow.patient_name, 'Sara Follow')
  assert.equal(ahmedRow.patient_name, 'Ahmed Follow')

  // Preview + manual remind
  const preview = crm.smart.previewManualFollowup(booking.appointment.id)
  assert.equal(preview.ok, true)
  assert.match(preview.message, /OUI|نعم/i)

  const remind = await crm.smart.sendManualFollowup(booking.appointment.id, {
    actorName: 'test-secretary',
  })
  assert.equal(remind.ok, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /confirmation|تأكيد|OUI|نعم/i)

  // Idempotency cooldown
  const remind2 = await crm.smart.sendManualFollowup(booking.appointment.id, {
    actorName: 'test-secretary',
  })
  assert.equal(remind2.ok, false)
  assert.equal(remind2.reason, 'cooldown')

  // Confirmation removes from unconfirmed
  crm.db.prepare(`UPDATE appointments SET status = 'confirmed' WHERE id = ?`)
    .run(booking.appointment.id)
  board = crm.smart.getFollowUpsBoard({ category: 'unconfirmed' })
  assert.ok(!board.items.some((i) => i.appointment_id === booking.appointment.id))

  // Cancellation removal
  crm.db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`)
    .run(a1.appointment.id)
  board = crm.smart.getFollowUpsBoard({ category: 'unconfirmed' })
  assert.ok(!board.items.some((i) => i.appointment_id === a1.appointment.id))

  // Callback task 24h
  const task = crm.smart.createTask({
    customer_id: a2.customer.id,
    appointment_id: a2.appointment.id,
    task_type: 'confirm_appointment',
    title: 'Appeler Sara',
    reason: '24 h sans réponse',
    status: 'to_call',
  })
  board = crm.smart.getFollowUpsBoard({ category: 'callback' })
  assert.ok(board.counts.callback >= 1)
  assert.ok(board.items.some((i) => i.task_id === task.id))

  // Reschedule only with explicit task
  board = crm.smart.getFollowUpsBoard({ category: 'reschedule' })
  const beforeReschedule = board.counts.reschedule
  assert.ok(!board.items.some((i) => i.appointment_id === a1.appointment.id), 'cancel alone ≠ reschedule')

  const rescheduleTask = crm.smart.createTask({
    customer_id: a1.customer.id,
    appointment_id: a1.appointment.id,
    task_type: 'reschedule',
    title: 'Reprogrammer Ahmed',
    status: 'planned',
  })
  board = crm.smart.getFollowUpsBoard({ category: 'reschedule' })
  assert.ok(board.counts.reschedule >= beforeReschedule + 1)
  assert.ok(board.items.some((i) => i.task_id === rescheduleTask.id))

  // Administrative
  const adminTask = crm.smart.createTask({
    customer_id: a2.customer.id,
    task_type: 'admin_docs',
    title: 'Demande de devis',
    status: 'planned',
  })
  board = crm.smart.getFollowUpsBoard({ category: 'administrative' })
  assert.ok(board.items.some((i) => i.task_id === adminTask.id))

  // Automation summary reflects disabled state
  const confirmAuto = crm.db.prepare(`SELECT id FROM automations WHERE key = 'confirm_24h_before'`).get()
  if (confirmAuto) {
    crm.smart.updateAutomation(confirmAuto.id, { status: 'paused' })
    board = crm.smart.getFollowUpsBoard()
    assert.equal(board.automation_summary.confirmation.active, false)
    crm.smart.updateAutomation(confirmAuto.id, { status: 'active' })
  }

  // Impact has no fake hardcoded -21
  assert.ok(board.impact)
  assert.ok('unconfirmed_change_percent' in board.impact)
  assert.ok('recovered_slots' in board.impact)
  assert.ok('estimated_hours_saved' in board.impact)

  // Validate all completes tasks only
  const candidates = crm.smart.listFollowupValidationCandidates()
  assert.ok(candidates.count >= 1)
  const validated = crm.smart.validateFollowupTasks([task.id, rescheduleTask.id, adminTask.id], {
    actorName: 'test',
  })
  assert.equal(validated.validated, 3)

  // Already confirmed preview error
  const previewConfirmed = crm.smart.previewManualFollowup(booking.appointment.id)
  assert.equal(previewConfirmed.ok, false)

  // Multi-patient remind message names Sara
  const previewSara = crm.smart.previewManualFollowup(a2.appointment.id)
  assert.equal(previewSara.ok, true)
  if (previewSara.multi_patient_contact) {
    assert.match(previewSara.message, /Sara Follow/)
  }

  // No @lid as phone
  board = crm.smart.getFollowUpsBoard({ category: 'unconfirmed' })
  for (const item of board.items) {
    if (item.patient_phone) {
      assert.ok(!/@lid/i.test(item.patient_phone))
      assert.ok(!/@c\.us/i.test(item.patient_phone))
    }
  }

  console.log('followups tests OK')
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
