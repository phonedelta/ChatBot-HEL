/**
 * Extensible Darija / French / Arabic dental vocabulary.
 * Hundreds of surface forms → canonical tokens + ASR mishearing fixes.
 */

const CANONICAL_GROUPS = [
  {
    canonical: 'dent',
    forms: [
      'dent', 'dents', 'سن', 'سنان', 'sinn', 'senn', 'sinan', 'sennan', 'sinnan', 'senan', 'snan',
      'ders', 'dersi', 'darsi', 'drass', 'drassa', 'darssa', 'dars', 'darss', 'الضرس', 'ضرس',
      'adrass', 'adras', 'derci', 'darci', 'dirty', 'jersey',
    ],
  },
  {
    canonical: 'molaire',
    forms: ['molaire', 'molaires', 'molairee', 'الضرس'],
  },
  {
    canonical: 'douleur',
    forms: [
      'douleur', 'douleurs', 'mal', 'wje3', 'wje3ni', 'waj3', 'waj3ni', 'ouj3', 'ouja3', 'oujaani',
      'وجع', 'وجعني', 'كاينوجعني', 'كايوجعني', 'kayj3ni', 'kaywaj3ni', 'yewj3ni', 'ywje3ni',
      'hrssa', 'harsa', '7ri9', 'hri9', '7ri9a', 'حريق', 'كايحرقني', 'kay7argni', 'visa', 'vision', 'wagon',
    ],
  },
  {
    canonical: 'gonflement',
    forms: ['nafkha', 'naf5a', 'nafha', 'navaja', 'نفخة', 'نفخه', 'gonflement', 'enflure', 'waram', 'ورم', 'wjeh', 'وجه'],
  },
  {
    canonical: 'docteur',
    forms: ['docteur', 'doctor', 'tbib', 'tpib', 'طبيب', 'dentiste', 'dr', 'doktour', 'doktor'],
  },
  {
    canonical: 'rendez-vous',
    forms: [
      'rendez-vous', 'rendez vous', 'rdv', 'rdvs', 'موعد', 'mow3id', 'maw3id', 'mawid', 'mo3id',
      'appointment', 'randivo', 'randivou', 'randivos', 'randevous', 'rendezvou', 'hervé', 'hervey',
      'air de vie', 'rendezvouz',
    ],
  },
  {
    canonical: 'vouloir',
    forms: [
      'bghit', 'bghiti', 'bghitc', 'بغيت', 'بغيتي', 'bghina', 'بغينا', 'baghit', 'bagheti', 'baghi',
      'ba8i', 'bagli', 'beach', 'big hit', 'je veux', 'je voudrais', 'veux', 'voudrais',
    ],
  },
  {
    canonical: 'avoir',
    forms: ['3endi', 'andi', '3andek', 'andy', 'endy', 'عندي', 'عندك', "j'ai", 'jai', '3ndi'],
  },
  {
    canonical: 'venir',
    forms: ['nji', 'njiw', 'نجي', 'نجيو', 'aji', 'أجي', 'venir', 'ngi', 'nje', 'naji'],
  },
  {
    canonical: 'pouvoir',
    forms: ['n9dar', 'nqdar', 'نقدر', 'نقدرش', 'peux', 'peut', 'pouvoir'],
  },
  {
    canonical: 'prendre',
    forms: ['nakhod', 'nkhod', 'nakhoud', 'nakhouud', 'ناخد', 'ناخذ', 'prendre', 'prend', 'nkhd'],
  },
  {
    canonical: 'faire',
    forms: ['ndir', 'ندير', 'نديرو', 'dir', 'دير', 'faire', 'fais', 'nder'],
  },
  {
    canonical: 'service',
    forms: ['service', 'services', 'serviss', 'servis', 'سيرفيس', 'خدمة', 'khadma'],
  },
  {
    canonical: 'extraire',
    forms: [
      'n9ala3', 'nqala3', 'n9la3', 'nkalaa', 'قلع', 'نقلع', 'extraction', 'arracher', 'enlever',
      'n9ale3', 'nqale3', 'qala3',
    ],
  },
  {
    canonical: 'implant',
    forms: ['implant', 'implants', 'emplant', 'امبلونت', 'امبلانت', 'انبلونت', 'implantt'],
  },
  {
    canonical: 'appareil',
    forms: ['appareil', 'appareils', 'bra', 'brackets', 'تقويم', 't9wim', 'taqwim', 'orthodontie', 'bagues'],
  },
  {
    canonical: 'blanchiment',
    forms: ['blanchiment', 'whitening', 'تبييض', 'tbyid', 'tbiyid', 'blanciment'],
  },
  {
    canonical: 'prix',
    forms: [
      'prix', 'taman', 'tamanou', 'ثمن', 'التمن', 'ch7al', 'chhal', 'shell', 'بشحال', 'كم',
      'cout', 'coût', 'combien', 'bch7al', 'bchhal',
    ],
  },
  {
    canonical: 'horaires',
    forms: ['horaire', 'horaires', 'وقت', 'الوقت', 'wa9t', 'ouvert', 'ouverture', 'ouverture'],
  },
  {
    canonical: 'localisation',
    forms: [
      'fin', 'فين', 'ou', 'où', 'localisation', 'adresse', 'cabinet', 'cabine', 'clinic', 'clinique',
      'parking', 'فين كاين', 'oukayn',
    ],
  },
  {
    canonical: 'demain',
    forms: ['ghdda', 'ghedda', 'gadda', 'غدا', 'غداً', 'demain', 'tomorrow'],
  },
  {
    canonical: 'aujourd_hui',
    forms: ['lyoum', 'اليوم', "aujourd'hui", 'aujourdhui', 'today'],
  },
  {
    canonical: 'annuler',
    forms: ['annuler', 'annulation', 'cancel', 'نلغي', 'nlrgi', 'nbddl', 'نبدل', 'changer', 'reporter', 'nbdel'],
  },
  {
    canonical: 'urgence',
    forms: ['urgence', 'urgent', 'مستعجل', 'مستعجلة', 'mosta3jel', 'musta3jil', 'daba', 'دابا'],
  },
  {
    canonical: 'salutation',
    forms: [
      'salam', 'salamou', 'سلام', 'السلام', 'bonjour', 'bonsoir', 'hello', 'hi', 'labas', 'لاباس',
      'cv', 'ça va', 'sava',
    ],
  },
  {
    canonical: 'remerciement',
    forms: ['merci', 'choukran', 'شكرا', 'شكراً', 'thank', 'thanks', 'mercy'],
  },
  {
    canonical: 'information',
    forms: ['nssawal', 'نسوال', 'سوال', 'سؤال', 'question', 'info', 'information', 'nsawl'],
  },
  {
    canonical: 'oui',
    forms: ['oui', 'ouais', 'yes', 'نعم', 'ايوا', 'أيوا', 'واخا', 'wakha', 'safi', 'صافي', 'موافق', 'أكيد'],
  },
  {
    canonical: 'non',
    forms: ['non', 'no', 'لا', 'laa'],
  },
  {
    canonical: 'pour',
    forms: ['bach', 'bash', 'باش', 'pour', 'afm', '3la', 'على'],
  },
  {
    canonical: 'et',
    forms: ['w', 'و', 'et', 'ou'],
  },
  {
    canonical: 'carie',
    forms: ['carie', ' caries', 'تسوس', 'tssaws', 'hrssa'],
  },
  {
    canonical: 'detartrage',
    forms: ['detartrage', 'détartrage', 'tandif', 'تنظيف', 'tartre'],
  },
  {
    canonical: 'gencive',
    forms: ['gencive', 'gencives', 'litta', 'لثة', 'lutha'],
  },
  {
    canonical: 'sang',
    forms: ['sang', 'دم', 'kaydi', 'نزيف', 'saignement'],
  },
  {
    canonical: 'enfant',
    forms: ['enfant', 'bébé', 'bebe', 'ولد', 'طفلة', 'drari', 'دراري'],
  },
  {
    canonical: 'telephone',
    forms: ['telephone', 'téléphone', 'numero', 'numéro', 'gsm', 'تليفون', 'هاتف', 'nimiro'],
  },
  {
    canonical: 'ville',
    forms: ['ville', 'city', 'مدينة', 'mdina', 'casa', 'casablanca', 'rabat'],
  },
]

