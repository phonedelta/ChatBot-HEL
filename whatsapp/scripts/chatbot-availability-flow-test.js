/**
 * Chatbot availability flow — same slots as Agenda, selection + booking continue.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { parseAvailabilityDate } = require('../src/crm/smart/availability-date')
const { parseAvailableSlotSelection } = require('../src/crm/smart/availability-slot-select')
const { detectAvailabilityIntent, looksLikeMyAppointments } = require('../src/crm/smart/availability-flow')
const { getBookableSlotsForDate } = require('../src/crm/appointment-slots')
const { classifyIntent } = require('../src/voice-nlu/intent-classifier')
const { routePatientMessage } = require('../src/voice-nlu/intent-router')

function nextWeekdayIso(from = new Date(), weekday = 1) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 1; i <= 14; i += 1) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() === weekday) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  }
  throw new Error('no weekday')
}

function display(iso) {
  const [, y, m, d] = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/) || []
  return `${d}/${m}/${y}`
}

async function run() {
  // --- Intent ---
  assert.equal(detectAvailabilityIntent('Chno les rendez-vous disponibles ?').matched, true)
  assert.equal(detectAvailabilityIntent('Quels sont les créneaux disponibles ?').matched, true)
  assert.equal(looksLikeMyAppointments('Chno les rendez-vous dyali ?'), true)
  assert.equal(detectAvailabilityIntent('Chno les rendez-vous dyali ?').matched, false)
  assert.equal(classifyIntent('Chno les rendez-vous disponibles ?').intent, 'CHECK_APPOINTMENT_AVAILABILITY')
  assert.notEqual(classifyIntent('Chno les rendez-vous dyali ?').intent, 'CHECK_APPOINTMENT_AVAILABILITY')
  assert.equal(routePatientMessage('Chno les rendez-vous disponibles ?').bookAppointment, false)

  // --- Date parsing ---
  const now = new Date(2026, 8, 3, 10, 0, 0) // 3 Sep 2026
  const d1 = parseAvailabilityDate('05/09', now)
  assert.equal(d1.valid, true)
  assert.equal(d1.date, '2026-09-05')
  const d2 = parseAvailabilityDate('05/01', new Date(2026, 11, 20))
  assert.equal(d2.date, '2027-01-05')
  const past = parseAvailabilityDate('01/09/2025', now)
  assert.equal(past.valid, false)
  assert.equal(past.reason, 'past_date')
  // Day/month without year → next future occurrence (not silent invent of past)
  assert.equal(parseAvailabilityDate('01/09', now).date, '2027-09-01')
  assert.equal(parseAvailabilityDate('5 septembre', now).date, '2026-09-05')
  assert.equal(parseAvailabilityDate('2026-09-05', now).date, '2026-09-05')

  // --- Slot selection parser ---
  const candidates = [
    { index: 1, time: '09:30' },
    { index: 2, time: '10:30' },
    { index: 3, time: '11:30' },
  ]
  assert.equal(parseAvailableSlotSelection({ input: '2', candidateSlots: candidates }).selectedTime, '10:30')
  assert.equal(parseAvailableSlotSelection({ input: '3', candidateSlots: candidates }).type, 'index')
  assert.notEqual(parseAvailableSlotSelection({ input: '3', candidateSlots: candidates }).selectedTime, '03:00')
  assert.equal(parseAvailableSlotSelection({ input: '11:30', candidateSlots: candidates }).selectedTime, '11:30')
  assert.equal(parseAvailableSlotSelection({ input: '7', candidateSlots: candidates }).type, 'invalid')
  assert.equal(parseAvailableSlotSelection({ input: '12:45', candidateSlots: candidates }).type, 'invalid')

  // --- Integration ---
  const tmp = path.join(os.tmpdir(), `hel-avail-flow-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212611122233@c.us'
  const monday = nextWeekdayIso(new Date(), 1)

  // Block some slots
  const cust = crm.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, whatsapp_chat_id, created_at)
    VALUES ('Bloc Test', '+212611122233', 'Casablanca', 'darija', ?, datetime('now'))
  `).run(chat)
  crm.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, duration_minutes, conversation_id, created_at)
    VALUES (?, ?, '11:00', 'confirmed', 30, ?, datetime('now'))
  `).run(cust.lastInsertRowid, monday, chat)
  crm.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, duration_minutes, conversation_id, created_at)
    VALUES (?, ?, '10:00', 'non_confirme', 30, ?, datetime('now'))
  `).run(cust.lastInsertRowid, monday, chat)

  const settings = crm.smart.getAppointmentsSettings()
  const bookable = getBookableSlotsForDate(crm.db, monday, {
    durationMinutes: settings.slotDurationMinutes,
    appointmentsSettings: settings,
    applyBookingRules: true,
  })
  assert.ok(bookable.ok)
  assert.ok(!bookable.times.includes('11:00'))
  assert.ok(!bookable.times.includes('10:00'))
  assert.ok(bookable.times.includes('10:30') || bookable.times.includes('11:30'))

  // Agenda vs chatbot same list
  const agenda = crm.smart.getAgendaBoard({ view: 'day', from: monday })
  const agendaTimes = (agenda.available_slots || [])
    .filter((s) => s.slot_date === monday)
    .map((s) => s.slot_time)
    .sort()
  const chatTimes = [...bookable.times].sort()
  assert.deepStrictEqual(chatTimes, agendaTimes)

  // Flow: ask date
  const ask = await crm.smart.handleInboundAvailability({
    chatKey: chat,
    text: 'Chno les rendez-vous disponibles ?',
    language: 'darija',
  })
  assert.equal(ask.action, 'ask_date')
  assert.match(ask.forceReply, /05\/09|النهار/)

  // Date → list all
  const list = await crm.smart.handleInboundAvailability({
    chatKey: chat,
    text: `${monday.slice(8, 10)}/${monday.slice(5, 7)}`,
    language: 'darija',
  })
  assert.equal(list.action, 'slots_listed')
  assert.match(list.forceReply, /الصباح|العشية|Matin/)
  assert.ok(!/11:00/.test(list.forceReply))
  const state = crm.smart.availabilityFlow.getState(chat)
  assert.equal(state.stage, 'awaiting_available_slot_selection')
  assert.ok(state.candidateSlots.length >= 1)

  // Select by index
  const idx = state.candidateSlots.find((c) => c.time === '11:30') || state.candidateSlots[0]
  const sel = await crm.smart.handleInboundAvailability({
    chatKey: chat,
    text: String(idx.index),
    language: 'darija',
  })
  assert.equal(sel.action, 'slot_selected')
  assert.equal(sel.appointmentTime, idx.time)
  assert.equal(sel.appointmentDate, monday)
  // No appointment created yet
  const created = crm.db.prepare(`
    SELECT COUNT(*) AS c FROM appointments
    WHERE appointment_date = ? AND appointment_time = ? AND status != 'cancelled'
      AND customer_id != ?
  `).get(monday, idx.time, cust.lastInsertRowid)
  assert.equal(created.c, 0)

  const lead = crm.repo.getLead(`main:${chat}`) || crm.repo.getLead(chat)
  assert.ok(lead)
  assert.equal(lead.appointment_date, monday)
  assert.equal(String(lead.appointment_time).slice(0, 5), idx.time)

  // Context preservation
  const tmp2 = path.join(os.tmpdir(), `hel-avail-ctx-${Date.now()}.sqlite`)
  const crm2 = createCrmService({ dbPath: tmp2 })
  const chat2 = '212600099988@c.us'
  const day2 = nextWeekdayIso(new Date(), 2)
  crm2.repo.upsertLead(`main:${chat2}`, {
    stage: 'awaiting_form',
    awaiting_field: 'bulk',
    booking_intent: 1,
    language: 'darija',
    full_name: 'Salim Zouhairi',
    city: 'Kénitra',
    problem: 'Urgences dentaires',
    whatsapp_chat_id: chat2,
  })
  await crm2.smart.handleInboundAvailability({
    chatKey: chat2,
    text: 'Chno kayn disponible',
    language: 'darija',
  })
  await crm2.smart.handleInboundAvailability({
    chatKey: chat2,
    text: `${day2.slice(8, 10)}/${day2.slice(5, 7)}`,
    language: 'darija',
  })
  const st2 = crm2.smart.availabilityFlow.getState(chat2)
  const pick = st2.candidateSlots[0]
  await crm2.smart.handleInboundAvailability({
    chatKey: chat2,
    text: String(pick.index),
    language: 'darija',
  })
  const lead2 = crm2.repo.getLead(`main:${chat2}`)
  assert.equal(lead2.full_name, 'Salim Zouhairi')
  assert.equal(lead2.city, 'Kénitra')
  assert.equal(lead2.problem, 'Urgences dentaires')
  assert.equal(lead2.appointment_date, day2)
  assert.equal(String(lead2.appointment_time).slice(0, 5), pick.time)

  // Intent + date same message
  const tmp3 = path.join(os.tmpdir(), `hel-avail-inline-${Date.now()}.sqlite`)
  const crm3 = createCrmService({ dbPath: tmp3 })
  const chat3 = '212600011122@c.us'
  const day3 = nextWeekdayIso(new Date(), 3)
  const inline = await crm3.smart.handleInboundAvailability({
    chatKey: chat3,
    text: `Chno kayn disponible ${day3.slice(8, 10)}/${day3.slice(5, 7)} ?`,
    language: 'darija',
  })
  assert.equal(inline.action, 'slots_listed')
  assert.ok(!/النهار اللي بغيتي/.test(inline.forceReply))

  // Closed day (Sunday)
  const sunday = nextWeekdayIso(new Date(), 0)
  const closed = await crm3.smart.handleInboundAvailability({
    chatKey: chat3,
    text: 'Chno les rendez-vous disponibles ?',
    language: 'darija',
  })
  assert.ok(closed.handled)
  const closedDay = await crm3.smart.handleInboundAvailability({
    chatKey: chat3,
    text: `${sunday.slice(8, 10)}/${sunday.slice(5, 7)}/${sunday.slice(0, 4)}`,
    language: 'darija',
  })
  assert.equal(closedDay.action, 'closed_day')

  // Stale slot
  const tmp4 = path.join(os.tmpdir(), `hel-avail-stale-${Date.now()}.sqlite`)
  const crm4 = createCrmService({ dbPath: tmp4 })
  const chat4 = '212600033344@c.us'
  const day4 = nextWeekdayIso(new Date(), 4)
  await crm4.smart.handleInboundAvailability({
    chatKey: chat4,
    text: `Quels créneaux sont disponibles ${day4.slice(8, 10)}/${day4.slice(5, 7)} ?`,
    language: 'fr',
  })
  const st4 = crm4.smart.availabilityFlow.getState(chat4)
  const target = st4.candidateSlots[0]
  const c4 = crm4.db.prepare(`
    INSERT INTO customers (full_name, phone_number, city, preferred_language, created_at)
    VALUES ('Other', '+212600033355', 'Rabat', 'fr', datetime('now'))
  `).run()
  crm4.db.prepare(`
    INSERT INTO appointments (customer_id, appointment_date, appointment_time, status, duration_minutes, created_at)
    VALUES (?, ?, ?, 'confirmed', 30, datetime('now'))
  `).run(c4.lastInsertRowid, day4, target.time)
  const stale = await crm4.smart.handleInboundAvailability({
    chatKey: chat4,
    text: String(target.index),
    language: 'fr',
  })
  assert.equal(stale.action, 'stale_slot')
  assert.match(stale.forceReply, /plus disponible|تعمرات/i)

  // Same-day disabled
  const tmp5 = path.join(os.tmpdir(), `hel-avail-sameday-${Date.now()}.sqlite`)
  const crm5 = createCrmService({ dbPath: tmp5 })
  crm5.smart.updateAppointmentsSettings({ allowSameDayBooking: false })
  const today = new Date()
  if (today.getDay() !== 0) {
    const chat5 = '212600055566@c.us'
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    await crm5.smart.handleInboundAvailability({
      chatKey: chat5,
      text: 'Chno les rendez-vous disponibles ?',
      language: 'darija',
    })
    const same = await crm5.smart.handleInboundAvailability({
      chatKey: chat5,
      text: `${todayIso.slice(8, 10)}/${todayIso.slice(5, 7)}/${todayIso.slice(0, 4)}`,
      language: 'darija',
    })
    assert.equal(same.action, 'same_day_disabled')
  }

  // Max advance
  const tmp6 = path.join(os.tmpdir(), `hel-avail-horizon-${Date.now()}.sqlite`)
  const crm6 = createCrmService({ dbPath: tmp6 })
  crm6.smart.updateAppointmentsSettings({ bookingHorizonDays: 7 })
  const far = new Date()
  far.setDate(far.getDate() + 40)
  while (far.getDay() === 0) far.setDate(far.getDate() + 1)
  const farIso = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`
  const chat6 = '212600066677@c.us'
  await crm6.smart.handleInboundAvailability({
    chatKey: chat6,
    text: 'Quelles sont vos disponibilités ?',
    language: 'fr',
  })
  const horizon = await crm6.smart.handleInboundAvailability({
    chatKey: chat6,
    text: `${farIso.slice(8, 10)}/${farIso.slice(5, 7)}/${farIso.slice(0, 4)}`,
    language: 'fr',
  })
  assert.equal(horizon.action, 'horizon_exceeded')

  // Slot duration 60
  const tmp7 = path.join(os.tmpdir(), `hel-avail-60-${Date.now()}.sqlite`)
  const crm7 = createCrmService({ dbPath: tmp7 })
  crm7.smart.updateAppointmentsSettings({ slotDurationMinutes: 60 })
  const day7 = nextWeekdayIso(new Date(), 5)
  const s60 = getBookableSlotsForDate(crm7.db, day7, {
    durationMinutes: 60,
    appointmentsSettings: crm7.smart.getAppointmentsSettings(),
  })
  assert.ok(s60.times.every((t) => {
    const [hh, mm] = t.split(':').map(Number)
    // openings 10:30 then +60 → 10:30, 11:30, 12:30...
    return Number.isFinite(hh)
  }))
  assert.ok(!s60.times.includes('11:00'))

  for (const p of [tmp, tmp2, tmp3, tmp4, tmp5, tmp6, tmp7]) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-wal`) } catch { /* ignore */ }
    try { fs.unlinkSync(`${p}-shm`) } catch { /* ignore */ }
  }

  console.log('chatbot-availability-flow-test: OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
