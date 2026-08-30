/**
 * Patient full-name validation for HEL CRM.
 * Conservative: prefer rejecting a false name over polluting customers.
 */

const { containsForbiddenNameTerm, looksLikeServiceText } = require('./services')
const { isKnownMoroccanCity } = require('./morocco-cities')

const AI_CONFIDENCE_THRESHOLD = 0.85

/** Conversational tokens (Darija Latin / FR) — signal only, not sole decision. */
const CONVERSATIONAL_TOKENS = new Set([
  'wach', 'wachi', 'ymkn', 'imken', 'momkin', 'nakhdo', 'nakhod', 'nakhou', 'nakhdou',
  'bghit', 'bghiti', 'baghi', 'bagha', 'kayn', 'kayna', 'kaynin', 'ghdda', 'ghda', 'ghedda',
  'lyoum', 'lyom', 'chhal', 'fin', '3lach', '3lach', 'merci', 'salam', 'slm', 'cv',
  'khoya', 'khti', 'rdv', 'rendez', 'vous', 'possible', 'demain', 'aujourd', 'aujourdhui',
  'bonjour', 'bonsoir', 'hello', 'svp', 'sill', 'vous', 'etes', 'ouvert', 'ouverte',
  'ouverts', 'reserve', 'reserver', 'reservation', 'prendre', 'veux', 'voudrais',
  'peux', 'peut', 'venir', 'dispo', 'disponible', 'disponibilite', 'heure', 'matin',
  'soir', 'apres', 'midi', 'docteur', 'cabinet', 'clinique', 'oui', 'non', 'ok',
  'okay', 'sba7', 'msak', 'labas', 'bikhir', 'choukran', 'chokran', 'afak', '3afak',
  'njib', 'nji', 'ndir', 'njiw', 'njih', 'bghina', 'bghina', 'dir', 'diri',
])

/** Family relation words must never become a patient identity. */
const RELATION_TOKENS = new Set([
  'khoya', 'khti', 'marti', 'mra', 'zawji', 'frere', 'frère', 'soeur', 'sœur',
  'femme', 'mari', 'fils', 'fille', 'enfant', 'brother', 'sister', 'wife', 'husband',
  'ami', 'amie', 'cousin', 'cousine',
])

/** Correction / grammar command tokens — never part of a person name. */
const NAME_COMMAND_TOKENS = new Set([
  'smiya', 'smiyti', 'smito', 'smiyto', 'smitha', 'smita', 'smiti', 'ismi',
  'dialo', 'dyalo', 'dialha', 'dyalha', 'dyal', 'dial',
  'changer', 'corriger', 'corrige', 'modifier', 'bdel', 'bdl', 'nom', 'name',
  'bgha', 'baghi', 'bagha', 'baghya', 'ydir', 'ndir', 'ndiro', 'kaydir',
  'howa', 'hiya', 'howwa', 'kamla', 'correct', 'correcte', 'faux', 'fausse',
  'ville', 'city', 'phone', 'telephone', 'numero', 'tel', 'rdv', 'rendez',
  'tabyid', 'tabyit', 'blanchiment', 'detartrage', 'facette', 'facettes',
  'au', 'fait',
])

const ARABIC_CONVERSATIONAL = [
  /بغيت/, /واش/, /كاين/, /يمكن/, /ناخذ/, /ناخدو/, /موعد/, /شكرا/, /بزاف/,
  /السلام/, /عليكم/, /فين/, /عيادة/, /غدا/, /اليوم/, /ممكن/, /حجز/,
]

const CITY_ONLY = new Set([
  'casablanca', 'casa', 'rabat', 'marrakech', 'marrakesh', 'fes', 'fès', 'meknes', 'meknès',
  'tanger', 'tangier', 'agadir', 'oujda', 'kenitra', 'kénitra', 'tetouan', 'tétouan',
  'mohammedia', 'sale', 'salé', 'temara', 'témara', 'ifrane', 'ifran', 'settat',
  'الدار البيضاء', 'كازا', 'الرباط', 'مراكش', 'فاس', 'طنجة', 'أكادير', 'وجدة',
])

