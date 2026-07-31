/**
 * Global intent classifier for Centre Dentaire HEL.
 *
 * Goal: detect the patient's INTENT first (Darija / FR / AR / medical mix),
 * not word-by-word literal understanding.
 */

const { CLINIC_SERVICES } = require('./transcript-interpreter')

const INTENT_NAMES = [
  'ASK_SERVICES',
  'BOOK_APPOINTMENT',
  'CANCEL_APPOINTMENT',
  'RESCHEDULE_APPOINTMENT',
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
      'chno kayn',
      'chno kaynin',
      'chno kaynin mn service',
      'chno kaynin mn services',
      'ach katdirou',
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
      'شنو كاين',
      'شنو كاينين',
      'الخدمات',
      'ما هي خدماتكم',
      'اش كتديرو',
    ],
    keywords: [
      'services', 'service', 'serviss', 'servis', 'prestations', 'soins',
      'traitements', 'interventions', 'خدمات', 'خدمة', 'katdirou', 'kat9edmo',
      'kat9ademo', 'kaynin', 'chno homa',
    ],
  },
  BOOK_APPOINTMENT: {
    phrases: [
      'bghit rendez-vous', 'bghit rdv', 'nakhod rdv', 'bghit nji',
      'prendre rendez-vous', 'je veux un rendez-vous', 'je voudrais un rdv',
      'بغيت موعد', 'نبغي نجي',
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
      'annuler mon rendez-vous', 'bghit nalghi rdv', 'نبغي نلغي الموعد',
      'cancel appointment', 'annuler rdv',
    ],
    keywords: ['annuler', 'annulation', 'cancel', 'نلغي', 'nlrgi'],
  },
  RESCHEDULE_APPOINTMENT: {
    phrases: [
      'reporter mon rendez-vous', 'changer mon rdv', 'bghit nbddl rdv',
      'نبدل الموعد', 'reschedule',
    ],
    keywords: ['reporter', 'reschedule', 'nbddl', 'نبدل', 'changer rdv'],
  },
  ASK_PRICE: {
    phrases: [
      'ch7al taman', 'combien ca coute', 'quel est le prix', 'بشحال',
    ],
    keywords: ['prix', 'taman', 'ثمن', 'combien', 'ch7al', 'chhal', 'cout', 'coût'],
  },
  ASK_LOCATION: {
    phrases: [
      'fin kayn cabinet', 'ou se trouve', 'votre adresse', 'فين كاين',
    ],
    keywords: ['adresse', 'localisation', 'fin', 'فين', 'parking', 'où', 'ou'],
  },
  ASK_OPENING_HOURS: {
    phrases: [
      'quels sont vos horaires', 'wa9t ouverture', 'وقت العمل',
    ],
    keywords: ['horaire', 'horaires', 'ouvert', 'ouverture', 'wa9t', 'وقت'],
  },
  DENTAL_PAIN: {
    phrases: [
      'kan wje3ni dersi', 'j ai mal aux dents', 'عندي وجع',
    ],
    keywords: ['wje3', 'waj3', 'وجع', 'douleur', 'mal', '7ri9', 'hri9'],
  },
  DENTAL_EMERGENCY: {
    phrases: [
      '3andi urgence', 'urgence dentaire', 'مستعجل', '3endi nafkha',
    ],
    keywords: ['urgence', 'urgent', 'mosta3jel', 'مستعجل', 'nafkha', 'waram', 'طوارئ'],
  },
  GREETING: {
    phrases: ['salam', 'bonjour', 'bonsoir', 'السلام عليكم'],
    keywords: ['salam', 'سلام', 'bonjour', 'bonsoir', 'hello', 'hi'],
  },
  THANKS: {
    phrases: ['merci beaucoup', 'choukran', 'شكرا'],
    keywords: ['merci', 'choukran', 'شكرا', 'thanks'],
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
  const asksWhat = /\b(chno|ach|شنو|اش|quels?|quelle|quoi|what)\b/i.test(text)
  const hasServiceWord = /\b(service|services|serviss|servis|soins|prestations|traitements|خدمات|خدمة)\b/i.test(text)
  const hasOfferVerb = /\b(katdirou|kat9edmo|kat9ademo|katkedmo|kayn|kaynin|3andkom|3ndkom|proposez|disponibles?|كتقدمو|عندكم|كاينين)\b/i.test(text)
  const wantsToKnow = /\b(bghit n3ref|bghit n3raf|n3ref|n3raf|بغيت نعرف|نعرف)\b/i.test(text)

  if (asksWhat && hasServiceWord) boost += 0.35
  if (asksWhat && hasOfferVerb) boost += 0.3
  if (hasServiceWord && hasOfferVerb) boost += 0.28
  if (wantsToKnow && (hasServiceWord || hasOfferVerb)) boost += 0.25
  if (/\bli kaynin\b|\bf had centre\b|\bles soins disponibles\b/i.test(text)) boost += 0.2

  return Math.min(0.45, boost)
}

