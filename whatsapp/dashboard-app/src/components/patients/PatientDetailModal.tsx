import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRightCircle,
  Calendar,
  CalendarPlus,
  ChevronRight,
  MessageCircle,
  Phone,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { ModalShell } from '@/components/ui/ModalShell'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import {
  cn,
  formatAppointmentSlot,
  formatLastContact,
  formatPhone,
  formatStatus,
  getLanguageLabel,
  getSourceLabel,
  initials,
  isSafePhone,
  statusTone,
} from '@/lib/format'

export type NextAction = {
  type: string
  label: string
  priority?: string
}

export type PatientContext = {
  patient: {
    id: number
    full_name: string
    city?: string | null
    phone_display?: string | null
    phone_number?: string | null
    language_label?: string
    source_label?: string
    created_at?: string
    subtitle?: string
  }
  contact?: {
    id?: number | null
    phone?: string | null
    phone_display?: string | null
    shared?: boolean
    linked_patients_count?: number
    channel?: string | null
  } | null
  linked_patients?: Array<{ id: number; full_name: string; next_appointment?: unknown }>
  next_appointment?: {
    id: number
    appointment_date: string
    appointment_time: string
    status: string
    status_label?: string
    type?: string
  } | null
  upcoming_appointments?: Array<{
    id: number
    appointment_date: string
    appointment_time: string
    status: string
    status_label?: string
    type?: string
  }>
  next_action?: NextAction
  confirmation?: { label?: string } | null
  last_contact_at?: string | null
  conversation_id?: number | null
  timeline?: Array<{
    id: number
    created_at: string
    title: string
    detail?: string | null
  }>
}

type PatientDetailModalProps = {
  open: boolean
  patientId: number | null
  patientName?: string | null
  context: PatientContext | null
  loading: boolean
  error?: string | null
  onClose: () => void
  onRetry?: () => void
  onOpenPatient: (id: number) => void
  onCreateAppointment: () => void
  onCallPhone: (phone?: string | null) => void
  onCancelAppointment: (appointmentId?: number | null) => void
}