const PLACE_PAIR = [
  /^casablanca\s+maroc$/i,
  /^rabat\s+maroc$/i,
  /^marrakech\s+maroc$/i,
  /^casablanca\s+morocco$/i,
]

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * Strip instruction / form labels that must never be part of CRM fullName.
 * "Le Nom Salim Zouhairi" → "Salim Zouhairi"
 */
function stripPersonNameLabels(value) {
  let s = collapseSpaces(value)
  if (!s) return ''
  const patterns = [
    /^(?:le\s+)?nom(?:\s+complet)?\s*[:\-–]?\s+/i,
    /^(?:le\s+)?nom(?:\s+complet)?\s*[:\-–]\s*/i,
    /^(?:name|full\s*name)\s*[:\-–]?\s+/i,
    /^(?:smiya|smito|smiyto|smitha|smita|smiti|smiyti|smiyiti)(?:\s+(?:dialo|dyalo|dialha|dyalha|howa|hiya))?\s*[:\-–]?\s+/i,
    /^(?:changer|corriger|modifier|bdel|bdl)\s+(?:le\s+)?(?:nom|smiya)\s*[:\-–]?\s*/i,
    /^(?:je m['’]appelle|mon nom(?:\s+complet)?(?:\s+(?:est|c['’]est))?|moi c['’]est|ismi|اسمي|سميتي)\s+/i,
    /^(?:الاسم(?:\s+الكامل)?|السمية|اسم)\s*[:\-–]?\s+/u,
    /^ل(?=[\u0600-\u06FF])/u,
  ]
  let prev = null
  while (s && s !== prev) {
    prev = s
    for (const re of patterns) {
      s = s.replace(re, '').trim()
    }
  }
  return s
}

function titleCaseLatinName(value) {
  return collapseSpaces(value)
    .split(' ')
    .map((part) => {
      if (!part) return part
      // Preserve Arabic / mixed without forcing Latin title-case on Arabic chars
      if (/[\u0600-\u06FF]/.test(part)) return part
      if (part.includes('-')) {
        return part.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-')
      }
      if (part.includes("'") || part.includes('’')) {
        return part.replace(/['’]/g, (m) => m).split(/(['’])/).map((p, i, arr) => {
          if (p === "'" || p === '’') return p
          if (!p) return p
          return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        }).join('')
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}

function normalizeAcceptedName(raw) {
  const collapsed = stripPersonNameLabels(raw)
  if (!collapsed) return ''
  if (/[\u0600-\u06FF]/.test(collapsed)) return collapsed
  return titleCaseLatinName(collapsed)
}

function tokenizeName(value) {
  return collapseSpaces(value)
    .split(/\s+/)
    .map((t) => t.replace(/^[-'’]+|[-'’]+$/g, ''))
    .filter((t) => t.length >= 2)
}

function looksLikePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 8 && digits.length >= String(value || '').replace(/\s/g, '').length * 0.7
}

function looksLikeDateOrTime(value) {
  const t = normalizeKey(value)
  if (!t) return false
  if (/\b\d{1,2}\s*[:hH]\s*\d{0,2}\b/.test(t)) return true
  if (/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(t)) return true
  if (/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|ghdda|ghda|lyoum|matin|soir)\b/.test(t)
    && /\b(\d|h|heure|matin|soir|aprem)\b/.test(t)) return true
  if (/^(mardi|lundi|mercredi|jeudi|vendredi|samedi|dimanche)(\s+\d{1,2}(h\d{0,2})?)?$/.test(t)) return true
  return false
}

function hasQuestionMark(value) {
  return /[?؟]/.test(String(value || ''))
}

function countConversationalHits(tokens) {
  let hits = 0
  for (const tok of tokens) {
    const key = normalizeKey(tok).replace(/[^\p{L}0-9]/gu, '')
    if (CONVERSATIONAL_TOKENS.has(key)) hits += 1
  }
  return hits
}

