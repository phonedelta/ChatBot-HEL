/**
 * Context-first conversation routing — structured state from DB workflows.
 * Priority: pending slot proposal > cancel > appointment confirmation > CRM booking lead.
 */

const { formatDateTimeLocalized, isDarija } = require('../messages')
const { clarificationMessage } = require('../../voice-nlu/nlu-fallback')

function chatKeyVariants(chatKey) {
  const raw = String(chatKey || '').trim()
  if (!raw) return []
  const bare = raw.replace(/^[^:]+:/, '')
  return [...new Set([raw, bare, `main:${bare}`].filter(Boolean))]
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|null} chatKey
 * @param {object|null} [lead]
 * @returns {{
 *   activeTopic: string|null,
 *   activeWorkflow: string|null,
 *   pendingStep: string|null,
 *   pendingQuestionType: string|null,
 *   blocksBooking: boolean,
 *   lastReliableIntent: string|null,
 *   entities: object,
 *   language: string|null,
 * }}
 */
function resolveConversationRoutingState(db, chatKey, lead = null, extras = {}) {
  const empty = {
    activeTopic: null,
    activeWorkflow: null,
    pendingStep: null,
    pendingQuestionType: null,
    blocksBooking: true,
    lastReliableIntent: null,
    entities: {},
    language: lead?.language || null,
  }

  if (!db || !chatKey) {
    return { ...empty, blocksBooking: false }
  }

  const variants = chatKeyVariants(chatKey)
  const availabilityState = extras?.availabilityState || null

  // PRIORITY 0 — availability consultation in progress (before booking form)
  if (
    availabilityState
    && (
      availabilityState.stage === 'awaiting_availability_date'
      || availabilityState.stage === 'awaiting_available_slot_selection'
      || availabilityState.stage === 'awaiting_precise_slot_confirm'
    )
  ) {
    return {
      activeTopic: 'availability',
      activeWorkflow: 'check_availability',
      pendingStep: availabilityState.stage,
      pendingQuestionType: availabilityState.stage === 'awaiting_availability_date'
        ? 'AVAILABILITY_DATE'
        : (availabilityState.stage === 'awaiting_precise_slot_confirm'
          ? 'YES_NO_SLOT_BOOK'
          : 'AVAILABLE_SLOT_SELECT'),
      blocksBooking: true,
      lastReliableIntent: 'CHECK_APPOINTMENT_AVAILABILITY',
      entities: {
        availabilityDate: availabilityState.availability_date || null,
        candidateSlots: availabilityState.candidateSlots || [],
      },
      language: availabilityState.language || lead?.language || null,
    }
  }

  // PRIORITY 1 — pending slot proposal (DB source of truth)
  for (const variant of variants) {
    const row = db.prepare(`
      SELECT p.*, a.appointment_date AS current_date, a.appointment_time AS current_time
      FROM slot_proposals p
      JOIN appointments a ON a.id = p.appointment_id
      WHERE p.status = 'pending' AND (p.chat_key = ? OR p.chat_key = ?)
      ORDER BY p.created_at DESC
      LIMIT 1
    `).get(variant, variant.replace(/^[^:]+:/, ''))
    if (row) {
      return {
        activeTopic: 'appointment_reschedule',
        activeWorkflow: 'slot_proposal',
        pendingStep: 'waiting_accept_reject',
        pendingQuestionType: 'YES_NO_SLOT_PROPOSAL',
        blocksBooking: true,
        lastReliableIntent: 'SLOT_PROPOSAL_SENT',
        entities: {
          proposalId: row.id,
          appointmentId: row.appointment_id,
          customerId: row.customer_id,
          slotDate: row.slot_date,
          slotTime: String(row.slot_time || '').slice(0, 5),
          currentDate: row.current_date,
          currentTime: String(row.current_time || '').slice(0, 5),
          conversationId: row.conversation_id,
        },
        language: row.language || lead?.language || null,
      }
    }
  }

  // PRIORITY 2 — pending cancel confirmation
  for (const variant of variants) {
    const row = db.prepare(`
      SELECT * FROM appointment_cancel_requests
      WHERE chat_key = ? AND status = 'pending'
      ORDER BY updated_at DESC LIMIT 1
    `).get(variant)
    if (row && row.step === 'WAITING_CONFIRMATION') {
      return {
        activeTopic: 'appointment_cancellation',
        activeWorkflow: 'cancel_appointment',
        pendingStep: 'waiting_confirmation',
        pendingQuestionType: 'YES_NO_CANCEL',
        blocksBooking: true,
        lastReliableIntent: 'CANCEL_CONFIRMATION_PENDING',
        entities: {
          cancelRequestId: row.id,
          appointmentId: row.appointment_id,
          patientId: row.patient_id,
        },
        language: row.language || lead?.language || null,
      }
    }
  }

  // PRIORITY 3 — pending 24h appointment confirmation
  for (const variant of variants) {
    const row = db.prepare(`
      SELECT r.*, a.appointment_date, a.appointment_time
      FROM appointment_confirmation_requests r
      JOIN appointments a ON a.id = r.appointment_id
      WHERE r.status = 'pending'
        AND r.initial_sent_at IS NOT NULL
        AND r.chat_key = ?
        AND a.status = 'non_confirme'
      ORDER BY r.initial_sent_at DESC
      LIMIT 1
    `).get(variant)
    if (row) {
      return {
        activeTopic: 'appointment_confirmation',
        activeWorkflow: 'appointment_confirmation',
        pendingStep: 'waiting_confirm_cancel',
        pendingQuestionType: 'YES_NO_CONFIRMATION',
        blocksBooking: true,
        lastReliableIntent: 'CONFIRMATION_PENDING',
        entities: {
          confirmationRequestId: row.id,
          appointmentId: row.appointment_id,
          customerId: row.customer_id,
          appointmentDate: row.appointment_date,
          appointmentTime: String(row.appointment_time || '').slice(0, 5),
        },
        language: lead?.language || null,
      }
    }
  }

  // PRIORITY 4 — CRM booking lead (only when no higher-priority workflow)
  const stage = String(lead?.stage || '')
  if (stage === 'awaiting_form' || stage === 'confirmation' || stage === 'crm_collection' || stage === 'awaiting_patient') {
    return {
      activeTopic: 'booking',
      activeWorkflow: 'booking',
      pendingStep: stage,
      pendingQuestionType: stage === 'confirmation'
        ? (
          lead?.awaiting_field === 'confirmation_rejection' ? 'BOOKING_REJECTION_CHOICE'
            : lead?.awaiting_field === 'fields_to_correct' ? 'BOOKING_FIELDS_TO_CORRECT'
              : lead?.awaiting_field === 'field_correction' ? 'BOOKING_FIELD_CORRECTION'
                : lead?.awaiting_field === 'draft_cancel_confirm' ? 'BOOKING_DRAFT_CANCEL_CONFIRM'
                  : lead?.awaiting_field === 'unclear_cancel_confirm' ? 'BOOKING_UNCLEAR_CANCEL_CONFIRM'
                    : 'YES_NO_BOOKING'
        )
        : (stage === 'awaiting_patient'
          ? (lead?.awaiting_field === 'duplicate_confirm' ? 'DUPLICATE_PATIENT_CONFIRM' : 'PATIENT_SELECT')
          : (lead?.awaiting_field === 'slot_alternative' ? 'BOOKING_SLOT_ALTERNATIVE' : 'PROVIDE_BULK_FORM')),
      blocksBooking: false,
      lastReliableIntent: 'BOOKING_IN_PROGRESS',
      entities: {
        awaitingField: lead?.awaiting_field || null,
        customerId: lead?.selected_patient_id || null,
        bookingTarget: lead?.booking_target || null,
      },
      language: lead?.language || null,
    }
  }

  return { ...empty, blocksBooking: false }
}

