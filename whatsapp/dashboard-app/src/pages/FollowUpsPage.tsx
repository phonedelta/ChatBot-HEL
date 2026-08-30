import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CalendarClock,
  CalendarX,
  FileText,
  MessageCircle,
  Phone,
  RefreshCw,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { cn, initials } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'

type FollowupStatusKey = 'no_response' | 'callback' | 'planned' | 'waiting' | 'reschedule' | 'admin' | string

type FollowupItem = {
  id: string | number
  kind?: string
  category: string
  appointment_id?: number | null
  patient_id?: number | null
  patient_name?: string | null
  patient_phone?: string | null
  phone_display?: string | null
  appointment_label?: string | null
  appointment_date?: string | null
  appointment_time?: string | null
  activity?: string | null
  status_key?: FollowupStatusKey
  status_label?: string | null
  conversation_id?: number | null
  task_id?: number | null
  requires_validation?: boolean
  actions?: {
    remind?: boolean
    call?: boolean
    open_patient?: boolean
    open_agenda?: boolean
    open_messages?: boolean
    reschedule?: boolean
    complete_task?: boolean
  }
}

type CategoryKey = 'unconfirmed' | 'no_response' | 'reschedule' | 'callback' | 'administrative'

type FollowUpsPayload = {
  ok?: boolean
  category?: CategoryKey
  items: FollowupItem[]
  counts: {
    unconfirmed: number
    no_response: number
    reschedule: number
    callback: number
    administrative: number
  }
  categories: Record<string, { label: string; count: number; items: FollowupItem[] }>
  summary: {
    total_prepared: number
    requires_validation: number
    badge_count: number
  }
  automations_explained: Array<{ title: string; when: string; then: string; active?: boolean }>
  automation_summary?: Record<string, { title: string; when: string; then: string; active: boolean }>
  impact: {
    unconfirmed_change_percent: number | null
    recovered_slots: number
    estimated_hours_saved: number
  }
  requiresValidation?: number
}

const CATEGORY_CARDS: Array<{
  key: CategoryKey
  label: string
  icon: typeof CalendarClock
  countKey: keyof FollowUpsPayload['counts']
  activeClass: string
  iconClass: string
}> = [
  {
    key: 'unconfirmed',
    label: 'Rendez-vous non confirmés',
    icon: CalendarClock,
    countKey: 'unconfirmed',
    activeClass: 'border-warning bg-[#FFF9EF]',
    iconClass: 'bg-warning/15 text-warning',
  },
  {
    key: 'no_response',
    label: 'Patients sans réponse',
    icon: MessageCircle,
    countKey: 'no_response',
    activeClass: 'border-danger/40 bg-danger/5',
    iconClass: 'bg-danger/10 text-danger',
  },
  {
    key: 'reschedule',
    label: 'Annulés à reprogrammer',
    icon: CalendarX,
    countKey: 'reschedule',
    activeClass: 'border-primary/40 bg-cyan-tint',
    iconClass: 'bg-cyan-tint text-primary',
  },
  {
    key: 'callback',
    label: 'Patients à rappeler',
    icon: Phone,
    countKey: 'callback',
    activeClass: 'border-navy/30 bg-navy/5',
    iconClass: 'bg-navy/10 text-navy',
  },
  {
    key: 'administrative',
    label: 'Demandes administratives',
    icon: FileText,
    countKey: 'administrative',
    activeClass: 'border-primary/30 bg-[#F0F7FA]',
    iconClass: 'bg-[#E8F2F7] text-navy-800',
  },
]

const EMPTY_COPY: Record<CategoryKey, { title: string; description: string }> = {
  unconfirmed: {
    title: 'Aucun rendez-vous non confirmé',
    description: 'Tous les rendez-vous concernés sont à jour.',
  },
  no_response: {
    title: 'Aucun patient en attente de réponse',
    description: 'Aucune relance en cours sans retour patient.',
  },
  reschedule: {
    title: 'Aucune reprogrammation en attente',
    description: 'Les annulations à reprogrammer apparaîtront ici.',
  },
  callback: {
    title: 'Aucun patient à rappeler',
    description: 'Les tâches assistante 24 h apparaîtront ici.',
  },
  administrative: {
    title: 'Aucune demande administrative',
    description: 'Les demandes nécessitant une intervention apparaîtront ici.',
  },
}

function statusPillClass(key?: string | null) {
  switch (key) {
    case 'callback':
      return 'bg-danger/10 text-danger'
    case 'planned':
      return 'bg-cyan-tint text-primary'
    case 'reschedule':
      return 'bg-cyan-tint text-primary'
    case 'admin':
      return 'bg-[#E8F2F7] text-navy-800'
    case 'no_response':
    case 'waiting':
    default:
      return 'bg-warning/10 text-warning'
  }
}