function looksLikeArabicConversational(value) {
  const text = String(value || '')
  return ARABIC_CONVERSATIONAL.some((re) => re.test(text))
}

function looksLikeFrenchSentence(value) {
  const t = normalizeKey(value)
  return (
    /\b(je|tu|vous|on|nous)\s+(veux|voudrais|peux|peut|sommes|etes|êtes|veux|veux)\b/.test(t)
    || /\b(je veux|possible demain|merci docteur|vous etes|vous êtes|je peux venir|prendre rendez)\b/.test(t)
    || /\b(rendez\s*vous|reservation|réserver|reserver)\b/.test(t)
  )
}

function looksLikeDarijaLatinPhrase(tokens, raw) {
  const hits = countConversationalHits(tokens)
  if (hits >= 1 && hasQuestionMark(raw)) return true
  if (hits >= 2) return true
  if (hits >= 1 && tokens.length <= 4) {
    // "ymkn nakhdo", "wach kayn", "bghit rdv"
    const joined = tokens.map((t) => normalizeKey(t)).join(' ')
    if (/\b(ymkn|imken|momkin|wach|bghit|baghi|kayn|nakhdo|nakhod)\b/.test(joined)) return true
  }
  return false
}

function isCityOnlyOrPlace(value, tokens) {
  const key = normalizeKey(value)
  if (CITY_ONLY.has(key) || isKnownMoroccanCity(value)) return true
  if (tokens.length === 1 && (CITY_ONLY.has(normalizeKey(tokens[0])) || isKnownMoroccanCity(tokens[0]))) {
    return true
  }
  if (PLACE_PAIR.some((re) => re.test(collapseSpaces(value)))) return true
  if (tokens.length === 2) {
    const a = normalizeKey(tokens[0])
    const b = normalizeKey(tokens[1])
    if ((CITY_ONLY.has(a) || isKnownMoroccanCity(tokens[0]))
      && (b === 'maroc' || b === 'morocco' || CITY_ONLY.has(b) || isKnownMoroccanCity(tokens[1]))) {
      return true
    }
  }
  return false
}

/**
 * Deterministic assessment of a full-name candidate.
 * @returns {{
 *   valid: boolean,
 *   normalizedName: string|null,
 *   confidence: number,
 *   reason: string,
 *   needsAi: boolean,
 *   source: 'deterministic'
 * }}
 */