/**
 * Contextual clarification — depends on active workflow, never generic booking form.
 * @param {ReturnType<typeof resolveConversationRoutingState>} state
 * @param {'fr'|'darija'|string} language
 * @param {number} [attempt=1]
 */
function contextualClarificationMessage(state, language, attempt = 1) {
  const lang = isDarija(language) ? 'darija' : 'fr'
  const wf = state?.activeWorkflow
  const entities = state?.entities || {}

  if (wf === 'slot_proposal' && entities.slotDate) {
    const slot = formatDateTimeLocalized(entities.slotDate, entities.slotTime, lang)
    if (lang === 'darija') {
      return `ما فهمتش مزيان. واش بغيتي تقبل الموعد الجديد ديال ${slot}؟ جاوب بـ نعم أو لا.`
    }
    return `Je n’ai pas bien compris. Souhaitez-vous accepter le nouveau créneau du ${slot} ? Répondez OUI ou NON.`
  }

  if (wf === 'cancel_appointment') {
    if (lang === 'darija') {
      return 'ما فهمتش مزيان. واش بغيتي نلغي الموعد ولا نخليه كيف ما هو؟ جاوب بـ نعم أو لا.'
    }
    return 'Je n’ai pas bien compris. Souhaitez-vous annuler le rendez-vous ou le conserver ? Répondez OUI ou NON.'
  }

  if (wf === 'appointment_confirmation' && entities.appointmentDate) {
    const slot = formatDateTimeLocalized(entities.appointmentDate, entities.appointmentTime, lang)
    if (lang === 'darija') {
      return `ما فهمتش مزيان. واش بغيتي تأكد الموعد ديال ${slot} ولا تلغيه؟ جاوب بـ نعم أو لا.`
    }
    return `Je n’ai pas bien compris. Souhaitez-vous confirmer ou annuler le rendez-vous du ${slot} ? Répondez OUI ou NON.`
  }

  if (wf === 'check_availability') {
    if (state?.pendingQuestionType === 'AVAILABILITY_DATE') {
      if (lang === 'darija') {
        return 'ما فهمتش التاريخ مزيان. عطيني النهار والشهر، مثلا: 05/09'
      }
      return 'Je n’ai pas bien compris la date. Indiquez le jour et le mois, par exemple : 05/09'
    }
    if (lang === 'darija') {
      return 'ما فهمتش مزيان. اختار رقم الساعة أو كتب ليا الساعة مباشرة.'
    }
    return 'Je n’ai pas bien compris. Choisissez le numéro du créneau ou indiquez l’heure.'
  }

  if (wf === 'booking') {
    if (state?.pendingQuestionType === 'PATIENT_SELECT') {
      if (lang === 'darija') {
        return 'ما فهمتش مزيان. عافاك حدد شكون الموعد ديالو: السمية أو الرقم، أو شخص جديد.'
      }
      return 'Je n’ai pas bien compris. Merci d’indiquer pour qui est le rendez-vous (nom, numéro, ou nouvelle personne).'
    }
    if (lang === 'darija') {
      return 'ما فهمتش مزيان هاد المعلومة. عافاك وضّح التاريخ أو المعلومة اللي طلبنا.'
    }
    return 'Je n’ai pas bien compris cette information. Pouvez-vous préciser la date ou l’information demandée ?'
  }

  return clarificationMessage(lang, attempt)
}

function hasPriorityOverBooking(state) {
  return Boolean(state?.blocksBooking && state?.activeWorkflow && state.activeWorkflow !== 'booking')
}

function logContextRouter(state, message, decision) {
  if (process.env.CRM_DEBUG_CONTEXT !== '1' && process.env.NODE_ENV === 'production') return
  console.log('[CONTEXT_ROUTER]', {
    activeTopic: state?.activeTopic || null,
    activeWorkflow: state?.activeWorkflow || null,
    pendingStep: state?.pendingStep || null,
    pendingQuestion: state?.pendingQuestionType || null,
    message: String(message || '').slice(0, 80),
    decision,
  })
}

module.exports = {
  resolveConversationRoutingState,
  contextualClarificationMessage,
  hasPriorityOverBooking,
  logContextRouter,
  chatKeyVariants,
}
