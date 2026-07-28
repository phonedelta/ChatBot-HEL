/**
 * Intent detection for dental WhatsApp conversations (Darija + French).
 */

const INTENT_PATTERNS = [
  {
    intent: 'salutation',
    patterns: [/\b(salam|سلام|bonjour|bonsoir|hello|hi)\b/i],
    requireShort: true,
  },
  {
    intent: 'remerciement',
    patterns: [/\b(merci|choukran|شكرا|thanks?)\b/i],
  },
  {
    intent: 'annulation_rendez_vous',
    patterns: [
      /\b(annul|cancel|نلغي|nbddl|نبدل|reporter|modifier).{0,20}(rdv|rendez|موعد)/i,
      /\b(rdv|rendez|موعد).{0,20}(annul|cancel|نلغي|nbddl|نبدل)/i,
    ],
  },
  {
    intent: 'prise_rendez_vous',
    patterns: [
      /\b(bghit|baghit|بغيت|vouloir|veux|voudrais).{0,40}(rdv|rendez|موعد|nji|نجي|venir|nakhod|nkhod)/i,
      /\b(nakhod|nkhod|prendre).{0,20}(rdv|rendez|موعد)/i,
      /\b(rdv|rendez-vous|randivo|موعد)\b/i,
      /\b(nji|نجي|venir).{0,20}(ghdda|ghedda|غدا|demain|lyoum|اليوم|bach|bash)?/i,
      /\b(n9dar|nqdar|نقدر).{0,20}(nji|نجي|venir)/i,
      /\b(ndir|faire).{0,20}(service|serviss).{0,40}(rdv|rendez|موعد|nji|nakhod)/i,
      /\bbach\s+nji\b/i,
    ],
  },
  {
    intent: 'urgence',
    patterns: [
      /\b(urgence|urgent|مستعجل|mosta3jel)\b/i,
      /\b(nafkha|نفخة|gonflement|waram|ورم)\b/i,
      /\b(wje3|waj3|وجع|douleur).{0,20}(kbii?r|بzaf|بزاف|fort|forte|beaucoup)\b/i,
    ],
  },
  {
    intent: 'douleur',
    patterns: [
      /\b(wje3|waj3|ouj3|وجع|douleur|mal).{0,25}(dent|ders|drass|سنان|ضرس|sinn)/i,
      /\b(dent|ders|drass|سنان|ضرس).{0,25}(wje3|waj3|وجع|douleur|mal)/i,
      /\b(wje3ni|waj3ni|وجعني|kayj3ni)\b/i,
    ],
  },
  {
    intent: 'extraction',
    patterns: [/\b(n9ala3|nqala3|قلع|extraction|arracher|enlever).{0,20}(dent|ders|drass|سنان|ضرس)?/i],
  },
  {
    intent: 'implant',
    patterns: [/\b(implant|امبلونت|امبلانت)\b/i],
  },
  {
    intent: 'appareil_dentaire',
    patterns: [/\b(appareil|brackets|تقويم|t9wim|orthodontie|bra)\b/i],
  },
  {
    intent: 'blanchiment',
    patterns: [/\b(blanchiment|whitening|تبييض|tbyid)\b/i],
  },
  {
    intent: 'prix',
    patterns: [/\b(prix|taman|ثمن|ch7al|chhal|بشحال|combien|co[uû]t)\b/i],
  },
  {
    intent: 'devis',
    patterns: [/\b(devis|devis?e|estimation)\b/i],
  },
  {
    intent: 'horaires',
    patterns: [/\b(horaire|horaires|ouvert|ouverture|وقت|wa9t)\b/i],
  },
  {
    intent: 'localisation',
    patterns: [/\b(fin|فين|où|ou|adresse|localisation|cabinet|clinique|parking)\b/i],
  },
  {
    intent: 'traitement',
    patterns: [/\b(traitement|soin|حشو|détartrage|detartrage|carie)\b/i],
  },
  {
    intent: 'consultation',
    patterns: [/\b(consultation|consult|nssawal|نسوال|سؤال|question|info)\b/i],
  },
]