function assessFullNameCandidate(candidate) {
  const raw = collapseSpaces(candidate)
  if (!raw) {
    return { valid: false, normalizedName: null, confidence: 1, reason: 'empty', needsAi: false, source: 'deterministic' }
  }
  if (raw.length < 3 || raw.length > 100) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'length', needsAi: false, source: 'deterministic' }
  }
  if (hasQuestionMark(raw)) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'question_mark', needsAi: false, source: 'deterministic' }
  }
  if (looksLikePhone(raw)) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'phone', needsAi: false, source: 'deterministic' }
  }
  if (looksLikeDateOrTime(raw)) {
    return { valid: false, normalizedName: null, confidence: 0.95, reason: 'date_or_time', needsAi: false, source: 'deterministic' }
  }

  // Strip labels first so "Le Nom Salim Zouhairi" is assessed as a person name.
  const stripped = stripPersonNameLabels(raw)
  if (!stripped) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'label_only', needsAi: false, source: 'deterministic' }
  }

  if (containsForbiddenNameTerm(stripped) || looksLikeServiceText(stripped)) {
    return { valid: false, normalizedName: null, confidence: 0.98, reason: 'dental_motif_or_service', needsAi: false, source: 'deterministic' }
  }
  if (looksLikeArabicConversational(stripped)) {
    return { valid: false, normalizedName: null, confidence: 0.97, reason: 'arabic_conversational', needsAi: false, source: 'deterministic' }
  }
  if (looksLikeFrenchSentence(stripped)) {
    return { valid: false, normalizedName: null, confidence: 0.96, reason: 'french_sentence', needsAi: false, source: 'deterministic' }
  }

  const cleanedForTokens = stripped
    .replace(/[^\p{L}\s'\u2019-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = tokenizeName(cleanedForTokens)
  if (tokens.length < 2) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'single_token', needsAi: false, source: 'deterministic' }
  }
  if (isCityOnlyOrPlace(cleanedForTokens, tokens)) {
    return { valid: false, normalizedName: null, confidence: 0.95, reason: 'city_or_place', needsAi: false, source: 'deterministic' }
  }
  if (looksLikeDarijaLatinPhrase(tokens, stripped)) {
    return { valid: false, normalizedName: null, confidence: 0.98, reason: 'darija_latin_phrase', needsAi: false, source: 'deterministic' }
  }
  if (tokens.some((t) => looksLikeServiceText(t) || containsForbiddenNameTerm(t))) {
    return { valid: false, normalizedName: null, confidence: 0.95, reason: 'token_service', needsAi: false, source: 'deterministic' }
  }
  if (tokens.some((t) => NAME_COMMAND_TOKENS.has(normalizeKey(t).replace(/[^\p{L}0-9]/gu, '')))) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'command_token', needsAi: false, source: 'deterministic' }
  }
  const relationOnly = tokens.length > 0
    && tokens.every((t) => RELATION_TOKENS.has(normalizeKey(t).replace(/[^\p{L}0-9]/gu, '')))
  if (relationOnly) {
    return { valid: false, normalizedName: null, confidence: 0.99, reason: 'relation_not_identity', needsAi: false, source: 'deterministic' }
  }

  // Particle-rich Moroccan names are fine: El, Ben, Ait, Oulad, Abd...
  const particleish = new Set(['el', 'al', 'ben', 'ibn', 'bint', 'ait', 'oulad', 'abd', 'abdel', 'abder'])
  const contentTokens = tokens.filter((t) => !particleish.has(normalizeKey(t)))
  if (contentTokens.length < 2 && tokens.length < 3) {
    // e.g. "El Amrani" alone is weak; "Mohamed El Amrani" OK
    if (tokens.length < 3) {
      return {
        valid: false,
        normalizedName: null,
        confidence: 0.6,
        reason: 'weak_name_shape',
        needsAi: true,
        source: 'deterministic',
      }
    }
  }

  // Looks like a plausible person name
  const normalizedName = normalizeAcceptedName(cleanedForTokens)
  const hasArabic = /[\u0600-\u06FF]/.test(normalizedName)
  const hasLatin = /[A-Za-z]/.test(normalizedName)
  if (!hasArabic && !hasLatin) {
    return { valid: false, normalizedName: null, confidence: 0.9, reason: 'no_letters', needsAi: false, source: 'deterministic' }
  }

  // High confidence accept for classic 2–5 token names without conversational hits
  const conf = countConversationalHits(tokens) === 0 ? 0.92 : 0.55
  if (conf < 0.85) {
    return {
      valid: false,
      normalizedName: null,
      confidence: conf,
      reason: 'ambiguous_needs_ai',
      needsAi: true,
      source: 'deterministic',
      candidateForAi: cleanedForTokens,
    }
  }

  return {
    valid: true,
    normalizedName,
    confidence: conf,
    reason: 'plausible_person_name',
    needsAi: false,
    source: 'deterministic',
  }
}

/**
 * Sync validate used across CRM extraction. Rejects ambiguous names (conservative).
 * @returns {string|null}
 */
function validateFullName(value) {
  const result = assessFullNameCandidate(value)
  if (!result.valid || result.needsAi) return null
  return result.normalizedName
}

/**
 * Optional OpenAI semantic check for ambiguous candidates.
 * Never invents a name. On error → reject.
 *
 * @param {string} candidate
 * @param {{ openAiClient?: any, model?: string } | null} ai
 */
