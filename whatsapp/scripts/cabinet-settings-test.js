/**
 * Cabinet settings — persistence, validation, booking rules.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const { createCabinetSettingsService, DEFAULT_APPOINTMENTS } = require('../src/crm/smart/cabinet-settings')

async function run() {
  const tmp = path.join(os.tmpdir(), `hel-settings-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })

  const appt = crm.smart.getAppointmentsSettings()
  assert.strictEqual(appt.slotDurationMinutes, DEFAULT_APPOINTMENTS.slotDurationMinutes)
  assert.strictEqual(appt.confirmationHoursBefore, undefined)

  const updated = crm.smart.updateAppointmentsSettings({ slotDurationMinutes: 45, minBookingLeadMinutes: 120 })
  assert.strictEqual(updated.slotDurationMinutes, 45)
  assert.strictEqual(crm.smart.getAppointmentsSettings().slotDurationMinutes, 45)

  const bad = crm.smart.updateAppointmentsSettings({ slotDurationMinutes: 999 })
  assert.strictEqual(bad.slotDurationMinutes, 30)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 7)
  const iso = tomorrow.toISOString().slice(0, 10)
  const check = crm.smart.validateBookingDateTime(iso, '11:00')
  assert.ok(check.ok)

  crm.smart.updateSecuritySettings({ sessionDurationHours: 24, idleLogoutEnabled: true, idleTimeoutMinutes: 30 })
  assert.strictEqual(crm.smart.getSessionTtlMs(), 24 * 60 * 60 * 1000)

  crm.smart.updateNotificationsSettings({ slotReleased: false })
  const n = crm.smart.createNotification({
    type: 'slot_released',
    title: 'test',
    source_event: 'appointment_cancelled',
  })
  assert.strictEqual(n, null)

  assert.strictEqual(crm.smart.getNotificationsSettings().appointmentCreated, true)
  crm.smart.updateNotificationsSettings({ appointmentCreated: false })
  assert.strictEqual(crm.smart.getNotificationsSettings().appointmentCreated, false)
  assert.strictEqual(
    crm.smart.createNotification({ type: 'appointment_created', title: 'Nouveau RDV' }),
    null,
  )

  crm.smart.updateAutomationsSettings({ masterEnabled: false })
  assert.strictEqual(crm.smart.getAutomationsSettings().masterEnabled, false)

  try { fs.unlinkSync(tmp) } catch { /* ignore */ }

  console.log('cabinet-settings-test: OK')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
