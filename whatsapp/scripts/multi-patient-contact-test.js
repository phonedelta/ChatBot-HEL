/**
 * Multi-patient per WhatsApp contact — identity & booking tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { normalizePersonName } = require('../src/crm/contact-patients')

function weekdayFuture(daysAhead = 3, time = '11:30') {
  for (let i = daysAhead; i < daysAhead + 14; i += 1) {
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
  assert.equal(normalizePersonName(' Sara   Benali '), 'sara benali')
  assert.equal(normalizePersonName('SARA BENALI'), 'sara benali')

  const tmp = path.join(os.tmpdir(), `hel-multi-patient-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const phone = '+212612345678'
  const chat = '212612345678@c.us'
  const slot1 = weekdayFuture(3, '11:00')
  const slot2 = weekdayFuture(5, '16:00')
  const slot3 = weekdayFuture(7, '11:30')

  // Booking 1 — Ahmed
  const b1 = crm.repo.saveConfirmedBooking({
    full_name: 'Ahmed Benali',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'douleur',
    appointment_date: slot1.date,
    appointment_time: slot1.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
    urgency: 'moyenne',
  })
  assert.ok(b1.customer.id)
  assert.ok(b1.contact?.id)
  assert.equal(b1.customer.full_name, 'Ahmed Benali')

  // Booking 2 — Sara same phone (must NOT overwrite Ahmed)
  const b2 = crm.repo.saveConfirmedBooking({
    full_name: 'Sara Benali',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'controle',
    appointment_date: slot2.date,
    appointment_time: slot2.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
    urgency: 'moyenne',
  })
  assert.notEqual(b2.customer.id, b1.customer.id)
  assert.equal(b2.customer.full_name, 'Sara Benali')
  assert.equal(b2.contact.id, b1.contact.id)

  const ahmedStill = crm.db.prepare('SELECT * FROM customers WHERE id = ?').get(b1.customer.id)
  assert.equal(ahmedStill.full_name, 'Ahmed Benali')

  // Booking 3 — Adam
  const b3 = crm.repo.saveConfirmedBooking({
    full_name: 'Adam Benali',
    phone_number: phone,
    city: 'Rabat',
    problem: 'detartrage',
    appointment_date: slot3.date,
    appointment_time: slot3.time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  assert.notEqual(b3.customer.id, b1.customer.id)
  assert.notEqual(b3.customer.id, b2.customer.id)
  assert.equal(b3.contact.id, b1.contact.id)

  // Linked patients count
  const linked = crm.db.prepare(`
    SELECT COUNT(*) AS c FROM contact_patients WHERE whatsapp_contact_id = ?
  `).get(b1.contact.id)
  assert.equal(linked.c, 3)

  // Reuse Ahmed on same contact
  const b4 = crm.repo.saveConfirmedBooking({
    full_name: 'Ahmed Benali',
    phone_number: phone,
    city: 'Casablanca',
    problem: 'suivi',
    appointment_date: weekdayFuture(9, '12:00').date,
    appointment_time: weekdayFuture(9, '12:00').time,
    conversation_id: chat,
    whatsapp_chat_id: chat,
  })
  assert.equal(b4.customer.id, b1.customer.id)

  // Phone search returns all three patients
  const hits = crm.repo.listCustomers({ query: '0612345678', limit: 20 })
  const names = hits.map((h) => h.full_name).sort()
  assert.ok(names.includes('Ahmed Benali'))
  assert.ok(names.includes('Sara Benali'))
  assert.ok(names.includes('Adam Benali'))

  // findCustomersByPhone
  const byPhone = crm.repo.findCustomersByPhone(phone)
  assert.ok(byPhone.length >= 3)

  // Confirmation disambiguation when 2 pending on same chat
  if (crm.smart.registerBookingCreated) {
    crm.smart.registerBookingCreated(b1.appointment.id, { chatKey: chat, language: 'fr' })
    crm.smart.registerBookingCreated(b2.appointment.id, { chatKey: chat, language: 'fr' })
    // Mark both as sent
    crm.db.prepare(`
      UPDATE appointment_confirmation_requests
      SET initial_sent_at = datetime('now'), status = 'pending'
      WHERE appointment_id IN (?, ?)
    `).run(b1.appointment.id, b2.appointment.id)

    const reply = await crm.smart.handleInboundConfirmationReply({
      chatKey: chat,
      text: 'OUI',
    })
    assert.equal(reply?.action, 'disambiguate')
    assert.ok(reply?.forceReply)
    assert.match(reply.forceReply, /Ahmed|Sara/)

    // Neither confirmed yet
    const a1 = crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(b1.appointment.id)
    const a2 = crm.db.prepare('SELECT status FROM appointments WHERE id = ?').get(b2.appointment.id)
    assert.equal(a1.status, 'non_confirme')
    assert.equal(a2.status, 'non_confirme')
  }

  // Persistence after reopen
  const crm2 = createCrmService({ dbPath: tmp })
  const linked2 = crm2.db.prepare(`
    SELECT COUNT(*) AS c FROM contact_patients WHERE whatsapp_contact_id = ?
  `).get(b1.contact.id)
  assert.equal(linked2.c, 3)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  console.log('multi-patient-contact tests OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
