/**
 * Analytics board — period filters, KPIs, daily series, confirmation, handoff, intents.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  createAnalyticsBoard,
  resolvePeriod,
  intentLabel,
} = require('../src/crm/smart/analytics-board')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function localDayOffset(daysAgo, hour = 10) {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  const isoDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const iso = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    hour,
    15,
    0,
  ).toISOString()
  return { isoDate, iso, date: d }
}

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
  // --- resolvePeriod ---
  const period = resolvePeriod({ days: 14 })
  assert.equal(period.days, 14)
  assert.ok(period.from)
  assert.ok(period.to)
  assert.ok(period.previous_from)
  assert.ok(period.previous_to)

  // --- intent labels (no raw enums) ---
  assert.equal(intentLabel('BOOK_APPOINTMENT'), 'Prise de rendez-vous')
  assert.equal(intentLabel('UNKNOWN'), 'Autres demandes')
  assert.equal(intentLabel('ASK_HOURS'), 'Horaires')

  const tmp = path.join(os.tmpdir(), `hel-analytics-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const db = crm.db

  // Seed appointments across days
  const slots = [
    weekdayFuture(5, '10:00'),
    weekdayFuture(6, '11:00'),
    weekdayFuture(7, '15:00'),
  ]

  const b1 = crm.repo.saveConfirmedBooking({
    full_name: 'Ana Analytics',
    phone_number: '+212612399001',
    city: 'Casablanca',
    problem: 'Prise de rendez-vous',
    appointment_date: slots[0].date,
    appointment_time: slots[0].time,
    conversation_id: '212612399001@c.us',
    whatsapp_chat_id: '212612399001@c.us',
  })
  const b2 = crm.repo.saveConfirmedBooking({
    full_name: 'Bilal Analytics',
    phone_number: '+212612399002',
    city: 'Rabat',
    problem: 'Horaires',
    appointment_date: slots[1].date,
    appointment_time: slots[1].time,
    conversation_id: '212612399002@c.us',
    whatsapp_chat_id: '212612399002@c.us',
  })
  const b3 = crm.repo.saveConfirmedBooking({
    full_name: 'Camille Analytics',
    phone_number: '+212612399003',
    city: 'Casablanca',
    problem: 'Annulation',
    appointment_date: slots[2].date,
    appointment_time: slots[2].time,
    conversation_id: '212612399003@c.us',
    whatsapp_chat_id: '212612399003@c.us',
  })

  // Backdate created_at for cohort / daily series
  const day0 = localDayOffset(0)
  const day2 = localDayOffset(2)
  const day5 = localDayOffset(5)
  const day20 = localDayOffset(20) // outside 14d window

  db.prepare('UPDATE appointments SET created_at = ? WHERE id = ?').run(day0.iso, b1.appointment.id)
  db.prepare('UPDATE appointments SET created_at = ? WHERE id = ?').run(day2.iso, b2.appointment.id)
  db.prepare('UPDATE appointments SET created_at = ? WHERE id = ?').run(day5.iso, b3.appointment.id)

  // Confirm b1 with whatsapp_patient (auto)
  db.prepare(`
    UPDATE appointments
    SET status = 'confirmed', confirmed_at = ?, confirmation_source = 'whatsapp_patient'
    WHERE id = ?
  `).run(day0.iso, b1.appointment.id)

  // Confirm b2 with staff (not auto)
  db.prepare(`
    UPDATE appointments
    SET status = 'confirmed', confirmed_at = ?, confirmation_source = 'staff_dashboard'
    WHERE id = ?
  `).run(day2.iso, b2.appointment.id)

  // Extra appointment outside period
  const oldSlot = weekdayFuture(12, '09:00')
  const old = crm.repo.saveConfirmedBooking({
    full_name: 'Old Outside',
    phone_number: '+212612399099',
    city: 'Fes',
    problem: 'Contrôle',
    appointment_date: oldSlot.date,
    appointment_time: oldSlot.time,
    conversation_id: '212612399099@c.us',
    whatsapp_chat_id: '212612399099@c.us',
  })
  db.prepare('UPDATE appointments SET created_at = ? WHERE id = ?').run(day20.iso, old.appointment.id)

  // Conversations + messages
  const conv1 = crm.smart.getOrCreateConversation({
    external_key: '212612399001@c.us',
    customer_id: b1.customer.id,
    phone_number: '+212612399001',
  })
  const conv2 = crm.smart.getOrCreateConversation({
    external_key: '212612399002@c.us',
    customer_id: b2.customer.id,
    phone_number: '+212612399002',
  })

  // Patient messages (inbound) + AI replies
  for (let i = 0; i < 8; i += 1) {
    crm.smart.addMessage(conv1.id, {
      direction: 'inbound',
      author_type: 'patient',
      body: `Message patient ${i}`,
      created_at: day0.iso,
      external_message_id: `in-${i}`,
    })
  }
  for (let i = 0; i < 2; i += 1) {
    crm.smart.addMessage(conv1.id, {
      direction: 'outbound',
      author_type: 'ai',
      body: `Réponse IA ${i}`,
      created_at: day0.iso,
      external_message_id: `out-ai-${i}`,
    })
  }

  // Previous period messages (for comparison)
  for (let i = 0; i < 4; i += 1) {
    crm.smart.addMessage(conv2.id, {
      direction: 'inbound',
      author_type: 'patient',
      body: `Ancien message ${i}`,
      created_at: day20.iso,
      external_message_id: `old-in-${i}`,
    })
  }

  // Handoff transition (not just final state)
  crm.smart.setHandoff(conv1.id, { owner: 'HUMAN', owner_user: 'Secrétaire' })
  // Return to AI — handoff should still count
  crm.smart.setHandoff(conv1.id, { owner: 'AI' })

  // Followups + confirmation messages
  crm.smart.logAiAction({
    conversation_id: conv1.id,
    customer_id: b1.customer.id,
    action_type: 'confirmation_request_sent',
    reason: 'Demande de confirmation',
    actor_type: 'ai',
  })
  crm.smart.logAiAction({
    conversation_id: conv1.id,
    customer_id: b1.customer.id,
    action_type: 'followup_sent',
    reason: 'Relance de confirmation',
    actor_type: 'ai',
  })
  // Force created_at on those actions into period
  db.prepare(`
    UPDATE ai_actions
    SET created_at = ?
    WHERE action_type IN ('confirmation_request_sent', 'followup_sent', 'handoff_to_human', 'handoff_to_ai')
  `).run(day0.iso)

  // Recovered slot: cancel then refill same slot
  const cancelSlot = weekdayFuture(9, '14:00')
  const cancelled = crm.repo.saveConfirmedBooking({
    full_name: 'Cancel Then Fill',
    phone_number: '+212612399010',
    city: 'Casablanca',
    problem: 'detartrage',
    appointment_date: cancelSlot.date,
    appointment_time: cancelSlot.time,
    conversation_id: '212612399010@c.us',
    whatsapp_chat_id: '212612399010@c.us',
  })
  db.prepare(`
    UPDATE appointments
    SET status = 'cancelled', cancelled_at = ?, created_at = ?
    WHERE id = ?
  `).run(day0.iso, day2.iso, cancelled.appointment.id)

  const refill = crm.repo.saveConfirmedBooking({
    full_name: 'Slot Refill',
    phone_number: '+212612399011',
    city: 'Casablanca',
    problem: 'controle',
    appointment_date: cancelSlot.date,
    appointment_time: cancelSlot.time,
    conversation_id: '212612399011@c.us',
    whatsapp_chat_id: '212612399011@c.us',
  })
  db.prepare('UPDATE appointments SET created_at = ? WHERE id = ?').run(day0.iso, refill.appointment.id)

  // Intent-like ai_actions
  crm.smart.logAiAction({
    conversation_id: conv1.id,
    action_type: 'intent_detected',
    reason: 'BOOK_APPOINTMENT',
    result: 'BOOK_APPOINTMENT',
    actor_type: 'ai',
  })
  db.prepare(`
    UPDATE ai_actions SET created_at = ? WHERE result = 'BOOK_APPOINTMENT'
  `).run(day0.iso)

  // --- analytics-period-filter ---
  const summary14 = crm.smart.getAnalyticsSummary({ days: 14 })
  assert.equal(summary14.period.days, 14)
  assert.ok(summary14.kpis)
  assert.ok(summary14.appointments_trend)

  const summary7 = crm.smart.getAnalyticsSummary({ days: 7 })
  assert.equal(summary7.period.days, 7)

  // --- analytics-patient-messages ---
  assert.equal(summary14.kpis.patient_messages.value, 8)

  // --- analytics-auto-handled-rate ---
  // Formule: réponses IA outbound ÷ messages patients inbound × 100
  assert.match(summary14.formulas.auto_handled_rate, /réponses IA outbound/i)
  assert.ok(summary14.automation.messages_handled_automatically >= 2)
  const expectedAuto = Math.round(
    (Math.min(summary14.automation.messages_handled_automatically, 8) / 8) * 1000,
  ) / 10
  assert.equal(summary14.kpis.auto_handled_rate.value, expectedAuto)

  // --- analytics-appointments-created ---
  // b1, b2, b3 + refill in period (cancelled may also count if created in period)
  assert.ok(summary14.kpis.appointments_created.value >= 3)

  // --- analytics-confirmation-rate (cohort) ---
  // Among created in period: b1+b2 confirmed (whatsapp + staff), b3 still non_confirme, + refill etc.
  assert.ok(summary14.kpis.confirmation_rate.value >= 0)
  assert.ok(summary14.appointment_confirmation.confirmed >= 2)
  assert.match(summary14.formulas.confirmation_rate, /cohorte/i)

  // --- analytics-confirmation-source ---
  assert.equal(summary14.appointment_confirmation.automatic_confirmed, 1)
  assert.equal(summary14.impact.automatic_confirmations, 1)

  // --- analytics-daily-appointments-series + zero-fill ---
  assert.equal(summary14.appointments_trend.length, 14)
  const zeros = summary14.appointments_trend.filter((d) => d.created === 0)
  assert.ok(zeros.length > 0, 'missing days must be zero-filled')
  const day0Row = summary14.appointments_trend.find((d) => d.date === day0.isoDate)
  assert.ok(day0Row)
  assert.ok(day0Row.created >= 1)
  assert.ok(day0Row.confirmed >= 1)

  // Linear fake line forbidden: not all equal if multiple days have data
  const createdVals = summary14.appointments_trend.map((d) => d.created)
  assert.ok(createdVals.some((v) => v === 0))
  assert.ok(createdVals.some((v) => v > 0))

  // --- analytics-handoff-rate ---
  assert.ok(summary14.automation.handoffs >= 1)
  assert.ok(summary14.automation.handoff_rate > 0)

  // --- analytics-recovered-slots ---
  assert.ok(summary14.impact.recovered_slots >= 1)

  // --- analytics-top-intents ---
  assert.ok(Array.isArray(summary14.top_intents))
  for (const intent of summary14.top_intents) {
    assert.ok(!/^[A-Z_]+$/.test(intent.label), `raw enum leaked: ${intent.label}`)
  }

  // --- analytics-period-comparison ---
  assert.ok(summary14.kpis.patient_messages.previous != null)
  assert.equal(summary14.kpis.patient_messages.previous, 4)
  assert.ok(summary14.kpis.patient_messages.change_percent != null)
  assert.equal(summary14.kpis.patient_messages.change_percent, 100)

  // Board direct unit
  const board = createAnalyticsBoard(db, { listAiActions: () => crm.smart.listAiActions({ limit: 5 }) })
  const series = board.dailyAppointmentSeries(summary14.period.from, summary14.period.to)
  assert.equal(series.length, 14)

  try {
    fs.unlinkSync(tmp)
  } catch { /* ignore */ }

  console.log('analytics-test: OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
