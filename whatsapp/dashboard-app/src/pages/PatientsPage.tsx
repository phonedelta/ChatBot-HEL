import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  PatientDetailModal,
  type PatientContext,
} from '@/components/patients/PatientDetailModal'
import { api } from '@/lib/api'
import {
  cn,
  formatAppointmentSlot,
  formatLastContact,
  formatPhone,
  formatStatus,
  initials,
  isSafePhone,
  statusTone,
} from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/smart/PageBits'
import { NewAppointmentModal } from '@/components/smart/NewAppointmentModal'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import { Skeleton } from '@/components/ui/Skeleton'

type NextAction = {
  type: string
  label: string
  priority?: string
}

type PatientRow = {
  id: number
  full_name: string
  subtitle?: string
  phone_number?: string | null
  phone_display?: string | null
  city?: string | null
  language_label?: string
  source_label?: string
  contact?: {
    id?: number | null
    phone?: string | null
    phone_display?: string | null
    shared?: boolean
    linked_patients_count?: number
    channel?: string | null
  } | null
  next_appointment?: {
    id: number
    appointment_date: string
    appointment_time: string
    status: string
    status_label?: string
    type?: string
  } | null
  next_action?: NextAction | string | null
  last_contact_at?: string | null
  conversation_id?: number | null
  needs_callback?: boolean
}

type PatientsPayload = {
  patients: PatientRow[]
  summary?: {
    patients: number
    appointments_upcoming: number
    to_confirm: number
    to_call: number
  }
  pagination?: {
    page: number
    limit: number
    total: number
    total_pages: number
    from: number
    to: number
  }
}

type FilterKey = 'all' | 'with_appointment' | 'to_confirm' | 'to_call' | 'no_appointment'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'with_appointment', label: 'Avec RDV' },
  { key: 'to_confirm', label: 'À confirmer' },
  { key: 'to_call', label: 'À rappeler' },
  { key: 'no_appointment', label: 'Sans RDV' },
]

function nextActionLabel(action?: NextAction | string | null) {
  if (!action) return 'Aucune action nécessaire'
  if (typeof action === 'string') return action
  return action.label || 'Aucune action nécessaire'
}

function nextActionTone(action?: NextAction | string | null) {
  const label = nextActionLabel(action)
  if (/rappeler|appeler/i.test(label)) return 'text-danger'
  if (/confirmer/i.test(label)) return 'text-warning'
  if (/répondre|reprogrammer|administrative/i.test(label)) return 'text-navy'
  return 'text-muted'
}

function statusBadgeClass(status?: string | null) {
  const tone = statusTone(status)
  if (tone === 'success') return 'bg-success/10 text-success'
  if (tone === 'danger') return 'bg-danger/10 text-danger'
  return 'bg-warning/10 text-warning'
}

function CyanAvatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-9 w-9 text-[11px]',
    lg: 'h-12 w-12 text-sm',
  }
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-cyan-tint font-semibold text-primary',
        sizes[size],
      )}
    >
      {initials(name)}
    </div>
  )
}

