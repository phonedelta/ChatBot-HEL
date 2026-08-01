import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  RefreshCw,
  Settings2,
  Wifi,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import type { OverviewPayload, AppointmentOrder } from '@/lib/types'
import { formatStatus, todayISO, toDateISO } from '@/lib/format'
import { normalizeStatus } from '@/components/ui/StatusSelect'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const weekLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function weekdayLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`)
  return weekLabels[(d.getDay() + 6) % 7]
}

function lastSevenDays() {
  const days: string[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export function DashboardPage() {
  const { username } = useAuth()
  const [data, setData] = useState<OverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api<OverviewPayload>('/dashboard/api/overview')
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

  const chartData = useMemo(() => {
    const map = new Map((data?.weekly_appointments || []).map((row) => [row.day, row.count]))
    return lastSevenDays().map((iso) => ({
      day: weekdayLabel(iso),
      value: map.get(iso) || 0,
      iso,
    }))
  }, [data])

  const calendarDays = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const first = new Date(year, month, 1)
    const startPad = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<{ day: number | null; iso?: string; hasAppt?: boolean; count?: number }> = []
    for (let i = 0; i < startPad; i++) cells.push({ day: null })

    const counts = new Map<string, number>()
    for (const order of data?.month_appointments || data?.recent_orders || []) {
      const day = toDateISO(order.appointment_date)
      if (!day) continue
      // Calendar markers: confirmed appointments only (non confirmé excluded)
      if (normalizeStatus(order.status) !== 'confirmed') continue
      counts.set(day, (counts.get(day) || 0) + 1)
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const count = counts.get(iso) || 0
      cells.push({ day: d, iso, hasAppt: count > 0, count })
    }
    return cells
  }, [data])

  const topMotifs = useMemo(() => {
    const rows = data?.frequent_problems || []
    const max = Math.max(1, ...rows.map((r) => Number(r.count) || 0))
    return rows.slice(0, 6).map((row) => ({
      problem: row.problem || 'Autre',
      count: Number(row.count) || 0,
      percent: Math.round(((Number(row.count) || 0) / max) * 100),
    }))
  }, [data])

  const stats = [
    {
      title: 'Rendez-vous aujourd’hui',
      value: data?.stats.appointments_today ?? 0,
      hint: 'Aujourd’hui',
      tone: 'primary' as const,
      icon: CalendarDays,
      to: '/commandes',
    },
    {
      title: 'À confirmer',
      value: data?.stats.pending_appointments ?? 0,
      hint: 'En attente',
      tone: 'warning' as const,
      icon: CalendarClock,
      to: '/commandes',
    },
    {
      title: 'Confirmés à venir',
      value: data?.stats.crm_upcoming ?? 0,
      hint: 'RDV validés',
      tone: 'success' as const,
      icon: CalendarCheck2,
      to: '/commandes',
    },
    {
      title: 'Sessions connectées',
      value: data?.stats.instances_ready ?? 0,
      hint: `${data?.stats.instances_ready ?? 0}/${data?.stats.instances_total ?? 0} prêtes`,
      tone: (data?.stats.instances_ready ? 'success' : 'warning') as 'success' | 'warning',
      icon: Wifi,
      to: '/config',
    },
  ]

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-text sm:text-4xl">
            Bonjour {username || 'Admin'} 👋
          </h1>
          <p className="mt-1 text-muted">Bienvenue sur votre espace d’administration.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            Actualiser
          </Button>
          <Avatar name={username || 'Admin'} size="lg" />
        </div>
      </header>

      {error ? (
        <div className="rounded-[20px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)
          : stats.map((stat) => (
              <Link key={stat.title} to={stat.to} className="block min-w-0">
                <Card className="h-full cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <stat.icon className="h-5 w-5" />
                    </div>
                    <Badge tone={stat.tone}>{stat.hint}</Badge>
                  </div>
                  <p className="mt-4 text-sm text-muted">{stat.title}</p>
                  <p className="mt-1 font-display text-3xl text-text">{stat.value}</p>
                </Card>
              </Link>
            ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl">Calendrier</h2>
              <p className="text-sm text-muted">Rendez-vous du mois (données CRM)</p>
            </div>
            <Badge tone="primary">
              {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
            </Badge>
          </div>
          <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold text-muted">
            {weekLabels.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((cell, idx) => (
              <div
                key={idx}
                title={cell.count ? `${cell.count} rendez-vous` : undefined}
                className={`flex h-11 items-center justify-center rounded-2xl text-sm ${
                  cell.day == null
                    ? 'opacity-0'
                    : cell.iso === todayISO()
                      ? 'bg-gradient-to-br from-primary to-secondary font-semibold text-white shadow-[0_8px_18px_rgba(15,159,178,0.3)]'
                      : cell.hasAppt
                        ? 'border border-primary/30 bg-primary/5 font-medium text-primary'
                        : 'bg-[#f7fcfd] text-text'
                }`}
              >
                {cell.day}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Motifs fréquents</h2>
              <p className="text-sm text-muted">Demandes les plus courantes des patients</p>
            </div>
            <Badge tone="primary">{topMotifs.length} motifs</Badge>
          </div>
          <div className="space-y-4">
            {topMotifs.length ? (
              topMotifs.map((motif, i) => (
                <motion.div
                  key={`${motif.problem}-${i}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-text">{motif.problem}</p>
                    <span className="shrink-0 text-xs font-semibold text-primary">{motif.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#e8f6f8]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                      style={{ width: `${motif.percent}%` }}
                    />
                  </div>
                </motion.div>
              ))
            ) : (
              <p className="py-10 text-center text-sm text-muted">
                Aucun motif enregistré pour le moment.
              </p>
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl">Évolution hebdomadaire</h2>
              <p className="text-sm text-muted">Rendez-vous planifiés sur 7 jours</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="helArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F9FB2" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0F9FB2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} width={28} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 16,
                    border: '1px solid #DCEFF2',
                    boxShadow: '0 8px 24px rgba(16,42,67,0.08)',
                  }}
                />
                <Area type="monotone" dataKey="value" stroke="#0F9FB2" strokeWidth={3} fill="url(#helArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card padding="p-0" className="overflow-hidden">
          <div className="border-b border-border px-6 py-5">
            <h2 className="font-display text-2xl">Prochains rendez-vous</h2>
            <p className="text-sm text-muted">Patients à venir</p>
          </div>
          <div className="divide-y divide-border">
            {(data?.recent_orders || [])
              .filter((o) => o.full_name)
              .slice(0, 5)
              .map((order: AppointmentOrder) => (
                <div key={order.id} className="flex items-center gap-3 px-6 py-4">
                  <Avatar name={order.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{order.full_name}</p>
                    <p className="text-xs text-muted">
                      {order.appointment_date} · {order.appointment_time}
                    </p>
                  </div>
                  <StatusBadge value={order.status} label={formatStatus(order.status)} />
                </div>
              ))}
            {!loading && !(data?.recent_orders || []).filter((o) => o.full_name).length ? (
              <p className="px-6 py-10 text-center text-sm text-muted">Aucun rendez-vous à venir.</p>
            ) : null}
          </div>
          <div className="border-t border-border px-6 py-4">
            <Link to="/commandes">
              <Button variant="secondary" className="w-full">
                Voir tout
              </Button>
            </Link>
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl">Actions rapides</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
          {[
            { to: '/commandes', label: 'Gérer les rendez-vous', icon: CalendarDays, desc: 'Confirmer, modifier, supprimer' },
            { to: '/config', label: 'Configurer WhatsApp', icon: Settings2, desc: 'Instance, QR et connexion' },
          ].map((action) => (
            <Link key={action.label} to={action.to}>
              <Card className="h-full cursor-pointer">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <action.icon className="h-5 w-5" />
                </div>
                <p className="font-semibold text-text">{action.label}</p>
                <p className="mt-1 text-sm text-muted">{action.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
