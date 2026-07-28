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
  if (v === 'confirmed' || v === 'confirmé' || v === 'confirme') return 'Confirmé'
  if (v === 'cancelled' || v === 'annule' || v === 'annulé') return 'Annulé'
  if (v === 'traitee') return 'Traitée'
  if (v === 'en_attente') return 'En attente'
  if (v === 'ready') return 'Prête'
  if (v === 'authenticated') return 'Authentifiée'
  if (v === 'qr') return 'QR requis'
  if (v === 'disconnected') return 'Déconnectée'
  if (v === 'initializing') return 'Initialisation'
  return 'Non confirmé'
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

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}