/**
 * Classify patient intent from text (and optional voice hints).
 * @param {string} rawText
 * @param {{ voiceIntent?: string|null, interpreterIntent?: string|null }} [options]
 * @returns {{ intent: string, confidence: number, matched: string|null, matchType: string|null }}
 */
function classifyIntent(rawText, options = {}) {
  const text = normalizeIntentText(rawText)
  if (!text) {
    return { intent: 'OTHER', confidence: 0, matched: null, matchType: null }
  }

  /** @type {{ intent: string, confidence: number, matched: string|null, matchType: string|null }} */
  let best = { intent: 'OTHER', confidence: 0, matched: null, matchType: null }

  for (const intentName of INTENT_NAMES) {
    if (intentName === 'OTHER') continue
    const dict = INTENT_DICTIONARY[intentName]
    if (!dict) continue
    const scored = scoreIntent(text, dict)
    let confidence = scored.score

    if (intentName === 'ASK_SERVICES') {
      confidence = Math.min(0.99, confidence + askServicesBoost(text))
      // Guard: "service" alone inside booking sentence should not win.
      if (/\b(rdv|rendez|موعد|nakhod|nji)\b/i.test(text) && !askServicesBoost(text)) {
        confidence *= 0.4
      }
    }

    // Prefer phrase matches globally over weak keyword noise.
    if (confidence > best.confidence) {
      best = {
        intent: intentName,
        confidence: Number(confidence.toFixed(3)),
        matched: scored.matched,
        matchType: scored.matchType,
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
    return { intent: 'OTHER', confidence: best.confidence, matched: best.matched, matchType: best.matchType }
  }

  return best
}

/**
 * Direct canned replies for high-confidence intents that should skip LLM guessing.
 * @param {string} intent
 * @param {'fr'|'darija'|'mixed'|'auto'|string} languageHint
 * @returns {string|null}
 */
function buildIntentDirectReply(intent, languageHint = 'fr') {
  const darija = languageHint === 'darija' || languageHint === 'mixed'

  if (intent === 'ASK_SERVICES') {
    if (darija) {
      return [
        'نقدم الخدمات التالية:',
        '',
        '• تقويم الأسنان',
        '• علاج تسوس الأسنان',
        '• تنظيف الأسنان (إزالة الجير)',
        '• علاج اللثة',
        '• تبييض الأسنان',
        '• زراعة الأسنان',
        '• قشور الأسنان',
        '• طب أسنان الأطفال',
        '• علاج الحالات المستعجلة',
        '',
        'إذا أردت خدمة معينة، أخبرني لأرتب لك موعداً هنا على واتساب.',
      ].join('\n')
    }
    const lines = CLINIC_SERVICES.map((name) => `• ${name}`)
    return [
      'Bien sûr. Voici les services disponibles au Centre Dentaire HEL :',
      '',
      ...lines,
      '',
      'Dites-moi le soin souhaité et je peux vous proposer un rendez-vous ici sur WhatsApp.',
    ].join('\n')
  }

  return null
}

module.exports = {
  INTENT_NAMES,
  INTENT_DICTIONARY,
  CLINIC_SERVICES,
  classifyIntent,
  buildIntentDirectReply,
  normalizeIntentText,
}
