import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatDateFr, formatAppointmentSlot, todayISO } from '@/lib/format'
import { appointmentStatusLabel } from '@/lib/labels'
import { useIsLgUp } from '@/hooks/useMediaQuery'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import {
  addDaysISO,
  getAppointmentStatusStyle,
  getWaitlistPriorityStyle,
  startOfWeekMonday,
  type AgendaAppointment,
  type AgendaPayload,
  type AgendaSlot,
  type AgendaView,
  type WaitlistEntry,
} from '@/lib/agenda'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NewAppointmentModal } from '@/components/smart/NewAppointmentModal'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/smart/PageBits'

const VIEW_LABELS: Record<AgendaView, string> = {
  day: 'Jour',
  week: 'Semaine',
  list: 'Liste',
}

export function AgendaPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const isLgUp = useIsLgUp()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<AgendaView>(() => {
    const v = params.get('view')
    return v === 'day' || v === 'list' || v === 'week' ? v : 'week'
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [anchor, setAnchor] = useState(() => params.get('from') || todayISO())
  const [typeFilter, setTypeFilter] = useState(params.get('type') || '')
  const [statusFilter, setStatusFilter] = useState(params.get('status') || '')
  const [data, setData] = useState<AgendaPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AgendaAppointment | null>(null)
  const [proposeSlot, setProposeSlot] = useState<AgendaSlot | null>(null)
  const [proposeIntent, setProposeIntent] = useState<'both' | 'move'>('both')
  const [slotActionMenu, setSlotActionMenu] = useState<AgendaSlot | null>(null)
  const [newAppt, setNewAppt] = useState<{ open: boolean; date?: string; time?: string }>({
    open: false,
  })
  const [actionBusy, setActionBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState<AgendaAppointment | null>(null)
  const [rescheduleTarget, setRescheduleTarget] = useState<AgendaAppointment | null>(null)
  const [pendingMoveSlot, setPendingMoveSlot] = useState<AgendaSlot | null>(null)
  const requestRef = useRef(0)
  const highlightHandledRef = useRef('')

  const patientFilter = params.get('patient') || ''
  const highlightDate = params.get('highlightDate') || ''
  const highlightTime = (params.get('highlightTime') || '').slice(0, 5)
  const highlightAction = params.get('action') || ''
  const highlightApptId = params.get('highlight') || ''
  const moveAppointmentId = params.get('action') === 'move' ? Number(params.get('appointmentId') || 0) : 0

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({
        view,
        from: view === 'week' ? startOfWeekMonday(anchor) : anchor,
      })
      if (typeFilter) query.set('type', typeFilter)
      if (statusFilter) query.set('status', statusFilter)
      const payload = await api<AgendaPayload>(`/dashboard/api/agenda?${query}`)
      if (requestId !== requestRef.current) return
      setData(payload)
    } catch (err) {
      if (requestId !== requestRef.current) return
      setData(null)
      setError(err instanceof Error ? err.message : 'Impossible de charger l’agenda.')
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [view, anchor, typeFilter, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  // Prefer Jour on small screens unless user explicitly chose a view via URL.
  useEffect(() => {
    if (params.get('view')) return
    if (!isLgUp && view === 'week') setView('day')
  }, [isLgUp]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (params.get('new') === '1') {
      setNewAppt({ open: true })
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  useEffect(() => {
    const from = params.get('from')
    if (from && from !== anchor) setAnchor(from)
    const v = params.get('view')
    if (v === 'day' || v === 'list' || v === 'week') setView(v)
  }, [params, anchor])

  useEffect(() => {
    if (!highlightDate || !highlightTime || !data) return
    const token = `${highlightDate}|${highlightTime}|${highlightAction}`
    if (highlightHandledRef.current === token) return
    highlightHandledRef.current = token

    const key = `${highlightDate}|${highlightTime}`
    setHighlightKey(key)
    const timer = window.setTimeout(() => setHighlightKey(null), 1800)

    if (highlightAction === 'choose') {
      const released = (data.released_slots || []).find(
        (s) => s.slot_date === highlightDate && String(s.slot_time).slice(0, 5) === highlightTime,
      )
      const available = (data.available_slots || []).find(
        (s) => s.slot_date === highlightDate && String(s.slot_time).slice(0, 5) === highlightTime,
      )
      if (released) {
        setProposeIntent('both')
        setProposeSlot(released)
      } else if (available) {
        setProposeIntent('both')
        setProposeSlot({
          slot_date: highlightDate,
          slot_time: highlightTime,
          kind: 'available',
          duration_minutes: available.duration_minutes || 30,
        })
      } else if (params.get('slotTaken') === '1') {
        setToast('Ce créneau n’est plus disponible.')
      } else {
        setProposeIntent('both')
        setProposeSlot({
          slot_date: highlightDate,
          slot_time: highlightTime,
          kind: 'released',
          duration_minutes: 30,
        })
      }
    }

    const next = new URLSearchParams(params)
    next.delete('highlightDate')
    next.delete('highlightTime')
    next.delete('action')
    next.delete('slotTaken')
    setParams(next, { replace: true })

    return () => window.clearTimeout(timer)
  }, [data, highlightDate, highlightTime, highlightAction, params, setParams])

  useEffect(() => {
    if (!highlightApptId) return
    const token = `highlight:${highlightApptId}`
    if (highlightHandledRef.current === token) return

    void (async () => {
      const id = Number(highlightApptId)
      if (!id) return
      let appt = (data?.appointments || []).find((a) => a.id === id) || null
      if (!appt) {
        try {
          const payload = await api<{ ok: boolean; appointment: AgendaAppointment }>(
            `/dashboard/api/agenda/appointments/${id}`,
          )
          appt = payload.appointment
          if (appt?.appointment_date) {
            setAnchor(appt.appointment_date)
            if (appt.status === 'cancelled') setStatusFilter('cancelled')
          }
        } catch {
          setToast('Ce rendez-vous n’est plus disponible.')
          highlightHandledRef.current = token
          return
        }
      }
      if (!appt) {
        setToast('Ce rendez-vous n’est plus disponible.')
      } else {
        setSelected(appt)
        setAnchor(appt.appointment_date)
        setHighlightKey(`${appt.appointment_date}|${appt.appointment_time}`)
        window.setTimeout(() => setHighlightKey(null), 2200)
      }
      highlightHandledRef.current = token
      const next = new URLSearchParams(params)
      next.delete('highlight')
      setParams(next, { replace: true })
    })()
  }, [highlightApptId, data, params, setParams])

  useEffect(() => {
    if (!moveAppointmentId) return
    const token = `move:${moveAppointmentId}`
    if (highlightHandledRef.current === token) return

    void (async () => {
      try {
        const payload = await api<{ ok: boolean; appointment: AgendaAppointment }>(
          `/dashboard/api/agenda/appointments/${moveAppointmentId}`,
        )
        const appt = payload.appointment
        if (!appt) throw new Error('missing')
        setRescheduleTarget(appt)
        setAnchor(appt.appointment_date)
        setPendingMoveSlot(null)
        highlightHandledRef.current = token
        const next = new URLSearchParams(params)
        next.delete('action')
        next.delete('appointmentId')
        next.delete('from')
        next.delete('highlightDate')
        next.delete('highlightTime')
        setParams(next, { replace: true })
      } catch {
        setToast('Ce rendez-vous n’est plus disponible.')
        highlightHandledRef.current = token
      }
    })()
  }, [moveAppointmentId, params, setParams])

  useEffect(() => {
    function onCreated() {
      void load()
    }
    window.addEventListener('hel:appointment-created', onCreated)
    return () => window.removeEventListener('hel:appointment-created', onCreated)
  }, [load])

  const appointments = useMemo(() => {
    let rows = data?.appointments || []
    if (patientFilter) {
      rows = rows.filter((r) => String(r.customer_id) === patientFilter)
    }
    return rows
  }, [data, patientFilter])

  function shiftDate(delta: number) {
    if (view === 'week') setAnchor(addDaysISO(startOfWeekMonday(anchor), delta * 7))
    else setAnchor(addDaysISO(anchor, delta))
  }

  async function confirmReschedule() {
    if (!rescheduleTarget || !pendingMoveSlot) return
    setActionBusy(true)
    setError('')
    try {
      await api(`/dashboard/api/agenda/appointments/${rescheduleTarget.id}/move`, {
        method: 'POST',
        body: {
          slot_date: pendingMoveSlot.slot_date,
          slot_time: pendingMoveSlot.slot_time,
        },
      })
      setToast('Rendez-vous déplacé.')
      setRescheduleTarget(null)
      setPendingMoveSlot(null)
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Déplacement impossible')
      await load()
    } finally {
      setActionBusy(false)
    }
  }

  function openSlotActionMenu(slot: AgendaSlot) {
    const canCreate = can(PERMISSIONS.CREATE_APPOINTMENT)
    const canMove = can(PERMISSIONS.EDIT_APPOINTMENT)
    if (!canCreate && !canMove) {
      setToast('Vous n’avez pas l’autorisation.')
      return
    }
    setSlotActionMenu(slot)
  }

  function handleSlotPickForReschedule(slot: AgendaSlot) {
    if (!rescheduleTarget) return
    setPendingMoveSlot(slot)
  }

  function handleFreeSlotClick(slot: AgendaSlot) {
    if (rescheduleTarget) {
      handleSlotPickForReschedule(slot)
      return
    }
    openSlotActionMenu(slot)
  }

  async function patchAppointment(id: number, body: Record<string, unknown>) {
    setActionBusy(true)
    setError('')
    try {
      await api(`/dashboard/api/crm/appointments/${id}`, { method: 'PATCH', body })
      setToast('Rendez-vous mis à jour.')
      setSelected(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action impossible')
    } finally {
      setActionBusy(false)
    }
  }

  async function openPatientChat(customerId: number) {
    try {
      const payload = await api<{ conversation_id: number | null }>(
        `/dashboard/api/agenda/conversation-for-patient/${customerId}`,
      )
      if (payload.conversation_id) {
        navigate(`/messages?c=${payload.conversation_id}`)
      } else {
        navigate('/messages')
      }
    } catch {
      navigate('/messages')
    }
  }

  async function runPropose(slot: AgendaSlot, patient: {
    customer_id: number
    appointment_id: number
  }) {
    setActionBusy(true)
    setError('')
    try {
      await api('/dashboard/api/agenda/slot-proposals', {
        method: 'POST',
        body: {
          customer_id: patient.customer_id,
          appointment_id: patient.appointment_id,
          slot_date: slot.slot_date,
          slot_time: slot.slot_time,
          duration_minutes: slot.duration_minutes || 30,
        },
      })
      setToast('Proposition WhatsApp envoyée.')
      setProposeSlot(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proposition impossible')
    } finally {
      setActionBusy(false)
    }
  }

  async function runMoveDirect(slot: AgendaSlot, appointmentId: number) {
    setActionBusy(true)
    setError('')
    try {
      await api(`/dashboard/api/agenda/appointments/${appointmentId}/move`, {
        method: 'POST',
        body: {
          slot_date: slot.slot_date,
          slot_time: slot.slot_time,
        },
      })
      setToast('Rendez-vous déplacé.')
      setProposeSlot(null)
      setProposeIntent('both')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Déplacement impossible')
      await load()
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-semibold leading-tight text-navy">Agenda</h1>
            <p className="mt-1 text-[13px] text-muted">
              {loading && !data ? 'Chargement…' : data?.range.subtitle || '—'}
            </p>
          </div>
          {can(PERMISSIONS.CREATE_APPOINTMENT) ? (
            <Button
              size="sm"
              className="shrink-0"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setNewAppt({ open: true })}
            >
              Nouveau rendez-vous
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-wrap sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-bg hover:text-navy"
                onClick={() => shiftDate(-1)}
                aria-label="Période précédente"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="h-11 rounded-md px-2 text-xs font-semibold text-navy hover:bg-bg"
                onClick={() => setAnchor(todayISO())}
              >
                Aujourd’hui
              </button>
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-bg hover:text-navy"
                onClick={() => shiftDate(1)}
                aria-label="Période suivante"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
              {(['day', 'week', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'min-h-11 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    view === v ? 'bg-navy text-white' : 'text-muted hover:text-navy',
                  )}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-11 rounded-lg border border-border bg-white px-2 text-xs font-medium text-navy outline-none"
              aria-label="Filtrer par type"
            >
              <option value="">Type</option>
              {(data?.appointment_types || []).map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-11 rounded-lg border border-border bg-white px-2 text-xs font-medium text-navy outline-none"
              aria-label="Filtrer par statut"
            >
              <option value="">Statut</option>
              <option value="confirmed">Confirmé</option>
              <option value="non_confirme">À confirmer</option>
              <option value="no_show">Patient absent</option>
              <option value="cancelled">Annulé</option>
              <option value="released">Créneau libéré</option>
              <option value="available">Disponible</option>
            </select>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <Button size="sm" variant="secondary" onClick={() => setFiltersOpen(true)}>
              Filtres
            </Button>
            {(typeFilter || statusFilter) ? (
              <button
                type="button"
                className="text-xs font-medium text-primary"
                onClick={() => {
                  setTypeFilter('')
                  setStatusFilter('')
                }}
              >
                Réinitialiser
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-white text-muted hover:text-navy"
            aria-label="Actualiser"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-xl border border-primary/30 bg-cyan-tint px-3 py-2 text-sm text-navy">
          {toast}
          <button type="button" className="ml-2 text-xs font-semibold" onClick={() => setToast('')}>OK</button>
        </div>
      ) : null}

      {rescheduleTarget ? (
        <div className="rounded-xl border border-primary/30 bg-cyan-tint/70 px-4 py-3 text-sm text-navy">
          <p className="font-semibold">
            Déplacement du rendez-vous de {rescheduleTarget.full_name}
          </p>
          <p className="mt-1 text-[var(--color-muted-accessible)]">
            Créneau actuel : {formatAppointmentSlot(rescheduleTarget.appointment_date, rescheduleTarget.appointment_time)}
            {pendingMoveSlot
              ? ` → Nouveau : ${formatAppointmentSlot(pendingMoveSlot.slot_date, pendingMoveSlot.slot_time)}`
              : ' — choisissez un créneau libre dans l’agenda.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={actionBusy}
              disabled={!pendingMoveSlot}
              onClick={() => void confirmReschedule()}
            >
              Confirmer le déplacement
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRescheduleTarget(null)
                setPendingMoveSlot(null)
              }}
            >
              Annuler le déplacement
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>Réessayer</Button>
        </div>
      ) : null}

      {/* Banner released slot */}
      {data?.banner ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-primary bg-cyan-tint p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-navy">{data.banner.message.title}</p>
              <p className="mt-0.5 text-[13px] text-muted">{data.banner.message.detail}</p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => {
              setProposeIntent('both')
              setProposeSlot({
                slot_date: data.banner!.slot_date,
                slot_time: data.banner!.slot_time,
                kind: 'released',
                appointment_id: data.banner!.appointment_id,
              })
            }}
          >
            Choisir un patient
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* Main calendar — carreaux */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#E6EBEF] bg-[#F3F5F7]">
          {loading && !data ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-64" />
            </div>
          ) : view === 'list' ? (
            <div className="bg-white p-1">
              <AgendaListView
                appointments={appointments}
                onSelect={setSelected}
              />
            </div>
          ) : (
            <AgendaGrid
              data={data}
              appointments={appointments}
              view={view}
              statusFilter={statusFilter}
              highlightKey={highlightKey}
              onSelectAppointment={setSelected}
              onSelectAvailable={handleFreeSlotClick}
              onSelectReleased={handleFreeSlotClick}
            />
          )}
        </section>

        {/* Right sidebar */}
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <WaitlistCard
            entries={data?.waitlist || []}
            count={data?.waitlist_count || 0}
            onLaunch={() => {
              const released = data?.released_slots?.[0]
              if (released) {
                setProposeIntent('both')
                setProposeSlot(released)
              } else {
                setToast('Aucun créneau libéré pour le moment. Cliquez un créneau libre dans l’agenda.')
              }
            }}
          />
          <StatusLegend />
        </aside>
      </div>

      {selected ? (
        <AppointmentDrawer
          appointment={selected}
          busy={actionBusy}
          onClose={() => setSelected(null)}
          onConfirm={() => void patchAppointment(selected.id, { status: 'confirmed' })}
          onCancel={() => setCancelConfirm(selected)}
          onMessage={() => void openPatientChat(selected.customer_id)}
        />
      ) : null}

      {filtersOpen ? (
        <Modal onClose={() => setFiltersOpen(false)}>
          <h2 className="text-lg font-semibold text-navy">Filtres agenda</h2>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-navy" htmlFor="agenda-filter-type">
              Type
            </label>
            <select
              id="agenda-filter-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="">Tous les types</option>
              {(data?.appointment_types || []).map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
            <label className="block text-sm font-medium text-navy" htmlFor="agenda-filter-status">
              Statut
            </label>
            <select
              id="agenda-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="">Tous les statuts</option>
              <option value="confirmed">Confirmé</option>
              <option value="non_confirme">À confirmer</option>
              <option value="no_show">Patient absent</option>
              <option value="cancelled">Annulé</option>
              <option value="released">Créneau libéré</option>
              <option value="available">Disponible</option>
            </select>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setTypeFilter(''); setStatusFilter(''); setFiltersOpen(false) }}>
              Réinitialiser
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Appliquer</Button>
          </div>
        </Modal>
      ) : null}

      {cancelConfirm ? (
        <Modal onClose={() => setCancelConfirm(null)}>
          <h2 className="font-display text-xl text-navy">Annuler ce rendez-vous ?</h2>
          <p className="mt-2 text-sm text-[var(--color-muted-accessible)]">
            Le créneau sera libéré et le rendez-vous passera au statut Annulé.
          </p>
          <p className="mt-2 text-sm font-medium text-navy">
            {cancelConfirm.full_name} — {formatAppointmentSlot(cancelConfirm.appointment_date, cancelConfirm.appointment_time)}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelConfirm(null)}>
              Retour
            </Button>
            <Button
              variant="danger"
              loading={actionBusy}
              onClick={() => {
                const target = cancelConfirm
                setCancelConfirm(null)
                void patchAppointment(target.id, { status: 'cancelled', source: 'staff_dashboard' })
              }}
            >
              Annuler le rendez-vous
            </Button>
          </div>
        </Modal>
      ) : null}

      {slotActionMenu ? (
        <SlotActionMenu
          slot={slotActionMenu}
          canCreate={can(PERMISSIONS.CREATE_APPOINTMENT)}
          canMove={can(PERMISSIONS.EDIT_APPOINTMENT)}
          onClose={() => setSlotActionMenu(null)}
          onCreate={() => {
            const slot = slotActionMenu
            setSlotActionMenu(null)
            setNewAppt({
              open: true,
              date: slot.slot_date,
              time: slot.slot_time,
            })
          }}
          onMove={() => {
            const slot = slotActionMenu
            setSlotActionMenu(null)
            setProposeIntent('move')
            setProposeSlot(slot)
          }}
        />
      ) : null}

      {proposeSlot ? (
        <ProposeSlotModal
          slot={proposeSlot}
          busy={actionBusy}
          intent={proposeIntent}
          onClose={() => {
            setProposeSlot(null)
            setProposeIntent('both')
          }}
          onPropose={(patient) => void runPropose(proposeSlot, patient)}
          onMove={(appointmentId) => void runMoveDirect(proposeSlot, appointmentId)}
        />
      ) : null}

      <NewAppointmentModal
        open={newAppt.open}
        initialDate={newAppt.date}
        initialTime={newAppt.time}
        onClose={() => setNewAppt({ open: false })}
        onCreated={(message) => {
          if (message) setToast(message)
          void load()
        }}
      />
    </div>
  )
}

function AgendaGrid({
  data,
  appointments,
  view,
  statusFilter,
  highlightKey,
  onSelectAppointment,
  onSelectAvailable,
  onSelectReleased,
}: {
  data: AgendaPayload | null
  appointments: AgendaAppointment[]
  view: AgendaView
  statusFilter: string
  highlightKey?: string | null
  onSelectAppointment: (a: AgendaAppointment) => void
  onSelectAvailable: (s: AgendaSlot) => void
  onSelectReleased: (s: AgendaSlot) => void
}) {
  const days = data?.range.days || []
  const timeAxis = data?.time_axis || []
  const showAvailable = !statusFilter || statusFilter === 'all' || statusFilter === 'available'
  const showReleased = !statusFilter || statusFilter === 'all' || statusFilter === 'released'

  const byDayTime = useMemo(() => {
    const map = new Map<string, AgendaAppointment>()
    for (const a of appointments) {
      map.set(`${a.appointment_date}|${a.appointment_time}`, a)
    }
    return map
  }, [appointments])

  const availableSet = useMemo(() => {
    const set = new Set<string>()
    for (const s of data?.available_slots || []) {
      set.add(`${s.slot_date}|${s.slot_time}`)
    }
    return set
  }, [data])

  const releasedMap = useMemo(() => {
    const map = new Map<string, AgendaSlot>()
    for (const s of data?.released_slots || []) {
      map.set(`${s.slot_date}|${s.slot_time}`, s)
    }
    return map
  }, [data])

  if (!days.length || !timeAxis.length) {
    return (
      <div className="p-6">
        <EmptyState
          title="Aucun créneau sur cette période"
          description="Le cabinet est fermé ou les horaires ne sont pas configurés."
        />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto overscroll-x-contain p-2 sm:p-3 sm:p-4">
      <div
        className="min-w-[560px] gap-1.5 sm:min-w-[760px] sm:gap-2.5"
        style={{
          display: 'grid',
          gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Corner spacer */}
        <div className="h-10" aria-hidden />

        {/* Day pills */}
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              'flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold tracking-tight',
              day.is_today
                ? 'bg-[#12324A] text-white shadow-sm'
                : 'bg-[#E8ECF0] text-[#5A6B7A]',
            )}
          >
            {day.label}
          </div>
        ))}

        {timeAxis.map((time) => (
          <div key={`row-${time}`} className="contents">
            <div className="flex items-center justify-end pr-1 text-[12px] font-medium tabular-nums text-[#8A97A5]">
              {time}
            </div>
            {days.map((day) => {
              const key = `${day.date}|${time}`
              const appt = byDayTime.get(key)
              const released = releasedMap.get(key)
              const available = availableSet.has(key)
              const closed = !day.hours
              const isHighlighted = highlightKey === key

              if (closed) {
                return (
                  <div
                    key={key}
                    className="min-h-[76px] rounded-xl border border-transparent bg-[#E8ECF0]/50"
                  />
                )
              }

              if (appt && statusFilter !== 'available' && statusFilter !== 'released') {
                const style = getAppointmentStatusStyle(appt.status)
                return (
                  <button
                    key={key}
                    type="button"
                    title={`${appt.full_name}\n${appt.appointment_type || 'Consultation'}\n${appt.appointment_time}–${appt.end_time}\n${appt.status_label}`}
                    onClick={() => onSelectAppointment(appt)}
                    className={cn(
                      'flex min-h-[76px] w-full flex-col items-start justify-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      style.bg,
                      style.border,
                      isHighlighted && 'animate-slot-highlight',
                    )}
                  >
                    <span className={cn('line-clamp-1 text-[13px] font-bold leading-tight', style.text)}>
                      {appt.short_name}
                    </span>
                    <span className={cn('line-clamp-1 text-[11px] font-medium leading-tight', style.muted || 'opacity-80')}>
                      {appt.appointment_type || 'Consultation'}
                    </span>
                  </button>
                )
              }

              if (released && showReleased) {
                const cancelledHint = released.appointment_id
                  ? `Annulé ${time}`
                  : time
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectReleased(released)}
                    className={cn(
                      'flex min-h-[76px] w-full flex-col items-start justify-start gap-0.5 rounded-xl border border-dashed border-[#5BB8C8] bg-[#E6F7FA] px-3 py-2.5 text-left transition hover:bg-[#D7F1F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      isHighlighted && 'animate-slot-highlight',
                    )}
                  >
                    <span className="text-[13px] font-bold leading-tight text-[#0E8A9A]">Créneau libéré</span>
                    <span className="text-[11px] font-medium text-[#4A8A95]">{cancelledHint}</span>
                  </button>
                )
              }

              if (available && showAvailable && view !== 'list') {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectAvailable({ slot_date: day.date, slot_time: time, kind: 'available' })}
                    className={cn(
                      'flex min-h-[76px] w-full items-center justify-center rounded-xl border border-dashed border-[#B8C4CE] bg-white px-2 text-[13px] font-medium text-[#8A97A5] transition hover:border-[#13AEC1]/50 hover:bg-[#F7FBFC] hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      isHighlighted && 'animate-slot-highlight',
                    )}
                  >
                    Disponible
                  </button>
                )
              }

              return (
                <div
                  key={key}
                  className={cn(
                    'min-h-[76px] rounded-xl border border-[#E6EBEF] bg-white',
                    isHighlighted && 'animate-slot-highlight',
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function AgendaListView({
  appointments,
  onSelect,
}: {
  appointments: AgendaAppointment[]
  onSelect: (a: AgendaAppointment) => void
}) {
  if (!appointments.length) {
    return (
      <div className="p-6">
        <EmptyState title="Aucun rendez-vous sur cette période." />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#F7FBFC] text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Heure</th>
            <th className="px-3 py-2.5 font-semibold">Patient</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="px-3 py-2.5 font-semibold">Praticien</th>
            <th className="px-3 py-2.5 font-semibold">Statut</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => {
            const style = getAppointmentStatusStyle(a.status)
            return (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                  {a.appointment_date} · {a.appointment_time}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    className="font-medium text-navy hover:underline"
                    onClick={() => onSelect(a)}
                  >
                    {a.full_name}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-muted">{a.appointment_type || '—'}</td>
                <td className="px-3 py-2.5 text-muted">{a.practitioner_name || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', style.bg, style.text)}>
                    {a.status_label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WaitlistCard({
  entries,
  count,
  onLaunch,
}: {
  entries: WaitlistEntry[]
  count: number
  onLaunch: () => void
}) {
  return (
    <div className="rounded-[14px] border border-border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-navy">Liste d’attente</h2>
        <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-muted">
          {count} patient{count > 1 ? 's' : ''}
        </span>
      </div>
      {!entries.length ? (
        <p className="text-[13px] text-muted">Aucune entrée active.</p>
      ) : (
        <ul className="space-y-2">
          {entries.slice(0, 8).map((w) => (
            <li key={w.id} className="rounded-[10px] bg-[#F7FBFC] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-navy">{w.patient_name}</p>
                <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', getWaitlistPriorityStyle(w.priority))}>
                  {w.priority_label}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">{w.preference_label}</p>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onLaunch}
        className="mt-4 flex h-10 w-full items-center justify-center rounded-[10px] bg-navy text-[13px] font-semibold text-white transition hover:bg-navy-800"
      >
        Proposer un créneau
      </button>
    </div>
  )
}

function StatusLegend() {
  const items = [
    { label: 'Confirmé', color: 'bg-[#20B26B]' },
    { label: 'À confirmer', color: 'bg-[#F59E0B]' },
    { label: 'Patient absent', color: 'bg-[#E34C4C]' },
    { label: 'Créneau libéré', color: 'bg-[#13AEC1]' },
    { label: 'Disponible', color: 'bg-[#9BB0C0]' },
  ]
  return (
    <div className="rounded-[14px] border border-border bg-white p-4">
      <h2 className="mb-3 text-[15px] font-semibold text-navy">Statuts</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cn('h-2.5 w-2.5 rounded-full', item.color)} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AppointmentDrawer({
  appointment,
  busy,
  onClose,
  onConfirm,
  onCancel,
  onMessage,
}: {
  appointment: AgendaAppointment
  busy: boolean
  onClose: () => void
  onConfirm: () => void
  onCancel: () => void
  onMessage: () => void
}) {
  const style = getAppointmentStatusStyle(appointment.status)
  return (
    <Modal onClose={onClose} className="max-w-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rendez-vous</p>
          <h2 className="mt-1 text-xl font-semibold text-navy">{appointment.full_name}</h2>
          <p className="text-sm text-muted">{appointment.phone_display || appointment.phone_number}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-bg" aria-label="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2 text-[13px]">
        <Row label="Date" value={formatDateFr(appointment.appointment_date)} />
        <Row label="Heure" value={`${appointment.appointment_time} – ${appointment.end_time || ''}`} />
        <Row label="Durée" value={`${appointment.duration_minutes} min`} />
        <Row label="Type" value={appointment.appointment_type || 'Consultation'} />
        <Row label="Praticien" value={appointment.practitioner_name || '—'} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">Statut</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', style.bg, style.text)}>
            {appointment.status_label}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {appointment.status === 'non_confirme' ? (
          <Button size="sm" loading={busy} onClick={onConfirm}>Confirmer</Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>Confirmé</Button>
        )}
        <Button size="sm" variant="secondary" loading={busy} onClick={onCancel}>Annuler</Button>
        <Button size="sm" variant="secondary" icon={<MessageSquare className="h-3.5 w-3.5" />} onClick={onMessage}>
          Message
        </Button>
        <Link
          to={`/patients/${appointment.customer_id}`}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-2xl border border-border bg-white text-sm font-medium text-navy hover:bg-cyan-tint"
        >
          <UserRound className="h-3.5 w-3.5" />
          Voir patient
        </Link>
      </div>
    </Modal>
  )
}

function SlotActionMenu({
  slot,
  canCreate,
  canMove,
  onClose,
  onCreate,
  onMove,
}: {
  slot: AgendaSlot
  canCreate: boolean
  canMove: boolean
  onClose: () => void
  onCreate: () => void
  onMove: () => void
}) {
  const slotLabel = formatAppointmentSlot(slot.slot_date, slot.slot_time)
  return (
    <Modal onClose={onClose} className="max-w-md">
      <h2 className="font-display text-xl text-navy">Que voulez-vous faire ?</h2>
      <p className="mt-1 text-sm text-muted">{slotLabel}</p>
      <div className="mt-5 flex flex-col gap-2">
        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition hover:border-primary/40 hover:bg-cyan-tint/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-white">
              <Plus className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-navy">Nouveau rendez-vous</span>
              <span className="block text-xs text-muted">Créer un RDV sur ce créneau</span>
            </span>
          </button>
        ) : null}
        {canMove ? (
          <button
            type="button"
            onClick={onMove}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition hover:border-primary/40 hover:bg-cyan-tint/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
              <ArrowLeftRight className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-navy">Déplacer un rendez-vous</span>
              <span className="block text-xs text-muted">Déplacer un RDV existant vers ce créneau</span>
            </span>
          </button>
        ) : null}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
      </div>
    </Modal>
  )
}

function ProposeSlotModal({
  slot,
  busy,
  intent = 'both',
  onClose,
  onPropose,
  onMove,
}: {
  slot: AgendaSlot
  busy: boolean
  intent?: 'both' | 'move'
  onClose: () => void
  onPropose: (patient: { customer_id: number; appointment_id: number }) => void
  onMove: (appointmentId: number) => void
}) {
  type PatientHit = {
    customer_id: number
    full_name: string
    phone_display?: string
    phone_number?: string
    on_waitlist?: boolean
    active_appointment: {
      id: number
      appointment_date: string
      appointment_time: string
      status: string
      appointment_type?: string | null
    } | null
  }

  const moveOnly = intent === 'move'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [selected, setSelected] = useState<PatientHit | null>(null)
  const [step, setStep] = useState<'search' | 'confirm_propose' | 'confirm_move'>('search')
  const [localError, setLocalError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearchError('')
      return undefined
    }
    searchTimer.current = setTimeout(() => {
      void (async () => {
        setSearching(true)
        setSearchError('')
        try {
          const payload = await api<{ patients?: PatientHit[] }>(
            `/dashboard/api/agenda/patients-for-slot?q=${encodeURIComponent(q)}&limit=20`,
          )
          let rows = payload.patients || []
          if (moveOnly) {
            rows = rows.filter((p) => p.active_appointment?.id)
          }
          setResults(rows)
        } catch {
          // Fallback: same CRM search as the Patients page (older servers may lack patients-for-slot)
          try {
            const fallback = await api<{
              patients?: Array<{
                id: number
                full_name: string
                phone_number?: string
                next_appointment?: {
                  id: number
                  appointment_date: string
                  appointment_time: string
                  status: string
                } | null
              }>
            }>(`/dashboard/api/patients?q=${encodeURIComponent(q)}&limit=20`)
            let mapped = (fallback.patients || []).map((p) => ({
              customer_id: p.id,
              full_name: p.full_name,
              phone_number: p.phone_number,
              phone_display: p.phone_number,
              active_appointment: p.next_appointment?.id
                ? {
                  id: p.next_appointment.id,
                  appointment_date: p.next_appointment.appointment_date,
                  appointment_time: String(p.next_appointment.appointment_time || '').slice(0, 5),
                  status: p.next_appointment.status,
                }
                : null,
            }))
            if (moveOnly) {
              mapped = mapped.filter((p) => p.active_appointment?.id)
            }
            setResults(mapped)
          } catch (err) {
            setResults([])
            setSearchError(err instanceof Error ? err.message : 'Recherche impossible')
          }
        } finally {
          setSearching(false)
        }
      })()
    }, 250)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query, moveOnly])

  const slotLabel = formatAppointmentSlot(slot.slot_date, slot.slot_time)
  const initials = (selected?.full_name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?'

  function confirmMoveClick() {
    const appt = selected?.active_appointment
    if (!appt) return
    const sameDate = appt.appointment_date === slot.slot_date
    const sameTime = String(appt.appointment_time).slice(0, 5) === String(slot.slot_time).slice(0, 5)
    if (sameDate && sameTime) {
      setLocalError('Ce rendez-vous est déjà prévu sur ce créneau.')
      return
    }
    setLocalError('')
    onMove(appt.id)
  }

  if (step === 'confirm_propose' && selected?.active_appointment) {
    return (
      <Modal onClose={onClose} className="max-w-lg">
        <h2 className="text-xl font-semibold text-navy">Proposer ce créneau ?</h2>
        <div className="mt-4 space-y-3 text-[13px]">
          <div>
            <p className="text-muted">Patient</p>
            <p className="font-semibold text-navy">{selected.full_name}</p>
          </div>
          <div>
            <p className="text-muted">Rendez-vous actuel</p>
            <p className="font-medium text-navy">
              {formatAppointmentSlot(selected.active_appointment.appointment_date, selected.active_appointment.appointment_time)}
            </p>
          </div>
          <div>
            <p className="text-muted">Créneau proposé</p>
            <p className="font-medium text-navy">{slotLabel}</p>
          </div>
          <p className="rounded-xl bg-cyan-tint px-3 py-2 text-navy">
            Le rendez-vous actuel restera inchangé tant que le patient n’aura pas accepté.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setStep('search')}>Annuler</Button>
          <Button
            loading={busy}
            onClick={() => onPropose({
              customer_id: selected.customer_id,
              appointment_id: selected.active_appointment!.id,
            })}
          >
            Envoyer la proposition
          </Button>
        </div>
      </Modal>
    )
  }

  if (step === 'confirm_move' && selected?.active_appointment) {
    return (
      <Modal onClose={onClose} className="max-w-lg">
        <h2 className="text-xl font-semibold text-navy">Déplacer le rendez-vous ?</h2>
        <div className="mt-4 space-y-3 text-[13px]">
          <div>
            <p className="text-muted">Patient</p>
            <p className="font-semibold text-navy">{selected.full_name}</p>
          </div>
          <div>
            <p className="text-muted">Ancien créneau</p>
            <p className="font-medium text-navy">
              {formatAppointmentSlot(selected.active_appointment.appointment_date, selected.active_appointment.appointment_time)}
            </p>
          </div>
          <div>
            <p className="text-muted">Nouveau créneau</p>
            <p className="font-medium text-navy">{slotLabel}</p>
          </div>
          {localError ? <p className="text-sm text-danger">{localError}</p> : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setLocalError(''); setStep('search') }}>Annuler</Button>
          <Button loading={busy} onClick={confirmMoveClick}>
            Confirmer le déplacement
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-tint text-primary">
          {moveOnly ? <ArrowLeftRight className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
        </div>
        <div>
          <h2 className="text-xl font-semibold text-navy">
            {moveOnly ? 'Déplacer un rendez-vous' : 'Créneau disponible'}
          </h2>
          <p className="text-sm text-muted">{slotLabel}</p>
          {slot.duration_minutes ? (
            <p className="text-xs text-muted">Durée : {slot.duration_minutes} min</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-semibold text-navy">
          {moveOnly ? 'Rechercher un rendez-vous' : 'Choisir un patient'}
        </p>
        <p className="mb-2 text-[12px] text-muted">
          {moveOnly
            ? 'Recherchez par nom, téléphone ou date du rendez-vous actuel.'
            : 'Recherchez le patient auquel vous souhaitez proposer ce créneau.'}
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
          }}
          placeholder="Rechercher patient, téléphone…"
          className="h-10 w-full rounded-[10px] border border-border bg-white px-3 text-sm text-navy outline-none focus:border-primary"
        />
      </div>

      {selected ? (
        <div className="mt-4 rounded-[12px] border border-border bg-[#F7FBFC] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {moveOnly ? 'Rendez-vous sélectionné' : 'Patient sélectionné'}
          </p>
          <div className="mt-2 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-navy">{selected.full_name}</p>
              <p className="text-[13px] text-muted">{selected.phone_display || selected.phone_number}</p>
              {selected.on_waitlist ? (
                <span className="mt-1 inline-flex rounded-md bg-cyan-tint px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  En liste d’attente
                </span>
              ) : null}
              {selected.active_appointment ? (
                <div className="mt-2 space-y-0.5 text-[13px] text-navy">
                  <p>
                    <span className="text-muted">Actuellement · </span>
                    {formatAppointmentSlot(
                      selected.active_appointment.appointment_date,
                      selected.active_appointment.appointment_time,
                    )}
                  </p>
                  {selected.active_appointment.appointment_type ? (
                    <p className="text-muted">{selected.active_appointment.appointment_type}</p>
                  ) : null}
                  <p className="text-xs text-muted">
                    {appointmentStatusLabel(selected.active_appointment.status)}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-warning">Aucun rendez-vous actif</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
          {searching ? <li className="text-sm text-muted">Recherche…</li> : null}
          {!searching && searchError ? (
            <li className="text-sm text-danger">{searchError}</li>
          ) : null}
          {!searching && !searchError && query.trim().length >= 2 && !results.length ? (
            <li className="text-sm text-muted">
              {moveOnly ? 'Aucun rendez-vous déplaçable trouvé.' : 'Aucun patient trouvé.'}
            </li>
          ) : null}
          {results.map((p) => (
            <li key={p.customer_id}>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-white px-3 py-2.5 text-left hover:bg-bg"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8ECF0] text-xs font-bold text-navy">
                  {(p.full_name || '?').split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || '').join('') || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy">{p.full_name}</p>
                  <p className="text-xs text-muted">{p.phone_display || p.phone_number}</p>
                  {p.active_appointment ? (
                    <p className="mt-1 text-xs text-navy">
                      {formatAppointmentSlot(p.active_appointment.appointment_date, p.active_appointment.appointment_time)}
                      {' · '}
                      {appointmentStatusLabel(p.active_appointment.status)}
                      {p.active_appointment.appointment_type
                        ? ` · ${p.active_appointment.appointment_type}`
                        : ''}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-warning">Aucun rendez-vous actif</p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
        {!moveOnly ? (
          <Button
            variant="secondary"
            disabled={!selected?.active_appointment || busy}
            onClick={() => setStep('confirm_propose')}
          >
            Envoyer une proposition
          </Button>
        ) : null}
        <Button
          disabled={!selected?.active_appointment || busy}
          onClick={() => setStep('confirm_move')}
        >
          {moveOnly ? 'Continuer' : 'Déplacer directement'}
        </Button>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-navy">{value}</span>
    </div>
  )
}
