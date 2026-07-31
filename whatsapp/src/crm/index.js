/**
 * Centre Dentaire HEL — CRM module
 *
 * Collects patient data after appointment confirmation and persists:
 * customers → dental_cases / appointments
 */

const path = require('path')
const { openCrmDatabase } = require('./db')
const { createCrmRepository } = require('./repository')
const { createCrmWorkflow } = require('./workflow')
const { checkCustomerData } = require('./checkCustomerData')
const { extractCustomerSignals, validateFullName } = require('./extract')
const { toE164, formatPhoneDisplay, isValidPhone } = require('./phone')
const {
  bookingFormMessage,
  askMissingField,
  askConfirmation,
  patientConfirmationMessage,
  staffNotificationText,
} = require('./messages')
const {
  validateAppointmentHours,
  outsideWorkingHoursMessage,
  WEEKLY_HOURS,
} = require('./working-hours')

/**
 * @param {{ dbPath?: string }} [options]
 */
function createCrmService(options = {}) {
  const dbPath = options.dbPath
    || process.env.CRM_DB_PATH
    || path.join(process.cwd(), 'storage', 'crm.sqlite')

  const db = openCrmDatabase(dbPath)
  const repo = createCrmRepository(db)
  const workflow = createCrmWorkflow(repo)

  return {
    dbPath,
    db,
    repo,
    workflow,
    checkCustomerData,
    extractCustomerSignals,
    validateFullName,
    toE164,
    formatPhoneDisplay,
    isValidPhone,
    bookingFormMessage,
    askMissingField,
    askConfirmation,
    patientConfirmationMessage,
    staffNotificationText,
    validateAppointmentHours,
    outsideWorkingHoursMessage,
    WEEKLY_HOURS,
    processCrmTurn: (...args) => workflow.processCrmTurn(...args),
    resetConversation: (...args) => workflow.resetConversation(...args),
  }
}

module.exports = {
  createCrmService,
  checkCustomerData,
  extractCustomerSignals,
  validateFullName,
  validateAppointmentHours,
  outsideWorkingHoursMessage,
  WEEKLY_HOURS,
  toE164,
  formatPhoneDisplay,
  isValidPhone,
}
