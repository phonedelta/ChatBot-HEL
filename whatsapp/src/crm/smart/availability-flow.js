/**
 * WhatsApp flow: consult cabinet availability then continue booking.
 * Uses getBookableSlotsForDate (same engine as Agenda).
 */

const { isDarija } = require('../messages')
const { checkCustomerData } = require('../checkCustomerData')
const {
  askConfirmation,
  bookingFormMessage,
  buildBookingCollectionReplies,
} = require('../messages')
const {
  getBookableSlotsForDate,
  checkSlotAvailability,
  normalizeSlotTime,
} = require('../appointment-slots')
const {
  WEEKLY_HOURS,
  weekdayFromIsoDate,
  DAY_NAMES_FR,
  DAY_NAMES_AR,
} = require('../working-hours')
const { parseAvailabilityDate, formatDisplayDate } = require('./availability-date')
const { parseAvailableSlotSelection } = require('./availability-slot-select')
const { validateBookingDateTime } = require('./cabinet-settings')

const STAGE_AWAITING_DATE = 'awaiting_availability_date'
const STAGE_AWAITING_SLOT = 'awaiting_available_slot_selection'
const STAGE_AWAITING_PRECISE_CONFIRM = 'awaiting_precise_slot_confirm'
const STATE_TTL_MS = 6 * 60 * 60 * 1000

const MY_APPOINTMENTS_RE = /\b(dyali|mes\s+rendez|mes\s+rdv|مواعيدي|موعدي|my\s+appointments?)\b/i

const AVAILABILITY_PHRASES = [
  /chno\s+(les\s+)?(rendez[- ]?vous|rdv|creneaux|créneaux)\s+disponibles?/i,
  /chno\s+kayn\s+(disponible|dispo|ghdda|ghedda|gheda|demain|mn\s+rendez|mn\s+rdv|nhar)/i,
  /chno\s+kayn\s+disponible/i,
  /wach\s+kayn\s+chi\s+(blassa|rdv|mo3id|موعد)/i,
  /wash\s+kayn\s+chi\s+(blassa|rdv)/i,
  /wach\s+disponible/i,
  /3andkom\s+chi\s+(rendez|rdv|creneau)/i,
  /bghit\s+nchof\s+(les\s+)?(horaires?|disponibilit)/i,
  /je\s+veux\s+nchof\s+chno\s+kayn/i,
  /nchof\s+chno\s+kayn/i,
  /quels?\s+(sont\s+)?(les\s+)?(creneaux|créneaux|rendez[- ]?vous|disponibilites?|disponibilités)/i,
  /quelles?\s+(sont\s+)?vos\s+disponibilites?/i,
  /horaires?\s+disponibles?/i,
  /creneaux?\s+disponibles?/i,
  /créneaux?\s+disponibles?/i,
  /rendez[- ]?vous\s+disponibles?/i,
  /wash\s+.+\s+disponible/i,
  /واش\s+.+\s+متوفر/i,
  /واش\s+كاين\s+شي\s+(موعد|بلاصة)/i,
  /المواعيد\s+المتوفرة/i,
  /شنو\s+كاين\s+من\s+موعد/i,
  /شنو\s+(المواعيد|الكريو|الكريوهات)\s+(المتوفرة|لي\s+كاينين)/i,
  /disponibilites?\s*\?/i,
  /disponibilités?\s*\?/i,
]

function nowIso() {
  return new Date().toISOString()
}

function normalizeChatKey(chatKey) {
  return String(chatKey || '').trim()
}

function stripInstance(chatKey) {
  return normalizeChatKey(chatKey).replace(/^[^:]+:/, '')
}

function looksLikeMyAppointments(text) {
  return MY_APPOINTMENTS_RE.test(String(text || ''))
}

