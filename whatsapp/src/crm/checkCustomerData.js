/**
 * Validates whether a CRM lead has all required fields before final save.
 */

const { validateFullName } = require('./extract')
const { isValidPhone } = require('./phone')

const REQUIRED_FIELDS = [
  'full_name',
  'phone_number',
  'city',
  'problem',
  'appointment',
]

/**
 * @typedef {object} CustomerLeadData
 * @property {string|null} [full_name]
 * @property {string|null} [phone_number]
 * @property {string|null} [city]
 * @property {string|null} [problem]
 * @property {string|null} [appointment_date]
 * @property {string|null} [appointment_time]
 */

/**
 * @param {CustomerLeadData} data
 * @returns {{
 *   ok: boolean,
 *   missing: string[],
 *   nextField: string|null,
 *   checks: Record<string, boolean>
 * }}
 */
function checkCustomerData(data = {}) {
  const fullName = validateFullName(data.full_name || '') || null
  const phoneOk = isValidPhone(data.phone_number || '')
  const cityOk = Boolean(String(data.city || '').trim())
  const problemOk = Boolean(String(data.problem || '').trim())
  const appointmentOk = Boolean(
    String(data.appointment_date || '').trim()
    && String(data.appointment_time || '').trim(),
  )

  const checks = {
    full_name: Boolean(fullName),
    phone_number: phoneOk,
    city: cityOk,
    problem: problemOk,
    appointment: appointmentOk,
  }

  const missing = REQUIRED_FIELDS.filter((field) => !checks[field])
  return {
    ok: missing.length === 0,
    missing,
    nextField: missing[0] || null,
    checks,
  }
}

module.exports = {
  checkCustomerData,
  REQUIRED_FIELDS,
}
