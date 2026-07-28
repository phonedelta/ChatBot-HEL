/**
 * Compact CRM booking workflow.
 *
 * 1) On booking request → ONE form message with all required fields
 * 2) Parse the patient's single reply (any order)
 * 3) If one field missing → ask only that field
 * 4) Summary + ask OUI / نعم
 * 5) Save to CRM only after explicit confirmation
 */

const { checkCustomerData } = require('./checkCustomerData')
const { extractCustomerSignals, validateFullName, resolveMotifPair } = require('./extract')
const {
  bookingFormMessage,
  askMissingField,
  askConfirmation,
  patientConfirmationMessage,
} = require('./messages')

/**
 * @param {ReturnType<import('./repository').createCrmRepository>} repo
 */
function createCrmWorkflow(repo) {
  function replyLanguage(lead, fallback = 'fr') {
    return lead?.language || fallback || 'fr'
  }

  function mergeSignals(lead, signals, awaitingField) {
    const patch = {}

    if (signals.full_name) patch.full_name = signals.full_name
    if (signals.phone_number) patch.phone_number = signals.phone_number
    if (signals.city) patch.city = signals.city
    if (signals.problem) {
      patch.problem = signals.problem
      if (signals.problem_details) patch.problem_details = signals.problem_details
      if (signals.urgency) patch.urgency = signals.urgency
    }
    if (signals.appointment_date) patch.appointment_date = signals.appointment_date
    if (signals.appointment_time) patch.appointment_time = signals.appointment_time
    if (signals.booking_intent) patch.booking_intent = 1

    // Single-field answers
    if (awaitingField === 'full_name' && !patch.full_name) {
      const name = validateFullName(signals.rawText || '')
      if (name) patch.full_name = name
    }
    if (awaitingField === 'phone_number' && !patch.phone_number && signals.phone_number) {
      patch.phone_number = signals.phone_number
    }
    if (awaitingField === 'city' && !patch.city && signals.city) {
      patch.city = signals.city
    }
    if (awaitingField === 'problem' && !patch.problem) {
      const text = String(signals.rawText || '').trim()
      if (text.length >= 3) {
        const motif = resolveMotifPair(text)
        patch.problem = motif.problem
        patch.problem_details = motif.problem_details
        patch.urgency = motif.urgency || 'moyenne'
      }
    }
    if (awaitingField === 'appointment') {
      if (signals.appointment_date) patch.appointment_date = signals.appointment_date
      if (signals.appointment_time) patch.appointment_time = signals.appointment_time
    }

    return patch
  }

  function buildLlmContext(lead, check) {
    return [
      'CRM BOOKING CONTEXT (internal):',
      `- Stage: ${lead?.stage || 'discovery'}`,
      `- Missing: ${(check?.missing || []).join(', ') || 'none'}`,
      '',
      'CRM RULES:',
      '- Booking is handled by the CRM workflow with forced template messages.',
      '- Do NOT ask CRM fields one by one in LLM replies when booking is active.',
      '- For Darija (Arabic script OR Latin keyboard like bghit/3andi/7ri9), ALWAYS reply in Arabic script, never Latin Darija.',
      '- Outside booking, keep answers short and professional.',
    ].join('\n')
  }

  function startForm(conversationId, lead, language, chatId, signals) {
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_form',
      awaiting_field: 'bulk',
      booking_intent: 1,
      language,
      whatsapp_chat_id: chatId || lead.whatsapp_chat_id || null,
      // keep already known fields if any
      full_name: lead.full_name || signals.full_name || null,
      phone_number: lead.phone_number || signals.phone_number || null,
      city: lead.city || signals.city || null,
      problem: lead.problem || signals.problem || null,
      problem_details: lead.problem_details || signals.problem_details || null,
      urgency: lead.urgency || signals.urgency || 'moyenne',
      appointment_date: lead.appointment_date || signals.appointment_date || null,
      appointment_time: lead.appointment_time || signals.appointment_time || null,
    })

    // If the first message already contains everything, skip the form.
    const check = checkCustomerData(updated)
    if (check.ok) {
      const ready = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'confirmation',
      })
      return finalizeTurn(ready, askConfirmation(ready, language), true, null, signals)
    }

    return finalizeTurn(updated, bookingFormMessage(language), true, null, signals)
  }

  function processAfterData(conversationId, lead, language, signals) {
    const check = checkCustomerData(lead)
    if (!check.ok) {
      const next = check.nextField
      const updated = repo.upsertLead(conversationId, {
        stage: 'crm_collection',
        awaiting_field: next,
      })
      return finalizeTurn(updated, askMissingField(next, language), true, null, signals)
    }

    const ready = repo.upsertLead(conversationId, {
      stage: 'confirmation',
      awaiting_field: 'confirmation',
    })
    return finalizeTurn(ready, askConfirmation(ready, language), true, null, signals)
  }

  function processCrmTurn(input = {}) {
    const conversationId = String(input.conversationId || '').trim()
    const userText = String(input.userText || '').trim()
    const language = input.languageHint || 'fr'
    if (!conversationId || !userText) {
      return {
        lead: null,
        forceReply: null,
        shouldSkipLlm: false,
        llmContext: '',
        booking: null,
        extracted: null,
      }
    }

    let lead = repo.getLead(conversationId) || repo.upsertLead(conversationId, {
      whatsapp_chat_id: input.chatId || null,
      phone_number: null,
      language,
      stage: 'discovery',
    })

    const signals = extractCustomerSignals(userText, {
      voiceIntent: input.voiceIntent || null,
    })
    signals.rawText = userText

    // Completed booking: only restart on a new booking intent
    if (lead.stage === 'completed') {
      if (signals.booking_intent) {
        lead = repo.upsertLead(conversationId, {
          stage: 'discovery',
          awaiting_field: null,
          booking_intent: 0,
          appointment_date: null,
          appointment_time: null,
          problem: null,
          problem_details: null,
          urgency: 'moyenne',
          // keep identity fields for convenience
          full_name: lead.full_name,
          phone_number: null,
          city: lead.city,
          language,
        })
      } else {
        return {
          lead,
          forceReply: null,
          shouldSkipLlm: false,
          llmContext: '',
          booking: null,
          extracted: signals,
          check: checkCustomerData(lead),
        }
      }
    }

    const lang = replyLanguage(lead, language)
    const isConfirmReply = lead.stage === 'confirmation'
      && (signals.confirmation_yes || signals.confirmation_no)

    // Do not merge field signals on OUI/نعم — otherwise short confirmations
    // (e.g. نعم) overwrite problem_details and never save the booking.
    if (!isConfirmReply) {
      const patch = mergeSignals(lead, signals, lead.awaiting_field)
      if (language) patch.language = language
      if (input.chatId) patch.whatsapp_chat_id = input.chatId
      lead = repo.upsertLead(conversationId, patch)
    } else if (language || input.chatId) {
      lead = repo.upsertLead(conversationId, {
        ...(language ? { language } : {}),
        ...(input.chatId ? { whatsapp_chat_id: input.chatId } : {}),
      })
    }

    repo.logConversation({
      conversation_id: conversationId,
      whatsapp_chat_id: input.chatId || null,
      direction: 'inbound',
      message_text: userText,
      extracted: {
        ...signals,
        stage: lead.stage,
        awaiting_field: lead.awaiting_field,
      },
      appointment_status: lead.stage,
    })

    // Confirmation stage
    if (lead.stage === 'confirmation') {
      if (signals.confirmation_yes) {
        const check = checkCustomerData(lead)
        if (!check.ok) {
          return processAfterData(conversationId, lead, lang, signals)
        }

        const booking = repo.saveConfirmedBooking(lead)
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          customer_id: booking.customer.id,
          direction: 'system',
          message_text: 'appointment_request_saved_pending_staff_call',
          extracted: {
            appointment_id: booking.appointment.id,
            customer_id: booking.customer.id,
            status: 'non_confirme',
          },
          appointment_status: 'non_confirme',
        })

        lead = repo.upsertLead(conversationId, {
          stage: 'completed',
          awaiting_field: null,
        })
        return finalizeTurn(lead, patientConfirmationMessage(lead, lang), true, booking, signals)
      }

      if (signals.confirmation_no) {
        lead = repo.upsertLead(conversationId, {
          stage: 'awaiting_form',
          awaiting_field: 'bulk',
          appointment_date: null,
          appointment_time: null,
        })
        return finalizeTurn(lead, bookingFormMessage(lang), true, null, signals)
      }

      return finalizeTurn(lead, askConfirmation(lead, lang), true, null, signals)
    }

    // Waiting for the bulk form answer or a single missing field
    if (lead.stage === 'awaiting_form' || lead.stage === 'crm_collection') {
      // Ignore a second booking intent that is just "bghit rdv" without data
      const checkBefore = checkCustomerData(lead)
      const providedSomething = Boolean(
        signals.full_name
        || signals.phone_number
        || signals.city
        || signals.problem
        || signals.appointment_date
        || signals.appointment_time
        || (lead.awaiting_field && lead.awaiting_field !== 'bulk' && String(userText).trim().length >= 2),
      )

      if (!providedSomething && signals.booking_intent && !checkBefore.ok) {
        return finalizeTurn(lead, bookingFormMessage(lang), true, null, signals)
      }

      return processAfterData(conversationId, lead, lang, signals)
    }

    // New booking request → send the single form message
    const shouldStartBooking = Boolean(
      signals.booking_intent
      || lead.booking_intent
      || ['prise_rendez_vous'].includes(String(input.voiceIntent || '')),
    )

    if (shouldStartBooking) {
      return startForm(conversationId, lead, lang, input.chatId, signals)
    }

    // Non-booking conversation: optional short hint for LLM if dental pain
    const shouldOfferBooking = Boolean(signals.problem || lead.problem)
    const offerContext = shouldOfferBooking
      ? [
        'BOOKING OFFER RULE (internal):',
        '- If relevant, invite the patient to book HERE on WhatsApp in ONE short sentence.',
        '- If they accept / ask for RDV, the CRM workflow will send the full form.',
        '- For Darija (including Latin keyboard), reply in Arabic script only.',
        '- Do not ask identity fields one by one.',
      ].join('\n')
      : ''

    return {
      lead,
      forceReply: null,
      shouldSkipLlm: false,
      llmContext: offerContext,
      booking: null,
      extracted: signals,
      check: checkCustomerData(lead),
    }
  }

  function finalizeTurn(lead, forceReply, shouldSkipLlm, booking, extracted) {
    const check = checkCustomerData(lead || {})
    return {
      lead,
      forceReply,
      shouldSkipLlm,
      llmContext: lead ? buildLlmContext(lead, check) : '',
      booking,
      extracted,
      check,
    }
  }

  function resetConversation(conversationId) {
    if (!conversationId) return
    repo.clearLead(conversationId)
  }

  return {
    processCrmTurn,
    resetConversation,
    buildLlmContext,
  }
}

module.exports = {
  createCrmWorkflow,
}