/** @type {Map<string, string>} */
const FORM_TO_CANONICAL = new Map()

for (const group of CANONICAL_GROUPS) {
  for (const form of group.forms) {
    FORM_TO_CANONICAL.set(normalizeKey(form), group.canonical)
  }
}

/**
 * Frequent ASR mishearings → corrected surface token (before canonicalization).
 */
const ASR_CORRECTIONS = {
  // vouloir
  baghit: 'bghit',
  bagheti: 'bghiti',
  baghi: 'bghit',
  ba8i: 'bghit',
  beach: 'bghit',
  'big hit': 'bghit',
  bagly: 'bghit',
  // prendre
  nkhod: 'nakhod',
  nakhoud: 'nakhod',
  nakhouud: 'nakhod',
  nkhd: 'nakhod',
  // rendez-vous
  randivo: 'rendez-vous',
  randivou: 'rendez-vous',
  randivos: 'rendez-vous',
  randevous: 'rendez-vous',
  rendezvou: 'rendez-vous',
  'rendez vous': 'rendez-vous',
  'air de vie': 'rdv',
  hervé: 'rdv',
  hervey: 'rdv',
  // dents / douleur
  dersi: 'dersi',
  derci: 'dersi',
  darci: 'darsi',
  drassa: 'ders',
  darssa: 'ders',
  dirty: 'dersi',
  jersey: 'dersi',
  visa: 'wje3',
  vision: 'wje3ni',
  wagon: 'waj3',
  ouja: 'ouj3',
  oujaani: 'wje3ni',
  // avoir
  andi: '3endi',
  andy: '3endi',
  endy: '3endi',
  // service / faire
  serviss: 'service',
  servis: 'service',
  nder: 'ndir',
  // extraction
  nkalaa: 'n9ala3',
  nqala3: 'n9ala3',
  // misc
  tpib: 'tbib',
  chhal: 'ch7al',
  shell: 'ch7al',
  gadda: 'ghdda',
  'gadda.': 'ghdda',
  ngi: 'nji',
  emplant: 'implant',
  cabine: 'cabinet',
  nafha: 'nafkha',
  navaja: 'nafkha',
  bash: 'bach',
  mercy: 'merci',
  // french ASR noise
  'sous-titres': '',
  'sous titres': '',
  'thank you': '',
}

const HESITATION_TOKENS = [
  'euh', 'euuh', 'eee', 'eeeuh', 'hmm', 'hum', 'hm', 'aaa', 'aaah', 'ahh', 'ah',
  'enfin', 'bah', 'ben', 'heu', 'uh', 'um', 'erm', 'يعني', 'اه', 'آآ',
]

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} token
 * @returns {string}
 */
function canonicalForToken(token) {
  const key = normalizeKey(token)
  if (!key) {
    return token
  }
  if (Object.prototype.hasOwnProperty.call(ASR_CORRECTIONS, key)) {
    const corrected = ASR_CORRECTIONS[key]
    if (!corrected) return ''
    return FORM_TO_CANONICAL.get(normalizeKey(corrected)) || corrected
  }
  return FORM_TO_CANONICAL.get(key) || token
}

module.exports = {
  CANONICAL_GROUPS,
  ASR_CORRECTIONS,
  HESITATION_TOKENS,
  FORM_TO_CANONICAL,
  normalizeKey,
  canonicalForToken,
}
