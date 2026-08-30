/**
 * Morocco-only city resolver (whitelist + aliases + light fuzzy match).
 * Never invents a city outside this catalogue.
 */

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Canonical Moroccan cities with Latin + Arabic aliases (incl. common typos). */
const MOROCCO_CITY_ENTRIES = [
  {
    canonical: 'Casablanca',
    aliases: [
      'casablanca', 'casa', 'casablanca maroc', 'casablanca morocco',
      'الدار البيضاء', 'دار البيضاء', 'كازا', 'كازابلانكا',
      'el oulfa', 'oulfa', 'ain sebaa', 'ain diab', 'maarif', 'sidi maarouf',
      'hay hassani', 'ayn sebaa',
    ],
  },
  {
    canonical: 'Rabat',
    aliases: ['rabat', 'الرباط', 'رباط'],
  },
  {
    canonical: 'Salé',
    aliases: ['sale', 'salé', 'سلا'],
  },
  {
    canonical: 'Témara',
    aliases: ['temara', 'témara', 'تمارة'],
  },
  {
    canonical: 'Kénitra',
    aliases: [
      'kenitra', 'kénitra', 'kentra', 'knetra', 'kentira', 'qnitra',
      'القنيطرة', 'قنيطرة',
    ],
  },
  {
    canonical: 'Marrakech',
    aliases: ['marrakech', 'marrakesh', 'marrakch', 'مراكش'],
  },
  {
    canonical: 'Fès',
    aliases: ['fes', 'fès', 'fez', 'فاس'],
  },
  {
    canonical: 'Meknès',
    aliases: ['meknes', 'meknès', 'meknez', 'مكناس'],
  },
  {
    canonical: 'Tanger',
    aliases: ['tanger', 'tangier', 'tanja', 'طنجة'],
  },
  {
    canonical: 'Tétouan',
    aliases: ['tetouan', 'tétouan', 'titwan', 'تطوان'],
  },
  {
    canonical: 'Agadir',
    aliases: ['agadir', 'أكادير', 'اكادير'],
  },
  {
    canonical: 'Oujda',
    aliases: ['oujda', 'وجدة'],
  },
  {
    canonical: 'Nador',
    aliases: ['nador', 'الناظور', 'ناظور'],
  },
  {
    canonical: 'El Jadida',
    aliases: ['el jadida', 'jadida', 'الجديدة'],
  },
  {
    canonical: 'Safi',
    aliases: ['safi', 'آسفي', 'اسفي'],
  },
  {
    canonical: 'Mohammedia',
    aliases: ['mohammedia', 'mohammadia', 'المحمدية'],
  },
  {
    canonical: 'Beni Mellal',
    aliases: ['beni mellal', 'beni-mellal', 'بني ملال'],
  },
  {
    canonical: 'Khouribga',
    aliases: ['khouribga', 'خريبكة'],
  },
  {
    canonical: 'Settat',
    aliases: ['settat', 'سطات'],
  },
  {
    canonical: 'Berrechid',
    aliases: ['berrechid', 'برشيد'],
  },
  {
    canonical: 'Larache',
    aliases: ['larache', 'العرائش'],
  },
  {
    canonical: 'Essaouira',
    aliases: ['essaouira', 'الصويرة'],
  },
  {
    canonical: 'Ouarzazate',
    aliases: ['ouarzazate', 'ورزازات'],
  },
  {
    canonical: 'Ifrane',
    aliases: ['ifrane', 'ifran', 'إفران', 'افران'],
  },
  {
    canonical: 'Khemisset',
    aliases: ['khemisset', 'khémisset', 'الخميسات'],
  },
  {
    canonical: 'Taza',
    aliases: ['taza', 'تازة'],
  },
  {
    canonical: 'Errachidia',
    aliases: ['errachidia', 'rachidia', 'الرشيدية'],
  },
  {
    canonical: 'Guelmim',
    aliases: ['guelmim', 'كلميم'],
  },
  {
    canonical: 'Laâyoune',
    aliases: ['laayoune', 'laâyoune', 'el aioun', 'العيون'],
  },
  {
    canonical: 'Dakhla',
    aliases: ['dakhla', 'الداخلة'],
  },
  {
    canonical: 'Tiznit',
    aliases: ['tiznit', 'تيزنيت'],
  },
  {
    canonical: 'Taroudant',
    aliases: ['taroudant', 'تارودانت'],
  },
  {
    canonical: 'Beni Ansar',
    aliases: ['beni ansar', 'بني انصار'],
  },
  {
    canonical: 'Fnideq',
    aliases: ['fnideq', 'fnidek', 'الفنيدق'],
  },
  {
    canonical: 'Martil',
    aliases: ['martil', 'مرتيل'],
  },
  {
    canonical: 'Ouazzane',
    aliases: ['ouazzane', 'wazzane', 'وزان'],
  },
  {
    canonical: 'Sidi Kacem',
    aliases: ['sidi kacem', 'سيدي قاسم'],
  },
  {
    canonical: 'Sidi Slimane',
    aliases: ['sidi slimane', 'سيدي سليمان'],
  },
  {
    canonical: 'Youssoufia',
    aliases: ['youssoufia', 'اليوسفية'],
  },
  {
    canonical: 'Kalaat Sraghna',
    aliases: ['kalaat sraghna', 'قلعة السراغنة'],
  },
  {
    canonical: 'Midelt',
    aliases: ['midelt', 'ميدلت'],
  },
  {
    canonical: 'Azrou',
    aliases: ['azrou', 'أزرو'],
  },
  {
    canonical: 'Chefchaouen',
    aliases: ['chefchaouen', 'chaouen', 'شفشاون'],
  },
  {
    canonical: 'Al Hoceima',
    aliases: ['al hoceima', 'hoceima', 'الحسيمة'],
  },
]

