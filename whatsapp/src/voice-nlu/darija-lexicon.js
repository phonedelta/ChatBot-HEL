/**
 * Extensible Moroccan Darija concept lexicon (Latin Arabizi + Arabic script).
 * Organized by semantic concepts — not a giant if-chain.
 */

/** @type {Record<string, string[]>} */
const CONCEPT_FORMS = {
  // Politeness
  please: ['3afak', 'afak', 'aafak', '3afakom', 'afakom', 'عفاك', 'عفاكم', 'من فضلك'],
  thanks: [
    'chokran', 'shokran', 'choukran', 'merci', 'merci bzaf', 'lah y3tik sa7a', 'lah yatik saha',
    'شكرا', 'شكراً', 'لاه يعطيك الصحة',
  ],

  // Question words
  what: ['chno', 'chnou', 'chnoo', 'ach', 'achno', 'achnou', 'chnowa', 'شنو', 'اشنو', 'أشنو', 'ما'],
  whether: ['wach', 'wash', 'wesh', 'wch', 'واش', 'وش'],
  where: ['fin', 'fayn', 'fein', 'فين'],
  when: ['fo9ach', 'foqach', 'imta', 'imta', 'wa9tach', 'وقتاش', 'فوقتاش', 'إيمتى', 'امتى'],
  how_much: ['ch7al', 'chhal', 'bch7al', 'bchhal', 'شحال', 'بشحال'],
  how: ['kifach', 'kifash', 'kif', 'كيفاش', 'كيف'],
  why: ['3lach', 'alach', '3lah', 'علاش', 'ليش'],

  // Will / request
  want: [
    'bghit', 'bghiti', 'bghina', 'brit', 'baghi', 'bagha', 'baghit', 'kanbghi', 'n7taj', 'khasni',
    'بغيت', 'بغيتي', 'بغينا', 'باغي', 'باغية', 'خصني', 'نحتاج', 'vouloir',
  ],
  take: ['nakhod', 'nkhod', 'nakhoud', 'ناخد', 'ناخذ', 'n7jez', 'n7ajez', 'نحجز', 'prendre'],
  see: ['nchof', 'nchoufo', 'نشوف', 'نشوفو'],
  come: ['nji', 'njiw', 'نجي', 'نجيو'],
  have: ['3endi', '3andi', '3ndi', 'andi', 'andy', 'endy', 'عندي', 'عندك'],

  // Existence / availability
  exist: ['kayn', 'kayen', 'kayna', 'kaynin', 'كاين', 'كاينة', 'كاينين'],
  not_exist: ['makaynch', 'makainch', 'makayench', 'ماكاينش', 'ما كاينش'],
  place_slot: ['blassa', 'blasa', 'بلاصة', 'بلاسا', 'créneau', 'creneau', 'creneaux', 'créneaux'],
  available: [
    'disponible', 'disponibles', 'disponibilite', 'disponibilité', 'dispo',
    'متوفر', 'متوفرة', 'متوفرين',
  ],

  // Appointment
  appointment: [
    'rdv', 'rendez-vous', 'rendez vous', 'rendezvou', 'randivo', 'appointment',
    'mo3id', 'mow3id', 'maw3id', 'موعد', 'مواعيد',
  ],
  my: ['dyali', 'diali', 'diyali', 'ديالي', 'mes'],

  // Time
  today: ['lyoum', 'lyom', 'اليوم', "aujourd'hui", 'aujourdhui', 'today'],
  tomorrow: ['ghdda', 'ghda', 'ghedda', 'gheda', 'gadda', 'ghada', 'غدا', 'غداً', 'demain'],
  after_tomorrow: ['ba3d ghdda', 'ba3d ghedda', 'mn b3d ghdda', 'بعد غدا', 'apres demain', 'après-demain'],
  now: ['daba', 'دابا', 'maintenant'],
  morning: ['sbah', 'sba7', 'الصباح', 'matin'],
  evening: ['l3chiya', 'lachiya', 'العشية', 'soir', 'apres-midi', 'après-midi'],
  night: ['lil', 'الليل', 'nuit'],

  // Affirmation / negation
  yes: [
    'oui', 'ouais', 'yes', 'ah', 'aah', 'iyeh', 'iyah', 'iwa', 'wakha', 'safi',
    'نعم', 'ايوا', 'أيوا', 'واخا', 'ايه', 'آها', 'وا',
  ],
  no: ['non', 'no', 'la', 'lla', 'laa', 'lah', 'لا', 'لاء', 'ماشي'],
  refuse: ['mabghitch', 'mabghitch', 'مابغيتش', 'ما بغيتش'],

  // Dental domain (surface help)
  tooth: ['ders', 'darsa', 'darssa', 'drssa', 'snan', 'sinn', 'ضرس', 'سن', 'أسنان'],
  pain: ['wja3', 'wje3', 'waj3', 'kadarni', 'katwja3ni', 'وجع', 'وجعني'],
  cavity: ['carie', 'tssaws', 'تسوس'],
  cleaning: ['detartrage', 'tn9iya', 'tnqiya', 'تنظيف', 'tartre'],
  extraction: ['n9ala3', 'n7yed', 'extraction', 'قلع', 'خلع'],
  braces: ['appareil', 'ta9wim', 'تقويم'],
  implant: ['implant', 'زرع'],
  emergency: ['urgence', 'mosta3jel', 'مستعجل'],
  swelling: ['nafkha', 'نفخة', 'waram', 'ورم'],

  // Location / hours / price
  hours: ['horaire', 'horaires', 'wa9t', 'وقت', 'kat7ello', 'kat7elou', 'حالين'],
  location: ['localisation', 'adresse', 'cabinet', 'clinique', 'parking'],
  price: ['prix', 'taman', 'ثمن', 'cout', 'coût', 'combien'],

  // Cancel / reschedule
  cancel: ['annuler', 'nalghi', 'nlghi', 'نلغي', 'cancel', 'الغ'],
  reschedule: ['nbdl', 'nbddl', 'n7wel', 'نبدل', 'نحول', 'reporter', 'changer', 'reschedule'],
}

