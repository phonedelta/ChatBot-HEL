/**
 * Controlled Latin → Arabic display transliteration for Moroccan person names.
 * Never overwrites the CRM Latin original; returns null when too uncertain.
 */

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z']/g, '')
}

/** Frequent Moroccan given / family name tokens. */
const NAME_TOKEN_AR = {
  // Given names
  salim: 'سليم',
  selim: 'سليم',
  saleem: 'سليم',
  yassine: 'ياسين',
  yasin: 'ياسين',
  yasine: 'ياسين',
  fatima: 'فاطمة',
  fatma: 'فاطمة',
  mohamed: 'محمد',
  mohammed: 'محمد',
  muhammad: 'محمد',
  ahmed: 'أحمد',
  ahmad: 'أحمد',
  hamza: 'حمزة',
  amine: 'أمين',
  amin: 'أمين',
  sara: 'سارة',
  sarah: 'سارة',
  imane: 'إيمان',
  iman: 'إيمان',
  nouhaila: 'نهيلة',
  aya: 'آية',
  maryam: 'مريم',
  meriem: 'مريم',
  omar: 'عمر',
  karim: 'كريم',
  bilal: 'بلال',
  youssef: 'يوسف',
  yusuf: 'يوسف',
  hassan: 'حسن',
  hussein: 'حسين',
  hicham: 'هشام',
  rachid: 'رشيد',
  rashid: 'رشيد',
  said: 'سعيد',
  saad: 'سعد',
  nadia: 'نادية',
  khadija: 'خديجة',
  aicha: 'عائشة',
  // Family names
  zouhairi: 'زهيري',
  zouheiri: 'زهيري',
  zohairi: 'زهيري',
  zouhair: 'زهير',
  alaoui: 'علوي',
  alawi: 'علوي',
  alami: 'علمي',
  idrissi: 'إدريسي',
  idrisi: 'إدريسي',
  bennani: 'بناني',
  benani: 'بناني',
  amrani: 'عمراني',
  elamrani: 'العمراني',
  filali: 'هلالي',
  chraibi: 'الشرايبي',
  tazi: 'التازي',
  fassi: 'فاسي',
  berada: 'برادة',
  sqalli: 'السقلّي',
}

/**
 * @param {string} fullName Latin or mixed full name
 * @returns {string|null} Arabic display form, or null if incomplete/uncertain
 */
function transliterateNameToArabic(fullName) {
  const raw = collapseSpaces(fullName)
  if (!raw) return null
  if (/^[\u0600-\u06FF\s'-]+$/u.test(raw)) return raw

  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null

  const out = []
  for (const part of parts) {
    if (/[\u0600-\u06FF]/.test(part)) {
      out.push(part)
      continue
    }
    const key = normalizeToken(part)
    const mapped = NAME_TOKEN_AR[key]
    if (!mapped) return null
    out.push(mapped)
  }
  return out.join(' ')
}

/**
 * Prefer explicit Arabic graphie, else deterministic transliteration, else Latin.
 */
function displayNameArabic(fullName, options = {}) {
  const explicit = collapseSpaces(options.arabicName || '')
  if (explicit && /[\u0600-\u06FF]/.test(explicit)) return explicit
  const raw = collapseSpaces(fullName)
  if (!raw) return ''
  if (/[\u0600-\u06FF]/.test(raw) && !/[A-Za-z]/.test(raw)) return raw
  return transliterateNameToArabic(raw) || raw
}

module.exports = {
  NAME_TOKEN_AR,
  transliterateNameToArabic,
  displayNameArabic,
}