const ALIAS_TO_CANONICAL = new Map()
const FUZZY_CANDIDATES = []

for (const entry of MOROCCO_CITY_ENTRIES) {
  const keys = new Set([normalizeKey(entry.canonical), ...entry.aliases.map(normalizeKey)])
  for (const key of keys) {
    if (!key) continue
    ALIAS_TO_CANONICAL.set(key, entry.canonical)
    if (key.length >= 4 && !/[\u0600-\u06FF]/.test(key)) {
      FUZZY_CANDIDATES.push({ key, canonical: entry.canonical })
    }
  }
}

/** Flat list kept for substring scans (longer aliases first). */
const MOROCCAN_CITY_TOKENS = Array.from(ALIAS_TO_CANONICAL.keys())
  .sort((a, b) => b.length - a.length)

function levenshtein(a, b) {
  const s = String(a || '')
  const t = String(b || '')
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length
  const row = new Array(t.length + 1)
  for (let j = 0; j <= t.length; j += 1) row[j] = j
  for (let i = 1; i <= s.length; i += 1) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= t.length; j += 1) {
      const temp = row[j]
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = temp
    }
  }
  return row[t.length]
}

function fuzzyResolve(key) {
  if (!key || key.length < 5) return null
  const maxDist = key.length >= 8 ? 2 : 1
  let best = null
  let bestDist = Infinity
  for (const cand of FUZZY_CANDIDATES) {
    if (Math.abs(cand.key.length - key.length) > maxDist) continue
    const d = levenshtein(key, cand.key)
    if (d < bestDist && d <= maxDist) {
      bestDist = d
      best = cand.canonical
    }
  }
  return best
}

/**
 * Resolve free text to a canonical Moroccan city, or null.
 * Never invents outside the whitelist.
 */
function resolveMoroccanCity(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const key = normalizeKey(raw)
  if (!key) return null
  if (ALIAS_TO_CANONICAL.has(key)) return ALIAS_TO_CANONICAL.get(key)

  // Prefer longest alias contained as a whole token / phrase
  for (const token of MOROCCAN_CITY_TOKENS) {
    if (token.length < 3) continue
    if (key === token) return ALIAS_TO_CANONICAL.get(token)
    if (key.includes(token)) {
      const re = new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
      if (re.test(` ${key} `)) return ALIAS_TO_CANONICAL.get(token)
    }
  }

  return fuzzyResolve(key)
}

function isKnownMoroccanCity(value) {
  return Boolean(resolveMoroccanCity(value))
}

function listMoroccanCityMentions(text) {
  const key = normalizeKey(text)
  if (!key) return []
  const found = []
  const seen = new Set()
  for (const token of MOROCCAN_CITY_TOKENS) {
    if (token.length < 3) continue
    const re = new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`)
    if (!re.test(` ${key} `) && !key.includes(token)) continue
    if (!re.test(` ${key} `) && token.length < 4) continue
    if (!key.includes(token)) continue
    const canonical = ALIAS_TO_CANONICAL.get(token)
    if (!canonical || seen.has(canonical)) continue
    seen.add(canonical)
    found.push(canonical)
  }
  return found
}

module.exports = {
  MOROCCO_CITY_ENTRIES,
  MOROCCAN_CITY_TOKENS,
  normalizeKey,
  resolveMoroccanCity,
  isKnownMoroccanCity,
  listMoroccanCityMentions,
}