function detectAvailabilityIntent(text) {
  const raw = String(text || '').trim()
  if (!raw) return { matched: false, confidence: 0 }
  if (looksLikeMyAppointments(raw)) {
    return { matched: false, confidence: 0, reason: 'my_appointments' }
  }
  for (const re of AVAILABILITY_PHRASES) {
    if (re.test(raw)) return { matched: true, confidence: 0.94, matchedBy: String(re) }
  }
  const n = raw.toLowerCase()
  const hasDispo = /\b(disponible|disponibles|disponibilite|disponibilité|dispo|متوفر|متوفرة)\b/i.test(raw)
  const hasSlotWord = /\b(rendez[- ]?vous|rdv|creneau|créneau|creneaux|créneaux|horaire|horaires|موعد|مواعيد|ساعة|سوايع)\b/i.test(raw)
  const hasAsk = /\b(chno|wach|wash|quels?|quelles?|bghit\s+nchof|voir|شحال|شنو|واش)\b/i.test(n)
  const hasPlace = /\b(blassa|بلاصة|créneau|creneau)\b/i.test(raw)
  const hasRelativeDay = /\b(ghdda|ghedda|gheda|lyoum|lyom|demain|aujourd|سبت|sebt)\b/i.test(n)
  if (hasDispo && (hasSlotWord || hasAsk)) {
    return { matched: true, confidence: 0.88, matchedBy: 'heuristic' }
  }
  if (hasAsk && hasPlace && (hasSlotWord || hasRelativeDay || /\bkayn\b/i.test(n))) {
    return { matched: true, confidence: 0.9, matchedBy: 'darija_place_slot' }
  }
  if (hasAsk && /\bkayn\b/i.test(n) && (hasSlotWord || hasRelativeDay) && !looksLikeMyAppointments(raw)) {
    return { matched: true, confidence: 0.87, matchedBy: 'darija_chno_kayn' }
  }
  return { matched: false, confidence: 0 }
}

function morningCutoffMinutes() {
  return 13 * 60
}

function dayMeta(dateIso) {
  const wd = weekdayFromIsoDate(dateIso)
  const hours = wd == null ? null : WEEKLY_HOURS[wd]
  return {
    weekday: wd,
    dayNameFr: wd == null ? null : DAY_NAMES_FR[wd],
    dayNameAr: wd == null ? null : DAY_NAMES_AR[wd],
    open: hours?.open || null,
    close: hours?.close || null,
    hasEveningHours: Boolean(hours && hours.close > '13:00'),
  }
}

function formatSlotsMessage(dateIso, times, language = 'darija') {
  const display = formatDisplayDate(dateIso)
  const meta = dayMeta(dateIso)
  const morning = []
  const afternoon = []
  times.forEach((t, i) => {
    const item = { index: i + 1, time: t }
    const [hh, mm] = t.split(':').map(Number)
    if (hh * 60 + mm < morningCutoffMinutes()) morning.push(item)
    else afternoon.push(item)
  })

  if (isDarija(language)) {
    const dayLabel = meta.dayNameAr ? `${meta.dayNameAr} ${display}` : display
    const lines = [`هاد هما المواعيد المتوفرة نهار ${dayLabel}:`, '']
    if (morning.length) {
      lines.push('🌅 الصباح')
      for (const s of morning) lines.push(`${s.index}. ${s.time}`)
      lines.push('')
    }
    if (afternoon.length) {
      lines.push('🌇 العشية')
      for (const s of afternoon) lines.push(`${s.index}. ${s.time}`)
      lines.push('')
    } else if (morning.length && !meta.hasEveningHours && meta.close) {
      lines.push(`⚠️ نهار ${meta.dayNameAr || 'هاد النهار'} المركز خدام غير فالصباح حتى لـ ${meta.close}.`)
      lines.push('ما كاينش مواعيد فالعشية.')
      lines.push('إلى بغيتي العشية، عطيني نهار من الإثنين للجمعة.')
      lines.push('')
    }
    lines.push('اختار الرقم ديال الساعة اللي ناسبك، أو كتب ليا الساعة مباشرة.')
    return lines.join('\n')
  }

  const dayLabel = meta.dayNameFr ? `${meta.dayNameFr} ${display}` : display
  const lines = [`Voici les créneaux disponibles le ${dayLabel} :`, '']
  if (morning.length) {
    lines.push('Matin')
    for (const s of morning) lines.push(`${s.index}. ${s.time}`)
    lines.push('')
  }
  if (afternoon.length) {
    lines.push('Après-midi')
    for (const s of afternoon) lines.push(`${s.index}. ${s.time}`)
    lines.push('')
  } else if (morning.length && !meta.hasEveningHours && meta.close) {
    lines.push(`⚠️ Le ${meta.dayNameFr || 'ce jour'} le cabinet n’ouvre que le matin jusqu’à ${meta.close}.`)
    lines.push('Il n’y a pas de créneaux l’après-midi.')
    lines.push('Pour l’après-midi, indiquez un jour du lundi au vendredi.')
    lines.push('')
  }
  lines.push('Choisissez le numéro ou indiquez directement l’heure.')
  return lines.join('\n')
}

