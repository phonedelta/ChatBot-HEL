import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react'
import { api, getStoredToken } from '@/lib/api'
import { cn } from '@/lib/format'
import {
  formatHistoryChangePair,
  historyCategoryIcon,
  historyCategoryTint,
  HISTORY_GRID_CLASS,
  HISTORY_GRID_PAD,
} from '@/lib/history-ui'
import { PERMISSIONS } from '@/lib/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/Button'
import { EmptyState, PageHeader } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'
import { ActorBadge, type HistoryActor, type ExecutedByUser } from '@/components/history/ActorBadge'
import type { HistoryTargetUser } from '@/lib/history-ui'
import { HistoryDetailModal } from '@/components/history/HistoryDetailModal'

type ActivityItem = {
  id: number
  event_type: string
  category: string
  actor?: HistoryActor
  executedBy: ExecutedByUser | null
  targetUser?: HistoryTargetUser | null
  actor_type: string
  actor_name: string | null
  actor_label: string
  origin?: string | null
  source: string | null
  patient_id: number | null
  patient_name: string | null
  conversation_id: number | null
  appointment_id: number | null
  task_id: number | null
  title: string
  description: string | null
  severity: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  source_event_id?: string | null
  created_at: string
}

type HistoryPayload = {
  ok?: boolean
  items: ActivityItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    today: { total: number; ai: number; human: number; system: number }
    period: { total: number; ai: number; human: number; system: number }
    categories: Array<{ category: string; count: number }>
    errors?: number
  }
}

type ActorFilterGroup = {
  group: string
  items: Array<{
    id: string
    label: string
    type: string
    userId?: number
    role?: string
  }>
}

const PERIODS = [
  { days: 1, label: 'Aujourd’hui' },
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
] as const

const TYPE_FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'ai', label: 'Assistant IA' },
  { id: 'human', label: 'Équipe' },
  { id: 'appointment', label: 'Rendez-vous' },
  { id: 'followup', label: 'Relances' },
  { id: 'handoff', label: 'Handoffs' },
  { id: 'waitlist', label: 'Liste d’attente' },
  { id: 'patient', label: 'Patients' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'errors', label: 'Erreurs' },
] as const

function formatEventTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDayGroup(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Aujourd’hui'
  if (sameDay(d, yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function eventSecondaryLine(item: ActivityItem): string | null {
  const changeLine = formatHistoryChangePair(item.old_value, item.new_value)
  if (changeLine) return changeLine

  const desc = item.description?.trim()
  if (!desc) return null

  const parMatch = /^Par\s+(.+)$/i.exec(desc)
  if (parMatch) return null

  return desc
}

function HistoryColumnHeader() {
  return (
    <div
      className={cn(
        'hidden border-b border-border bg-[#F5FAFC] sm:grid sm:h-12 sm:items-center',
        HISTORY_GRID_CLASS,
        HISTORY_GRID_PAD,
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Heure</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Action</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Exécuté par</span>
      <span className="text-center text-xs font-semibold uppercase tracking-wide text-muted">Détails</span>
    </div>
  )
}
function buildQueryParams(sp: URLSearchParams) {
  const params = new URLSearchParams()
  const keys = ['days', 'type', 'actor', 'q', 'page', 'patientId', 'conversationId', 'appointmentId', 'from', 'to']
  for (const k of keys) {
    const v = sp.get(k)
    if (v) params.set(k, v)
  }
  return params
}

function SummaryCard({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'primary' | 'danger' }) {
  const tones = {
    default: 'text-navy',
    primary: 'text-primary',
    danger: 'text-danger',
  }
  return (
    <div className="rounded-2xl border border-border bg-white px-5 py-[18px] shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold', tones[tone])}>{value}</p>
    </div>
  )
}

function DayGroupHeader({ day, count }: { day: string; count: number }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-b border-border bg-white py-2.5', HISTORY_GRID_PAD)}>
      <h2 className="text-[15px] font-semibold text-navy">{day}</h2>
      <span className="text-xs text-muted">
        {count} action{count > 1 ? 's' : ''}
      </span>
    </div>
  )
}

function historyActorFromItem(item: ActivityItem): HistoryActor {
  if (item.actor?.displayName) return item.actor
  if (item.executedBy?.userId) {
    return {
      type: 'dashboard_user',
      userId: item.executedBy.userId,
      displayName: item.executedBy.displayName,
      role: item.executedBy.role,
      roleLabel: item.executedBy.roleLabel,
      initials: item.executedBy.initials,
    }
  }
  const raw = String(item.actor_type || '').toLowerCase()
  if (raw === 'assistant_ai' || raw === 'ai' || raw === 'patient' || raw === 'system') {
    return { type: 'assistant_ai', userId: null, displayName: 'Assistant IA' }
  }
  return {
    type: 'dashboard_user',
    userId: null,
    displayName: item.actor_label || item.actor_name || 'Utilisateur',
    role: null,
  }
}

function HistoryEventRow({ item, onSelect }: { item: ActivityItem; onSelect: () => void }) {
  const Icon = historyCategoryIcon(item.category, item.event_type)
  const tint = historyCategoryTint(item.category, item.severity)
  const secondaryLine = eventSecondaryLine(item)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left transition-colors duration-150 hover:bg-[#F8FCFD]',
        'flex flex-col gap-3 py-3 sm:grid sm:gap-0 sm:py-0',
        HISTORY_GRID_CLASS,
        HISTORY_GRID_PAD,
      )}
    >
      <div className="text-sm font-medium tabular-nums text-muted sm:py-3.5">
        {formatEventTime(item.created_at)}
      </div>

      <div className="flex min-w-0 items-start gap-3.5 sm:gap-4 sm:py-3.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-10 sm:w-10', tint)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-navy">{item.title}</p>
          {secondaryLine ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted">{secondaryLine}</p>
          ) : null}
          {item.patient_name ? (
            <p className="mt-1 text-sm text-navy/80">{item.patient_name}</p>
          ) : null}
        </div>
      </div>

      <div className="sm:py-3.5">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted sm:sr-only">Exécuté par</p>
        <ActorBadge actor={historyActorFromItem(item)} />
      </div>

      <div className="flex items-center justify-end sm:justify-center sm:py-3.5">
        <ChevronRight className="h-4 w-4 text-muted sm:mx-auto" aria-label="Voir le détail de l'action" />
      </div>
    </button>
  )
}

export function HistoryPage() {
  const { can } = usePermissions()
  const canExport = can(PERMISSIONS.EXPORT_HISTORY)
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<HistoryPayload | null>(null)
  const [actorGroups, setActorGroups] = useState<ActorFilterGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ActivityItem | null>(null)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')
  const requestRef = useRef(0)

  const days = Number(searchParams.get('days') || 7)
  const typeFilter = searchParams.get('type') || 'all'
  const actorFilter = searchParams.get('actor') || 'all'
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const patientId = searchParams.get('patientId')
  const conversationId = searchParams.get('conversationId')
  const appointmentId = searchParams.get('appointmentId')

  const setParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      if (key !== 'page') next.delete('page')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const load = useCallback(async (soft = false) => {
    const reqId = ++requestRef.current
    if (!soft) setLoading(true)
    setError('')
    try {
      const qs = buildQueryParams(searchParams)
      if (!qs.has('days') && !qs.has('from')) qs.set('days', String(days))
      if (typeFilter !== 'all') qs.set('type', typeFilter)
      if (actorFilter !== 'all') qs.set('actor', actorFilter)
      if (page > 1) qs.set('page', String(page))
      const payload = await api<HistoryPayload>(`/dashboard/api/history?${qs.toString()}`)
      if (reqId !== requestRef.current) return
      setData(payload)
    } catch (err) {
      if (reqId !== requestRef.current) return
      setError(err instanceof Error ? err.message : 'Erreur de chargement')
    } finally {
      if (reqId === requestRef.current) setLoading(false)
    }
  }, [searchParams, days, typeFilter, actorFilter, page])

  useEffect(() => {
    api<{ ok: boolean; groups: ActorFilterGroup[] }>('/dashboard/api/history/actors')
      .then((res) => setActorGroups(res.groups || []))
      .catch(() => setActorGroups([]))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setParam('q', searchInput.trim() || null), 300)
    return () => clearTimeout(t)
  }, [searchInput, setParam])

  useEffect(() => {
    load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityItem[]>()
    for (const item of data?.items || []) {
      const key = formatDayGroup(item.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries())
  }, [data?.items])

  const exportCsv = () => {
    const qs = buildQueryParams(searchParams)
    const token = getStoredToken()
    const url = `/dashboard/api/history/export.csv?${qs.toString()}${token ? `&token=${encodeURIComponent(token)}` : ''}`
    window.open(url, '_blank')
  }

  const printPdf = () => {
    window.print()
  }

  const resetFilters = () => {
    setSearchInput('')
    setSearchParams({}, { replace: true })
  }

  const pageTitle = patientId && data?.items?.[0]?.patient_name
    ? `Historique · ${data.items[0].patient_name}`
    : 'Historique'

  const statValue = (value: number | undefined) => {
    if (loading) return '—'
    if (error) return '—'
    return value ?? 0
  }

  const hasItems = (data?.items?.length || 0) > 0

  return (
    <div className="history-page space-y-5 animate-[fadeIn_280ms_ease] pb-8">
      <PageHeader
        title={pageTitle}
        subtitle="Journal d’audit des actions du cabinet — comptes dashboard et Assistant IA."
        actions={(
          <Button variant="secondary" size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Actualiser
          </Button>
        )}
      />

      {/* Résumé */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        <SummaryCard label="Actions aujourd’hui" value={statValue(data?.summary?.today?.total)} />
        <SummaryCard label="Équipe" value={statValue(data?.summary?.today?.human)} />
        <SummaryCard label="Assistant IA" value={statValue(data?.summary?.today?.ai)} tone="primary" />
        <SummaryCard label="Erreurs" value={statValue(data?.summary?.errors)} tone="danger" />
      </div>

      {/* Filtres */}
      <div className="space-y-3 rounded-2xl border border-border bg-white p-4 shadow-soft print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted">Période :</span>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setParam('days', String(p.days))}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                days === p.days ? 'bg-navy text-white' : 'bg-transparent text-muted hover:bg-cyan-tint/60',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setParam('type', f.id)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                typeFilter === f.id ? 'bg-navy text-white' : 'bg-[#F4F6F8] text-muted hover:text-navy',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={actorFilter}
            onChange={(e) => setParam('actor', e.target.value)}
            className="h-9 min-w-[160px] rounded-lg border border-border bg-white px-3 text-sm text-navy"
          >
            <option value="all">Tous les exécutants</option>
            {actorGroups.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher patient, action, acteur…"
              className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => load(true)} title="Actualiser">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          {canExport ? (
            <>
              <Button variant="ghost" size="sm" onClick={exportCsv} disabled={Boolean(error)}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={printPdf} disabled={!hasItems}>
                <Printer className="h-4 w-4" />
                PDF
              </Button>
            </>
          ) : null}
        </div>
        {(patientId || conversationId || appointmentId) ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Filtres actifs :</span>
            {patientId ? <span className="rounded-full bg-cyan-tint px-2 py-0.5 text-primary">Patient #{patientId}</span> : null}
            {conversationId ? <span className="rounded-full bg-cyan-tint px-2 py-0.5 text-primary">Conversation #{conversationId}</span> : null}
            {appointmentId ? <span className="rounded-full bg-cyan-tint px-2 py-0.5 text-primary">RDV #{appointmentId}</span> : null}
            <button type="button" onClick={resetFilters} className="text-primary hover:underline">Réinitialiser</button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-5 print:hidden">
          <p className="text-sm font-medium text-navy">Impossible de charger l’historique.</p>
          <p className="mt-1 text-xs text-muted">{error.includes('404') ? 'Le serveur doit être redémarré pour activer cette fonctionnalité.' : error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => load()}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="space-y-3 print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[88px] rounded-2xl" />)}
          </div>
          <Skeleton className="h-24 rounded-2xl" />
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[96px] rounded-2xl" />)}
        </div>
      ) : null}

      {!loading && !error && !hasItems ? (
        <EmptyState
          title="Aucune action trouvée"
          description="Aucune activité ne correspond aux filtres sélectionnés."
          action={<Button variant="secondary" onClick={resetFilters}>Réinitialiser les filtres</Button>}
        />
      ) : null}

      {!error && hasItems ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <HistoryColumnHeader />
          {grouped.map(([day, items]) => (
            <section key={day}>
              <DayGroupHeader day={day} count={items.length} />
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id}>
                    <HistoryEventRow item={item} onSelect={() => setSelected(item)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {!error && (data?.pagination?.totalPages || 1) > 1 ? (
        <div className="flex items-center justify-between print:hidden">
          <p className="text-xs text-muted">
            Page {data?.pagination?.page} / {data?.pagination?.totalPages} · {data?.pagination?.total} événements
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" disabled={page >= (data?.pagination?.totalPages || 1)} onClick={() => setParam('page', String(page + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <HistoryDetailModal item={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export default HistoryPage
