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
const { createSmartCrm } = require('./smart')
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
  const smart = createSmartCrm(db, repo)
  const workflow = createCrmWorkflow(repo, options.ai || null, {
    validateBooking: (date, time) => smart.validateBookingDateTime(date, time),
  })

  async function processCrmTurn(input = {}) {
    const result = await workflow.processCrmTurn(input)
    const chatId = input.chatId || result?.lead?.whatsapp_chat_id || null
    const phone = result?.lead?.phone_number
      || result?.booking?.customer?.phone_number
      || null
    const customerId = result?.booking?.customer?.id || null
    if (chatId && (phone || customerId)) {
      try {
        smart.linkConversationIdentity({
          whatsapp_id: chatId,
          phone_number: phone,
          customer_id: customerId,
          push_name: result?.lead?.full_name || result?.booking?.customer?.full_name || null,
          source: result?.booking ? 'booking_confirmed' : 'crm_form',
        })
      } catch (error) {
        console.warn('[IDENTITY_RESOLUTION] link after CRM turn failed', error.message || error)
      }
    }

    // After booking OUI: register confirmation request (non_confirme → WhatsApp later)
    if (result?.booking?.appointment?.id && smart.registerBookingCreated) {
      try {
        const conv = chatId
          ? smart.getOrCreateConversation({
            external_key: chatId,
            customer_id: customerId,
            phone_number: phone,
            language: result?.lead?.language || input.languageHint || null,
          })
          : null
        smart.registerBookingCreated(result.booking.appointment.id, {
          chatKey: chatId,
          conversationId: conv?.id || null,
          language: result?.lead?.language || input.languageHint || null,
        })
        // Explicit history entry — Assistant IA / WhatsApp patient origin
        smart.recordActivity?.({
          event_type: 'appointment_created',
          category: 'appointment',
          actor: { type: 'assistant_ai', displayName: 'Assistant IA', role: null },
          origin: 'whatsapp_patient',
          source: 'whatsapp',
          patient_id: result.booking.customer?.id || customerId || null,
          appointment_id: result.booking.appointment.id,
          conversation_id: conv?.id || null,
          title: 'Rendez-vous créé',
          description: result.booking.customer?.full_name || null,
          new_value: {
            date: result.booking.appointment.appointment_date,
            time: String(result.booking.appointment.appointment_time || '').slice(0, 5),
            status: result.booking.appointment.status || 'non_confirme',
            created_via: 'whatsapp_booking',
          },
          source_event_id: `appointment:created:wa:${result.booking.appointment.id}`,
        })
      } catch (error) {
        console.warn('[CONFIRMATION] register booking failed', error.message || error)
      }
    }

    return result
  }

  return {
    dbPath,
    db,
    repo,
    smart,
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
    processCrmTurn,
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