function askDateMessage(language = 'darija') {
  if (isDarija(language)) {
    return [
      'أكيد 👍',
      'شنو هو النهار اللي بغيتي فيه الموعد؟',
      '',
      'عطيني النهار والشهر، مثلا:',
      '05/09',
    ].join('\n')
  }
  return [
    'Bien sûr 👍',
    'Pour quel jour souhaitez-vous voir les disponibilités ?',
    '',
    'Indiquez-moi le jour et le mois, par exemple :',
    '05/09',
  ].join('\n')
}

function msgPastDate(language = 'darija') {
  if (isDarija(language)) {
    return 'هاد النهار داز.\nعطيني نهار آخر باش نشوف ليك المواعيد المتوفرة.'
  }
  return 'Cette date est déjà passée.\nMerci d’indiquer un autre jour pour voir les disponibilités.'
}

function msgClosed(language = 'darija') {
  if (isDarija(language)) {
    return 'المركز مسدود هاد النهار.\n\nعطيني نهار آخر ونشوف ليك المواعيد المتوفرة.'
  }
  return 'Le cabinet est fermé ce jour-là.\n\nIndiquez un autre jour et je vérifierai les disponibilités.'
}

function msgNone(dateIso, language = 'darija') {
  const display = formatDisplayDate(dateIso)
  if (isDarija(language)) {
    return `ما بقا حتى موعد متوفر نهار ${display}.\n\nعطيني نهار آخر ونشوف ليك المواعيد المتوفرة.`
  }
  return `Aucun créneau n’est disponible le ${display}.\n\nIndiquez un autre jour et je vérifierai les disponibilités.`
}

function msgSameDayDisabled(language = 'darija') {
  if (isDarija(language)) {
    return 'ما يمكنش نحجز فنفس النهار.\nعطيني نهار آخر باش نشوف ليك المواعيد المتوفرة.'
  }
  return 'Les rendez-vous le jour même ne sont pas autorisés.\nMerci d’indiquer un autre jour.'
}

function msgHorizon(language = 'darija') {
  if (isDarija(language)) {
    return 'هاد التاريخ بعيد بزاف على المدة المسموحة للحجز.\nعطيني نهار أقرب باش نشوف ليك المواعيد المتوفرة.'
  }
  return 'Cette date dépasse la période de réservation autorisée.\nMerci d’indiquer une date plus proche.'
}

function msgNeedDate(language = 'darija') {
  if (isDarija(language)) {
    return 'ما فهمتش التاريخ مزيان.\nعطيني النهار والشهر، مثلا: 05/09'
  }
  return 'Je n’ai pas bien compris la date.\nIndiquez le jour et le mois, par exemple : 05/09'
}

