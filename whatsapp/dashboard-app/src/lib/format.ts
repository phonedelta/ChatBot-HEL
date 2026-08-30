export function initials(name?: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function formatStatus(value?: string | null) {
  const v = String(value || '').toLowerCase()
  if (v === 'non_confirme' || v === 'non confirme' || v === 'non confirmé' || v === 'en attente') return 'À confirmer'
  if (v === 'confirmed' || v === 'confirmé' || v === 'confirme') return 'Confirmé'
  if (v === 'cancelled' || v === 'annule' || v === 'annulé') return 'Annulé'
  if (v === 'traitee') return 'Traitée'
  if (v === 'en_attente') return 'En attente'
  if (v === 'ready') return 'Prête'
  if (v === 'authenticated') return 'Authentifiée'
  if (v === 'qr') return 'QR requis'
  if (v === 'disconnected') return 'Déconnectée'
  if (v === 'initializing') return 'Initialisation'
  if (v === 'recovering') return 'Récupération'
  if (v === 'missing') return 'Absente'
  return value ? String(value) : 'Inconnu'
}

export function statusTone(value?: string | null): 'success' | 'warning' | 'danger' | 'muted' {
  const v = String(value || '').toLowerCase()
  if (v === 'confirmed' || v === 'confirmé' || v === 'confirme' || v === 'ready' || v === 'authenticated' || v === 'traitee') {
    return 'success'
  }
  if (v === 'cancelled' || v === 'annule' || v === 'annulé' || v === 'disconnected') return 'danger'
  if (v === 'qr' || v === 'initializing' || v === 'non_confirme' || !v) return 'warning'
  return 'warning'
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** Local calendar date YYYY-MM-DD (Morocco-safe, not UTC). */
export function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Normalize any date-like value to YYYY-MM-DD. */
export function toDateISO(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

/** True when appointment_date is today (local). */
export function isTodayDate(value?: string | null) {
  return toDateISO(value) === todayISO()
}

export function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

/** Moroccan mobile display: +212 6 61 24 88 03 */
export function formatPhone(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw || raw === 'Numéro non identifié') return raw || 'Numéro non identifié'
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('212') && digits.length === 12) {
    const local = digits.slice(3)
    return `+212 ${local[0]} ${local.slice(1, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`.trim()
  }
  if (raw.startsWith('+')) return raw
  return raw
}

function parseLocalDate(value?: string | null) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatTimeShort(value?: string | null) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return raw.slice(0, 5)
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

/** Aujourd’hui à 14:30 · Demain à … · 29 août à … */
export function formatAppointmentDate(dateIso?: string | null, timeStr?: string | null) {
  const date = String(dateIso || '').slice(0, 10)
  const time = formatTimeShort(timeStr)
  if (!date) return '—'
  const today = todayISO()
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`
  const prefix = date === today
    ? 'Aujourd’hui'
    : date === tomorrow
      ? 'Demain'
      : parseLocalDate(date)?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) || date
  return time ? `${prefix} à ${time}` : prefix
}

/** Compact slot label: 5 sept. · 09:30 · Demain · 11:00 */
export function formatAppointmentSlot(dateIso?: string | null, timeStr?: string | null) {
  const date = String(dateIso || '').slice(0, 10)
  const time = formatTimeShort(timeStr)
  if (!date) return '—'
  const today = todayISO()
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`
  let day: string
  if (date === today) day = 'Aujourd’hui'
  else if (date === tomorrow) day = 'Demain'
  else {
    const d = parseLocalDate(date)
    day = d
      ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace(/\.$/, '')
      : date
  }
  return time ? `${day} · ${time}` : day
}

/** Aujourd’hui · WhatsApp · Hier · WhatsApp · 26 août · WhatsApp */
export function formatLastContact(iso?: string | null, channel = 'whatsapp') {
  const raw = String(iso || '').trim()
  if (!raw) return '—'
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return '—'
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  let day: string
  if (sameDay(d, today)) day = 'Aujourd’hui'
  else if (sameDay(d, yesterday)) day = 'Hier'
  else day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const ch = channel === 'whatsapp' ? 'WhatsApp' : channel
  return `${day} · ${ch}`
}

export function getLanguageLabel(value?: string | null) {
  const v = String(value || '').toLowerCase()
  if (v === 'darija' || v === 'ar' || v === 'darija_arab') return 'Darija'
  if (v === 'fr' || v === 'french' || !v) return 'Français'
  if (v === 'en') return 'Anglais'
  return String(value)
}

export function getSourceLabel(value?: string | null) {
  const v = String(value || '').toLowerCase()
  if (!v || v.includes('whatsapp')) return 'WhatsApp'
  if (v.includes('website') || v.includes('form')) return 'Formulaire du site'
  if (v.includes('manual') || v.includes('dashboard') || v.includes('staff')) return 'Saisie manuelle'
  return 'WhatsApp'
}

export function isSafePhone(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (/@lid/i.test(raw) || /@c\.us/i.test(raw)) return false
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 15
}
