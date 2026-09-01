/**
 * Post-commit side effects for dashboard manual appointment creation.
 */
const { listPatientsReachableByPhone } = require('../contact-patients')
const { buildManualAppointmentConfirmationMessage } = require('./manual-appointment-confirmation')

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createManualAppointmentFlow(db, helpers = {}) {
  const {
    appointmentConfirmation,
    trackWhatsAppTurn,
    logAiAction,
    getSendWhatsAppText,
  } = helpers

  function hasManualConfirmationSent(appointmentId) {
    try {
      const row = db.prepare(`
        SELECT id FROM ai_actions
        WHERE action_type = 'manual_confirmation_sent'
          AND result = ?
        LIMIT 1
      `).get(String(appointmentId))
      return Boolean(row)
    } catch {
      return false
    }
  }

  /**
   * Runs after DB commit of createManualAppointment.
   * @param {object} bookingResult
   * @param {{ actorDisplayName?: string }} [options]
   */
  async function completeManualAppointmentCreation(bookingResult, {
    actorDisplayName = 'Assistante',
  } = {}) {
    const appointmentId = Number(bookingResult?.appointment_id || 0)
    const customer = bookingResult?.customer
    const appointment = bookingResult?.appointment
    const phone = customer?.phone_number
    const problem = bookingResult?.dentalCase?.problem
      || bookingResult?.order?.problem
      || null
    const patientName = customer?.full_name || bookingResult?.full_name

    const followup = { scheduled: false }
    const whatsapp = {
      attempted: false,
      sent: false,
      messageId: null,
      error: null,
      disconnected: false,
      skipped: false,
    }

    if (!appointmentId || !customer || !appointment || !phone) {
      whatsapp.error = 'Données rendez-vous incomplètes'
      return { whatsapp, followup }
    }

    const chatKey = customer.whatsapp_chat_id
      || bookingResult?.contact?.whatsapp_id
      || null

    const req = appointmentConfirmation?.registerManualConfirmedAppointment?.(appointmentId, {
      chatKey,
      language: 'darija',
    })
    followup.scheduled = Boolean(req)

    if (hasManualConfirmationSent(appointmentId)) {
      whatsapp.skipped = true
      return { whatsapp, followup }
    }

    const sendFn = typeof getSendWhatsAppText === 'function' ? getSendWhatsAppText() : null
    if (typeof sendFn !== 'function') {
      whatsapp.error = 'WhatsApp sender unavailable'
      return { whatsapp, followup }
    }

    const linkedPatients = listPatientsReachableByPhone(db, phone)
    const sharedContact = linkedPatients.length > 1

    const messageText = buildManualAppointmentConfirmationMessage({
      patientName,
      date: appointment.appointment_date,
      time: appointment.appointment_time,
      reason: problem,
      sharedContact,
    })

    whatsapp.attempted = true

    try {
      const sent = await sendFn({
        chatId: chatKey,
        phone,
        text: messageText,
      })
      whatsapp.sent = true
      whatsapp.messageId = sent?.messageId || null
      const resolvedChatId = sent?.chatId || chatKey

      if (typeof trackWhatsAppTurn === 'function') {
        trackWhatsAppTurn({
          chatId: resolvedChatId,
          customerId: customer.id,
          outboundText: messageText,
          outboundAuthor: 'human',
          outboundMessageId: sent?.messageId || null,
          phoneNumber: phone,
          contactName: patientName,
        })
      }

      appointmentConfirmation?.registerManualConfirmedAppointment?.(appointmentId, {
        chatKey: resolvedChatId,
        language: 'darija',
        initialSentAt: new Date().toISOString(),
      })

      if (typeof logAiAction === 'function') {
        logAiAction({
          customer_id: customer.id,
          action_type: 'manual_confirmation_sent',
          reason: 'Confirmation WhatsApp création manuelle dashboard',
          result: String(appointmentId),
          source: 'dashboard',
          payload: {
            appointment_id: appointmentId,
            recipient: phone,
          },
        })
      }
    } catch (error) {
      whatsapp.sent = false
      whatsapp.error = error?.message || String(error)
      if (error?.code === 'WA_NOT_READY') {
        whatsapp.disconnected = true
      }
      console.warn('[manual-appointment] WhatsApp confirmation failed', {
        appointmentId,
        recipient: phone,
        code: error?.code || null,
        message: whatsapp.error,
      })
    }

    return { whatsapp, followup }
  }

  return {
    completeManualAppointmentCreation,
    hasManualConfirmationSent,
  }
}

module.exports = {
  createManualAppointmentFlow,
}