export function PatientsPage() {
  const { can } = usePermissions()
  const canCreatePatient = can(PERMISSIONS.CREATE_PATIENT)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [q, setQ] = useState(searchParams.get('q') || '')
  const [debouncedQ, setDebouncedQ] = useState(q)
  const filter = (searchParams.get('filter') || 'all') as FilterKey
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const selectedId = searchParams.get('patient')
    ? Number(searchParams.get('patient'))
    : null

  const [rows, setRows] = useState<PatientRow[]>([])
  const [summary, setSummary] = useState({
    patients: 0,
    appointments_upcoming: 0,
    to_confirm: 0,
    to_call: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    total_pages: 1,
    from: 0,
    to: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const [context, setContext] = useState<PatientContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [menuId, setMenuId] = useState<number | null>(null)

  const [newPatientOpen, setNewPatientOpen] = useState(false)
  const [apptOpen, setApptOpen] = useState(false)
  const [apptPrefill, setApptPrefill] = useState<{
    name?: string
    phone?: string
    city?: string
  }>({})

  const listAbortRef = useRef<AbortController | null>(null)
  const contextReqRef = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 280)
    return () => window.clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    listAbortRef.current?.abort()
    const ac = new AbortController()
    listAbortRef.current = ac
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams()
      if (debouncedQ) query.set('q', debouncedQ)
      query.set('filter', filter)
      query.set('page', String(page))
      query.set('limit', '25')
      query.set('sort', 'action')
      const payload = await api<PatientsPayload>(`/dashboard/api/patients?${query}`)
      if (ac.signal.aborted) return
      setRows(payload.patients || [])
      if (payload.summary) setSummary(payload.summary)
      if (payload.pagination) setPagination(payload.pagination)
    } catch (err) {
      if (ac.signal.aborted) return
      setError(err instanceof Error ? err.message : 'Impossible de charger les patients.')
      setRows([])
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }, [debouncedQ, filter, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  const loadContext = useCallback(async (id: number) => {
    const reqId = ++contextReqRef.current
    setContextLoading(true)
    setContextError('')
    try {
      const payload = await api<PatientContext>(`/dashboard/api/patients/${id}/context`)
      if (reqId !== contextReqRef.current) return
      setContext(payload)
    } catch (err) {
      if (reqId !== contextReqRef.current) return
      const message = err instanceof Error ? err.message : 'Impossible de charger la fiche patient.'
      setContextError(message)
      setContext(null)
    } finally {
      if (reqId === contextReqRef.current) setContextLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setContext(null)
      return
    }
    void loadContext(selectedId)
  }, [selectedId, loadContext])

  function setFilter(next: FilterKey) {
    const params = new URLSearchParams(searchParams)
    params.set('filter', next)
    params.set('page', '1')
    setSearchParams(params, { replace: true })
  }

  function setPage(next: number) {
    const params = new URLSearchParams(searchParams)
    params.set('page', String(next))
    setSearchParams(params, { replace: true })
  }

  function openPatient(id: number) {
    const params = new URLSearchParams(searchParams)
    params.set('patient', String(id))
    setSearchParams(params, { replace: true })
    setMenuId(null)
  }

  function closePatientModal() {
    const params = new URLSearchParams(searchParams)
    params.delete('patient')
    setSearchParams(params, { replace: true })
    setContext(null)
    setContextError('')
  }

  function openMessages(row: PatientRow | PatientContext['patient'] & { conversation_id?: number | null }) {
    const convId = 'conversation_id' in row ? row.conversation_id : context?.conversation_id
    closePatientModal()
    if (convId) {
      navigate(`/messages?c=${convId}`)
      return
    }
    navigate('/messages')
  }

  function callPhone(phone?: string | null) {
    if (!isSafePhone(phone)) {
      setToast('Aucun numéro de téléphone disponible.')
      return
    }
    window.location.href = `tel:${phone}`
    try {
      void navigator.clipboard?.writeText(String(phone))
      setToast(`Numéro copié : ${formatPhone(phone)}`)
    } catch { /* ignore */ }
  }

  function openCreateAppt(row?: PatientRow | null) {
    const fromCtx = context?.patient
    setApptPrefill({
      name: row?.full_name || fromCtx?.full_name || '',
      phone: row?.phone_number || row?.contact?.phone || fromCtx?.phone_number || '',
      city: row?.city || fromCtx?.city || '',
    })
    setApptOpen(true)
    setMenuId(null)
  }

  async function cancelAppointment(appointmentId?: number | null) {
    if (!appointmentId) return
    if (!window.confirm('Annuler ce rendez-vous ?')) return
    try {
      await api(`/dashboard/api/crm/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: { status: 'cancelled', source: 'staff_dashboard' },
      })
      setToast('Rendez-vous annulé.')
      await load()
      if (selectedId) await loadContext(selectedId)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Annulation impossible')
    }
  }

  const selectedRow = rows.find((r) => r.id === selectedId) || null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-navy">Patients</h1>
          <p className="mt-1 text-sm text-muted">Patients, contacts et rendez-vous</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted hover:text-navy"
          aria-label="Actualiser"
          title="Actualiser"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {toast ? (
        <div className="rounded-xl border border-border bg-cyan-tint px-4 py-2 text-sm text-navy">
          {toast}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              const params = new URLSearchParams(searchParams)
              if (e.target.value.trim()) params.set('q', e.target.value.trim())
              else params.delete('q')
              params.set('page', '1')
              setSearchParams(params, { replace: true })
            }}
            placeholder="Rechercher par nom ou téléphone..."
            className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm text-navy outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-8 rounded-lg px-3 text-xs font-medium transition',
                filter === f.key
                  ? 'bg-navy text-white'
                  : 'border border-border bg-white text-muted hover:text-navy',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canCreatePatient ? (
        <button
          type="button"
          onClick={() => setNewPatientOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouveau patient
        </button>
        ) : null}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Patients actifs', value: summary.patients },
          { label: 'Rendez-vous à venir', value: summary.appointments_upcoming },
          { label: 'À confirmer', value: summary.to_confirm },
          { label: 'À rappeler', value: summary.to_call },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-[14px] border border-border bg-white px-3.5 py-3"
          >
            <p className="text-[22px] font-semibold tabular-nums text-navy">{kpi.value}</p>
            <p className="text-[12px] text-muted">{kpi.label}</p>
          </div>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      ) : null}

      {/* List */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-white">
        {/* Desktop header */}
        <div className="hidden border-b border-border bg-[#FAFCFD] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_120px] lg:gap-3">
          <span>Patient</span>
          <span>Contact</span>
          <span>Prochain rendez-vous</span>
          <span>Prochaine action</span>
          <span>Dernier contact</span>
          <span className="text-right">Actions</span>
        </div>

        {loading ? (
          <div className="space-y-0 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="mb-1 h-[68px] w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="Aucun patient trouvé"
              description="Modifiez la recherche ou créez un nouveau patient."
            />
          </div>
        ) : null}

        {!loading && rows.length > 0 ? (
          <ul>
            {rows.map((row) => {
              const phone = row.phone_display || formatPhone(row.phone_number) || '—'
              const shared = Boolean(row.contact?.shared)
              const active = selectedId === row.id
              return (
                <li key={row.id}>
                  {/* Desktop row */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openPatient(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openPatient(row.id)
                    }}
                    className={cn(
                      'hidden cursor-pointer border-b border-border px-4 py-[14px] transition lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_120px] lg:items-center lg:gap-3',
                      active ? 'border-l-2 border-l-primary bg-bg' : 'hover:bg-[#FAFCFD]',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CyanAvatar name={row.full_name} />
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-navy">{row.full_name}</p>
                        <p className="text-[12px] text-muted">{row.subtitle || 'Patient actif'}</p>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm text-navy">{phone}</p>
                      <p className="text-[11px] text-muted">
                        {shared
                          ? `Contact WhatsApp partagé · ${row.contact?.linked_patients_count || 0} patients`
                          : 'WhatsApp'}
                      </p>
                      {shared ? (
                        <span className="mt-1 inline-flex rounded-full bg-cyan-tint px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Contact partagé
                        </span>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      {row.next_appointment ? (
                        <>
                          <p className="text-sm text-navy">
                            {formatAppointmentSlot(
                              row.next_appointment.appointment_date,
                              row.next_appointment.appointment_time,
                            )}
                          </p>
                          <span
                            className={cn(
                              'mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              statusBadgeClass(row.next_appointment.status),
                            )}
                          >
                            {row.next_appointment.status_label
                              || formatStatus(row.next_appointment.status)}
                          </span>
                        </>
                      ) : (
                        <p className="text-sm text-muted">—</p>
                      )}
                    </div>

                    <div className={cn('text-sm font-medium', nextActionTone(row.next_action))}>
                      {nextActionLabel(row.next_action)}
                    </div>

                    <div className="text-sm text-muted">
                      {formatLastContact(row.last_contact_at, 'whatsapp')}
                    </div>

                    <div
                      className="relative flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title="Voir"
                        onClick={() => openPatient(row.id)}
                        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-cyan-tint"
                      >
                        Voir
                      </button>
                      <button
                        type="button"
                        title="Message"
                        onClick={() => openMessages(row)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-navy"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={isSafePhone(row.phone_number) ? 'Appeler' : 'Aucun numéro'}
                        disabled={!isSafePhone(row.phone_number)}
                        onClick={() => callPhone(row.phone_number)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-navy disabled:opacity-30"
                      >
                        <Phone className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="Plus"
                        onClick={() => setMenuId(menuId === row.id ? null : row.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-navy"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menuId === row.id ? (
                        <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-border bg-white py-1 shadow-soft">
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-bg"
                            onClick={() => openCreateAppt(row)}
                          >
                            Créer un rendez-vous
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-bg"
                            onClick={() => {
                              navigate(`/agenda?patientId=${row.id}`)
                              setMenuId(null)
                            }}
                          >
                            Voir les rendez-vous
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-bg"
                            onClick={() => {
                              openMessages(row)
                              setMenuId(null)
                            }}
                          >
                            Ouvrir dans Messages
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openPatient(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') openPatient(row.id)
                    }}
                    className={cn(
                      'border-b border-border px-4 py-3 lg:hidden',
                      active && 'bg-bg',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <CyanAvatar name={row.full_name} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-navy">{row.full_name}</p>
                        <p className="text-xs text-muted">{phone}</p>
                        <p className="mt-2 text-sm text-navy">
                          {row.next_appointment
                            ? formatAppointmentSlot(
                              row.next_appointment.appointment_date,
                              row.next_appointment.appointment_time,
                            )
                            : 'Aucun RDV'}
                        </p>
                        {row.next_appointment ? (
                          <span
                            className={cn(
                              'mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              statusBadgeClass(row.next_appointment.status),
                            )}
                          >
                            {row.next_appointment.status_label
                              || formatStatus(row.next_appointment.status)}
                          </span>
                        ) : null}
                        <p className={cn('mt-2 text-xs font-medium', nextActionTone(row.next_action))}>
                          {nextActionLabel(row.next_action)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openPatient(row.id)}
                        className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white"
                      >
                        Voir
                      </button>
                      <button
                        type="button"
                        onClick={() => openMessages(row)}
                        className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-navy"
                      >
                        Message
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        {/* Pagination */}
        {pagination.total > pagination.limit ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted">
            <span>
              {pagination.from}–{pagination.to} sur {pagination.total}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="h-7 rounded-md border border-border px-2 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="inline-flex h-7 items-center px-2 text-navy">
                {page} / {pagination.total_pages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.total_pages}
                onClick={() => setPage(page + 1)}
                className="h-7 rounded-md border border-border px-2 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <PatientDetailModal
        open={Boolean(selectedId)}
        patientId={selectedId}
        patientName={context?.patient?.full_name || selectedRow?.full_name}
        context={context}
        loading={contextLoading}
        error={contextError || null}
        onClose={closePatientModal}
        onRetry={selectedId ? () => void loadContext(selectedId) : undefined}
        onOpenPatient={openPatient}
        onCreateAppointment={() => openCreateAppt(selectedRow)}
        onCallPhone={callPhone}
        onCancelAppointment={cancelAppointment}
      />

      {/* New patient modal */}
      {newPatientOpen ? (
        <NewPatientModal
          onClose={() => setNewPatientOpen(false)}
          onCreated={() => {
            setNewPatientOpen(false)
            setToast('Patient créé.')
            void load()
          }}
        />
      ) : null}

      <NewAppointmentModal
        open={apptOpen}
        onClose={() => setApptOpen(false)}
        initialName={apptPrefill.name}
        initialPhone={apptPrefill.phone}
        initialCity={apptPrefill.city}
        onCreated={() => {
          setToast('Rendez-vous créé.')
          void load()
          if (selectedId) void loadContext(selectedId)
        }}
      />
    </div>
  )
}

function NewPatientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [language, setLanguage] = useState('fr')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api('/dashboard/api/patients', {
        method: 'POST',
        body: {
          full_name: fullName.trim(),
          phone_number: phone.trim(),
          city: city.trim() || null,
          language,
        },
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <h2 className="text-lg font-semibold text-navy">Nouveau patient</h2>
        <p className="mt-1 text-sm text-muted">Mini-fiche opérationnelle — pas de dossier médical.</p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 space-y-3">
          <Field label="Nom et prénom">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
          </Field>
          <Field label="Téléphone / contact WhatsApp">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+212 6…" />
          </Field>
          <Field label="Ville">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Langue">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-primary"
            >
              <option value="fr">Français</option>
              <option value="darija">Darija</option>
            </select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" loading={saving} onClick={() => void save()}>
            Créer
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Legacy full-page detail — redirect UX to list + modal */
export function PatientDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (id) navigate(`/patients?patient=${id}`, { replace: true })
    else navigate('/patients', { replace: true })
  }, [id, navigate])

  return (
    <div className="p-8">
      <Skeleton className="h-40 w-full" />
      <p className="mt-3 text-sm text-muted">
        <Link to="/patients" className="text-primary">Retour aux patients</Link>
      </p>
    </div>
  )
}