function nextActionLabel(action?: NextAction | string | null) {
  if (!action) return 'Aucune action requise'
  if (typeof action === 'string') return action
  return action.label || 'Aucune action requise'
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

function formatTimelineWhen(iso?: string | null) {
  const raw = String(iso || '').trim()
  if (!raw) return ''
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return `Aujourd’hui · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatLongAppointmentDate(date: string, time: string): { datePart: string; timePart: string } {
  const d = new Date(String(date).includes('T') ? date : `${date}T${time || '12:00:00'}`)
  if (Number.isNaN(d.getTime())) {
    const fallback = formatAppointmentSlot(date, time)
    const parts = fallback.split(' · ')
    return { datePart: parts[0] || fallback, timePart: parts[1] || String(time).slice(0, 5) }
  }
  const datePart = d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timePart = String(time || '').slice(0, 5)
  return { datePart, timePart }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</p>
  )
}

function PatientAvatar({ name, size = 'lg' }: { name?: string | null; size?: 'sm' | 'lg' }) {
  const label = initials(name)
  const sizes = {
    sm: 'h-8 w-8 text-[10px]',
    lg: 'h-12 w-12 text-sm',
  }
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-cyan-tint font-semibold text-primary',
        sizes[size],
      )}
    >
      {label ? label : <UserRound className="h-5 w-5" aria-hidden />}
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted transition-colors hover:bg-bg hover:text-navy"
      aria-label="Fermer"
    >
      <X className="h-[18px] w-[18px]" />
    </button>
  )
}

export function PatientDetailModal({
  open,
  patientId,
  patientName,
  context,
  loading,
  error,
  onClose,
  onRetry,
  onOpenPatient,
  onCreateAppointment,
  onCallPhone,
  onCancelAppointment,
}: PatientDetailModalProps) {
  const navigate = useNavigate()
  const { can } = usePermissions()

  const canViewMessages = can(PERMISSIONS.VIEW_MESSAGES)
  const canCreateAppt = can(PERMISSIONS.CREATE_APPOINTMENT)
  const canViewAgenda = can(PERMISSIONS.VIEW_AGENDA)
  const canEditAppt = can(PERMISSIONS.EDIT_APPOINTMENT)
  const canCancelAppt = can(PERMISSIONS.CANCEL_APPOINTMENT)
  const canViewHistory = can(PERMISSIONS.VIEW_HISTORY)

  const displayName = context?.patient?.full_name || patientName || 'Patient'
  const shared = Boolean(context?.contact?.shared)
  const linkedCount = context?.contact?.linked_patients_count || 0
  const phoneDisplay = context?.patient?.phone_display
    || formatPhone(context?.patient?.phone_number)
    || '—'

  function goToConversation() {
    const convId = context?.conversation_id
    onClose()
    if (convId) navigate(`/messages?c=${convId}`)
    else navigate('/messages')
  }

  function goToAgenda(params: string) {
    onClose()
    navigate(`/agenda?${params}`)
  }

  const headerSubtitle = shared
    ? 'Contact partagé · WhatsApp'
    : `${context?.patient?.subtitle || 'Patient actif'} · WhatsApp`

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      maxWidth={760}
      titleId="patient-detail-title"
      header={
        <div className="flex items-start gap-3 px-5 py-5 sm:px-6">
          <PatientAvatar name={displayName} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  id="patient-detail-title"
                  className="truncate text-[20px] font-semibold leading-snug text-navy sm:text-[22px]"
                >
                  {displayName}
                </h2>
                <p className="mt-0.5 text-[13px] text-muted sm:text-sm">{headerSubtitle}</p>
                {shared ? (
                  <span className="mt-2 inline-flex rounded-full bg-cyan-tint px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                    Contact WhatsApp partagé
                  </span>
                ) : null}
              </div>
              <CloseButton onClick={onClose} />
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-[18px] px-5 py-5 sm:px-6 sm:py-6">
        {loading && !context ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-[14px]" />
            <Skeleton className="h-32 w-full rounded-[14px]" />
            <Skeleton className="h-40 w-full rounded-[14px]" />
          </div>
        ) : null}

        {error && !context && !loading ? (
          <div className="rounded-[14px] border border-danger/20 bg-danger/5 px-4 py-4 text-sm text-danger">
            {error}
            {onRetry ? (
              <button type="button" className="ml-2 font-semibold underline" onClick={onRetry}>
                Réessayer
              </button>
            ) : null}
          </div>
        ) : null}

        {context ? (
          <>
            {/* Contact */}
            <section>
              <SectionTitle>Contact</SectionTitle>
              <div className="mt-2 rounded-[14px] border border-border bg-[#F9FCFD] p-4">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4">
                  <div>
                    <dt className="text-[12px] text-muted">Téléphone</dt>
                    <dd className="mt-0.5 text-sm font-medium text-navy">{phoneDisplay}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">Canal</dt>
                    <dd className="mt-0.5 text-sm font-medium text-navy">WhatsApp</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">Langue</dt>
                    <dd className="mt-0.5 text-sm font-medium text-navy">
                      {context.patient.language_label || getLanguageLabel(null)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-muted">Dernier contact</dt>
                    <dd className="mt-0.5 text-sm font-medium text-navy">
                      {formatLastContact(context.last_contact_at, 'whatsapp')}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2">
              {canViewMessages ? (
                <button
                  type="button"
                  onClick={goToConversation}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-white transition-opacity hover:opacity-95"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </button>
              ) : null}
              <button
                type="button"
                disabled={!isSafePhone(context.patient.phone_number)}
                onClick={() => onCallPhone(context.patient.phone_number)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-xs font-semibold text-navy transition-colors hover:bg-bg disabled:opacity-40"
              >
                <Phone className="h-3.5 w-3.5" />
                Appeler
              </button>
              {canCreateAppt ? (
                <button
                  type="button"
                  onClick={onCreateAppointment}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3.5 text-xs font-semibold text-navy transition-colors hover:bg-bg"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Créer un rendez-vous
                </button>
              ) : null}
            </div>

            {/* Shared contact alert */}
            {shared ? (
              <div className="flex gap-3 rounded-[14px] border border-primary/15 bg-cyan-tint px-4 py-3">
                <UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-[13px] font-semibold text-navy">Contact partagé</p>
                  <p className="mt-0.5 text-sm text-muted">
                    Ce numéro WhatsApp est utilisé par {linkedCount} patient{linkedCount > 1 ? 's' : ''}.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Linked patients */}
            {context.linked_patients && context.linked_patients.length > 0 ? (
              <section>
                <SectionTitle>Autres patients liés à ce contact</SectionTitle>
                <ul className="mt-2 space-y-1 rounded-[14px] border border-border bg-white p-1.5">
                  {context.linked_patients.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onOpenPatient(p.id)}
                        className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-bg"
                      >
                        <PatientAvatar name={p.full_name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-navy">
                          {p.full_name}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Next appointment */}
            <section>
              <SectionTitle>Prochain rendez-vous</SectionTitle>
              {context.next_appointment ? (
                <div className="mt-2 rounded-[14px] border border-border bg-white p-4">
                  <div className="flex gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-primary">
                      <Calendar className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      {(() => {
                        const { datePart, timePart } = formatLongAppointmentDate(
                          context.next_appointment!.appointment_date,
                          context.next_appointment!.appointment_time,
                        )
                        return (
                          <>
                            <p className="text-[15px] font-semibold text-navy">{datePart}</p>
                            <p className="text-sm text-navy">{timePart}</p>
                          </>
                        )
                      })()}
                      {context.next_appointment.type ? (
                        <p className="mt-1 text-sm text-muted">{context.next_appointment.type}</p>
                      ) : null}
                      <span
                        className={cn(
                          'mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                          statusBadgeClass(context.next_appointment.status),
                        )}
                      >
                        {context.next_appointment.status_label
                          || formatStatus(context.next_appointment.status)}
                      </span>
                      {context.confirmation?.label ? (
                        <p className="mt-2 text-xs text-muted">{context.confirmation.label}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {canViewAgenda ? (
                      <button
                        type="button"
                        onClick={() => {
                          const a = context.next_appointment!
                          goToAgenda(
                            `from=${a.appointment_date}&highlightDate=${a.appointment_date}&highlightTime=${a.appointment_time}&appointmentId=${a.id}`,
                          )
                        }}
                        className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-navy hover:bg-bg"
                      >
                        Voir dans l&apos;Agenda
                      </button>
                    ) : null}
                    {canEditAppt ? (
                      <button
                        type="button"
                        onClick={() => {
                          const a = context.next_appointment!
                          goToAgenda(
                            `from=${a.appointment_date}&highlightDate=${a.appointment_date}&highlightTime=${a.appointment_time}&action=move&appointmentId=${a.id}`,
                          )
                        }}
                        className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-navy hover:bg-bg"
                      >
                        Déplacer
                      </button>
                    ) : null}
                    {canCancelAppt ? (
                      <button
                        type="button"
                        onClick={() => void onCancelAppointment(context.next_appointment?.id)}
                        className="h-8 rounded-lg border border-danger/30 px-3 text-xs font-medium text-danger hover:bg-danger/5"
                      >
                        Annuler
                      </button>
                    ) : null}
                  </div>

                  {context.upcoming_appointments && context.upcoming_appointments.length > 1 ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="mb-1.5 text-[12px] font-semibold text-navy">Rendez-vous à venir</p>
                      <ul className="space-y-1">
                        {context.upcoming_appointments.slice(0, 3).map((a) => (
                          <li key={a.id} className="text-xs text-muted">
                            {formatAppointmentSlot(a.appointment_date, a.appointment_time)}
                            {' · '}
                            {a.status_label || formatStatus(a.status)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 rounded-[14px] border border-dashed border-border bg-[#F9FCFD] px-4 py-5 text-center">
                  <p className="text-sm text-muted">Aucun rendez-vous à venir</p>
                  {canCreateAppt ? (
                    <button
                      type="button"
                      onClick={onCreateAppointment}
                      className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Créer un rendez-vous
                    </button>
                  ) : null}
                </div>
              )}
            </section>

            {/* Next action */}
            <section>
              <SectionTitle>Prochaine action</SectionTitle>
              <div className="mt-2 flex items-start gap-3 rounded-[14px] border border-border bg-[#F9FCFD] px-4 py-3">
                <ArrowRightCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p className={cn('text-sm font-medium', nextActionTone(context.next_action))}>
                  {nextActionLabel(context.next_action)}
                </p>
              </div>
            </section>

            {/* Last contact */}
            <section>
              <SectionTitle>Dernier contact</SectionTitle>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border px-4 py-3">
                <p className="text-sm text-navy">
                  {formatLastContact(context.last_contact_at, 'whatsapp')}
                </p>
                {canViewMessages && context.conversation_id ? (
                  <button
                    type="button"
                    onClick={goToConversation}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Voir la conversation
                  </button>
                ) : null}
              </div>
            </section>

            {/* Patient info */}
            <section>
              <SectionTitle>Informations patient</SectionTitle>
              <dl className="mt-2 divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-[#F9FCFD]">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-muted">Nom</dt>
                  <dd className="text-right text-sm font-medium text-navy">{context.patient.full_name}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-muted">Téléphone</dt>
                  <dd className="text-right text-sm font-medium text-navy">{phoneDisplay}</dd>
                </div>
                {context.patient.city ? (
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-muted">Ville</dt>
                    <dd className="text-right text-sm font-medium text-navy">{context.patient.city}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-muted">Langue</dt>
                  <dd className="text-right text-sm font-medium text-navy">
                    {context.patient.language_label || getLanguageLabel(null)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-sm text-muted">Source</dt>
                  <dd className="text-right text-sm font-medium text-navy">
                    {context.patient.source_label || getSourceLabel(null)}
                  </dd>
                </div>
                {context.patient.created_at ? (
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-muted">Date de création</dt>
                    <dd className="text-right text-sm font-medium text-navy">
                      {new Date(String(context.patient.created_at).replace(' ', 'T'))
                        .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {/* Recent activity */}
            {canViewHistory ? (
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <SectionTitle>Activité récente</SectionTitle>
                  {patientId ? (
                    <Link
                      to={`/historique?patientId=${patientId}`}
                      onClick={onClose}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Voir tout l&apos;historique
                    </Link>
                  ) : null}
                </div>
                {!context.timeline?.length ? (
                  <p className="text-sm text-muted">Aucune activité pour l&apos;instant.</p>
                ) : (
                  <ul className="space-y-2">
                    {context.timeline.slice(0, 3).map((ev) => (
                      <li key={ev.id} className="rounded-[10px] border border-border px-3 py-2.5">
                        <p className="text-[11px] text-muted">{formatTimelineWhen(ev.created_at)}</p>
                        <p className="text-sm font-medium text-navy">{ev.title}</p>
                        {ev.detail ? <p className="text-xs text-muted">{ev.detail}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </ModalShell>
  )
}
