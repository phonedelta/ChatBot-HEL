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
  if (v === 'non_confirme' || v === 'non confirme' || v === 'non confirmé') return 'non confirmé'
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
