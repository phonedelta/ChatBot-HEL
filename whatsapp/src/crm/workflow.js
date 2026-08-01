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
const {
  extractCustomerSignals,
  validateFullName,
  resolveMotifPair,
} = require('./extract')
const {
  bookingFormMessage,
  incompleteBulkReminder,
  fullNameRequiredMessage,
  voiceUseTextReminder,
  askConfirmation,
  patientConfirmationMessage,
} = require('./messages')
const {
  detectServiceBookingIntent,
  hasExplicitBookingIntent,
} = require('../voice-nlu/intent-table')
const { isOfficialService } = require('./services')
const {
  validateAppointmentHours,
  outsideWorkingHoursMessage,
} = require('./working-hours')

/**
 * @param {ReturnType<import('./repository').createCrmRepository>} repo
 */
function createCrmWorkflow(repo) {
  function replyLanguage(lead, fallback = 'fr') {
    return lead?.language || fallback || 'fr'
  }

  function mergeSignals(lead, signals, awaitingField) {
    const patch = {}

    const nextName = signals.full_name ? validateFullName(signals.full_name) : null
    if (nextName) {
      const keepExisting = Boolean(validateFullName(lead?.full_name || ''))
        && awaitingField
        && awaitingField !== 'bulk'
        && awaitingField !== 'full_name'
      if (!keepExisting) patch.full_name = nextName
    }
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
        if (motif.problem) {
          patch.problem = motif.problem
          patch.problem_details = motif.problem_details
          patch.urgency = motif.urgency || 'moyenne'
        }
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
      '- Booking uses ONE fixed form message asking for ALL fields together.',
      '- Do NOT ask CRM fields one by one in LLM replies when booking is active.',
      '- For Darija (Arabic script OR Latin keyboard like bghit/3andi/7ri9), ALWAYS reply in Arabic script, never Latin Darija.',
      '- Outside booking, keep answers short and professional.',
    ].join('\n')
  }

  function resetLeadForNewBooking(conversationId, lead, language, chatId = null) {
    return repo.upsertLead(conversationId, {
      stage: 'discovery',
      awaiting_field: null,
      booking_intent: 0,
      full_name: null,
      phone_number: null,
      city: null,
      problem: null,
      problem_details: null,
      urgency: 'moyenne',
      appointment_date: null,
      appointment_time: null,
      language: language || lead?.language || 'fr',
      whatsapp_chat_id: chatId || lead?.whatsapp_chat_id || null,
    })
  }

  function startForm(conversationId, lead, language, chatId, signals) {
    const knownService = isOfficialService(signals.problem || lead.problem || '')
      ? (signals.problem || lead.problem)
      : null
    const skipProblem = Boolean(signals.skipProblemQuestion && knownService)

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
      problem: knownService || lead.problem || signals.problem || null,
      problem_details: lead.problem_details || signals.problem_details || null,
      urgency: lead.urgency || signals.urgency || 'moyenne',
      appointment_date: lead.appointment_date || signals.appointment_date || null,
      appointment_time: lead.appointment_time || signals.appointment_time || null,
    })

    // If the first message already contains everything, skip the form.
    const check = checkCustomerData(updated)
    if (check.ok) {
      return processAfterData(conversationId, updated, language, signals)
    }

    return finalizeTurn(
      updated,
      bookingFormMessage(language, { knownService, skipProblem }),
      true,
      null,
      signals,
    )
  }

  function resendFullForm(conversationId, lead, language, signals, missing = []) {
    const knownService = isOfficialService(lead.problem || signals?.problem || '')
      ? (lead.problem || signals.problem)
      : null
    const skipProblem = Boolean(knownService)
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_form',
      awaiting_field: 'bulk',
      booking_intent: 1,
    })
    const needsFullName = (missing || []).includes('full_name')
      || Boolean(signals?.name_incomplete)
    const body = [
      needsFullName ? fullNameRequiredMessage(language) : null,
      incompleteBulkReminder(language, missing),
      bookingFormMessage(language, { knownService, skipProblem }),
    ].filter(Boolean).join('\n')
    return finalizeTurn(updated, body, true, null, signals)
  }

  /**
   * Reject appointment slots outside clinic opening hours and ask again.
   */
  function rejectOutsideHours(conversationId, lead, language, signals, hoursResult) {
    const knownService = isOfficialService(lead.problem || signals?.problem || '')
      ? (lead.problem || signals.problem)
      : null
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_form',
      awaiting_field: 'bulk',
      booking_intent: 1,
      appointment_date: null,
      appointment_time: null,
    })
    const body = [
      outsideWorkingHoursMessage(language, hoursResult),
      '',
      bookingFormMessage(language, {
        knownService,
        skipProblem: Boolean(knownService),
      }),
    ].join('\n')
    return finalizeTurn(updated, body, true, null, signals)
  }

  function processAfterData(conversationId, lead, language, signals) {
    const check = checkCustomerData(lead)
    if (!check.ok) {
      // Never ask field-by-field — always re-send the full one-message form.
      return resendFullForm(conversationId, lead, language, signals, check.missing)
    }

    const hours = validateAppointmentHours(lead.appointment_date, lead.appointment_time)
    if (!hours.ok) {
      return rejectOutsideHours(conversationId, lead, language, signals, hours)
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
    const isVoice = Boolean(input.isVoice)
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

    // Migrate legacy one-by-one collection to bulk form mode
    if (lead.stage === 'crm_collection') {
      lead = repo.upsertLead(conversationId, {
        stage: 'awaiting_form',
        awaiting_field: 'bulk',
      })
    }

    const signals = extractCustomerSignals(userText, {
      voiceIntent: input.voiceIntent || null,
    })
    signals.rawText = userText

    // Prefer Intent Router result when provided by the main pipeline
    const router = input.router || null
    if (router?.bookAppointment && router.skipProblemQuestion && router.service) {
      signals.booking_intent = true
      signals.problem = router.service
      signals.problem_details = signals.problem_details || userText
      signals.urgency = signals.urgency || 'moyenne'
      signals.category = router.service
      signals.skipProblemQuestion = true
      signals.service_booking = router
    }

    // Direct service booking intent table (text only) — fallback if no router
    const serviceBooking = !isVoice ? detectServiceBookingIntent(userText) : {
      intent: null,
      skipProblemQuestion: false,
      service: null,
    }
    if (
      !signals.skipProblemQuestion
      && serviceBooking.intent === 'BOOK_APPOINTMENT'
      && serviceBooking.skipProblemQuestion
    ) {
      signals.booking_intent = true
      signals.problem = serviceBooking.service
      signals.problem_details = signals.problem_details || userText
      signals.urgency = serviceBooking.urgency || signals.urgency || 'moyenne'
      signals.category = serviceBooking.service
      signals.skipProblemQuestion = true
      signals.service_booking = serviceBooking
    }

    // Voice may hint a known service for conversation context — never auto-open the form
    const voiceService = input.voiceService || null
    if (
      isVoice
      && voiceService?.service
      && Number(voiceService.confidence || 0) >= 0.8
    ) {
      const official = isOfficialService(voiceService.service)
        ? voiceService.service
        : (isOfficialService(voiceService.crmProblem) ? voiceService.crmProblem : null)
      if (official) {
        signals.problem = official
        signals.category = official
        // Do NOT set booking_intent from service detection alone
      }
    } else if (
      !isVoice
      && voiceService?.service
      && Number(voiceService.confidence || 0) >= 0.8
      && !signals.problem
    ) {
      const official = isOfficialService(voiceService.service)
        ? voiceService.service
        : (isOfficialService(voiceService.crmProblem) ? voiceService.crmProblem : null)
      if (official) {
        signals.problem = official
        signals.problem_details = signals.problem_details || userText
        signals.urgency = voiceService.urgency || signals.urgency || 'moyenne'
        signals.category = official
        if (hasExplicitBookingIntent(userText) || router?.bookAppointment) {
          signals.booking_intent = true
          signals.skipProblemQuestion = true
        }
      }
    }

    // Voice notes never provide CRM form fields
    if (isVoice) {
      signals.full_name = null
      signals.phone_number = null
      signals.city = null
      signals.appointment_date = null
      signals.appointment_time = null
      // Only open booking on EXPLICIT appointment request in the transcript
      const explicitVoiceBooking = Boolean(
        hasExplicitBookingIntent(userText)
        || router?.bookAppointment,
      )
      signals.booking_intent = explicitVoiceBooking
      if (!explicitVoiceBooking) {
        signals.skipProblemQuestion = false
      }
    }

    // Legacy "completed" leads: wipe booking fields so a new RDV starts clean
    if (lead.stage === 'completed') {
      if (signals.booking_intent) {
        lead = resetLeadForNewBooking(conversationId, lead, language, input.chatId)
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
    const isConfirmReply = !isVoice
      && lead.stage === 'confirmation'
      && (signals.confirmation_yes || signals.confirmation_no)

    // Voice: converse about the problem via LLM. Form only on explicit RDV request.
    if (isVoice) {
      if (language || input.chatId) {
        lead = repo.upsertLead(conversationId, {
          ...(language ? { language } : {}),
          ...(input.chatId ? { whatsapp_chat_id: input.chatId } : {}),
          ...(signals.problem && signals.booking_intent ? {
            problem: signals.problem,
            booking_intent: 1,
          } : {}),
        })
      }
      repo.logConversation({
        conversation_id: conversationId,
        whatsapp_chat_id: input.chatId || null,
        direction: 'inbound',
        message_text: `[vocal] ${userText}`,
        extracted: { ...signals, voice_ignored_for_crm_fields: true, stage: lead.stage },
        appointment_status: lead.stage,
      })

      // Explicit "je veux un RDV" / "bghit mo3id" in the vocal → send the one-message form
      if (signals.booking_intent) {
        return startForm(conversationId, lead, lang, input.chatId, signals)
      }

      // Already collecting a form, but vocal has no clear booking ask → short reminder only
      if (lead.stage === 'awaiting_form' || lead.stage === 'confirmation') {
        return finalizeTurn(lead, voiceUseTextReminder(lang), true, null, signals)
      }

      // Normal vocal → AI conversation (understand the dental problem)
      return {
        lead,
        forceReply: null,
        shouldSkipLlm: false,
        llmContext: [
          'VOICE NOTE RULE:',
          '- Answer the patient from the transcript: understand their dental problem and discuss it.',
          '- Never collect appointment fields from voice.',
          '- Do NOT send the booking form unless they clearly ask for a rendez-vous.',
          '- You may briefly invite them to book later in ONE text message if relevant.',
        ].join('\n'),
        booking: null,
        extracted: signals,
        check: checkCustomerData(lead),
      }
    }

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

    // Confirmation stage (text only)
    if (lead.stage === 'confirmation') {
      if (signals.confirmation_yes) {
        const check = checkCustomerData(lead)
        if (!check.ok) {
          return processAfterData(conversationId, lead, lang, signals)
        }

        const hours = validateAppointmentHours(lead.appointment_date, lead.appointment_time)
        if (!hours.ok) {
          return rejectOutsideHours(conversationId, lead, lang, signals, hours)
        }

        const booking = repo.saveConfirmedBooking(lead)
        const confirmationText = patientConfirmationMessage(lead, lang)
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

        // Auto-reset CRM lead so the patient can book again without old data
        lead = resetLeadForNewBooking(conversationId, lead, lang, input.chatId)
        return finalizeTurn(lead, confirmationText, true, booking, signals)
      }

      if (signals.confirmation_no) {
        lead = repo.upsertLead(conversationId, {
          stage: 'awaiting_form',
          awaiting_field: 'bulk',
          appointment_date: null,
          appointment_time: null,
        })
        const known = isOfficialService(lead.problem || '') ? lead.problem : null
        return finalizeTurn(
          lead,
          bookingFormMessage(lang, { knownService: known, skipProblem: Boolean(known) }),
          true,
          null,
          signals,
        )
      }

      return finalizeTurn(lead, askConfirmation(lead, lang), true, null, signals)
    }

    // Waiting for the ONE bulk form answer (never field-by-field)
    if (lead.stage === 'awaiting_form' || lead.stage === 'crm_collection') {
      const checkBefore = checkCustomerData(lead)
      const providedSomething = Boolean(
        signals.full_name
        || signals.phone_number
        || signals.city
        || signals.problem
        || signals.appointment_date
        || signals.appointment_time,
      )

      // "bghit rdv" alone while form is open → resend full form
      if (!providedSomething && !checkBefore.ok) {
        return resendFullForm(conversationId, lead, lang, signals, checkBefore.missing)
      }

      return processAfterData(conversationId, lead, lang, signals)
    }

    // New booking request → send the single form message (explicit RDV only)
    const shouldStartBooking = Boolean(
      signals.booking_intent
      || lead.booking_intent
      || router?.bookAppointment
      || hasExplicitBookingIntent(userText),
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

  function finalizeTurn(lead, templateReply, sendExactTemplate = true, booking = null, extracted = null) {
    const check = checkCustomerData(lead || {})
    const baseContext = lead ? buildLlmContext(lead, check) : ''
    const draft = String(templateReply || '').trim()

    // Booking form / summary / missing-field prompts must be sent EXACTLY
    // so the patient always replies with one structured message.
    if (sendExactTemplate && draft) {
      return {
        lead,
        forceReply: draft,
        templateReply: draft,
        shouldSkipLlm: true,
        llmContext: baseContext,
        booking,
        extracted,
        check,
      }
    }

    const aiBrief = draft
      ? [
        'CRM MESSAGE BRIEF (highest priority for THIS turn):',
        'Write the WhatsApp reply with the AI in the required patient language.',
        'You MUST include every fact from the draft below.',
        '--- DRAFT START ---',
        draft,
        '--- DRAFT END ---',
      ].join('\n')
      : ''

    return {
      lead,
      forceReply: draft || null,
      templateReply: draft || null,
      shouldSkipLlm: false,
      llmContext: [baseContext, aiBrief].filter(Boolean).join('\n\n'),
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