function msgInvalidIndex(slots, bad, language = 'darija') {
  if (isDarija(language)) {
    return `الاختيار ${bad} ما كاينش.\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
  }
  return `Le choix ${bad} n’existe pas.\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
}

function msgTimeUnavailable(time, slots, language = 'darija') {
  if (isDarija(language)) {
    return `${time} ماشي متوفرة فهاد النهار.\n\nاختار واحد من هاد المواعيد:\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
  }
  return `${time} n’est pas disponible ce jour-là.\n\nChoisissez parmi ces créneaux :\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
}

function msgStaleSlot(slots, language = 'darija') {
  if (isDarija(language)) {
    return `هاد الساعة تعمرات دابا وما بقاتش متوفرة.\n\nهادو هما السوايع اللي مازال متوفرين:\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
  }
  return `Ce créneau vient d’être pris et n’est plus disponible.\n\nVoici les horaires encore libres :\n\n${formatSlotsMessage(slots.date, slots.times, language)}`
}

function msgPreciseAvailable(dateIso, time, language = 'darija') {
  const display = formatDisplayDate(dateIso)
  if (isDarija(language)) {
    return `نعم، ${time} متوفرة نهار ${display}.\nواش بغيتي نحجزهالك؟`
  }
  return `Oui, ${time} est disponible le ${display}.\nSouhaitez-vous que je le réserve ?`
}

function msgPreciseBusy(dateIso, time, slots, language = 'darija') {
  const display = formatDisplayDate(dateIso)
  if (isDarija(language)) {
    return `${time} ماشي متوفرة نهار ${display}.\n\nهادو هما المواعيد المتوفرة:\n\n${formatSlotsMessage(dateIso, slots.times, language)}`
  }
  return `${time} n’est pas disponible le ${display}.\n\nVoici les créneaux disponibles :\n\n${formatSlotsMessage(dateIso, slots.times, language)}`
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} helpers
 */
function createAvailabilityFlow(db, helpers = {}) {
  const {
    getAppointmentsSettings = null,
    getLead = null,
    upsertLead = null,
    resolveLeadConversationId = null,
  } = helpers

  function ensureTables() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS availability_chat_state (
        chat_key TEXT PRIMARY KEY,
        stage TEXT NOT NULL,
        availability_date TEXT,
        candidate_slots_json TEXT,
        precise_time TEXT,
        language TEXT DEFAULT 'darija',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      );
    `)
  }

  ensureTables()

  function appointmentsSettings() {
    return typeof getAppointmentsSettings === 'function'
      ? getAppointmentsSettings()
      : {
        slotDurationMinutes: 30,
        minBookingLeadMinutes: 0,
        bookingHorizonDays: 30,
        allowSameDayBooking: true,
      }
  }

  function clearState(chatKey) {
    const key = normalizeChatKey(chatKey)
    if (!key) return
    db.prepare(`
      DELETE FROM availability_chat_state WHERE chat_key = ? OR chat_key = ?
    `).run(key, stripInstance(key))
  }

  function getState(chatKey) {
    const key = normalizeChatKey(chatKey)
    if (!key) return null
    const row = db.prepare(`
      SELECT * FROM availability_chat_state
      WHERE chat_key = ? OR chat_key = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(key, stripInstance(key))
    if (!row) return null
    if (row.expires_at) {
      const exp = new Date(String(row.expires_at).replace(' ', 'T')).getTime()
      if (Number.isFinite(exp) && exp < Date.now()) {
        clearState(key)
        return null
      }
    }
    let slots = []
    try { slots = JSON.parse(row.candidate_slots_json || '[]') } catch { slots = [] }
    return { ...row, candidateSlots: slots }
  }

  function saveState({
    chatKey,
    stage,
    availabilityDate = null,
    candidateSlots = [],
    preciseTime = null,
    language = 'darija',
  }) {
    const key = normalizeChatKey(chatKey)
    if (!key) return null
    const ts = nowIso()
    const expires = new Date(Date.now() + STATE_TTL_MS).toISOString()
    db.prepare(`
      INSERT INTO availability_chat_state (
        chat_key, stage, availability_date, candidate_slots_json, precise_time,
        language, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_key) DO UPDATE SET
        stage = excluded.stage,
        availability_date = excluded.availability_date,
        candidate_slots_json = excluded.candidate_slots_json,
        precise_time = excluded.precise_time,
        language = excluded.language,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(
      key,
      stage,
      availabilityDate,
      JSON.stringify(candidateSlots || []),
      preciseTime,
      language,
      ts,
      ts,
      expires,
    )
    return getState(key)
  }

  function fetchSlots(dateIso, now = new Date()) {
    const settings = appointmentsSettings()
    return getBookableSlotsForDate(db, dateIso, {
      durationMinutes: settings.slotDurationMinutes,
      appointmentsSettings: settings,
      now,
      applyBookingRules: true,
    })
  }

  function snapshotFromTimes(times) {
    return (times || []).map((t, i) => ({ index: i + 1, time: normalizeSlotTime(t) }))
  }

  function resolveConversationId(chatKey) {
    if (typeof resolveLeadConversationId === 'function') {
      return resolveLeadConversationId(chatKey)
    }
    const key = normalizeChatKey(chatKey)
    const bare = stripInstance(key)
    if (typeof getLead === 'function') {
      if (getLead(key)) return key
      if (getLead(`main:${bare}`)) return `main:${bare}`
      if (getLead(bare)) return bare
    }
    return key.startsWith('main:') ? key : `main:${bare}`
  }

  function continueBookingWithSlot({ chatKey, date, time, language }) {
    if (typeof getLead !== 'function' || typeof upsertLead !== 'function') {
      return {
        forceReply: isDarija(language)
          ? `مزيان، اخترتي ${formatDisplayDate(date)} مع ${time}. عافاك صيفط معلومات الحجز.`
          : `Très bien, vous avez choisi le ${formatDisplayDate(date)} à ${time}. Merci d’envoyer les informations de réservation.`,
        lead: null,
      }
    }

    const conversationId = resolveConversationId(chatKey)
    const existing = getLead(conversationId) || {}
    const stage = ['awaiting_patient', 'awaiting_form', 'crm_collection', 'confirmation'].includes(existing.stage)
      ? (existing.stage === 'confirmation' ? 'awaiting_form' : existing.stage)
      : 'awaiting_form'
    const awaiting = stage === 'awaiting_patient'
      ? (existing.awaiting_field || 'patient_select')
      : 'bulk'

    const updated = upsertLead(conversationId, {
      stage,
      awaiting_field: awaiting,
      booking_intent: 1,
      language: existing.language || language,
      appointment_date: date,
      appointment_time: time,
      whatsapp_chat_id: existing.whatsapp_chat_id || stripInstance(chatKey),
    })

    if (stage === 'awaiting_patient') {
      return {
        forceReply: isDarija(language)
          ? `مزيان، الموعد المختار: ${formatDisplayDate(date)} مع ${time}.\nعافاك حدد شكون الموعد ديالو.`
          : `Très bien, créneau choisi : ${formatDisplayDate(date)} à ${time}.\nMerci d’indiquer pour qui est le rendez-vous.`,
        lead: updated,
      }
    }

    const check = checkCustomerData(updated)
    if (!check.ok) {
      const replies = typeof buildBookingCollectionReplies === 'function'
        ? buildBookingCollectionReplies(updated, language, {
          missing: check.missing,
          entry: false,
          justFilled: ['appointment_date', 'appointment_time'],
        })
        : [bookingFormMessage(language)]
      return {
        forceReply: replies[0] || bookingFormMessage(language),
        forceReplies: replies,
        lead: updated,
      }
    }

    const ready = upsertLead(conversationId, {
      stage: 'confirmation',
      awaiting_field: 'confirmation',
    })
    return {
      forceReply: askConfirmation(ready, language),
      lead: ready,
    }
  }

  function respondWithSlots(chatKey, dateIso, language, now = new Date()) {
    const result = fetchSlots(dateIso, now)
    if (result.reason === 'closed_day') {
      saveState({
        chatKey,
        stage: STAGE_AWAITING_DATE,
        availabilityDate: null,
        candidateSlots: [],
        language,
      })
      return {
        handled: true,
        action: 'closed_day',
        forceReply: msgClosed(language),
        shouldSkipLlm: true,
      }
    }
    if (result.reason === 'past_date') {
      saveState({
        chatKey,
        stage: STAGE_AWAITING_DATE,
        language,
      })
      return {
        handled: true,
        action: 'past_date',
        forceReply: msgPastDate(language),
        shouldSkipLlm: true,
      }
    }
    if (result.reason === 'same_day_disabled') {
      saveState({ chatKey, stage: STAGE_AWAITING_DATE, language })
      return {
        handled: true,
        action: 'same_day_disabled',
        forceReply: msgSameDayDisabled(language),
        shouldSkipLlm: true,
      }
    }
    if (result.reason === 'horizon_exceeded') {
      saveState({ chatKey, stage: STAGE_AWAITING_DATE, language })
      return {
        handled: true,
        action: 'horizon_exceeded',
        forceReply: msgHorizon(language),
        shouldSkipLlm: true,
      }
    }
    if (!result.ok || !result.times.length) {
      saveState({ chatKey, stage: STAGE_AWAITING_DATE, language })
      return {
        handled: true,
        action: 'no_slots',
        forceReply: msgNone(dateIso, language),
        shouldSkipLlm: true,
      }
    }

    const snap = snapshotFromTimes(result.times)
    saveState({
      chatKey,
      stage: STAGE_AWAITING_SLOT,
      availabilityDate: dateIso,
      candidateSlots: snap,
      language,
    })
    return {
      handled: true,
      action: 'slots_listed',
      forceReply: formatSlotsMessage(dateIso, result.times, language),
      shouldSkipLlm: true,
      availabilityDate: dateIso,
      slots: snap,
    }
  }

  function handleDateInput(chatKey, text, language, now = new Date()) {
    const parsed = parseAvailabilityDate(text, now)
    if (!parsed.valid) {
      if (parsed.reason === 'past_date') {
        return {
          handled: true,
          action: 'past_date',
          forceReply: msgPastDate(language),
          shouldSkipLlm: true,
        }
      }
      return {
        handled: true,
        action: 'need_date',
        forceReply: msgNeedDate(language),
        shouldSkipLlm: true,
      }
    }

    // Precise slot check: date + time in same message
    if (parsed.time) {
      const live = fetchSlots(parsed.date, now)
      if (live.reason === 'closed_day') {
        return {
          handled: true,
          action: 'closed_day',
          forceReply: msgClosed(language),
          shouldSkipLlm: true,
        }
      }
      const check = checkSlotAvailability(db, {
        date: parsed.date,
        time: parsed.time,
        durationMinutes: appointmentsSettings().slotDurationMinutes,
      })
      const settings = appointmentsSettings()
      const rules = validateBookingDateTime(
        parsed.date,
        parsed.time,
        settings,
        now,
      )
      const bookable = check.available && rules.ok
        && (live.times || []).includes(parsed.time)

      if (bookable) {
        saveState({
          chatKey,
          stage: STAGE_AWAITING_PRECISE_CONFIRM,
          availabilityDate: parsed.date,
          candidateSlots: snapshotFromTimes(live.times),
          preciseTime: parsed.time,
          language,
        })
        return {
          handled: true,
          action: 'precise_available',
          forceReply: msgPreciseAvailable(parsed.date, parsed.time, language),
          shouldSkipLlm: true,
        }
      }

      if (!live.times?.length) {
        return {
          handled: true,
          action: 'no_slots',
          forceReply: msgNone(parsed.date, language),
          shouldSkipLlm: true,
        }
      }
      saveState({
        chatKey,
        stage: STAGE_AWAITING_SLOT,
        availabilityDate: parsed.date,
        candidateSlots: snapshotFromTimes(live.times),
        language,
      })
      return {
        handled: true,
        action: 'precise_busy',
        forceReply: msgPreciseBusy(parsed.date, parsed.time, live, language),
        shouldSkipLlm: true,
      }
    }

    return respondWithSlots(chatKey, parsed.date, language, now)
  }

  function handleSlotSelection(chatKey, text, state, language, now = new Date()) {
    const dateIso = state.availability_date
    const candidates = state.candidateSlots || []
    const parsed = parseAvailableSlotSelection({
      input: text,
      candidateSlots: candidates,
    })

    if (parsed.type === 'invalid') {
      if (parsed.reason === 'index_out_of_range') {
        return {
          handled: true,
          action: 'invalid_index',
          forceReply: msgInvalidIndex({ date: dateIso, times: candidates.map((c) => c.time) }, parsed.index, language),
          shouldSkipLlm: true,
        }
      }
      if (parsed.reason === 'time_unavailable') {
        return {
          handled: true,
          action: 'time_unavailable',
          forceReply: msgTimeUnavailable(
            parsed.selectedTime,
            { date: dateIso, times: candidates.map((c) => c.time) },
            language,
          ),
          shouldSkipLlm: true,
        }
      }
      // Maybe patient sent a new date instead
      const asDate = parseAvailabilityDate(text, now)
      if (asDate.valid) return handleDateInput(chatKey, text, language, now)

      return {
        handled: true,
        action: 'clarify_slot',
        forceReply: formatSlotsMessage(dateIso, candidates.map((c) => c.time), language),
        shouldSkipLlm: true,
      }
    }

    const selectedTime = parsed.selectedTime
    const live = fetchSlots(dateIso, now)
    if (!live.times.includes(selectedTime)) {
      if (!live.times.length) {
        saveState({ chatKey, stage: STAGE_AWAITING_DATE, language })
        return {
          handled: true,
          action: 'stale_no_slots',
          forceReply: msgNone(dateIso, language),
          shouldSkipLlm: true,
        }
      }
      const snap = snapshotFromTimes(live.times)
      saveState({
        chatKey,
        stage: STAGE_AWAITING_SLOT,
        availabilityDate: dateIso,
        candidateSlots: snap,
        language,
      })
      return {
        handled: true,
        action: 'stale_slot',
        forceReply: msgStaleSlot({ date: dateIso, times: live.times }, language),
        shouldSkipLlm: true,
      }
    }

    clearState(chatKey)
    const continued = continueBookingWithSlot({
      chatKey,
      date: dateIso,
      time: selectedTime,
      language,
    })
    return {
      handled: true,
      action: 'slot_selected',
      forceReply: continued.forceReply,
      forceReplies: continued.forceReplies || null,
      shouldSkipLlm: true,
      appointmentDate: dateIso,
      appointmentTime: selectedTime,
      lead: continued.lead,
    }
  }

  async function handleInboundAvailability({
    chatKey = null,
    text = '',
    language = 'darija',
    routerIntent = null,
    now = null,
  } = {}) {
    const raw = String(text || '').trim()
    if (!raw || !chatKey) return null
    if (looksLikeMyAppointments(raw)) return null

    const cabinetNow = now instanceof Date ? now : new Date()
    const lang = isDarija(language) ? 'darija' : 'fr'
    const state = getState(chatKey)
    const availabilityDetect = detectAvailabilityIntent(raw)
    const routerIsAvailability = String(routerIntent || '').toUpperCase() === 'CHECK_APPOINTMENT_AVAILABILITY'

    // Deterministic state priority
    if (state?.stage === STAGE_AWAITING_PRECISE_CONFIRM) {
      const { parseYesNoReply } = require('../binary-confirmation')
      const yn = parseYesNoReply(raw, { allowTypoYes: true })
      if (yn.value === 'yes') {
        const dateIso = state.availability_date
        const time = state.precise_time
        const live = fetchSlots(dateIso, cabinetNow)
        if (!live.times.includes(time)) {
          const snap = snapshotFromTimes(live.times)
          saveState({
            chatKey,
            stage: STAGE_AWAITING_SLOT,
            availabilityDate: dateIso,
            candidateSlots: snap,
            language: lang,
          })
          return {
            handled: true,
            action: 'stale_slot',
            forceReply: msgStaleSlot({ date: dateIso, times: live.times }, lang),
            shouldSkipLlm: true,
          }
        }
        clearState(chatKey)
        const continued = continueBookingWithSlot({
          chatKey, date: dateIso, time, language: lang,
        })
        return {
          handled: true,
          action: 'slot_selected',
          forceReply: continued.forceReply,
          forceReplies: continued.forceReplies || null,
          shouldSkipLlm: true,
          appointmentDate: dateIso,
          appointmentTime: time,
          lead: continued.lead,
        }
      }
      if (yn.value === 'no') {
        saveState({
          chatKey,
          stage: STAGE_AWAITING_SLOT,
          availabilityDate: state.availability_date,
          candidateSlots: state.candidateSlots,
          language: lang,
        })
        return {
          handled: true,
          action: 'precise_declined',
          forceReply: formatSlotsMessage(
            state.availability_date,
            (state.candidateSlots || []).map((c) => c.time),
            lang,
          ),
          shouldSkipLlm: true,
        }
      }
      return {
        handled: true,
        action: 'clarify_precise',
        forceReply: msgPreciseAvailable(state.availability_date, state.precise_time, lang),
        shouldSkipLlm: true,
      }
    }

    if (state?.stage === STAGE_AWAITING_SLOT) {
      return handleSlotSelection(chatKey, raw, state, lang, cabinetNow)
    }

    if (state?.stage === STAGE_AWAITING_DATE) {
      return handleDateInput(chatKey, raw, lang, cabinetNow)
    }

    // Fresh intent
    const matched = availabilityDetect.matched || routerIsAvailability
    if (!matched) return null

    // Intent may already include a date (and optional time)
    const parsed = parseAvailabilityDate(raw, cabinetNow)
    if (parsed.valid) {
      return handleDateInput(chatKey, raw, lang, cabinetNow)
    }

    // Intent alone → ask date
    saveState({
      chatKey,
      stage: STAGE_AWAITING_DATE,
      language: lang,
    })
    return {
      handled: true,
      action: 'ask_date',
      forceReply: askDateMessage(lang),
      shouldSkipLlm: true,
    }
  }

  return {
    ensureTables,
    detectAvailabilityIntent,
    looksLikeMyAppointments,
    handleInboundAvailability,
    getState,
    clearState,
    fetchSlots,
    getBookableSlotsForDate: (date, opts) => getBookableSlotsForDate(db, date, {
      durationMinutes: appointmentsSettings().slotDurationMinutes,
      appointmentsSettings: appointmentsSettings(),
      applyBookingRules: true,
      ...opts,
    }),
    STAGE_AWAITING_DATE,
    STAGE_AWAITING_SLOT,
  }
}

module.exports = {
  createAvailabilityFlow,
  detectAvailabilityIntent,
  looksLikeMyAppointments,
  formatSlotsMessage,
  askDateMessage,
  STAGE_AWAITING_DATE,
  STAGE_AWAITING_SLOT,
}
