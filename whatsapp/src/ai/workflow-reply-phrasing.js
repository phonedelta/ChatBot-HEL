/**
 * Rewords the booking workflow's replies in the patient's own language and script.
 *
 * The workflow decides what is said; the model only chooses the words. A rewording that drops
 * or changes a date, a time, a phone number or a menu number, or that is not written in the
 * expected script, is discarded and the workflow's own template is sent instead.
 */

const { isReplyInStyle, styleInstruction } = require('./reply-style')

const QUESTION_LABELS = {
  full_name: 'le nom complet (prénom et nom)',
  phone_number: 'le numéro de téléphone',
  city: 'la ville où habite le patient',
  problem: 'le motif : problème dentaire ou soin souhaité',
  appointment: 'le jour et l\'heure souhaités',
  appointment_date: 'le jour souhaité',
  appointment_time: 'l\'heure souhaitée',
}

const QUESTIONS = {
  full_name: 'Quel est votre nom complet (prénom et nom) ?',
  phone_number: 'Quel est votre numéro de téléphone ?',
  city: 'Dans quelle ville habitez-vous ?',
  problem: 'Quel est le motif de la consultation (douleur, contrôle, détartrage…) ?',
  appointment: 'Quel jour et à quelle heure souhaitez-vous venir ?',
  appointment_date: 'Quel jour souhaitez-vous venir ?',
  appointment_time: 'À quelle heure souhaitez-vous venir ?',
}

const MAX_ATTEMPTS = 2
// Told to the model on its second attempt, so it corrects the right thing.
const REJECTION_FEEDBACK = {
  wrong_script: 'elle n’était pas dans la langue et l’écriture demandées',
  too_long: 'elle était trop longue',
  empty: 'elle était vide',
  date_dropped: 'une date du MESSAGE manquait',
  phone_dropped: 'un numéro de téléphone du MESSAGE manquait',
  time_dropped: 'une heure du MESSAGE manquait',
  date_invented: 'elle contenait une date absente du MESSAGE',
  time_invented: 'elle contenait une heure absente du MESSAGE',
  menu_changed: 'les numéros de la liste à choix avaient changé',
}
// Rewording is cosmetic: past this delay the workflow's own template is sent.
const REWORDING_DEADLINE_MS = 12000

/** Resolves like the promise, or rejects once the delay has passed. */
function withDeadline(promise, delayMs) {
  let timer = null
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('AI reply took too long')
      error.code = 'AI_DEADLINE_EXCEEDED'
      reject(error)
    }, Math.max(1, delayMs))
  })
  // The late answer is simply ignored; its error, if any, must not surface as unhandled.
  promise.catch(() => {})
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function buildPhrasingSystemPrompt(style) {
  return [
    'Tu es la réceptionniste du Centre Dentaire HEL sur WhatsApp.',
    `Le moteur de réservation a préparé un MESSAGE à envoyer au patient. Réécris-le ${styleInstruction(style)}.`,
    '',
    'Règles :',
    '- Dis exactement ce que dit le MESSAGE : n\'ajoute aucune information, promesse, date, heure ou créneau, et ne retire rien de ce qui concerne le rendez-vous du patient.',
    '- Recopie à l\'identique les dates, les heures, les numéros de téléphone et les numéros des listes à choix.',
    '- Le MESSAGE peut être rédigé dans une autre langue ou une autre écriture que celle demandée : traduis-le en entier, sans en recopier un seul mot tel quel.',
    '- Écris le nom du patient comme dans FAITS.nom quand il est fourni.',
    '- Si le MESSAGE demande plusieurs informations manquantes, pose seulement la question indiquée par PROCHAINE_QUESTION (le patient peut en donner plusieurs à la fois).',
    '- Ne rappelle les horaires d\'ouverture que si tu demandes le jour ou l\'heure.',
    '- Ne recopie pas les phrases de mode d\'emploi (par exemple « vous pouvez les envoyer en un ou plusieurs messages »).',
    '- Si le MESSAGE reliste des informations déjà reçues avant de poser une question, accuse réception en quelques mots sans tout relister. Le récapitulatif final à confirmer, lui, se recopie en entier.',
    '- Style : réceptionniste humaine, chaleureuse et brève. Une ou deux phrases courtes, sauf pour un récapitulatif (une ligne par information). Pas de salutation, pas de présentation, pas de formule répétée.',
    '- En darija, parle comme au Maroc, jamais en arabe classique.',
    '- Si le MESSAGE dit qu\'un rendez-vous est enregistré, garde clairement cette information. S\'il dit que l\'enregistrement a échoué, ne dis jamais que le rendez-vous est confirmé.',
    '- Réponds uniquement par le message final, sans guillemets ni commentaire.',
  ].join('\n')
}