async function classifyPersonNameWithAi(candidate, ai = null) {
  const base = assessFullNameCandidate(candidate)
  if (!base.needsAi && base.valid === false && base.confidence >= 0.9) {
    return { ...base, source: base.source }
  }
  if (base.valid && !base.needsAi) {
    return base
  }

  const client = ai?.openAiClient || null
  const model = ai?.model || process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  if (!client) {
    return {
      valid: false,
      normalizedName: null,
      confidence: 0.4,
      reason: 'ai_unavailable_reject',
      needsAi: false,
      source: 'fallback',
    }
  }

  const text = collapseSpaces(base.candidateForAi || candidate)
  try {
    const response = await client.responses.create({
      model,
      instructions: [
        'Tu es un validateur de données pour un formulaire de cabinet dentaire marocain.',
        'Détermine si le texte fourni représente réellement un nom complet de personne.',
        'Langues: français, Darija alphabet latin, arabe.',
        'Un nom valide = identité humaine plausible avec au minimum prénom + nom.',
        'Une phrase, question, salutation, demande de RDV, date, heure, ville, numéro, motif dentaire n’est PAS un nom.',
        'Ne corrige pas une phrase pour la transformer en nom. Ne devine jamais. Ne translittère pas.',
        'Retourne UNIQUEMENT un JSON: {"isPersonFullName":boolean,"confidence":number,"normalizedName":string|null,"reason":string}',
      ].join(' '),
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            candidate: text,
            field: 'patient_full_name',
            locale: 'Morocco',
            supportedLanguages: ['fr', 'darija-latin', 'ar'],
          }),
        },
      ],
      max_output_tokens: 200,
      store: false,
    })

    const rawOut = String(response?.output_text || '').trim()
    const jsonMatch = rawOut.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {
        valid: false,
        normalizedName: null,
        confidence: 0.3,
        reason: 'ai_invalid_json',
        needsAi: false,
        source: 'ai',
      }
    }
    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return {
        valid: false,
        normalizedName: null,
        confidence: 0.3,
        reason: 'ai_json_parse_error',
        needsAi: false,
        source: 'ai',
      }
    }

    const isPerson = Boolean(parsed.isPersonFullName)
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    let normalizedName = parsed.normalizedName == null ? null : collapseSpaces(String(parsed.normalizedName))
    if (isPerson && normalizedName) {
      // Re-run deterministic on AI-normalized value (must still pass structure)
      const recheck = assessFullNameCandidate(normalizedName)
      if (!recheck.valid || recheck.needsAi) {
        return {
          valid: false,
          normalizedName: null,
          confidence,
          reason: 'ai_accepted_but_deterministic_reject',
          needsAi: false,
          source: 'ai',
        }
      }
      normalizedName = recheck.normalizedName
    }

    if (isPerson && confidence >= AI_CONFIDENCE_THRESHOLD && normalizedName) {
      return {
        valid: true,
        normalizedName,
        confidence,
        reason: parsed.reason || 'ai_accepted',
        needsAi: false,
        source: 'ai',
      }
    }

    return {
      valid: false,
      normalizedName: null,
      confidence,
      reason: parsed.reason || 'ai_rejected',
      needsAi: false,
      source: 'ai',
    }
  } catch (error) {
    console.warn('[hel-crm] name AI validation failed', error.message || error)
    return {
      valid: false,
      normalizedName: null,
      confidence: 0.2,
      reason: 'ai_error_reject',
      needsAi: false,
      source: 'fallback',
    }
  }
}

/**
 * Full validation pipeline: deterministic then optional AI.
 * @returns {Promise<{valid:boolean, normalizedName:string|null, confidence:number, reason:string, source:string}>}
 */
async function validateFullNameCandidate(candidate, options = {}) {
  const det = assessFullNameCandidate(candidate)
  if (!det.needsAi) {
    return {
      valid: det.valid,
      normalizedName: det.normalizedName,
      confidence: det.confidence,
      reason: det.reason,
      source: det.source,
    }
  }
  return classifyPersonNameWithAi(candidate, options.ai || null)
}

module.exports = {
  AI_CONFIDENCE_THRESHOLD,
  assessFullNameCandidate,
  validateFullName,
  validateFullNameCandidate,
  classifyPersonNameWithAi,
  normalizeAcceptedName,
  stripPersonNameLabels,
  looksLikeDarijaLatinPhrase,
  hasQuestionMark,
}