/** @type {Map<string, string>} form → concept */
const FORM_TO_CONCEPT = new Map()

function normalizeLexKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

for (const [concept, forms] of Object.entries(CONCEPT_FORMS)) {
  for (const form of forms) {
    const key = normalizeLexKey(form)
    if (key && !FORM_TO_CONCEPT.has(key)) FORM_TO_CONCEPT.set(key, concept)
  }
}

function conceptForToken(token) {
  const key = normalizeLexKey(token)
  if (!key) return null
  if (FORM_TO_CONCEPT.has(key)) return FORM_TO_CONCEPT.get(key)
  // Collapse repeated letters then retry: bghiiiiit → bghiit → bghit
  const collapsed2 = key.replace(/([a-zà-ÿ\u0600-\u06ff])\1{2,}/gi, '$1$1')
  if (collapsed2 !== key && FORM_TO_CONCEPT.has(collapsed2)) return FORM_TO_CONCEPT.get(collapsed2)
  const collapsed1 = key.replace(/([a-zà-ÿ\u0600-\u06ff])\1+/gi, '$1')
  if (collapsed1 !== key && FORM_TO_CONCEPT.has(collapsed1)) return FORM_TO_CONCEPT.get(collapsed1)
  return null
}

function extractConcepts(tokens = []) {
  const concepts = new Set()
  for (const token of tokens) {
    const c = conceptForToken(token)
    if (c) concepts.add(c)
  }
  // Multi-word forms (already split may miss "ba3d ghdda")
  return [...concepts]
}

function hasAllConcepts(concepts, required) {
  const set = new Set(concepts)
  return required.every((c) => set.has(c))
}

function hasAnyConcept(concepts, list) {
  const set = new Set(concepts)
  return list.some((c) => set.has(c))
}

module.exports = {
  CONCEPT_FORMS,
  FORM_TO_CONCEPT,
  normalizeLexKey,
  conceptForToken,
  extractConcepts,
  hasAllConcepts,
  hasAnyConcept,
}