function normalizeTime(value) {
  const match = String(value || '').match(/(\d{1,2})\s*[:hH]\s*(\d{2})/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

/** "16/10/2026" and "16/10" name the same day: compare on day/month, then on the year if both have one. */
function parseDateToken(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (!match) return null
  return { dayMonth: `${Number(match[1])}/${Number(match[2])}`, year: match[3] ? Number(match[3]) % 100 : null }
}

function sameDate(left, right) {
  return left.dayMonth === right.dayMonth && (left.year === null || right.year === null || left.year === right.year)
}

/** Dates, times, phone numbers and menu numbers found in a message. */
function factTokens(text) {
  const raw = String(text || '')
  const times = new Set((raw.match(/\b\d{1,2}\s*[:hH]\s*\d{2}\b/g) || []).map(normalizeTime).filter(Boolean))
  const dates = (raw.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g) || []).map(parseDateToken).filter(Boolean)
  const phones = new Set(
    (raw.match(/\+?\d[\d ]{7,}\d/g) || [])
      .map((item) => item.replace(/\D/g, ''))
      .filter((digits) => digits.length >= 9),
  )
  const menuNumbers = new Set((raw.match(/^\s*\d{1,2}(?=\s*[.)\-–]\s)/gm) || []).map((item) => item.trim()))
  return { times, dates, phones, menuNumbers }
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item))
}

/**
 * @returns {string|null} null when the rewording is faithful, otherwise why it is rejected.
 */
function rewordingProblem({ original, rewritten, style, facts = {}, requireAllTimes = false }) {
  const text = String(rewritten || '').trim()
  if (!text) return 'empty'
  if (!isReplyInStyle(text, style)) return 'wrong_script'
  if (text.length > Math.max(420, original.length * 1.6)) return 'too_long'

  const before = factTokens(original)
  const after = factTokens(text)
  // The appointment's own date and time may always be mentioned, even if this message omits them.
  const knownDate = parseDateToken(facts.date)
  const knownTime = normalizeTime(facts.time)
  const allowedDates = knownDate ? [...before.dates, knownDate] : before.dates
  const allowedTimes = new Set(knownTime ? [...before.times, knownTime] : before.times)

  for (const date of before.dates) if (!after.dates.some((item) => sameDate(item, date))) return 'date_dropped'
  for (const phone of before.phones) if (!after.phones.has(phone)) return 'phone_dropped'
  for (const date of after.dates) if (!allowedDates.some((item) => sameDate(item, date))) return 'date_invented'
  for (const time of after.times) if (!allowedTimes.has(time)) return 'time_invented'

  const requiredTimes = requireAllTimes
    ? [...before.times]
    : (knownTime && before.times.has(knownTime) ? [knownTime] : [])
  for (const time of requiredTimes) if (!after.times.has(time)) return 'time_dropped'

  if (before.menuNumbers.size >= 2 && !sameSet(before.menuNumbers, after.menuNumbers)) return 'menu_changed'
  return null
}

function nextMissingField(lead, missing = []) {
  const field = Array.isArray(missing) ? missing[0] : null
  if (field === 'appointment') {
    if (lead?.appointment_date && !lead?.appointment_time) return 'appointment_time'
    if (lead?.appointment_time && !lead?.appointment_date) return 'appointment_date'
  }
  return field || null
}

/** Which single question to ask next, from the workflow's ordered missing fields. */
function nextBookingQuestion(lead, missing = []) {
  return QUESTION_LABELS[nextMissingField(lead, missing)] || null
}

