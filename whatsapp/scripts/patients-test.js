/**
 * Patients board tests — list, search shared phone, next appointment, context.
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
  const tmp = path.join(os.tmpdir(), `hel-patients-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })

  const slot = weekdayFuture(5, '11:30')
  const b1 = crm.repo.saveConfirmedBooking({
    full_name: 'Ahmed Patients',
    phone_number: '+212612377001',
    city: 'Casablanca',
    problem: 'Contrôle',
    appointment_date: slot.date,
    appointment_time: slot.time,
    conversation_id: '212612377001@c.us',
    whatsapp_chat_id: '212612377001@c.us',
  })

  // Shared phone — 3 patients
  const phone = '+212612377002'
  const chat = '212612377002@c.us'
  const a = crm.repo.saveConfirmedBooking({
    full_name: 'Ahmed Shared',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'douleur',
    appointment_date: weekdayFuture(6, '11:00').date,
    appointment_time: weekdayFuture(6, '11:00').time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  const s = crm.repo.saveConfirmedBooking({
    full_name: 'Sara Shared',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'detartrage',
    appointment_date: weekdayFuture(8, '15:00').date,
    appointment_time: weekdayFuture(8, '15:00').time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  const adamSlot = weekdayFuture(10, '10:30')
  const d = crm.repo.saveConfirmedBooking({
    full_name: 'Adam Shared',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'blanchiment',
    appointment_date: adamSlot.date,
    appointment_time: adamSlot.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })

  // List
  let board = crm.smart.listPatientsBoard({ limit: 50 })
  assert.ok(board.summary.patients >= 4)
  assert.ok(board.patients.some((p) => p.id === b1.customer.id))
  assert.ok(board.patients.every((p) => p.full_name !== 'Yasmine El Amrani'))

  // Search shared phone returns 3
  board = crm.smart.listPatientsBoard({ query: '0612377002', limit: 50 })
  const sharedHits = board.patients.filter((p) => (
    [a.customer.id, s.customer.id, d.customer.id].includes(p.id)
  ))
  assert.ok(sharedHits.length >= 3, 'shared phone search must return multiple patients')

  // Shared contact badge
  const sara = board.patients.find((p) => p.id === s.customer.id)
  assert.ok(sara)
  assert.equal(sara.contact.shared, true)
  assert.ok(sara.contact.linked_patients_count >= 3)
  assert.ok(!/@lid/i.test(String(sara.phone_number || '')))
  assert.ok(!/@c\.us/i.test(String(sara.phone_number || '')))

  // Next appointment
  assert.ok(sara.next_appointment)
  assert.equal(sara.next_appointment.status, 'non_confirme')
  assert.equal(sara.next_action.type, 'CONFIRM_APPOINTMENT')

  // Confirm → next action none (if no other task)
  crm.db.prepare(`UPDATE appointments SET status = 'confirmed' WHERE id = ?`)
    .run(s.appointment.id)
  board = crm.smart.listPatientsBoard({ query: 'Sara Shared' })
  const sara2 = board.patients.find((p) => p.id === s.customer.id)
  assert.equal(sara2.next_appointment.status, 'confirmed')
  assert.equal(sara2.next_action.type, 'NONE')

  // Cancelled ignored as next
  crm.db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`)
    .run(a.appointment.id)
  board = crm.smart.listPatientsBoard({ query: 'Ahmed Shared' })
  const ahmed = board.patients.find((p) => p.id === a.customer.id)
  assert.equal(ahmed.next_appointment, null)
  assert.equal(ahmed.has_upcoming_appointment, false)

  // Filters
  board = crm.smart.listPatientsBoard({ filter: 'to_confirm' })
  assert.ok(board.patients.every((p) => p.needs_confirmation))

  board = crm.smart.listPatientsBoard({ filter: 'no_appointment' })
  assert.ok(board.patients.some((p) => p.id === a.customer.id))

  // Callback filter
  const task = crm.smart.createTask({
    customer_id: d.customer.id,
    appointment_id: d.appointment.id,
    task_type: 'confirm_appointment',
    title: 'Appeler',
    status: 'to_call',
  })
  board = crm.smart.listPatientsBoard({ filter: 'to_call' })
  assert.ok(board.patients.some((p) => p.id === d.customer.id))

  // Context drawer
  const ctx = crm.smart.getPatientContext(s.customer.id)
  assert.ok(ctx)
  assert.equal(ctx.patient.full_name, 'Sara Shared')
  assert.ok(ctx.linked_patients.some((p) => p.full_name === 'Ahmed Shared' || p.full_name === 'Adam Shared'))
  assert.ok(Array.isArray(ctx.timeline))

  // Pagination
  board = crm.smart.listPatientsBoard({ page: 1, limit: 2 })
  assert.equal(board.patients.length, 2)
  assert.ok(board.pagination.total >= 4)

  // Manual create
  const created = crm.smart.createManualPatient({
    fullName: 'Nouvelle Patiente',
    phoneNumber: '+212612377099',
    city: 'Rabat',
    language: 'darija',
  })
  assert.equal(created.ok, true)
  assert.equal(created.patient.full_name, 'Nouvelle Patiente')

  console.log('patients tests OK', { taskId: task.id })
  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
