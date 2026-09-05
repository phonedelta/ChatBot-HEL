/**
 * Global intent classifier for Centre Dentaire HEL.
 *
 * Goal: detect the patient's INTENT first (Darija / FR / AR / medical mix),
 * not word-by-word literal understanding.
 */

const { CLINIC_SERVICES } = require('./transcript-interpreter')
const { buildPublicServicesReply, PUBLIC_SERVICES_LIST } = require('../crm/services')
const {
  normalizeDarijaForNlu,
  classifyIntentFromConcepts,
  logDarijaNlu,
} = require('./darija-normalizer')

const INTENT_NAMES = [
  'ASK_SERVICES',
  'BOOK_APPOINTMENT',
  'CANCEL_APPOINTMENT',
  'RESCHEDULE_APPOINTMENT',
  'CHECK_APPOINTMENT_AVAILABILITY',
  'LIST_MY_APPOINTMENTS',
  'ASK_PRICE',
  'ASK_LOCATION',
  'ASK_OPENING_HOURS',
  'DENTAL_PAIN',
  'DENTAL_EMERGENCY',
  'GREETING',
  'THANKS',
  'OTHER',
]

/**
 * Synonym / phrase dictionary per intent.
 * Prefer phrase-level meaning over isolated tokens.
 */
const INTENT_DICTIONARY = {
  ASK_SERVICES: {
    phrases: [
      // FR
      'quels sont vos services',
      'quels services',
      'vos services',
      'liste des services',
      'services disponibles',
      'soins disponibles',
      'prestations',
      'pouvez-vous me dire les soins',
      'me dire les services',
      'quels soins',
      'que proposez vous',
      'que proposez-vous',
      // Darija latin
      'chno homa les service',
      'chno homa les services',
      // Avoid bare "chno kayn" alone — ambiguous with availability
      'chno kaynin',
      'chno kaynin mn service',
      'chno kaynin mn services',
      'chno kayn 3andkom',
      'chno kayn 3ndkom',
      'ach katdirou',
      'wach katdiro',
      'wach katdirou',
      'wach katdiro implant',
      'ach kat9edmo',
      'chno kat9edmo',
      'chno kat9ademo',
      'chno katkedmo',
      'bghit n3ref les service',
      'bghit n3ref les services',
      'bghit n3raf les services',
      '3afak chno 3andkom',
      '3afak chno homa les service',
      'chno 3andkom',
      'chno 3ndkom',
      'wach 3andkom services',
      'wach kayn services',
      'les service li kaynin',
      'li kaynin f had centre',
      // Arabic
      'شنو عندكم',
      'شنو الخدمات',
      'شنو كتقدمو',
      'شنو كاينين',
      'الخدمات',
      'ما هي خدماتكم',
      'اش كتديرو',
      'واش كتديرو',
    ],
    keywords: [
      'services', 'service', 'serviss', 'servis', 'prestations', 'soins',
      'traitements', 'interventions', 'خدمات', 'خدمة', 'katdirou', 'katdiro', 'kat9edmo',
      'kat9ademo', 'kaynin', 'chno homa',
    ],
  },
  BOOK_APPOINTMENT: {
    phrases: [
      'bghit rendez-vous', 'bghit rdv', 'nakhod rdv', 'bghit nakhod rdv', 'bghit nji',
      'brit rdv', 'baghi rdv', 'khasni rdv', '3afak bghit rdv',
      'prendre rendez-vous', 'je veux un rendez-vous', 'je voudrais un rdv',
      'بغيت موعد', 'بغيت ناخد موعد', 'نبغي نجي',
      'bghit n7yed derssa', 'bghit n7yed ders', 'bghit n9ala3 ders', 'bghit extraction',
      'bghit nettoyage', 'bghit tn9iya', 'bghit blanchiment', 'bghit tabyid',
      'bghit appareil', 'bghit ta9wim', 'bghit implant',
      'بغيت نحيد ضرس', 'بغيت نقلع ضرس',
    ],
    // Only appointment words — service names alone must not open the booking form
    keywords: [
      'rendez-vous', 'rdv', 'randivo', 'موعد', 'appointment', 'bghit nji',
    ],
  },
  CANCEL_APPOINTMENT: {
    phrases: [
      'annuler mon rendez-vous', 'bghit nalghi rdv', 'bghit nlghi rdv', 'نبغي نلغي الموعد',
      'بغيت نلغي الموعد', 'annuler lia rdv', 'annuler lia rendez-vous',
      'cancel appointment', 'annuler rdv', 'je veux annuler',
      'je ne pourrai pas venir', 'je ne peux pas venir',
      'pouvez-vous annuler', 'je souhaite annuler', 'ma9darch nji',
    ],
    keywords: ['annuler', 'annulation', 'cancel', 'نلغي', 'nlrgi', 'nalghi', 'nlghi'],
  },
  CHECK_APPOINTMENT_AVAILABILITY: {
    phrases: [
      'chno les rendez-vous disponibles',
      'chno les rdv disponibles',
      'chno les creneaux disponibles',
      'chno les créneaux disponibles',
      'chno kayn disponible',
      'chno kayn mn rendez-vous',
      'chno kayn mn rdv',
      'chno kayn ghdda',
      'chno kayn ghedda',
      'wach kayn chi blassa',
      'wach kayn chi rdv',
      'wach disponible',
      'je veux nchof chno kayn',
      'bghit nchof les disponibilites',
      'bghit nchof les disponibilités',
      '3andkom chi rendez-vous disponible',
      '3andkom chi rdv disponible',
      'bghit nchof les horaires disponibles',
      'quels creneaux sont disponibles',
      'quels créneaux sont disponibles',
      'quelles sont vos disponibilites',
      'quelles sont vos disponibilités',
      'quels sont les rendez-vous disponibles',
      'rendez vous disponibles',
      'horaires disponibles',
      'المواعيد المتوفرة',
      'شنو المواعيد المتوفرة',
      'شنو كاين من موعد',
      'واش كاين شي موعد',
      'واش كاين شي بلاصة',
    ],
    keywords: [
      'disponible', 'disponibles', 'disponibilite', 'disponibilité', 'dispo',
      'متوفر', 'متوفرة', 'créneaux', 'creneaux', 'blassa',
    ],
  },
  LIST_MY_APPOINTMENTS: {
    phrases: [
      'chno les rendez-vous dyali',
      'chno les rdv dyali',
      'chno rdv dyali',
      'wach 3ndi chi rdv',
      'wach 3andi chi rdv',
      'bghit nchof rendez-vous dyali',
      'mes rendez-vous',
      'mes rdv',
      'مواعيدي',
      'شنو مواعيدي',
      'شنو المواعيد ديالي',
      'my appointments',
    ],
    keywords: ['dyali', 'مواعيدي', 'mes rdv', 'ديالي'],
  },
  RESCHEDULE_APPOINTMENT: {
    phrases: [
      'reporter mon rendez-vous', 'changer mon rdv', 'bghit nbddl rdv',
      'bghit nbdl lheure', 'bghit nbdl lwa9t', 'momkin n7wel rdv',
      'نبدل الموعد', 'بغيت نبدل الموعد', 'reschedule', 'changer mon rendez-vous',
      'reporter mon rdv',
    ],
    keywords: ['reporter', 'reschedule', 'nbddl', 'nbdl', 'نبدل', 'changer rdv', 'n7wel'],
  },
  ASK_PRICE: {
    phrases: [
      'ch7al taman', 'ch7al taman detartrage', 'combien ca coute', 'combien detartrage',
      'quel est le prix', 'بشحال',
    ],
    keywords: ['prix', 'taman', 'ثمن', 'combien', 'ch7al', 'chhal', 'cout', 'coût'],
  },
  ASK_LOCATION: {
    phrases: [
      'fin kayn cabinet', 'fin kaynin', 'fin jay cabinet', '3tini localisation',
      'ou se trouve', 'votre adresse', 'فين كاين', 'فين كاين المركز',
    ],
    keywords: ['adresse', 'localisation', 'فين', 'parking', 'où'],
  },
  ASK_OPENING_HOURS: {
    phrases: [
      'quels sont vos horaires', 'chno les horaires', 'chno les horaires dyalkom',
      'fo9ach kat7ello', 'wa9t ouverture', 'wach halin sebt',
      'وقت العمل', 'وقتاش كتحلو', 'واش حالين',
    ],
    keywords: ['horaire', 'horaires', 'ouvert', 'ouverture', 'wa9t', 'وقت', 'fo9ach', 'kat7ello'],
  },
  DENTAL_PAIN: {
    phrases: [
      'kan wje3ni dersi', '3ndi wja3 f drssa', '3andi wja3', 'darsa katwja3ni',
      'j ai mal aux dents', 'عندي وجع', 'عندي وجع فالضرس',
    ],
    keywords: ['wje3', 'wja3', 'waj3', 'وجع', 'douleur', 'mal', '7ri9', 'hri9'],
  },
  DENTAL_EMERGENCY: {
    phrases: [
      '3andi urgence', 'urgence dentaire', 'مستعجل', '3endi nafkha',
    ],
    keywords: ['urgence', 'urgent', 'mosta3jel', 'مستعجل', 'nafkha', 'waram', 'طوارئ'],
  },
  GREETING: {
    phrases: ['salam', 'slm', 'salam 3likom', 'bonjour', 'bonsoir', 'السلام عليكم', 'سلام عليكم'],
    keywords: ['salam', 'slm', 'سلام', 'bonjour', 'bonsoir', 'hello', 'hi'],
  },
  THANKS: {
    phrases: ['merci beaucoup', 'merci bzaf', 'choukran', 'chokran', 'lah y3tik sa7a', 'شكرا'],
    keywords: ['merci', 'choukran', 'chokran', 'شكرا', 'thanks'],
  },
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeIntentText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\u0600-\u06FF\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Score one intent against normalized text.
 * @param {string} text
 * @param {{ phrases?: string[], keywords?: string[] }} dict
 * @returns {{ score: number, matched: string|null, matchType: string|null }}
 */
function scoreIntent(text, dict) {
  let best = { score: 0, matched: null, matchType: null }

  for (const phrase of dict.phrases || []) {
    const p = normalizeIntentText(phrase)
    if (!p) continue
    if (text.includes(p)) {
      const score = Math.min(0.99, 0.88 + Math.min(p.length, 28) * 0.004)
      if (score > best.score) {
        best = { score, matched: p, matchType: 'phrase' }
      }
    }
  }

  // Keyword support is weaker; used as reinforcement for global meaning.
  let keywordHits = 0
  let keywordMatched = null
  for (const keyword of dict.keywords || []) {
    const k = normalizeIntentText(keyword)
    if (!k || k.length < 3) continue
    const re = new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i')
    if (re.test(text) || text.includes(k)) {
      keywordHits += 1
      keywordMatched = keywordMatched || k
    }
  }

  if (keywordHits >= 2) {
    const score = Math.min(0.93, 0.72 + keywordHits * 0.08)
    if (score > best.score) {
      best = { score, matched: keywordMatched, matchType: 'keywords' }
    }
  } else if (keywordHits === 1 && best.score < 0.7) {
    // Single generic keyword is not enough alone for ASK_SERVICES-like intents,
    // but keep a soft signal for later combination.
    const score = 0.55
    if (score > best.score) {
      best = { score, matched: keywordMatched, matchType: 'keyword' }
    }
  }

  return best
}

/**
 * ASK_SERVICES needs stronger detection: service-list questions often mix FR+Darija.
 * @param {string} text
 * @returns {number}
 */
function askServicesBoost(text) {
  let boost = 0
  const asksWhat = /\b(chno|ach|wach|wash|شنو|اش|واش|quels?|quelle|quoi|what)\b/i.test(text)
  const hasServiceWord = /\b(service|services|serviss|servis|soins|prestations|traitements|خدمات|خدمة|implant|appareil|detartrage|orthodont)\b/i.test(text)
  const hasOfferVerb = /\b(katdirou|katdiro|kat9edmo|kat9ademo|katkedmo|kayn|kaynin|3andkom|3ndkom|proposez|disponibles?|كتقدمو|كتديرو|عندكم|كاينين)\b/i.test(text)
  const wantsToKnow = /\b(bghit n3ref|bghit n3raf|n3ref|n3raf|بغيت نعرف|نعرف)\b/i.test(text)

  // Availability of slots ≠ list of services
  if (
    /\b(blassa|créneau|creneau|disponible|ghdda|ghedda)\b/i.test(text)
    && /\b(rdv|rendez|موعد|kayn)\b/i.test(text)
    && !/\b(service|services|soins|خدمات)\b/i.test(text)
  ) {
    return 0
  }

  if (asksWhat && hasServiceWord) boost += 0.35
  if (asksWhat && hasOfferVerb) boost += 0.3
  if (hasServiceWord && hasOfferVerb) boost += 0.28
  if (wantsToKnow && (hasServiceWord || hasOfferVerb)) boost += 0.25
  if (/\bli kaynin\b|\bf had centre\b|\bles soins disponibles\b/i.test(text)) boost += 0.2
  if (/\b(wach|wash)\s+katdiro/i.test(text)) boost += 0.35

  return Math.min(0.45, boost)
}

/**
 * Classify patient intent from text (and optional voice hints).
 * Uses Darija normalization + concept scoring before phrase dictionary.
 * @param {string} rawText
 * @param {{ voiceIntent?: string|null, interpreterIntent?: string|null, stage?: string|null }} [options]
 * @returns {{ intent: string, confidence: number, matched: string|null, matchType: string|null, nlu?: object }}
 */
function classifyIntent(rawText, options = {}) {
  const darija = normalizeDarijaForNlu(rawText, { stage: options.stage || null })
  const text = normalizeIntentText(darija.normalizedText || rawText)
  const rawNorm = normalizeIntentText(rawText)
  if (!text && !rawNorm) {
    return { intent: 'OTHER', confidence: 0, matched: null, matchType: null }
  }

  /** @type {{ intent: string, confidence: number, matched: string|null, matchType: string|null }} */
  let best = { intent: 'OTHER', confidence: 0, matched: null, matchType: null }

  // Phrase-level concept rules (Darija Arabizi / AR / mixed)
  const conceptHit = classifyIntentFromConcepts(darija.concepts, darija.normalizedText)
  if (conceptHit && conceptHit.confidence >= 0.86) {
    best = {
      intent: conceptHit.intent,
      confidence: conceptHit.confidence,
      matched: conceptHit.matched,
      matchType: 'darija_concepts',
    }
  }

  // Score dictionary on both normalized + raw (FR phrases still match raw)
  for (const sourceText of [...new Set([text, rawNorm].filter(Boolean))]) {
    for (const intentName of INTENT_NAMES) {
      if (intentName === 'OTHER') continue
      const dict = INTENT_DICTIONARY[intentName]
      if (!dict) continue
      const scored = scoreIntent(sourceText, dict)
      let confidence = scored.score

      if (intentName === 'ASK_SERVICES') {
        confidence = Math.min(0.99, confidence + askServicesBoost(sourceText))
        if (/\b(rdv|rendez|موعد|nakhod|nji)\b/i.test(sourceText) && !askServicesBoost(sourceText)) {
          confidence *= 0.4
        }
        if (
          /\b(disponible|disponibles|disponibilite|dispo|متوفر|créneau|creneau|horaire|blassa|kayn)\b/i.test(sourceText)
          && /\b(rendez|rdv|موعد|créneau|creneau|horaire|blassa)\b/i.test(sourceText)
          && !/\b(service|services|soins|خدمات)\b/i.test(sourceText)
        ) {
          confidence *= 0.25
        }
      }

      if (intentName === 'CHECK_APPOINTMENT_AVAILABILITY') {
        if (
          /\b(disponible|disponibles|dispo|متوفر|متوفرة|blassa|kayn)\b/i.test(sourceText)
          && /\b(rendez|rdv|موعد|créneau|creneau|horaire|سوايع|blassa|ghdda|lyoum)\b/i.test(sourceText)
        ) {
          confidence = Math.max(confidence, 0.92)
        }
        if (/\bwash?\s+kayn\s+chi\b/i.test(sourceText) || /\bchno\s+kayn\b/i.test(sourceText)) {
          if (!/\bdyali\b/i.test(sourceText)) confidence = Math.max(confidence, 0.9)
        }
        if (/\b(dyali|mes\s+rendez|مواعيدي)\b/i.test(sourceText)) {
          confidence = 0
        }
      }

      if (intentName === 'LIST_MY_APPOINTMENTS') {
        if (/\b(dyali|mes\s+rendez|mes\s+rdv|مواعيدي|3ndi\s+chi\s+rdv)\b/i.test(sourceText)) {
          confidence = Math.max(confidence, 0.93)
        }
      }

      if (intentName === 'BOOK_APPOINTMENT') {
        if (/\b(bghit|brit|baghi|بغيت).{0,30}\b(rdv|rendez|موعد|nakhod)\b/i.test(sourceText)) {
          confidence = Math.max(confidence, 0.93)
        }
      }

      if (intentName === 'ASK_OPENING_HOURS') {
        if (/\bfo9ach\b|\bkat7ell/i.test(sourceText) || /وقتاش|حالين/.test(sourceText)) {
          confidence = Math.max(confidence, 0.9)
        }
      }

      if (intentName === 'ASK_LOCATION') {
        if (/\bfin\s+kayn/i.test(sourceText) || /فين\s*كاين/.test(sourceText)) {
          confidence = Math.max(confidence, 0.92)
        }
      }

      if (confidence > best.confidence) {
        best = {
          intent: intentName,
          confidence: Number(confidence.toFixed(3)),
          matched: scored.matched,
          matchType: scored.matchType || 'dictionary',
        }
      }
    }
  }

  // Soft mapping from AI Transcript Interpreter intents
  const voiceHint = String(options.interpreterIntent || options.voiceIntent || '').toLowerCase()
  if (voiceHint) {
    const mapped = {
      appointment: 'BOOK_APPOINTMENT',
      emergency: 'DENTAL_EMERGENCY',
      pain: 'DENTAL_PAIN',
      hours: 'ASK_OPENING_HOURS',
      location: 'ASK_LOCATION',
      price: 'ASK_PRICE',
      greeting: 'GREETING',
      thanks: 'THANKS',
      cancel: 'CANCEL_APPOINTMENT',
      ask_services: 'ASK_SERVICES',
      info: 'ASK_SERVICES',
    }[voiceHint]
    if (mapped && best.confidence < 0.75) {
      best = {
        intent: mapped,
        confidence: Math.max(best.confidence, 0.8),
        matched: voiceHint,
        matchType: 'voice_interpreter',
      }
    }
  }

  if (best.confidence < 0.45) {
    logDarijaNlu({
      raw: rawText,
      normalized: darija.normalizedText,
      intent: 'OTHER',
      source: 'low_confidence',
      confidence: best.confidence,
      concepts: darija.concepts,
    })
    return {
      intent: 'OTHER',
      confidence: best.confidence,
      matched: best.matched,
      matchType: best.matchType,
      nlu: darija,
    }
  }

  logDarijaNlu({
    raw: rawText,
    normalized: darija.normalizedText,
    intent: best.intent,
    source: best.matchType,
    confidence: best.confidence,
    concepts: darija.concepts,
  })

  return { ...best, nlu: darija }
}

/**
 * Direct canned replies for high-confidence intents that should skip LLM guessing.
 * @param {string} intent
 * @param {'fr'|'darija'|'mixed'|'auto'|string} languageHint
 * @returns {string|null}
 */
function buildIntentDirectReply(intent, languageHint = 'fr') {
  if (intent === 'ASK_SERVICES') {
    return buildPublicServicesReply(languageHint)
  }

  return null
}

module.exports = {
  INTENT_NAMES,
  INTENT_DICTIONARY,
  CLINIC_SERVICES,
  PUBLIC_SERVICES_LIST,
  classifyIntent,
  buildIntentDirectReply,
  normalizeIntentText,
}
