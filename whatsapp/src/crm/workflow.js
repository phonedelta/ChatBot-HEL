/**
 * Compact CRM booking workflow.
 *
 * Explicit RDV intent opens booking. Fields are collected progressively
 * (any order, several messages) and seeded from recent patient inbound texts.
 */

const { checkCustomerData } = require('./checkCustomerData')
const {
  extractCustomerSignals,
  validateFullName,
  resolveMotifPair,
} = require('./extract')
const { toE164 } = require('./phone')
const { stripPersonNameLabels } = require('./name-validator')
const {
  bookingFormMessage,
  fullNameRequiredMessage,
  voiceUseTextReminder,
  buildBookingCollectionReplies,
  missingFieldsMessage,
  askConfirmation,
  patientConfirmationMessage,
  correctionAck,
} = require('./messages')
const {
  detectCorrectionIntent,
  buildCorrectionPatch,
} = require('./booking-corrections')
const {
  parseCorrectionState,
  serializeCorrectionState,
  isStrictBookingConfirmYes,
  isBookingConfirmNo,
  parseRejectionChoice,
  parseFieldsToCorrect,
  parseFieldCorrectionValue,
  rejectionMenuMessage,
  fieldsToCorrectPrompt,
  fieldCorrectionPrompt,
  fieldCorrectionRetry,
  draftCancelConfirmMessage,
  unclearReplyCancelAskMessage,
  draftCancelledMessage,
  outsideHoursRetry,
} = require('./booking-confirmation-flow')
const { parseYesNoReply } = require('./binary-confirmation')
const {
  detectServiceBookingIntent,
  hasExplicitBookingIntent,
} = require('../voice-nlu/intent-table')
const {
  isGibberishMessage,
  isExplicitUnclearPhrase,
  formAwaitingClarifyMessage,
} = require('../voice-nlu/nlu-fallback')
const { isOfficialService } = require('./services')
const { isValidPhone } = require('./phone')
const {
  validateAppointmentHours,
  outsideWorkingHoursMessage,
} = require('./working-hours')
const { normalizePersonName } = require('./contact-patients')
const {
  parsePatientSelection,
  looksLikeNewPerson,
  conversationAppliesToPatient,
  buildPatientPickerReplies,
  existingPatientAck,
  newPersonAck,
  duplicateNameConfirmMessage,
  ambiguousPatientMessage,
  parseDuplicateConfirm,
  matchLinkedByName,
} = require('./booking-patient-select')

function hasExtractedBookingFields(signals) {
  if (!signals) return false
  const real = Boolean(
    signals.full_name
    || signals.phone_number
    || signals.city
    || signals.problem
    || signals.appointment_date
    || signals.appointment_time
    || Object.values(signals._cleared || {}).some(Boolean),
  )
  if (signals.confirmation_yes || signals.confirmation_no) return real
  return real || Boolean(signals.name_incomplete)
}

function detectJustFilled(before, after) {
  const prev = checkCustomerData(before || {})
  const next = checkCustomerData(after || {})
  const filled = []
  for (const field of ['full_name', 'problem', 'phone_number', 'city', 'appointment']) {
    if (!prev.checks[field] && next.checks[field]) filled.push(field)
  }
  return filled
}

function applyLastWins(acc, extracted, { identity = true } = {}) {
  if (!extracted) return acc
  if (identity) {
    if (extracted.full_name) acc.full_name = extracted.full_name
    if (extracted.phone_number) acc.phone_number = extracted.phone_number
    if (extracted.city) acc.city = extracted.city
    if (extracted.appointment_date) acc.appointment_date = extracted.appointment_date
    if (extracted.appointment_time) acc.appointment_time = extracted.appointment_time
  }
  if (extracted.problem) {
    acc.problem = extracted.problem
    if (extracted.problem_details) acc.problem_details = extracted.problem_details
    if (extracted.urgency) acc.urgency = extracted.urgency
  }
  return acc
}

/**
 * @param {ReturnType<import('./repository').createCrmRepository>} repo
 * @param {{ openAiClient?: any, openAiModel?: string } | null} [ai]
 */
