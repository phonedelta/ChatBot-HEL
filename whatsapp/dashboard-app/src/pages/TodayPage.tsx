import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  MessageSquareWarning,
  PhoneCall,
  RefreshCw,
  UserRoundSearch,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { formatStatus } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, PageHeader, StatCard } from '@/components/smart/PageBits'
import { StatusBadge } from '@/components/ui/Badge'

type TodayPayload = {
  ok: boolean
  clinic: { name: string }
  assistant: { name: string; active: boolean }
  attention: {
    waiting_reply: number
    to_confirm: number
    to_call: number
    transferred: number
  }
  kpis: {
    appointments_today: number
    confirmed: number
    pending: number
    cancelled: number
    available_slots?: number | null
  }
  agenda: Array<{
    id: number
    appointment_time: string
    full_name: string
    problem?: string
    status: string
    status_label?: string
  }>
  ai_activity: {
    messages_auto: number
    appointments_created: number
    followups_sent: number
    slots_recovered: number
    transferred: number
    recent: Array<{ id: number; action_type?: string; text?: string; at?: string; reason?: string; created_at?: string }>
  }
  frequent_requests: Array<{ problem: string; count: number }>
}

export function TodayPage() {
  const { user } = useAuth()
  const [data, setData] = useState<TodayPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api<TodayPayload>('/dashboard/api/today')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Impossible de charger Aujourd’hui"
        description={error}
        action={
          <Button onClick={() => void load()} icon={<RefreshCw className="h-4 w-4" />}>
            Réessayer
          </Button>
        }
      />
    )
  }

  const attention = data?.attention
  const kpis = data?.kpis

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bonjour, ${user?.displayName || 'équipe'}`}
        subtitle="Voici ce qui nécessite votre attention aujourd’hui."
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
            Actualiser
          </Button>
        }
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-accessible)]">
          À traiter maintenant
        </h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <AttentionCard
            icon={MessageSquareWarning}
            title="Patients attendant une réponse"
            count={attention?.waiting_reply || 0}
            to="/messages?status=TO_PROCESS"
            cta="Voir les messages"
            tone="warning"
          />
          <AttentionCard
            icon={CalendarCheck2}
            title="Rendez-vous à confirmer"
            count={attention?.to_confirm || 0}
            to="/agenda?status=non_confirme"
            cta="Confirmer"
            tone="info"
          />
          <AttentionCard
            icon={PhoneCall}
            title="Patients à rappeler"
            count={attention?.to_call || 0}
            to="/relances"
            cta="Voir les relances"
            tone="default"
          />
          <AttentionCard
            icon={UserRoundSearch}
            title="Demandes transférées"
            count={attention?.transferred || 0}
            to="/messages?status=TRANSFERRED"
            cta="Voir la demande"
            tone="danger"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-accessible)]">KPI du jour</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Rendez-vous du jour" value={kpis?.appointments_today || 0} />
          <StatCard label="Confirmés" value={kpis?.confirmed || 0} tone="success" />
          <StatCard label="À confirmer" value={kpis?.pending || 0} tone="warning" />
          <StatCard label="Annulations" value={kpis?.cancelled || 0} tone="danger" />
          <StatCard label="Créneaux disponibles" value={kpis?.available_slots ?? '—'} tone="info" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="card-surface order-1 p-4 sm:p-5 xl:col-span-2 xl:order-none">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-navy">Agenda du jour</h2>
            <Link to="/agenda" className="shrink-0 text-sm font-medium text-primary hover:underline">
              Voir l’agenda
            </Link>
          </div>
          {!data?.agenda?.length ? (
            <EmptyState
              title="Aucun rendez-vous aujourd’hui"
              description="Les nouveaux rendez-vous WhatsApp apparaîtront ici."
            />
          ) : (
            <ul className="space-y-2">
              {data.agenda.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy break-words">
                      {item.appointment_time} · {item.full_name}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted-accessible)]">{item.problem || 'Consultation'}</p>
                  </div>
                  <StatusBadge value={item.status} label={item.status_label || formatStatus(item.status)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card-surface p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-navy">Votre assistant IA aujourd’hui</h2>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <MiniMetric label="Messages auto" value={data?.ai_activity.messages_auto || 0} />
          <MiniMetric label="RDV créés" value={data?.ai_activity.appointments_created || 0} />
          <MiniMetric label="Relances" value={data?.ai_activity.followups_sent || 0} />
          <MiniMetric label="Créneaux récupérés" value={data?.ai_activity.slots_recovered || 0} />
        </div>
        <ul className="space-y-2">
          {(data?.ai_activity.recent || []).slice(0, 5).map((row) => (
            <li key={row.id} className="rounded-lg bg-bg px-3 py-2 text-xs text-[var(--color-muted-accessible)]">
              <span className="font-medium text-navy">{row.at || String(row.created_at || '').slice(11, 16)}</span>
              {' · '}
              {row.text || row.reason || row.action_type}
            </li>
          ))}
          {!data?.ai_activity.recent?.length ? (
            <li className="text-sm text-[var(--color-muted-accessible)]">Aucune action IA enregistrée aujourd’hui.</li>
          ) : null}
        </ul>
      </section>

      <section className="card-surface p-4 sm:p-5">
        <h2 className="mb-3 text-base font-semibold text-navy">Demandes fréquentes</h2>
        {!data?.frequent_requests?.length ? (
          <p className="text-sm text-[var(--color-muted-accessible)]">Pas encore assez de données pour afficher des tendances.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.frequent_requests.map((item) => (
              <span
                key={item.problem}
                className="rounded-full border border-border bg-cyan-tint px-3 py-1 text-sm text-navy"
              >
                {item.problem} · {item.count}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function AttentionCard({
  icon: Icon,
  title,
  count,
  to,
  cta,
  tone,
}: {
  icon: typeof MessageSquareWarning
  title: string
  count: number
  to: string
  cta: string
  tone: 'default' | 'warning' | 'info' | 'danger'
}) {
  const tones = {
    default: 'border-border',
    warning: 'border-warning/40 bg-warning/5',
    info: 'border-primary/40 bg-cyan-tint',
    danger: 'border-danger/40 bg-danger/5',
  }
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-soft ${tones[tone]}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-muted">{title}</p>
          <p className="mt-1 text-3xl font-semibold text-navy">{count}</p>
        </div>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <Link
        to={to}
        className="inline-flex items-center gap-1 text-sm font-semibold text-navy hover:text-primary"
      >
        {cta}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-lg font-semibold text-navy">{value}</p>
    </div>
  )
}