/**
 * One question at a time: the message to reword for a collection step, instead of the
 * workflow's full checklist. Returns null when the step needs its template (e.g. a name to
 * re-enter), which then goes through unchanged.
 * @param {{ missing: string[], justFilled?: string[], entry?: boolean, rejectedName?: boolean }} collection
 */
function collectionBrief(collection, lead, template = '') {
  if (!collection || collection.rejectedName) return null
  const field = nextMissingField(lead, collection.missing)
  const question = QUESTIONS[field]
  if (!question) return null

  const opening = collection.entry
    ? 'Très bien, je prépare votre rendez-vous.'
    : ((collection.justFilled || []).length ? 'Merci, c’est noté.' : '')
  // Opening hours are only worth repeating when asking for the day or the time.
  const hoursLine = field.startsWith('appointment')
    ? String(template).split('\n').reverse().find((line) => /\d{1,2}\s*[:hH]\s*\d{2}/.test(line))
    : null
  return [opening, question, hoursLine ? `(${hoursLine.trim()})` : ''].filter(Boolean).join(' ')
}

/**
 * @param {{ provider: object, replies: string[], message?: string|null, style: string,
 *   patientMessage?: string, facts?: { name?: string|null, date?: string|null, time?: string|null },
 *   nextQuestion?: string|null, requireAllTimes?: boolean, logger?: object }} args
 *   replies are the workflow's templates, sent as they are when the rewording fails;
 *   message, when given, is what gets reworded instead of those templates.
 * @returns {Promise<{ replies: string[], phrased: boolean, reason: string|null }>}
 */
async function phraseWorkflowReplies(args = {}) {
  const replies = (Array.isArray(args.replies) ? args.replies : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const provider = args.provider
  if (!replies.length || !provider?.isConfigured?.()) {
    return { replies, phrased: false, reason: replies.length ? 'not_configured' : 'empty' }
  }

  const original = String(args.message || '').trim() || replies.join('\n\n')
  const facts = args.facts || {}
  const prompt = [
    `DERNIER MESSAGE DU PATIENT : ${JSON.stringify(String(args.patientMessage || '').slice(0, 300))}`,
    `FAITS : ${JSON.stringify({ nom: facts.name || null, date: facts.date || null, heure: facts.time || null })}`,
    `PROCHAINE_QUESTION : ${args.nextQuestion || 'aucune'}`,
    'MESSAGE :',
    original,
  ].join('\n')

  let problem = null
  const deadline = Date.now() + (Number(args.deadlineMs) || REWORDING_DEADLINE_MS)
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const feedback = problem
        ? `\n\nREMARQUE : ta réponse précédente a été refusée car ${REJECTION_FEEDBACK[problem] || 'elle ne respectait pas les règles'}. Corrige ce point.`
        : ''
      const result = await withDeadline(provider.generateChatResponse({
        systemPrompt: buildPhrasingSystemPrompt(args.style),
        messages: [{ role: 'user', content: `${prompt}${feedback}` }],
        maxOutputTokens: 400,
        intent: 'WORKFLOW_REPLY_PHRASING',
        responseMode: 'ai_after_backend_action',
      }), deadline - Date.now())
      const rewritten = String(result.text || '').trim().replace(/^["«]\s*|\s*["»]$/g, '')
      problem = rewordingProblem({
        original,
        rewritten,
        style: args.style,
        facts,
        requireAllTimes: Boolean(args.requireAllTimes),
      })
      if (!problem) return { replies: [rewritten], phrased: true, reason: null }
      args.logger?.warn?.('[workflow-phrasing] rewording rejected', { reason: problem, style: args.style, attempt })
    } catch (error) {
      problem = 'provider_error'
      args.logger?.warn?.('[workflow-phrasing] rewording failed', {
        reason: error?.code || error?.message || 'provider_error',
        style: args.style,
        attempt,
      })
      break
    }
  }
  return { replies, phrased: false, reason: problem }
}

module.exports = {
  buildPhrasingSystemPrompt,
  collectionBrief,
  withDeadline,
  factTokens,
  nextBookingQuestion,
  phraseWorkflowReplies,
  rewordingProblem,
}
