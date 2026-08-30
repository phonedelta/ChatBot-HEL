import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  CalendarPlus,
  CircleCheck,
  MessageCircle,
  Minus,
  RefreshCw,
  UserRound,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'

type KpiMetric = {
  value: number
  previous?: number | null
  change_percent?: number | null
  change_absolute?: number | null
  detail?: string
}

type AnalyticsPayload = {
  ok?: boolean
  period?: {
    from: string
    to: string
    days: number
    previous_from?: string
    previous_to?: string
  }
  kpis?: {
    patient_messages?: KpiMetric
    auto_handled_rate?: KpiMetric
    appointments_created?: KpiMetric
    confirmation_rate?: KpiMetric
  }
  appointments_trend?: Array<{
    date?: string
    day?: string
    created: number
    confirmed: number
    pending?: number
    count?: number
  }>
  appointment_confirmation?: {
    created: number
    pending: number
    confirmation_messages_sent: number
    confirmed: number
    automatic_confirmed: number
  }
  automation?: {
    messages_handled_automatically: number
    automatic_followups: number
    automatic_confirmations: number
    handoffs: number
    handoff_rate: number
    auto_handled_rate: number
  }
  impact?: {
    automatic_confirmations: number
    followups_sent: number
    recovered_slots: number
    handoffs: number
    estimated_hours_saved?: number
  }
  top_intents?: Array<{ label: string; count: number; problem?: string }>
  frequent_requests?: Array<{ label?: string; problem?: string; count: number }>
  recent_activity?: Array<{
    id: number | string
    created_at: string
    action_type?: string
    reason?: string
    label: string
  }>
  watch?: Array<{ key: string; label: string; link?: string }>
  // legacy
  messages_patients?: number
  auto_handled_rate?: number
  appointments_created?: number
  confirmation_rate?: number
  volume_by_day?: Array<{ day: string; count: number }>
}

const PERIODS = [
  { days: 7, label: '7 j' },
  { days: 14, label: '14 j' },
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
] as const

function formatShortDate(iso: string) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  const month = months[Number(m[2]) - 1] || m[2]
  return `${Number(m[3])} ${month}`
}

function formatRelative(iso: string | null) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return 'à l’instant'
  if (mins < 60) return `il y a ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.round(hours / 24)} j`
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('fr-FR')
}

function DeltaBadge({
  changePercent,
  changeAbsolute,
  positiveIsGood = true,
}: {
  changePercent?: number | null
  changeAbsolute?: number | null
  positiveIsGood?: boolean
}) {
  const value = changePercent != null ? changePercent : changeAbsolute
  if (value == null) {
    return <span className="text-xs text-muted">—</span>
  }
  const up = value > 0
  const down = value < 0
  const good = positiveIsGood ? up : down
  const bad = positiveIsGood ? down : up
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  const label =
    changePercent != null
      ? `${up ? '+' : ''}${changePercent} % vs période précédente`
      : `${up ? '+' : ''}${changeAbsolute} vs période précédente`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        good && 'text-success',
        bad && 'text-danger',
        !good && !bad && 'text-muted',
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {changePercent != null
        ? `${up ? '+' : ''}${changePercent} %`
        : `${up ? '+' : ''}${changeAbsolute}`}
      <span className="sr-only">{label}</span>
    </span>
  )
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  iconClass,
  delta,
  loading,
}: {
  label: string
  value: string
  detail?: string
  icon: typeof MessageCircle
  iconClass: string
  delta?: ReactNode
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="min-h-[125px] rounded-2xl border border-border bg-white p-[18px]">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-8 w-20" />
        <Skeleton className="mt-3 h-3 w-36" />
      </div>
    )
  }
  return (
    <article className="group min-h-[125px] rounded-2xl border border-border bg-white p-[18px] transition-[transform,border-color] duration-200 hover:-translate-y-px hover:border-navy/25">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconClass)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight text-navy">{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta}
        {detail ? <p className="text-xs text-muted">{detail}</p> : null}
      </div>
    </article>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload: { created: number; confirmed: number; pending?: number } }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2 text-xs shadow-soft">
      <p className="font-semibold text-navy">{formatShortDate(String(label || ''))}</p>
      <p className="mt-1 text-muted">{row.created} rendez-vous créé{row.created > 1 ? 's' : ''}</p>
      <p className="text-muted">{row.confirmed} confirmé{row.confirmed > 1 ? 's' : ''}</p>
      <p className="text-muted">{row.pending || 0} à confirmer</p>
    </div>
  )
}