/**
 * @param {string} text
 * @param {string[]} canonicalTokens
 * @param {{ primaryText?: string }} [options]
 * @returns {{ intent: string, confidence: number, matchedBy: string|null }}
 */
function detectIntent(text, canonicalTokens = [], options = {}) {
  const source = String(text || '')
  const set = new Set((canonicalTokens || []).map((item) => String(item || '').toLowerCase()))
  const primary = String(options.primaryText || text || '').trim()
  const wordCount = primary ? primary.split(/\s+/).filter(Boolean).length : 0

  // Canonical-token shortcuts (robust after normalization).
  if (set.has('gonflement') || (set.has('urgence') && (set.has('douleur') || set.has('dent')))) {
    return { intent: 'urgence', confidence: 0.9, matchedBy: 'canonical:urgence' }
  }
  if (set.has('douleur') && (set.has('dent') || set.has('molaire'))) {
    return { intent: 'douleur', confidence: 0.9, matchedBy: 'canonical:douleur' }
  }
  if (set.has('annuler') && set.has('rendez-vous')) {
    return { intent: 'annulation_rendez_vous', confidence: 0.88, matchedBy: 'canonical:annulation_rdv' }
  }
  if (
    (set.has('vouloir') || set.has('prendre') || set.has('faire'))
    && (set.has('rendez-vous') || set.has('venir'))
  ) {
    return { intent: 'prise_rendez_vous', confidence: 0.9, matchedBy: 'canonical:rdv' }
  }
  if (set.has('prendre') && set.has('rendez-vous')) {
    return { intent: 'prise_rendez_vous', confidence: 0.9, matchedBy: 'canonical:prendre_rdv' }
  }
  if (set.has('vouloir') && set.has('service') && (set.has('venir') || set.has('prendre') || set.has('rendez-vous'))) {
    return { intent: 'prise_rendez_vous', confidence: 0.86, matchedBy: 'canonical:service_rdv' }
  }
  if (set.has('rendez-vous')) {
    return { intent: 'prise_rendez_vous', confidence: 0.82, matchedBy: 'canonical:rdv_only' }
  }
  if (set.has('venir') && (set.has('demain') || set.has('aujourd_hui'))) {
    return { intent: 'prise_rendez_vous', confidence: 0.8, matchedBy: 'canonical:venir_date' }
  }
  if (set.has('extraire')) {
    return { intent: 'extraction', confidence: 0.86, matchedBy: 'canonical:extraction' }
  }
  if (set.has('prix') && set.has('implant')) {
    return { intent: 'prix', confidence: 0.86, matchedBy: 'canonical:prix_implant' }
  }
  if (set.has('prix')) {
    return { intent: 'prix', confidence: 0.8, matchedBy: 'canonical:prix' }
  }
  if (set.has('localisation')) {
    return { intent: 'localisation', confidence: 0.84, matchedBy: 'canonical:localisation' }
  }
  if (set.has('horaires')) {
    return { intent: 'horaires', confidence: 0.84, matchedBy: 'canonical:horaires' }
  }
  if (set.has('information')) {
    return { intent: 'consultation', confidence: 0.75, matchedBy: 'canonical:info' }
  }
  if (set.has('salutation') && wordCount <= 4) {
    return { intent: 'salutation', confidence: 0.85, matchedBy: 'canonical:salutation' }
  }
  if (set.has('remerciement')) {
    return { intent: 'remerciement', confidence: 0.85, matchedBy: 'canonical:remerciement' }
  }

  for (const rule of INTENT_PATTERNS) {
    if (rule.requireShort && wordCount > 5) {
      continue
    }
    for (const pattern of rule.patterns) {
      if (pattern.test(source)) {
        return {
          intent: rule.intent,
          confidence: 0.78,
          matchedBy: String(pattern),
        }
      }
    }
  }

  return {
    intent: 'autre',
    confidence: 0.35,
    matchedBy: null,
  }
}

module.exports = {
  INTENT_PATTERNS,
  detectIntent,
}