function createCrmWorkflow(repo, ai = null, options = {}) {
  const { validateBooking } = options
  const nameAi = ai && ai.openAiClient
    ? { openAiClient: ai.openAiClient, model: ai.openAiModel || process.env.OPENAI_MODEL }
    : null

  function replyLanguage(lead, fallback = 'fr') {
    return lead?.language || fallback || 'fr'
  }

  async function resolveFullName(candidate, existingName = null) {
    const existingValid = existingName ? validateFullName(existingName) : null
    if (!candidate) return existingValid
    const cleaned = stripPersonNameLabels(candidate)
    const { validateFullNameCandidate } = require('./name-validator')
    const result = await validateFullNameCandidate(cleaned || candidate, { ai: nameAi })
    if (result.valid && result.normalizedName) {
      return stripPersonNameLabels(result.normalizedName) || result.normalizedName
    }
    return null
  }

  async function mergeSignals(lead, signals, awaitingField) {
    const patch = {}

    const nextName = await resolveFullName(signals.full_name || null, lead?.full_name || null)
    if (nextName) {
      const keepExisting = Boolean(validateFullName(lead?.full_name || ''))
        && awaitingField
        && awaitingField !== 'bulk'
        && awaitingField !== 'fields'
        && awaitingField !== 'full_name'
      if (!keepExisting) patch.full_name = nextName
    } else if (signals.full_name) {
      patch._rejected_full_name = true
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

    const cleared = signals._cleared || {}
    if (cleared.phone_number && !signals.phone_number) patch.phone_number = null
    if (cleared.city && !signals.city) patch.city = null
    if (cleared.full_name && !nextName) patch.full_name = null
    if (cleared.problem && !signals.problem) {
      patch.problem = null
      patch.problem_details = null
    }
    if (cleared.appointment && !signals.appointment_date && !signals.appointment_time) {
      patch.appointment_date = null
      patch.appointment_time = null
    }

    if (awaitingField === 'full_name' && !patch.full_name) {
      const name = await resolveFullName(signals.rawText || '', null)
      if (name) patch.full_name = name
      else if (String(signals.rawText || '').trim()) patch._rejected_full_name = true
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
      '- Booking fields may arrive across several patient messages.',
      '- Ask only for fields that are still missing. Never invent identity or phone numbers.',
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
      selected_patient_id: null,
      booking_target: null,
      pending_duplicate_patient_id: null,
      allow_duplicate_name: 0,
      correction_json: null,
      language: language || lead?.language || 'fr',
      whatsapp_chat_id: chatId || lead?.whatsapp_chat_id || null,
    })
  }

  function seedFromPatientHistory(conversationId, chatId) {
    const acc = {
      full_name: null,
      phone_number: null,
      city: null,
      problem: null,
      problem_details: null,
      urgency: null,
      appointment_date: null,
      appointment_time: null,
    }
    if (typeof repo.listRecentInboundTexts !== 'function') return acc
    const rows = repo.listRecentInboundTexts({ conversationId, chatId, limit: 25 })
    for (const row of rows) {
      const raw = String(row.text || '').replace(/^\[vocal\]\s*/i, '').trim()
      if (!raw) continue
      const extracted = extractCustomerSignals(raw, { conservative: true })
      if (row.isVoice) {
        applyLastWins(acc, extracted, { identity: false })
        continue
      }
      applyLastWins(acc, extracted, { identity: true })
    }
    return acc
  }

  function pickPhone(signals, seeded, lead) {
    if (signals.phone_number && isValidPhone(signals.phone_number)) return signals.phone_number
    if (seeded.phone_number && isValidPhone(seeded.phone_number)) return seeded.phone_number
    if (lead?.phone_number && isValidPhone(lead.phone_number)) return lead.phone_number
    return null
  }

  function phonesEqual(a, b) {
    const left = toE164(a)
    const right = toE164(b)
    return Boolean(left && right && left === right)
  }

  /**
   * Remove fields that bleed from linked existing patients into a new_patient draft.
   * Keeps conversation candidates that clearly belong to someone else (e.g. khoya smito Yassine).
   */
  function scrubSeedForNewPatient(seeded, patients = []) {
    const out = {
      full_name: seeded?.full_name || null,
      phone_number: seeded?.phone_number || null,
      city: seeded?.city || null,
      problem: seeded?.problem || null,
      problem_details: seeded?.problem_details || null,
      urgency: seeded?.urgency || null,
      appointment_date: seeded?.appointment_date || null,
      appointment_time: seeded?.appointment_time || null,
    }
    if (!patients.length) return out

    let nameBleedPatient = null
    if (out.full_name) {
      const hit = findLinkedByName(patients, out.full_name)
      if (hit) {
        nameBleedPatient = hit
        out.full_name = null
      }
    }
    for (const patient of patients) {
      if (out.phone_number && phonesEqual(out.phone_number, patient.phone_number)) {
        out.phone_number = null
      }
    }
    // Only wipe city/motif/slot when the seeded NAME belonged to a linked patient.
    // A leftover shared-channel phone must not erase an explicit third-party motif/slot.
    if (nameBleedPatient) {
      if (out.city && nameBleedPatient.city
        && normalizePersonName(out.city) === normalizePersonName(nameBleedPatient.city)) {
        out.city = null
      }
      out.problem = null
      out.problem_details = null
      out.urgency = null
      out.appointment_date = null
      out.appointment_time = null
    }
    return out
  }

  function isFreshBookingRequest(text) {
    const raw = String(text || '').trim()
    if (!hasExplicitBookingIntent(raw)) return false
    return /\b(jdid|jdida|nouveau|nouvelle|autre|جديد|جديدة)\b/i.test(raw)
      || /رنديفو\s*جديد|موعد\s*جديد|رendez[- ]?vous\s+jdid/i.test(raw)
  }

  function switchBookingTargetToNewPerson(conversationId, lead, language, chatId, signals, options = {}) {
    return startCollection(conversationId, lead, language, chatId, signals, {
      target: 'new_patient',
      patients: options.patients,
      ack: options.ack || newPersonAck(language, signals?.full_name || null),
      allowDuplicate: Boolean(options.allowDuplicate),
    })
  }

  function linkedPatientsFor(conversationId, chatId) {
    if (typeof repo.listLinkedPatientsForChat !== 'function') return []
    return repo.listLinkedPatientsForChat({
      chatId: chatId || null,
      conversationId: conversationId || null,
    })
  }

  function recentInboundStrings(conversationId, chatId) {
    if (typeof repo.listRecentInboundTexts !== 'function') return []
    return repo.listRecentInboundTexts({ conversationId, chatId, limit: 25 })
      .map((row) => String(row.text || '').replace(/^\[vocal\]\s*/i, '').trim())
      .filter(Boolean)
  }

  function namesEqual(a, b) {
    const left = normalizePersonName(a)
    const right = normalizePersonName(b)
    return Boolean(left && right && left === right)
  }

  function findLinkedByName(patients, fullName) {
    const norm = normalizePersonName(fullName)
    if (!norm) return null
    const hits = (patients || []).filter((p) => namesEqual(p.full_name, fullName))
    if (hits.length === 1) return hits[0]
    return null
  }

  function isTargetResolved(lead) {
    const target = String(lead?.booking_target || '').trim()
    if (target === 'existing_patient' && lead?.selected_patient_id) return true
    if (target === 'new_patient') return true
    return false
  }

  function prependAck(replies, ack) {
    const list = (Array.isArray(replies) ? replies : [replies])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const intro = String(ack || '').trim()
    if (!intro) return list
    if (!list.length) return [intro]
    list[0] = `${intro}\n\n${list[0]}`
    return list
  }

  function detectRetarget(text, patients, lead, { allowIndex = false } = {}) {
    if (!patients?.length) return null
    const parsed = parsePatientSelection(text, patients, { allowIndex })
    if (parsed.type === 'ambiguous') return parsed
    if (parsed.type === 'new') {
      if (String(lead.booking_target || '') === 'new_patient') return null
      return parsed
    }
    if (parsed.type === 'new_incomplete') {
      if (String(lead.booking_target || '') === 'new_patient') return null
      return { type: 'new', fullName: null, reason: parsed.reason }
    }
    if (parsed.type === 'existing' && parsed.patient) {
      if (
        String(lead.booking_target || '') === 'existing_patient'
        && Number(lead.selected_patient_id) === Number(parsed.patient.id)
      ) {
        return null
      }
      if (String(lead.booking_target || '') === 'new_patient' && !lead.allow_duplicate_name) {
        return { type: 'duplicate', patient: parsed.patient, reason: 'new_then_existing_name' }
      }
      return parsed
    }
    return null
  }

  function showPatientPicker(conversationId, lead, language, chatId, patients, extraMessage = null, signals = null) {
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_patient',
      awaiting_field: 'patient_select',
      booking_intent: 1,
      booking_target: 'unresolved',
      selected_patient_id: null,
      pending_duplicate_patient_id: null,
      allow_duplicate_name: 0,
      language,
      whatsapp_chat_id: chatId || lead?.whatsapp_chat_id || null,
      full_name: null,
      phone_number: null,
      city: null,
      // Keep motif from the initiating message; identity is still unresolved.
      problem: signals?.problem || null,
      problem_details: signals?.problem_details || null,
      urgency: signals?.urgency || 'moyenne',
      appointment_date: null,
      appointment_time: null,
    })
    const replies = buildPatientPickerReplies(patients, language)
    if (extraMessage) {
      replies.push(extraMessage)
    }
    return finalizeTurn(updated, replies[0], true, null, signals, replies)
  }

  /** Re-ask the picker without wiping candidates already on the lead. */
  function remindPatientPicker(conversationId, lead, language, chatId, patients, extraMessage = null, signals = null) {
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_patient',
      awaiting_field: 'patient_select',
      booking_intent: 1,
      booking_target: 'unresolved',
      selected_patient_id: null,
      language,
      whatsapp_chat_id: chatId || lead?.whatsapp_chat_id || null,
      problem: signals?.problem || lead?.problem || null,
      problem_details: signals?.problem_details || lead?.problem_details || null,
      urgency: signals?.urgency || lead?.urgency || 'moyenne',
    })
    const replies = buildPatientPickerReplies(patients, language)
    if (extraMessage) replies.push(extraMessage)
    return finalizeTurn(updated, replies[0], true, null, signals, replies)
  }

  function applyNamedSelection(signals, parsed) {
    if (!signals) return signals
    if (parsed?.fullName) signals.full_name = parsed.fullName
    if (parsed?.type === 'new_incomplete' && parsed.firstName) {
      signals.name_incomplete = true
    }
    return signals
  }

  function askDuplicateConfirm(conversationId, lead, language, chatId, patient) {
    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_patient',
      awaiting_field: 'duplicate_confirm',
      booking_target: 'new_patient',
      selected_patient_id: null,
      pending_duplicate_patient_id: patient.id,
      allow_duplicate_name: 0,
      language,
      whatsapp_chat_id: chatId || lead?.whatsapp_chat_id || null,
      full_name: patient.full_name,
    })
    return finalizeTurn(
      updated,
      duplicateNameConfirmMessage(patient, language),
      true,
      null,
      null,
    )
  }

  async function startCollection(conversationId, lead, language, chatId, signals, options = {}) {
    const target = options.target || 'new_patient'
    const patient = options.patient || null
    const ack = options.ack || null
    const patients = options.patients || linkedPatientsFor(conversationId, chatId)
    const seeded = seedFromPatientHistory(conversationId, chatId)
    const recentTexts = recentInboundStrings(conversationId, chatId)

    if (target === 'existing_patient' && patient) {
      applyLastWins(seeded, signals, { identity: false })
      const applies = conversationAppliesToPatient(patient, patients, recentTexts)
      const knownService = isOfficialService(signals.problem || (applies ? seeded.problem : '') || '')
        ? (signals.problem || (applies ? seeded.problem : null))
        : (signals.problem || (applies ? seeded.problem : null) || null)
      const city = signals.city || (applies ? seeded.city : null) || patient.city || null
      const phone = (signals.phone_number && isValidPhone(signals.phone_number))
        ? signals.phone_number
        : (isValidPhone(patient.phone_number) ? patient.phone_number : null)

      const updated = repo.upsertLead(conversationId, {
        stage: 'awaiting_form',
        awaiting_field: 'bulk',
        booking_intent: 1,
        language,
        whatsapp_chat_id: chatId || lead.whatsapp_chat_id || null,
        booking_target: 'existing_patient',
        selected_patient_id: patient.id,
        pending_duplicate_patient_id: null,
        allow_duplicate_name: 0,
        full_name: patient.full_name,
        phone_number: phone,
        city,
        problem: knownService || null,
        problem_details: signals.problem_details || (applies ? seeded.problem_details : null) || null,
        urgency: signals.urgency || (applies ? seeded.urgency : null) || 'moyenne',
        appointment_date: signals.appointment_date || (applies ? seeded.appointment_date : null) || null,
        appointment_time: signals.appointment_time || (applies ? seeded.appointment_time : null) || null,
      })

      const check = checkCustomerData(updated)
      if (check.ok) {
        const next = processAfterData(conversationId, updated, language, signals, { entry: true })
        if (ack) {
          const replies = prependAck(next.forceReplies || [next.forceReply], ack)
          return finalizeTurn(next.lead, replies[0], true, next.booking, signals, replies)
        }
        return next
      }

      const replies = prependAck(buildBookingCollectionReplies(updated, language, {
        missing: check.missing,
        entry: true,
        rejectedName: Boolean(signals.name_incomplete),
      }), ack)
      return finalizeTurn(updated, replies[0], true, null, signals, replies)
    }

    applyLastWins(seeded, signals, { identity: true })
    // Never let an existing linked patient profile bleed into a new-person draft.
    // Scrub already merges current-turn signals over seed; do not re-inject
    // unscrubbed linked identity afterward.
    const scrubbed = scrubSeedForNewPatient(
      {
        full_name: signals.full_name || seeded.full_name || null,
        phone_number: signals.phone_number || seeded.phone_number || null,
        city: signals.city || seeded.city || null,
        problem: signals.problem || seeded.problem || null,
        problem_details: signals.problem_details || seeded.problem_details || null,
        urgency: signals.urgency || seeded.urgency || null,
        appointment_date: signals.appointment_date || seeded.appointment_date || null,
        appointment_time: signals.appointment_time || seeded.appointment_time || null,
      },
      patients,
    )

    let resolvedName = await resolveFullName(scrubbed.full_name || null, null)
    const linkedHit = resolvedName ? findLinkedByName(patients, resolvedName) : null
    if (linkedHit && !options.allowDuplicate && signals.full_name) {
      const updated = repo.upsertLead(conversationId, {
        stage: 'awaiting_patient',
        awaiting_field: 'duplicate_confirm',
        booking_target: 'new_patient',
        selected_patient_id: null,
        pending_duplicate_patient_id: linkedHit.id,
        allow_duplicate_name: 0,
        language,
        whatsapp_chat_id: chatId || lead.whatsapp_chat_id || null,
        full_name: resolvedName,
        phone_number: scrubbed.phone_number && !phonesEqual(scrubbed.phone_number, linkedHit.phone_number)
          ? scrubbed.phone_number
          : null,
        city: scrubbed.city || null,
        problem: scrubbed.problem || null,
        problem_details: scrubbed.problem_details || null,
        urgency: scrubbed.urgency || 'moyenne',
        appointment_date: scrubbed.appointment_date || null,
        appointment_time: scrubbed.appointment_time || null,
        booking_intent: 1,
      })
      return finalizeTurn(
        updated,
        duplicateNameConfirmMessage(linkedHit, language),
        true,
        null,
        signals,
      )
    }
    if (linkedHit && !signals.full_name) {
      resolvedName = null
    }

    const knownService = isOfficialService(scrubbed.problem || '')
      ? scrubbed.problem
      : (scrubbed.problem || null)

    const updated = repo.upsertLead(conversationId, {
      stage: 'awaiting_form',
      awaiting_field: 'bulk',
      booking_intent: 1,
      language,
      whatsapp_chat_id: chatId || lead.whatsapp_chat_id || null,
      booking_target: 'new_patient',
      selected_patient_id: null,
      pending_duplicate_patient_id: null,
      allow_duplicate_name: options.allowDuplicate ? 1 : 0,
      full_name: resolvedName || null,
      phone_number: scrubbed.phone_number || null,
      city: scrubbed.city || null,
      problem: knownService || null,
      problem_details: scrubbed.problem_details || null,
      urgency: scrubbed.urgency || 'moyenne',
      appointment_date: scrubbed.appointment_date || null,
      appointment_time: scrubbed.appointment_time || null,
    })

    const check = checkCustomerData(updated)
    if (check.ok) {
      const next = processAfterData(conversationId, updated, language, signals, { entry: true })
      if (ack) {
        const replies = prependAck(next.forceReplies || [next.forceReply], ack)
        return finalizeTurn(next.lead, replies[0], true, next.booking, signals, replies)
      }
      return next
    }

    const replies = prependAck(buildBookingCollectionReplies(updated, language, {
      missing: check.missing,
      entry: true,
      rejectedName: Boolean(signals.name_incomplete) && !resolvedName,
    }), ack)
    if (!replies.length) {
      return finalizeTurn(
        updated,
        bookingFormMessage(language, { knownService, skipProblem: Boolean(knownService) }),
        true,
        null,
        signals,
      )
    }
    return finalizeTurn(updated, replies[0], true, null, signals, replies)
  }

  async function beginBooking(conversationId, lead, language, chatId, signals, userText = '') {
    const patients = linkedPatientsFor(conversationId, chatId)
    if (!patients.length) {
      return startCollection(conversationId, lead, language, chatId, signals, {
        target: 'new_patient',
        patients,
      })
    }

    let parsed = parsePatientSelection(userText, patients, {
      allowIndex: true,
      acceptUnknownFullName: true,
    })

    if (parsed.type === 'unknown' && signals?.full_name) {
      parsed = matchLinkedByName(signals.full_name, patients)
    }

    applyNamedSelection(signals, parsed)

    if (parsed.type === 'existing' && parsed.patient) {
      return startCollection(conversationId, lead, language, chatId, signals, {
        target: 'existing_patient',
        patient: parsed.patient,
        patients,
        ack: existingPatientAck(parsed.patient, language),
      })
    }
    if (parsed.type === 'new' || parsed.type === 'new_incomplete') {
      return switchBookingTargetToNewPerson(conversationId, lead, language, chatId, signals, {
        patients,
        ack: newPersonAck(language, signals?.full_name || parsed.fullName || null),
      })
    }
    if (parsed.type === 'ambiguous') {
      return showPatientPicker(
        conversationId,
        lead,
        language,
        chatId,
        patients,
        ambiguousPatientMessage(language, parsed.matches || []),
        signals,
      )
    }

    return showPatientPicker(conversationId, lead, language, chatId, patients, null, signals)
  }

  async function handlePatientPickerTurn(conversationId, lead, language, chatId, signals, userText) {
    const patients = linkedPatientsFor(conversationId, chatId)
    if (!patients.length) {
      return startCollection(conversationId, lead, language, chatId, signals, {
        target: 'new_patient',
        patients,
      })
    }

    if (lead.awaiting_field === 'duplicate_confirm') {
      const choice = parseDuplicateConfirm(userText)
      const pending = lead.pending_duplicate_patient_id
        ? (typeof repo.getCustomerById === 'function'
          ? repo.getCustomerById(lead.pending_duplicate_patient_id)
          : patients.find((p) => Number(p.id) === Number(lead.pending_duplicate_patient_id)))
        : null
      if (choice.type === 'existing' && pending) {
        return startCollection(conversationId, lead, language, chatId, signals, {
          target: 'existing_patient',
          patient: pending,
          patients,
          ack: existingPatientAck(pending, language),
        })
      }
      if (choice.type === 'new') {
        return switchBookingTargetToNewPerson(conversationId, lead, language, chatId, signals, {
          patients,
          allowDuplicate: true,
          ack: newPersonAck(language, signals?.full_name || null),
        })
      }
      return finalizeTurn(
        lead,
        duplicateNameConfirmMessage(pending || patients[0], language),
        true,
        null,
        signals,
      )
    }

    let parsed = parsePatientSelection(userText, patients, {
      allowIndex: true,
      acceptUnknownFullName: true,
    })
    if (parsed.type === 'unknown' && signals?.full_name) {
      parsed = matchLinkedByName(signals.full_name, patients)
    }
    applyNamedSelection(signals, parsed)

    // Keep initiating motif for unresolved picker — never copy identity from a prior existing draft.
    if (parsed.type === 'new' || parsed.type === 'new_incomplete') {
      // Drop any lead identity that could belong to a previously selected patient.
      const cleanSignals = {
        ...signals,
        full_name: signals.full_name || parsed.fullName || null,
        phone_number: signals.phone_number || null,
        city: signals.city || null,
        appointment_date: signals.appointment_date || null,
        appointment_time: signals.appointment_time || null,
      }
      if (!cleanSignals.problem && lead?.problem && !lead?.selected_patient_id) {
        cleanSignals.problem = lead.problem
        cleanSignals.problem_details = cleanSignals.problem_details || lead.problem_details
        cleanSignals.urgency = cleanSignals.urgency || lead.urgency
      }
      return switchBookingTargetToNewPerson(conversationId, lead, language, chatId, cleanSignals, {
        patients,
        ack: newPersonAck(language, cleanSignals.full_name || null),
      })
    }

    if (!signals.problem && lead?.problem) {
      signals.problem = lead.problem
      signals.problem_details = signals.problem_details || lead.problem_details
      signals.urgency = signals.urgency || lead.urgency
    }

    if (parsed.type === 'existing' && parsed.patient) {
      return startCollection(conversationId, lead, language, chatId, signals, {
        target: 'existing_patient',
        patient: parsed.patient,
        patients,
        ack: existingPatientAck(parsed.patient, language),
      })
    }
    if (parsed.type === 'ambiguous') {
      return remindPatientPicker(
        conversationId,
        lead,
        language,
        chatId,
        patients,
        ambiguousPatientMessage(language, parsed.matches || []),
        signals,
      )
    }

    // Stay in selection: never wipe candidates; never fall through to generic LLM.
    return remindPatientPicker(conversationId, lead, language, chatId, patients, null, signals)
  }

  async function startForm(conversationId, lead, language, chatId, signals, userText = '') {
    return beginBooking(conversationId, lead, language, chatId, signals, userText)
  }

  function rejectOutsideHours(conversationId, lead, language, signals, hoursResult) {
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
      missingFieldsMessage(language, ['appointment'], { includeHours: true }),
    ].join('\n')
    return finalizeTurn(updated, body, true, null, signals)
  }

  function processAfterData(conversationId, lead, language, signals, extra = {}) {
    const check = checkCustomerData(lead)
    if (!check.ok) {
      const updated = repo.upsertLead(conversationId, {
        stage: 'awaiting_form',
        awaiting_field: 'bulk',
        booking_intent: 1,
      })
      const replies = buildBookingCollectionReplies(updated, language, {
        missing: check.missing,
        entry: Boolean(extra.entry),
        justFilled: extra.justFilled || [],
        rejectedName: Boolean(extra.rejectedName || signals?.name_incomplete),
      })
      return finalizeTurn(updated, replies[0] || bookingFormMessage(language), true, null, signals, replies)
    }

    const hours = validateAppointmentHours(lead.appointment_date, lead.appointment_time)
    if (!hours.ok) {
      return rejectOutsideHours(conversationId, lead, language, signals, hours)
    }

    if (typeof validateBooking === 'function') {
      const bookingRules = validateBooking(lead.appointment_date, lead.appointment_time)
      if (bookingRules && !bookingRules.ok) {
        const updated = repo.upsertLead(conversationId, {
          stage: 'awaiting_form',
          awaiting_field: 'bulk',
          appointment_date: null,
          appointment_time: null,
        })
        const msg = language === 'darija' || language === 'ar'
          ? 'التاريخ اللي عطيتي ما يمكنش للحجز. عافاك صيفط تاريخ و ساعة آخرين ضمن المدة المسموحة.'
          : 'La date indiquée n’est pas disponible pour la réservation. Merci de proposer un autre jour et une autre heure dans la période autorisée.'
        return finalizeTurn(updated, msg, true, null, signals)
      }
    }

    const ready = repo.upsertLead(conversationId, {
      stage: 'confirmation',
      awaiting_field: 'confirmation',
      correction_json: null,
    })
    return finalizeTurn(ready, askConfirmation(ready, language), true, null, signals)
  }

  async function processCrmTurn(input = {}) {
    const conversationId = String(input.conversationId || '').trim()
    const userText = String(input.userText || '').trim()
    const language = input.languageHint || 'fr'
    const isVoice = Boolean(input.isVoice)
    if (!conversationId || !userText) {
      return {
        lead: null,
        forceReply: null,
        forceReplies: [],
        shouldSkipLlm: false,
        llmContext: '',
        booking: null,
        extracted: null,
      }
    }

    if (repo.isConversationHumanControlled?.(conversationId, input.chatId)) {
      const lead = repo.getLead(conversationId)
      return {
        lead,
        forceReply: null,
        forceReplies: [],
        shouldSkipLlm: true,
        llmContext: '',
        booking: null,
        extracted: null,
        check: lead ? checkCustomerData(lead) : null,
      }
    }

    let lead = repo.getLead(conversationId) || repo.upsertLead(conversationId, {
      whatsapp_chat_id: input.chatId || null,
      phone_number: null,
      language,
      stage: 'discovery',
    })

    if (lead.stage === 'crm_collection') {
      lead = repo.upsertLead(conversationId, {
        stage: 'awaiting_form',
        awaiting_field: 'bulk',
      })
    }

    const inPicker = lead.stage === 'awaiting_patient'
    const inBooking = lead.stage === 'awaiting_form'
      || lead.stage === 'confirmation'
      || lead.stage === 'crm_collection'
      || inPicker

    const signals = extractCustomerSignals(userText, {
      voiceIntent: input.voiceIntent || null,
      conservative: !inBooking,
    })
    signals.rawText = userText

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

    if (isVoice) {
      signals.full_name = null
      signals.phone_number = null
      signals.city = null
      signals.appointment_date = null
      signals.appointment_time = null
      const explicitVoiceBooking = Boolean(
        hasExplicitBookingIntent(userText)
        || router?.bookAppointment,
      )
      signals.booking_intent = explicitVoiceBooking
      if (!explicitVoiceBooking) {
        signals.skipProblemQuestion = false
      }
    }

    if (lead.stage === 'completed') {
      if (signals.booking_intent) {
        lead = resetLeadForNewBooking(conversationId, lead, language, input.chatId)
      } else {
        return {
          lead,
          forceReply: null,
          forceReplies: [],
          shouldSkipLlm: false,
          llmContext: '',
          booking: null,
          extracted: signals,
          check: checkCustomerData(lead),
        }
      }
    }

    const lang = replyLanguage(lead, language)
    const routingState = input.routingState || null
    const bookingBlocked = Boolean(
      routingState?.blocksBooking && routingState?.activeWorkflow !== 'booking',
    )

    // Explicit "nouveau RDV" while a draft/summary is open → independent booking.
    if (
      !isVoice
      && !bookingBlocked
      && isFreshBookingRequest(userText)
      && (
        lead.stage === 'awaiting_form'
        || lead.stage === 'confirmation'
        || lead.stage === 'awaiting_patient'
        || lead.stage === 'crm_collection'
      )
    ) {
      lead = resetLeadForNewBooking(conversationId, lead, language, input.chatId)
      return startForm(conversationId, lead, lang, input.chatId, signals, userText)
    }

    if (bookingBlocked && (process.env.CRM_DEBUG_CONTEXT === '1' || process.env.NODE_ENV !== 'production')) {
      console.log('[BOOKING_GUARD]', {
        blocked: true,
        activeWorkflow: routingState.activeWorkflow,
        leadStage: lead.stage,
        text: String(userText || '').slice(0, 60),
      })
    }

    if (bookingBlocked && (lead.stage === 'awaiting_form' || lead.stage === 'crm_collection')) {
      return {
        lead,
        forceReply: null,
        forceReplies: [],
        shouldSkipLlm: true,
        llmContext: '',
        booking: null,
        extracted: signals,
        check: checkCustomerData(lead),
      }
    }

    const fieldUpdates = hasExtractedBookingFields(signals)

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

      if (signals.booking_intent) {
        if (inPicker) {
          return handlePatientPickerTurn(conversationId, lead, lang, input.chatId, signals, userText)
        }
        if (lead.stage === 'awaiting_form' || lead.stage === 'confirmation') {
          const missing = checkCustomerData(lead).missing
          return finalizeTurn(lead, voiceUseTextReminder(lang, missing), true, null, signals)
        }
        return startForm(conversationId, lead, lang, input.chatId, signals, userText)
      }

      if (lead.stage === 'awaiting_patient') {
        return handlePatientPickerTurn(conversationId, lead, lang, input.chatId, signals, userText)
      }

      if (lead.stage === 'awaiting_form' || lead.stage === 'confirmation') {
        const missing = checkCustomerData(lead).missing
        return finalizeTurn(lead, voiceUseTextReminder(lang, missing), true, null, signals)
      }

      return {
        lead,
        forceReply: null,
        forceReplies: [],
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

    const beforeLead = { ...lead }
    const patients = linkedPatientsFor(conversationId, input.chatId)
    const selectionHint = patients.length
      ? parsePatientSelection(userText, patients, { allowIndex: inPicker })
      : { type: 'unknown' }
    const switching = selectionHint.type === 'existing'
      || selectionHint.type === 'new'
      || selectionHint.type === 'ambiguous'
      || selectionHint.type === 'new_incomplete'
      || (selectionHint.type === 'unknown' && looksLikeNewPerson(userText))

    if (inPicker) {
      repo.logConversation({
        conversation_id: conversationId,
        whatsapp_chat_id: input.chatId || null,
        direction: 'inbound',
        message_text: userText,
        extracted: { ...signals, stage: lead.stage, awaiting_field: lead.awaiting_field },
        appointment_status: lead.stage,
      })
      return handlePatientPickerTurn(conversationId, lead, lang, input.chatId, signals, userText)
    }

    // Booking draft confirmation / correction / cancel — before mergeSignals
    if (lead.stage === 'confirmation') {
      repo.logConversation({
        conversation_id: conversationId,
        whatsapp_chat_id: input.chatId || null,
        direction: 'inbound',
        message_text: userText,
        extracted: { ...signals, stage: lead.stage, awaiting_field: lead.awaiting_field },
        appointment_status: lead.stage,
      })
      return handleBookingConfirmationTurn(conversationId, lead, lang, input.chatId, signals, userText)
    }

    const isConfirmReply = false

    if (!isConfirmReply && inBooking && patients.length && isTargetResolved(lead)) {
      const retarget = detectRetarget(userText, patients, lead, { allowIndex: false })
      if (retarget?.type === 'ambiguous') {
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: { ...signals, stage: lead.stage, awaiting_field: lead.awaiting_field },
          appointment_status: lead.stage,
        })
        return finalizeTurn(
          lead,
          ambiguousPatientMessage(lang, retarget.matches || []),
          true,
          null,
          signals,
        )
      }
      if (retarget?.type === 'duplicate' && retarget.patient) {
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: { ...signals, stage: lead.stage },
          appointment_status: lead.stage,
        })
        return askDuplicateConfirm(conversationId, lead, lang, input.chatId, retarget.patient)
      }
      if (retarget?.type === 'existing' && retarget.patient) {
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: { ...signals, stage: lead.stage },
          appointment_status: lead.stage,
        })
        return startCollection(conversationId, lead, lang, input.chatId, signals, {
          target: 'existing_patient',
          patient: retarget.patient,
          patients,
          ack: existingPatientAck(retarget.patient, lang),
        })
      }
      if (retarget?.type === 'new') {
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: { ...signals, stage: lead.stage },
          appointment_status: lead.stage,
        })
        if (retarget.fullName) signals.full_name = retarget.fullName
        // Never carry previous existing-patient identity into the new draft.
        const cleanSignals = {
          ...signals,
          phone_number: signals.phone_number || null,
          city: signals.city || null,
          appointment_date: signals.appointment_date || null,
          appointment_time: signals.appointment_time || null,
        }
        return switchBookingTargetToNewPerson(conversationId, lead, lang, input.chatId, cleanSignals, {
          patients,
          ack: newPersonAck(lang, cleanSignals.full_name || retarget.fullName || null),
        })
      }
    }

    if (!isConfirmReply && inBooking) {
      const correction = detectCorrectionIntent(userText, { now: new Date() })
      if (correction.isCorrection) {
        const beforeLead = { ...lead }
        const patch = buildCorrectionPatch(correction)
        if (language) patch.language = language
        if (input.chatId) patch.whatsapp_chat_id = input.chatId
        // Invalidate any prior confirmation — require a fresh OUI after edits.
        if (lead.stage === 'confirmation' || lead.awaiting_field === 'confirmation') {
          patch.stage = 'awaiting_form'
          patch.awaiting_field = 'bulk'
        }
        lead = repo.upsertLead(conversationId, patch)

        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: {
            correction: true,
            changedFields: correction.changedFields,
            fields: correction.fields,
            cleared: correction.cleared,
            stage: lead.stage,
          },
          appointment_status: lead.stage,
        })

        const ack = correctionAck(correction.changedFields, lang)
        const follow = processAfterData(conversationId, lead, lang, {
          ...signals,
          full_name: null,
          phone_number: null,
          city: null,
          problem: null,
          problem_details: null,
          appointment_date: null,
          appointment_time: null,
          booking_intent: false,
          confirmation_yes: false,
          confirmation_no: false,
          _cleared: {},
        }, {
          justFilled: detectJustFilled(beforeLead, lead),
        })
        const replies = prependAck(follow.forceReplies || [follow.forceReply], ack)
        return finalizeTurn(
          follow.lead || lead,
          replies[0],
          true,
          follow.booking || null,
          { ...signals, _correction: correction },
          replies,
        )
      }

      const patch = await mergeSignals(lead, signals, lead.awaiting_field)
      const rejectedName = Boolean(patch._rejected_full_name)
      delete patch._rejected_full_name
      if (language) patch.language = language
      if (input.chatId) patch.whatsapp_chat_id = input.chatId
      lead = repo.upsertLead(conversationId, patch)

      if (
        rejectedName
        && (lead.stage === 'awaiting_form' || lead.stage === 'crm_collection' || lead.awaiting_field === 'bulk')
      ) {
        const check = checkCustomerData(lead)
        const missing = Array.from(new Set([...(check.missing || []), 'full_name']))
        repo.logConversation({
          conversation_id: conversationId,
          whatsapp_chat_id: input.chatId || null,
          direction: 'inbound',
          message_text: userText,
          extracted: { ...signals, stage: lead.stage, awaiting_field: lead.awaiting_field },
          appointment_status: lead.stage,
        })
        const replies = buildBookingCollectionReplies(lead, language, {
          missing,
          rejectedName: true,
        })
        return finalizeTurn(lead, replies[0] || fullNameRequiredMessage(language), true, null, signals, replies)
      }

      if (
        String(lead.booking_target || '') === 'new_patient'
        && !Number(lead.allow_duplicate_name)
        && lead.full_name
        && patients.length
      ) {
        const hit = findLinkedByName(patients, lead.full_name)
        if (hit) {
          repo.logConversation({
            conversation_id: conversationId,
            whatsapp_chat_id: input.chatId || null,
            direction: 'inbound',
            message_text: userText,
            extracted: { ...signals, stage: lead.stage, duplicate_name: true },
            appointment_status: lead.stage,
          })
          return askDuplicateConfirm(conversationId, lead, lang, input.chatId, hit)
        }
      }
    } else if (!inBooking) {
      const patch = {}
      if (language) patch.language = language
      if (input.chatId) patch.whatsapp_chat_id = input.chatId
      if (Object.keys(patch).length) lead = repo.upsertLead(conversationId, patch)
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

    if (lead.stage === 'awaiting_form' || lead.stage === 'crm_collection') {
      const checkBefore = checkCustomerData(beforeLead)
      const providedSomething = fieldUpdates

      if (!providedSomething && !checkBefore.ok) {
        if (isGibberishMessage(userText) || isExplicitUnclearPhrase(userText)) {
          return finalizeTurn(lead, formAwaitingClarifyMessage(lang), true, null, signals)
        }
        return processAfterData(conversationId, lead, lang, signals)
      }

      return processAfterData(conversationId, lead, lang, signals, {
        justFilled: detectJustFilled(beforeLead, lead),
      })
    }

    const shouldStartBooking = !bookingBlocked && Boolean(
      router?.bookAppointment
      || hasExplicitBookingIntent(userText)
      || (signals.booking_intent && hasExplicitBookingIntent(userText)),
    )

    if (shouldStartBooking) {
      return startForm(conversationId, lead, lang, input.chatId, signals, userText)
    }

    const shouldOfferBooking = Boolean(signals.problem || lead.problem)
    const offerContext = shouldOfferBooking
      ? [
        'BOOKING OFFER RULE (internal):',
        '- If relevant, invite the patient to book HERE on WhatsApp in ONE short sentence.',
        '- If they accept / ask for RDV, the CRM workflow will collect the remaining fields.',
        '- For Darija (including Latin keyboard), reply in Arabic script only.',
        '- Do not ask identity fields one by one unless booking has started.',
      ].join('\n')
      : ''

    return {
      lead,
      forceReply: null,
      forceReplies: [],
      shouldSkipLlm: false,
      llmContext: offerContext,
      booking: null,
      extracted: signals,
      check: checkCustomerData(lead),
    }
  }

  function finalizeTurn(lead, templateReply, sendExactTemplate = true, booking = null, extracted = null, replies = null, extra = {}) {
    const check = checkCustomerData(lead || {})
    const baseContext = lead ? buildLlmContext(lead, check) : ''
    const list = (Array.isArray(replies) ? replies : [templateReply])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const draft = list[0] || String(templateReply || '').trim()

    if (sendExactTemplate && draft) {
      return {
        lead,
        forceReply: draft,
        forceReplies: list,
        templateReply: draft,
        shouldSkipLlm: true,
        llmContext: baseContext,
        booking,
        extracted,
        check,
        conversationReset: Boolean(extra.conversationReset),
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
      forceReplies: list,
      templateReply: draft || null,
      shouldSkipLlm: false,
      llmContext: [baseContext, aiBrief].filter(Boolean).join('\n\n'),
      booking,
      extracted,
      check,
      conversationReset: Boolean(extra.conversationReset),
    }
  }

  function executeDraftReset(conversationId, language) {
    resetConversation(conversationId)
    const empty = {
      stage: 'discovery',
      awaiting_field: null,
      booking_intent: 0,
      language: language || 'fr',
    }
    return finalizeTurn(
      empty,
      draftCancelledMessage(language),
      true,
      null,
      { conversation_reset: true },
      null,
      { conversationReset: true },
    )
  }

  async function handleBookingConfirmationTurn(conversationId, lead, language, chatId, signals, userText) {
    const awaiting = String(lead.awaiting_field || 'confirmation')

    const returnToSummary = () => {
      const ready = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'confirmation',
        correction_json: null,
      })
      return finalizeTurn(ready, askConfirmation(ready, language), true, null, signals)
    }

    // --- Confirm cancel after unclear reply ---
    if (awaiting === 'unclear_cancel_confirm') {
      const yn = parseYesNoReply(userText, { allowTypoYes: false })
      if (yn.value === 'yes' || isStrictBookingConfirmYes(userText)) {
        return executeDraftReset(conversationId, language)
      }
      if (yn.value === 'no' || isBookingConfirmNo(userText)) {
        return returnToSummary()
      }
      const updated = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'unclear_cancel_confirm',
      })
      return finalizeTurn(updated, unclearReplyCancelAskMessage(language), true, null, signals)
    }

    // --- Confirm full draft cancellation ---
    if (awaiting === 'draft_cancel_confirm') {
      const yn = parseYesNoReply(userText, { allowTypoYes: false })
      if (yn.value === 'yes' || isStrictBookingConfirmYes(userText)) {
        return executeDraftReset(conversationId, language)
      }
      if (yn.value === 'no' || isBookingConfirmNo(userText)) {
        return returnToSummary()
      }
      const updated = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'draft_cancel_confirm',
      })
      return finalizeTurn(updated, draftCancelConfirmMessage(language), true, null, signals)
    }

    // --- Sequential field value ---
    if (awaiting === 'field_correction') {
      const state = parseCorrectionState(lead.correction_json)
      const field = state.fields[state.index]
      if (!field) {
        return returnToSummary()
      }
      const parsed = parseFieldCorrectionValue(field, userText, { now: new Date() })
      if (!parsed.ok) {
        const detail = parsed.reason === 'outside_hours'
          ? outsideHoursRetry(language, parsed.hours)
          : fieldCorrectionRetry(field, language)
        return finalizeTurn(lead, detail, true, null, signals)
      }
      const nextIndex = state.index + 1
      const done = nextIndex >= state.fields.length
      const updated = repo.upsertLead(conversationId, {
        ...parsed.patch,
        stage: 'confirmation',
        awaiting_field: done ? 'confirmation' : 'field_correction',
        correction_json: done
          ? null
          : serializeCorrectionState({ fields: state.fields, index: nextIndex }),
      })
      if (!done) {
        const nextField = state.fields[nextIndex]
        return finalizeTurn(updated, fieldCorrectionPrompt(nextField, language), true, null, signals)
      }
      const check = checkCustomerData(updated)
      if (!check.ok) {
        const missingLead = repo.upsertLead(conversationId, {
          stage: 'awaiting_form',
          awaiting_field: 'bulk',
          correction_json: null,
        })
        return processAfterData(conversationId, missingLead, language, signals)
      }
      const hours = validateAppointmentHours(updated.appointment_date, updated.appointment_time)
      if (!hours.ok) {
        return rejectOutsideHours(conversationId, updated, language, signals, hours)
      }
      return finalizeTurn(updated, askConfirmation(updated, language), true, null, signals)
    }

    // --- Which fields to correct ---
    if (awaiting === 'fields_to_correct') {
      const fields = parseFieldsToCorrect(userText)
      if (!fields.length) {
        return finalizeTurn(lead, fieldsToCorrectPrompt(language), true, null, signals)
      }
      const updated = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'field_correction',
        correction_json: serializeCorrectionState({ fields, index: 0 }),
      })
      return finalizeTurn(updated, fieldCorrectionPrompt(fields[0], language), true, null, signals)
    }

    // --- After NON: correct or cancel ---
    if (awaiting === 'confirmation_rejection') {
      const choice = parseRejectionChoice(userText)
      if (choice.type === 'correct') {
        const updated = repo.upsertLead(conversationId, {
          stage: 'confirmation',
          awaiting_field: 'fields_to_correct',
          correction_json: null,
        })
        return finalizeTurn(updated, fieldsToCorrectPrompt(language), true, null, signals)
      }
      if (choice.type === 'cancel') {
        const updated = repo.upsertLead(conversationId, {
          stage: 'confirmation',
          awaiting_field: 'draft_cancel_confirm',
          correction_json: null,
        })
        return finalizeTurn(updated, draftCancelConfirmMessage(language), true, null, signals)
      }
      const updated = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'confirmation_rejection',
      })
      return finalizeTurn(updated, rejectionMenuMessage(language), true, null, signals)
    }

    // --- Main summary confirmation ---
    // 1) Strict OUI
    if (isStrictBookingConfirmYes(userText)) {
      const check = checkCustomerData(lead)
      if (!check.ok) {
        return processAfterData(conversationId, lead, language, signals)
      }
      const hours = validateAppointmentHours(lead.appointment_date, lead.appointment_time)
      if (!hours.ok) {
        return rejectOutsideHours(conversationId, lead, language, signals, hours)
      }
      if (typeof validateBooking === 'function') {
        const bookingRules = validateBooking(lead.appointment_date, lead.appointment_time)
        if (bookingRules && !bookingRules.ok) {
          const updated = repo.upsertLead(conversationId, {
            stage: 'awaiting_form',
            awaiting_field: 'bulk',
            appointment_date: null,
            appointment_time: null,
            correction_json: null,
          })
          const msg = language === 'darija' || language === 'ar'
            ? 'التاريخ اللي عطيتي ما يمكنش للحجز. عافاك صيفط تاريخ و ساعة آخرين ضمن المدة المسموحة.'
            : 'La date indiquée n’est pas disponible pour la réservation. Merci de proposer un autre jour et une autre heure dans la période autorisée.'
          return finalizeTurn(updated, msg, true, null, signals)
        }
      }
      const booking = repo.saveConfirmedBooking(lead)
      const confirmationText = patientConfirmationMessage(lead, language)
      repo.logConversation({
        conversation_id: conversationId,
        whatsapp_chat_id: chatId || null,
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
      const cleared = resetLeadForNewBooking(conversationId, lead, language, chatId)
      return finalizeTurn(cleared, confirmationText, true, booking, signals)
    }

    // 2) NON → rejection menu (do not wipe draft)
    if (isBookingConfirmNo(userText)) {
      const updated = repo.upsertLead(conversationId, {
        stage: 'confirmation',
        awaiting_field: 'confirmation_rejection',
        correction_json: null,
      })
      return finalizeTurn(updated, rejectionMenuMessage(language), true, null, signals)
    }

    // 3) Explicit correction (even without NON first)
    const correction = detectCorrectionIntent(userText, { now: new Date() })
    if (correction.isCorrection) {
      const patch = buildCorrectionPatch(correction)
      patch.stage = 'confirmation'
      patch.awaiting_field = 'confirmation'
      patch.correction_json = null
      if (language) patch.language = language
      if (chatId) patch.whatsapp_chat_id = chatId
      const updated = repo.upsertLead(conversationId, patch)
      const check = checkCustomerData(updated)
      if (!check.ok) {
        const formLead = repo.upsertLead(conversationId, {
          stage: 'awaiting_form',
          awaiting_field: 'bulk',
        })
        const ack = correctionAck(correction.changedFields, language)
        const follow = processAfterData(conversationId, formLead, language, {
          ...signals,
          confirmation_yes: false,
          confirmation_no: false,
        })
        const replies = prependAck(follow.forceReplies || [follow.forceReply], ack)
        return finalizeTurn(follow.lead || formLead, replies[0], true, null, signals, replies)
      }
      const hours = validateAppointmentHours(updated.appointment_date, updated.appointment_time)
      if (!hours.ok) {
        return rejectOutsideHours(conversationId, updated, language, signals, hours)
      }
      const ack = correctionAck(correction.changedFields, language)
      const summary = askConfirmation(updated, language)
      return finalizeTurn(updated, `${ack}\n\n${summary}`, true, null, signals)
    }

    // 4) Unclear → ask cancel?
    const updated = repo.upsertLead(conversationId, {
      stage: 'confirmation',
      awaiting_field: 'unclear_cancel_confirm',
      correction_json: null,
    })
    return finalizeTurn(updated, unclearReplyCancelAskMessage(language), true, null, signals)
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