function CyanAvatar({ name }: { name?: string | null }) {
  return (
    <div className="inline-flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-cyan-tint text-[11px] font-semibold text-primary">
      {initials(name)}
    </div>
  )
}

export function FollowUpsPage() {
  const { can } = usePermissions()
  const canSendFollowup = can(PERMISSIONS.SEND_MANUAL_FOLLOWUP)
  const canValidateFollowups = can(PERMISSIONS.VALIDATE_FOLLOWUPS)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const categoryParam = (searchParams.get('category') || 'unconfirmed') as CategoryKey
  const category = CATEGORY_CARDS.some((c) => c.key === categoryParam) ? categoryParam : 'unconfirmed'

  const [data, setData] = useState<FollowUpsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busyId, setBusyId] = useState<string | number | null>(null)

  const [remindItem, setRemindItem] = useState<FollowupItem | null>(null)
  const [remindPreview, setRemindPreview] = useState('')
  const [remindLoading, setRemindLoading] = useState(false)

  const [validateOpen, setValidateOpen] = useState(false)
  const [validateBreakdown, setValidateBreakdown] = useState<{
    count: number
    breakdown: { whatsapp: number; tasks: number; admin: number }
    task_ids: number[]
  } | null>(null)
  const [validating, setValidating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api<FollowUpsPayload>(
        `/dashboard/api/followups?category=${encodeURIComponent(category)}&limit=80`,
      )
      setData(payload)
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Impossible de charger les relances.'
      const hint = /404|Not Found/i.test(raw)
        ? 'L’API Relances est introuvable. Redémarrez le serveur WhatsApp (npm start sur le port 8081), puis cliquez Réessayer.'
        : raw
      setError(hint)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load()
    }, 45_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  const counts = data?.counts || {
    unconfirmed: 0,
    no_response: 0,
    reschedule: 0,
    callback: 0,
    administrative: 0,
  }

  const items = data?.items || data?.categories?.[category]?.items || []
  const categoryLabel = CATEGORY_CARDS.find((c) => c.key === category)?.label || 'Relances'
  const totalPrepared = data?.summary?.total_prepared
    ?? Object.values(counts).reduce((a, b) => a + Number(b || 0), 0)
  const requiresValidation = data?.summary?.requires_validation
    ?? data?.requiresValidation
    ?? 0

  const impact = data?.impact
  const automationBlocks = useMemo(() => {
    if (data?.automation_summary) {
      return Object.values(data.automation_summary)
    }
    return (data?.automations_explained || []).map((row) => ({
      title: row.title,
      when: row.when,
      then: row.then,
      active: row.active !== false,
    }))
  }, [data])

  function setCategory(next: CategoryKey) {
    const params = new URLSearchParams(searchParams)
    params.set('category', next)
    setSearchParams(params, { replace: true })
  }

  async function openRemind(item: FollowupItem) {
    if (!item.appointment_id) return
    setRemindItem(item)
    setRemindPreview('')
    setRemindLoading(true)
    try {
      const preview = await api<{ message: string }>(
        `/dashboard/api/followups/preview?appointment_id=${item.appointment_id}`,
      )
      setRemindPreview(preview.message || '')
    } catch (err) {
      setRemindItem(null)
      setToast(err instanceof Error ? err.message : 'Aperçu impossible')
    } finally {
      setRemindLoading(false)
    }
  }

  async function sendRemind() {
    if (!remindItem?.appointment_id) return
    setBusyId(remindItem.id)
    try {
      await api('/dashboard/api/followups/remind', {
        method: 'POST',
        body: {
          appointment_id: remindItem.appointment_id,
          message: remindPreview || undefined,
        },
      })
      setToast(`Relance envoyée à ${remindItem.patient_name || 'le patient'}.`)
      setRemindItem(null)
      await load()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Envoi impossible'
      setToast(message)
    } finally {
      setBusyId(null)
    }
  }

  async function openValidateAll() {
    try {
      const payload = await api<{
        count: number
        breakdown: { whatsapp: number; tasks: number; admin: number }
        task_ids: number[]
      }>('/dashboard/api/followups/validation-candidates')
      setValidateBreakdown(payload)
      setValidateOpen(true)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Impossible de préparer la validation')
    }
  }

  async function confirmValidateAll() {
    setValidating(true)
    try {
      const result = await api<{ validated: number; failed: number; remaining?: number }>(
        '/dashboard/api/followups/validate-all',
        {
          method: 'POST',
          body: { task_ids: validateBreakdown?.task_ids || [] },
        },
      )
      setValidateOpen(false)
      setToast(
        result.failed
          ? `${result.validated} actions validées · ${result.failed} nécessitent encore votre attention`
          : `${result.validated} action(s) validée(s).`,
      )
      await load()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Validation impossible')
    } finally {
      setValidating(false)
    }
  }

  async function completeTask(item: FollowupItem) {
    if (!item.task_id) return
    setBusyId(item.id)
    try {
      await api(`/dashboard/api/tasks/${item.task_id}`, {
        method: 'PATCH',
        body: { status: 'completed' },
      })
      setToast('Tâche marquée comme traitée.')
      await load()
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Mise à jour impossible')
    } finally {
      setBusyId(null)
    }
  }

  function callPatient(item: FollowupItem) {
    const phone = item.patient_phone
    if (!phone) {
      setToast('Aucun numéro de téléphone disponible.')
      return
    }
    const href = `tel:${phone}`
    window.location.href = href
    // Fallback UX: copy if tel: may not work on desktop
    try {
      void navigator.clipboard?.writeText(phone)
      setToast(`Numéro copié : ${item.phone_display || phone}`)
    } catch {
      /* ignore */
    }
  }

  function openPatient(item: FollowupItem) {
    if (item.patient_id) {
      navigate(`/patients/${item.patient_id}`)
      return
    }
    if (item.conversation_id) {
      navigate(`/messages?c=${item.conversation_id}`)
    }
  }

  function openMessages(item: FollowupItem) {
    if (item.conversation_id) {
      navigate(`/messages?c=${item.conversation_id}`)
      return
    }
    if (item.patient_id) {
      navigate(`/messages?patientId=${item.patient_id}`)
    }
  }

  function openAgenda(item: FollowupItem) {
    const params = new URLSearchParams()
    if (item.appointment_date) {
      params.set('from', item.appointment_date)
      params.set('highlightDate', item.appointment_date)
    }
    if (item.appointment_time) params.set('highlightTime', item.appointment_time)
    if (item.patient_id) params.set('patientId', String(item.patient_id))
    if (item.appointment_id) params.set('appointmentId', String(item.appointment_id))
    if (category === 'reschedule') params.set('action', 'choose')
    navigate(`/agenda?${params.toString()}`)
  }

  const primaryActionLabel = category === 'reschedule'
    ? 'Reprogrammer'
    : category === 'administrative'
      ? 'Ouvrir'
      : 'Relancer'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight text-navy">Relances</h1>
          <p className="mt-1 text-sm text-muted">
            L’assistant IA a préparé {totalPrepared} relance{totalPrepared === 1 ? '' : 's'}.{' '}
            {requiresValidation} nécessitent votre validation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void load()}
            className="h-8 rounded-lg text-xs"
          >
            Actualiser
          </Button>
          {canValidateFollowups ? (
          <button
            type="button"
            onClick={() => void openValidateAll()}
            disabled={!requiresValidation}
            className="inline-flex h-8 items-center rounded-lg bg-navy px-3 text-xs font-medium text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Tout valider
          </button>
          ) : null}
        </div>
      </div>

      {toast ? (
        <div className="rounded-xl border border-border bg-cyan-tint px-4 py-2 text-sm text-navy">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          <p>Impossible de charger les relances.</p>
          <p className="mt-1 text-xs opacity-80">{error}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold underline"
            onClick={() => void load()}
          >
            Réessayer
          </button>
        </div>
      ) : null}

      {/* Category cards */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible xl:grid-cols-5">
        {CATEGORY_CARDS.map((card) => {
          const Icon = card.icon
          const active = category === card.key
          const count = counts[card.countKey] || 0
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setCategory(card.key)}
              className={cn(
                'min-w-[160px] flex-1 rounded-[14px] border bg-white p-3.5 text-left transition sm:min-w-0',
                active ? card.activeClass : 'border-border hover:border-primary/30',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-lg',
                    card.iconClass,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[22px] font-semibold tabular-nums text-navy">{count}</span>
              </div>
              <p className="mt-2 text-[12px] font-medium leading-snug text-muted">{card.label}</p>
            </button>
          )
        })}
      </div>

      {/* Main + sidebar */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-navy">{categoryLabel}</h2>
            <p className="text-[11px] text-muted">Généré automatiquement par l’assistant IA</p>
          </div>

          {loading ? (
            <div className="space-y-0 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="mb-1 h-[58px] w-full rounded-lg" />
              ))}
            </div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={EMPTY_COPY[category].title}
                description={EMPTY_COPY[category].description}
              />
            </div>
          ) : null}

          {!loading && items.length > 0 ? (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const canRemind = Boolean(item.actions?.remind && item.appointment_id)
                const canCall = Boolean(item.actions?.call && item.patient_phone)
                const showReschedule = category === 'reschedule' || item.actions?.reschedule
                const showOpen = category === 'administrative'

                return (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 px-4 py-2.5 transition hover:bg-[#F7FBFC] sm:flex-row sm:items-center sm:gap-3"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => openPatient(item)}
                    >
                      <CyanAvatar name={item.patient_name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-navy">
                          {item.patient_name || 'Patient'}
                        </p>
                        <button
                          type="button"
                          className="truncate text-xs text-muted hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            openAgenda(item)
                          }}
                        >
                          {item.appointment_label || '—'}
                        </button>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left text-xs text-muted hover:text-navy sm:max-w-[220px]"
                      onClick={() => openMessages(item)}
                      title="Ouvrir la conversation"
                    >
                      {item.activity || '—'}
                    </button>

                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        statusPillClass(item.status_key),
                      )}
                    >
                      {item.status_label || '—'}
                    </span>

                    <div className="flex shrink-0 items-center gap-2">
                      {showReschedule ? (
                        <button
                          type="button"
                          onClick={() => openAgenda(item)}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-white"
                        >
                          Reprogrammer
                        </button>
                      ) : showOpen ? (
                        <button
                          type="button"
                          onClick={() => openMessages(item)}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-white"
                        >
                          Ouvrir
                        </button>
                      ) : canSendFollowup ? (
                        <button
                          type="button"
                          disabled={!canRemind || busyId === item.id}
                          onClick={() => void openRemind(item)}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {busyId === item.id ? '…' : primaryActionLabel}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={!canCall}
                        title={canCall ? `Appeler ${item.phone_display || ''}` : 'Aucun numéro de téléphone disponible.'}
                        onClick={() => callPatient(item)}
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-white px-3 text-xs font-medium text-navy disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Appeler
                      </button>

                      {item.actions?.complete_task && item.task_id ? (
                        <button
                          type="button"
                          onClick={() => void completeTask(item)}
                          className="hidden h-8 items-center rounded-lg px-2 text-[11px] font-medium text-muted hover:text-navy lg:inline-flex"
                        >
                          Traité
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-[14px] border border-border bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-navy">Ce que l’IA gère seule</h3>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {automationBlocks.map((block) => (
                  <div key={block.title} className="rounded-[9px] bg-bg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-navy">{block.title}</p>
                      {block.active === false ? (
                        <span className="text-[10px] font-medium text-muted">Désactivée</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                      {block.when}
                      <br />
                      → {block.then}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[14px] border border-border bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-navy">Impact cette semaine</h3>
            {loading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[22px] font-semibold text-primary">
                    {impact?.unconfirmed_change_percent == null
                      ? '—'
                      : `${impact.unconfirmed_change_percent > 0 ? '+' : ''}${impact.unconfirmed_change_percent} %`}
                  </p>
                  <p className="text-[12px] text-muted">de rendez-vous non confirmés</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-primary">
                    {impact?.recovered_slots ?? 0}
                  </p>
                  <p className="text-[12px] text-muted">créneaux récupérés</p>
                </div>
                <div>
                  <p className="text-[22px] font-semibold text-primary">
                    {impact?.estimated_hours_saved != null
                      ? `${impact.estimated_hours_saved} h`
                      : '—'}
                  </p>
                  <p className="text-[12px] text-muted">de travail administratif économisées</p>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* Remind modal */}
      {remindItem ? (
        <Modal onClose={() => setRemindItem(null)}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">
              Relancer {remindItem.patient_name || 'le patient'}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {remindItem.appointment_label}
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
              Message
            </label>
            {remindLoading ? (
              <Skeleton className="mt-2 h-36 w-full" />
            ) : (
              <textarea
                className="mt-2 min-h-[140px] w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-primary"
                value={remindPreview}
                onChange={(e) => setRemindPreview(e.target.value)}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRemindItem(null)}>
                Annuler
              </Button>
              <Button
                size="sm"
                loading={busyId === remindItem.id}
                disabled={!remindPreview.trim()}
                onClick={() => void sendRemind()}
              >
                Envoyer
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Validate all modal */}
      {validateOpen ? (
        <Modal onClose={() => setValidateOpen(false)}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Valider les actions en attente ?</h3>
            <p className="mt-2 text-sm text-muted">
              {validateBreakdown?.count || 0} action
              {(validateBreakdown?.count || 0) === 1 ? '' : 's'} nécessitent votre validation.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-navy">
              <li>— {validateBreakdown?.breakdown?.whatsapp || 0} relances WhatsApp / confirmations</li>
              <li>— {validateBreakdown?.breakdown?.tasks || 0} tâches</li>
              <li>— {validateBreakdown?.breakdown?.admin || 0} autres actions administratives</li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              Cela ne confirme pas automatiquement les rendez-vous et n’envoie pas de relances.
              Seules les tâches humaines en attente sont marquées comme traitées.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setValidateOpen(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                loading={validating}
                disabled={!validateBreakdown?.count}
                onClick={() => void confirmValidateAll()}
                className="bg-navy hover:bg-navy-800"
              >
                Tout valider
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Quiet link for patients deep-link discovery */}
      <p className="sr-only">
        <Link to="/patients">Patients</Link>
      </p>
    </div>
  )
}