function ProgressBar({ value, max = 100, tone = 'cyan' }: { value: number; max?: number; tone?: 'cyan' | 'success' | 'warning' | 'muted' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 1000) / 10) : 0
  const colors = {
    cyan: 'bg-cyan',
    success: 'bg-success',
    warning: 'bg-warning',
    muted: 'bg-secondary/40',
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-cyan-tint" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-500', colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function AnalyticsPage() {
  const [days, setDays] = useState(14)
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const load = useCallback(async (periodDays: number, soft = false) => {
    const reqId = ++requestIdRef.current
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const payload = await api<AnalyticsPayload>(`/dashboard/api/analytics?days=${periodDays}`)
      if (reqId !== requestIdRef.current) return
      setData(payload)
      setLastUpdated(new Date().toISOString())
    } catch (err) {
      if (reqId !== requestIdRef.current) return
      setError(err instanceof Error ? err.message : 'Impossible de charger les analyses.')
      if (!soft) setData(null)
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load(days, true)
    }, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [days, load])

  const chartData = useMemo(() => {
    const rows = data?.appointments_trend?.length
      ? data.appointments_trend
      : data?.volume_by_day || []
    return rows.map((row) => {
      const anyRow = row as {
        date?: string
        day?: string
        created?: number
        confirmed?: number
        pending?: number
        count?: number
      }
      return {
        date: anyRow.date || anyRow.day || '',
        created: Number(anyRow.created ?? anyRow.count ?? 0),
        confirmed: Number(anyRow.confirmed ?? 0),
        pending: Number(anyRow.pending ?? 0),
      }
    })
  }, [data])

  const intents = useMemo(() => {
    const raw = data?.top_intents || data?.frequent_requests || []
    return raw.map((item) => ({
      label: item.label || item.problem || 'Autres demandes',
      count: Number(item.count || 0),
    }))
  }, [data])

  const maxIntent = Math.max(1, ...intents.map((i) => i.count))
  const kpis = data?.kpis
  const confirmation = data?.appointment_confirmation
  const automation = data?.automation
  const impact = data?.impact
  const hasAnyActivity =
    (kpis?.patient_messages?.value || 0) > 0 ||
    (kpis?.appointments_created?.value || 0) > 0 ||
    chartData.some((d) => d.created > 0)

  if (error && !data) {
    return (
      <EmptyState
        title="Impossible de charger les analyses."
        description={error}
        action={
          <Button variant="secondary" size="sm" onClick={() => void load(days)}>
            Réessayer
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-5 animate-[fadeIn_280ms_ease]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Analyses</h1>
          <p className="mt-1 text-sm text-muted">Activité patients, rendez-vous et automatisations</p>
          {lastUpdated ? (
            <p className="mt-1 text-xs text-muted">Dernière mise à jour {formatRelative(lastUpdated)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border bg-white p-1" role="group" aria-label="Période">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  days === p.days
                    ? 'bg-navy text-white'
                    : 'bg-transparent text-muted hover:bg-cyan-tint/60 hover:text-navy',
                )}
                aria-pressed={days === p.days}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            title="Actualiser les données"
            aria-label="Actualiser les données"
            disabled={refreshing || loading}
            onClick={() => void load(days, true)}
            icon={<RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />}
          />
        </div>
      </header>

      {/* 4 KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs principaux">
        <KpiCard
          loading={loading && !data}
          label="Messages patients"
          value={formatNumber(kpis?.patient_messages?.value ?? data?.messages_patients ?? 0)}
          icon={MessageCircle}
          iconClass="bg-cyan-tint text-cyan"
          delta={
            <DeltaBadge
              changePercent={kpis?.patient_messages?.change_percent}
              changeAbsolute={kpis?.patient_messages?.change_absolute}
            />
          }
        />
        <KpiCard
          loading={loading && !data}
          label="Traitement automatique"
          value={formatPercent(kpis?.auto_handled_rate?.value ?? data?.auto_handled_rate ?? 0)}
          detail={kpis?.auto_handled_rate?.detail}
          icon={Bot}
          iconClass="bg-[#EAF7F0] text-success"
          delta={<DeltaBadge changePercent={kpis?.auto_handled_rate?.change_percent} />}
        />
        <KpiCard
          loading={loading && !data}
          label="Rendez-vous créés"
          value={formatNumber(kpis?.appointments_created?.value ?? data?.appointments_created ?? 0)}
          icon={CalendarPlus}
          iconClass="bg-[#EEF3F8] text-navy-800"
          delta={
            <DeltaBadge
              changePercent={kpis?.appointments_created?.change_percent}
              changeAbsolute={kpis?.appointments_created?.change_absolute}
            />
          }
        />
        <KpiCard
          loading={loading && !data}
          label="Taux de confirmation"
          value={formatPercent(kpis?.confirmation_rate?.value ?? data?.confirmation_rate ?? 0)}
          detail={kpis?.confirmation_rate?.detail}
          icon={CircleCheck}
          iconClass="bg-[#EAF7F0] text-success"
          delta={<DeltaBadge changePercent={kpis?.confirmation_rate?.change_percent} />}
        />
      </section>

      {!loading && data && !hasAnyActivity ? (
        <EmptyState
          title="Pas encore assez d’activité pour cette période."
          description="Les indicateurs apparaîtront au fur et à mesure des interactions patients."
        />
      ) : (
        <>
          {/* Chart + Impact */}
          <section className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,0.8fr)]">
            <article className="card-surface p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-navy">Évolution des rendez-vous</h2>
                  <p className="mt-0.5 text-sm text-muted">Rendez-vous créés et confirmés sur la période</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan" /> Créés
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-success" /> Confirmés
                  </span>
                </div>
              </div>
              {loading && !data ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (
                <div className="h-[300px] w-full" role="img" aria-label="Graphique des rendez-vous créés et confirmés par jour">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="helCreated" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#13AEC1" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#13AEC1" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="helConfirmed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#20B26B" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#20B26B" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#DCEAF0" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatShortDate}
                        tick={{ fontSize: 11, fill: '#708299' }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={28}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#708299' }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Area
                        type="linear"
                        dataKey="created"
                        name="Créés"
                        stroke="#13AEC1"
                        strokeWidth={2}
                        fill="url(#helCreated)"
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={!refreshing}
                      />
                      <Area
                        type="linear"
                        dataKey="confirmed"
                        name="Confirmés"
                        stroke="#20B26B"
                        strokeWidth={2}
                        fill="url(#helConfirmed)"
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={!refreshing}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article className="card-surface flex flex-col p-4 sm:p-5">
              <h2 className="text-base font-semibold text-navy">Impact opérationnel</h2>
              <p className="mt-0.5 text-sm text-muted">Valeur créée par l’assistant sur la période</p>
              {loading && !data ? (
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-border">
                  {[
                    {
                      icon: CircleCheck,
                      value: impact?.automatic_confirmations ?? 0,
                      label: 'Confirmations automatiques',
                      link: null as string | null,
                    },
                    {
                      icon: MessageCircle,
                      value: impact?.followups_sent ?? 0,
                      label: 'Relances envoyées',
                      link: '/relances',
                    },
                    {
                      icon: CalendarCheck,
                      value: impact?.recovered_slots ?? 0,
                      label: 'Créneaux récupérés',
                      link: '/agenda',
                    },
                    {
                      icon: UserRound,
                      value: impact?.handoffs ?? 0,
                      label: 'Conversations transférées',
                      link: '/messages?status=TRANSFERRED',
                    },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-tint text-cyan">
                        <row.icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold text-navy">{formatNumber(row.value)}</p>
                        <p className="text-xs text-muted">{row.label}</p>
                      </div>
                      {row.link && row.value > 0 ? (
                        <Link to={row.link} className="text-xs font-medium text-cyan hover:underline">
                          Voir
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {impact?.estimated_hours_saved != null && impact.estimated_hours_saved > 0 ? (
                <p className="mt-auto border-t border-border pt-3 text-xs text-muted">
                  Temps estimé économisé :{' '}
                  <span className="font-semibold text-navy">
                    {impact.estimated_hours_saved.toLocaleString('fr-FR')} h
                  </span>
                  <span className="block text-[11px] text-muted/80">
                    Formule : actions automatiques × minutes configurées
                  </span>
                </p>
              ) : null}
            </article>
          </section>

          {/* Confirmation + Automation */}
          <section className="grid gap-3 lg:grid-cols-2">
            <article className="card-surface p-4 sm:p-5">
              <h2 className="text-base font-semibold text-navy">Confirmation des rendez-vous</h2>
              <p className="mt-0.5 text-sm text-muted">Suivi du parcours de confirmation</p>
              {loading && !data ? (
                <Skeleton className="mt-4 h-24 w-full" />
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-stretch gap-2">
                    {[
                      { label: 'Créés', value: confirmation?.created ?? 0 },
                      { label: 'À confirmer', value: confirmation?.pending ?? 0 },
                      { label: 'Messages', value: confirmation?.confirmation_messages_sent ?? 0 },
                      { label: 'Confirmés', value: confirmation?.confirmed ?? 0 },
                    ].map((step, idx, arr) => (
                      <div key={step.label} className="flex min-w-[88px] flex-1 items-center gap-2">
                        <div className="flex-1 rounded-xl bg-[#F5FAFC] px-3 py-3 text-center">
                          <p className="text-xl font-semibold text-navy">{formatNumber(step.value)}</p>
                          <p className="mt-0.5 text-[11px] text-muted">{step.label}</p>
                        </div>
                        {idx < arr.length - 1 ? (
                          <ArrowRight className="hidden h-4 w-4 shrink-0 text-border sm:block" aria-hidden />
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-muted">
                    Confirmation automatique ·{' '}
                    <span className="font-medium text-navy">
                      {formatNumber(confirmation?.automatic_confirmed ?? 0)} confirmée
                      {(confirmation?.automatic_confirmed ?? 0) > 1 ? 's' : ''} automatiquement
                    </span>
                  </p>
                  {(confirmation?.pending ?? 0) > 0 ? (
                    <Link
                      to="/relances?category=unconfirmed"
                      className="mt-2 inline-flex text-sm font-medium text-cyan hover:underline"
                    >
                      Voir dans Relances
                    </Link>
                  ) : null}
                </>
              )}
            </article>

            <article className="card-surface p-4 sm:p-5">
              <h2 className="text-base font-semibold text-navy">Automatisation</h2>
              <p className="mt-0.5 text-sm text-muted">Ce que l’IA gère sans intervention</p>
              {loading && !data ? (
                <Skeleton className="mt-4 h-32 w-full" />
              ) : (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-muted">Traitement automatique</span>
                      <span className="font-semibold text-navy">
                        {formatPercent(automation?.auto_handled_rate ?? 0)}
                      </span>
                    </div>
                    <ProgressBar value={automation?.auto_handled_rate ?? 0} tone="cyan" />
                    <p className="mt-1 text-xs text-muted">
                      {formatNumber(automation?.messages_handled_automatically ?? 0)} réponses automatiques
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-[#F5FAFC] px-3 py-2.5">
                      <p className="text-lg font-semibold text-navy">
                        {formatNumber(automation?.automatic_confirmations ?? 0)}
                      </p>
                      <p className="text-xs text-muted">Confirmations auto</p>
                    </div>
                    <div className="rounded-xl bg-[#F5FAFC] px-3 py-2.5">
                      <p className="text-lg font-semibold text-navy">
                        {formatNumber(automation?.automatic_followups ?? 0)}
                      </p>
                      <p className="text-xs text-muted">Relances auto</p>
                    </div>
                  </div>
                </div>
              )}
            </article>
          </section>

          <section>
            <article className="card-surface p-4 sm:p-5">
              <h2 className="text-base font-semibold text-navy">Demandes fréquentes</h2>
              <p className="mt-0.5 text-sm text-muted">Ce que les patients demandent le plus</p>
              {loading && !data ? (
                <Skeleton className="mt-4 h-40 w-full" />
              ) : !intents.length ? (
                <p className="mt-6 text-sm text-muted">Aucune donnée suffisante sur cette période.</p>
              ) : (
                <ul className="mt-4 max-w-2xl space-y-3">
                  {intents.map((item) => (
                    <li key={item.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-navy">{item.label}</span>
                          <span className="text-sm font-semibold text-navy">{item.count}</span>
                        </div>
                        <ProgressBar value={item.count} max={maxIntent} tone="cyan" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  )
}
