import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { cn, initials } from '@/lib/format'
import type { ConversationContextPayload } from '@/lib/conversation-context'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'

function ContextFieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[12px] leading-snug">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-navy [overflow-wrap:anywhere]">
        {value}
      </span>
    </div>
  )
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-bg px-3 py-2.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-navy [overflow-wrap:anywhere]">{value}</p>
    </div>
  )
}

function ContextCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[14px] border border-border bg-white p-4', className)}>
      {children}
    </div>
  )
}

function PatientQuickCardSkeleton() {
  return (
    <ContextCard>
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Skeleton className="h-9 rounded-[9px]" />
        <Skeleton className="h-9 rounded-[9px]" />
      </div>
    </ContextCard>
  )
}

function AISummarySkeleton() {
  return (
    <ContextCard>
      <Skeleton className="mb-3 h-4 w-2/3" />
      <div className="space-y-2">
        <Skeleton className="h-14 rounded-[10px]" />
        <Skeleton className="h-14 rounded-[10px]" />
        <Skeleton className="h-14 rounded-[10px]" />
      </div>
    </ContextCard>
  )
}

function formatLinkedNextAppt(
  next?: {
    appointment_date: string
    appointment_time: string
  } | null,
) {
  if (!next?.appointment_date) return 'Aucun rendez-vous à venir'
  return `Prochain RDV : ${next.appointment_date} · ${String(next.appointment_time || '').slice(0, 5)}`
}

function PatientQuickCard({ context }: { context: ConversationContextPayload }) {
  const { patient, contact, linked_patients, active_patient_context_id, next_appointment, last_contact } = context
  const linked = linked_patients || []
  const contactPhone = contact?.phone_display || patient.phone_display
  const contactName = contact?.display_name || patient.display_name

  return (
    <ContextCard>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Contact WhatsApp</p>
      <div className="mt-2 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
          {initials(contactName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-navy">{contactPhone}</p>
          {contact?.display_name ? (
            <p className="mt-0.5 text-[12px] text-muted">Nom WhatsApp : {contact.display_name}</p>
          ) : null}
          <p className="mt-0.5 text-[12px] text-muted">{patient.language_subtitle}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <ContextFieldRow label="Dernier contact" value={last_contact.display} />
        <ContextFieldRow label="Source" value={patient.source_label} />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Patients liés</p>
          <span className="rounded-md bg-bg px-1.5 py-0.5 text-[11px] font-semibold text-navy">
            {linked.length}
          </span>
        </div>

        {!linked.length ? (
          <p className="text-[13px] text-muted">Aucun patient encore identifié.</p>
        ) : (
          <ul className="max-h-52 space-y-2 overflow-y-auto">
            {linked.map((p) => {
              const isActive = Number(active_patient_context_id) === Number(p.id)
              return (
                <li
                  key={p.id}
                  className={cn(
                    'rounded-[10px] border px-2.5 py-2',
                    isActive ? 'border-primary/40 bg-cyan-tint/50' : 'border-border bg-bg',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-navy">
                      {initials(p.full_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-navy">{p.full_name}</p>
                      <p className="text-[11px] text-muted">{formatLinkedNextAppt(p.next_appointment)}</p>
                      {isActive ? (
                        <p className="mt-0.5 text-[10px] font-semibold text-primary">Patient concerné actuellement</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <Link
                          to={`/patients/${p.id}`}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Voir
                        </Link>
                        <Link
                          to={`/agenda?patient=${p.id}`}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Agenda
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {linked.length <= 1 && next_appointment ? (
        <div className="mt-3">
          <ContextFieldRow label="Prochain rendez-vous" value={next_appointment.display} />
        </div>
      ) : null}
    </ContextCard>
  )
}

function ConversationAISummaryCard({ context }: { context: ConversationContextPayload }) {
  const { summary } = context

  if (!summary.has_summary) {
    return (
      <ContextCard>
        <h3 className="text-[15px] font-semibold text-navy">Résumé IA de la conversation</h3>
        <p className="mt-3 text-[13px] text-muted">Pas encore de résumé.</p>
        <p className="mt-1 text-[12px] text-muted">
          Le résumé sera généré après suffisamment de contexte.
        </p>
      </ContextCard>
    )
  }

  return (
    <ContextCard>
      <h3 className="mb-3 text-[15px] font-semibold text-navy">Résumé IA de la conversation</h3>
      <div className="space-y-2">
        {summary.reason ? (
          <SummaryField label="Motif de contact" value={summary.reason.label} />
        ) : null}
        {summary.action ? (
          <SummaryField label="Action effectuée" value={summary.action.label} />
        ) : (
          <SummaryField label="Action effectuée" value="Aucune action pour le moment" />
        )}
        <SummaryField label="Statut" value={summary.status.label} />
        {summary.next_action ? (
          <SummaryField label="Prochaine action" value={summary.next_action.label} />
        ) : (
          <SummaryField label="Prochaine action" value="Aucune action nécessaire" />
        )}
      </div>
    </ContextCard>
  )
}

function WaitlistCard({ context }: { context: ConversationContextPayload }) {
  const entry = context.waitlist
  if (!entry?.active) return null

  return (
    <ContextCard>
      <h3 className="text-[15px] font-semibold text-navy">Liste d’attente</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted [overflow-wrap:anywhere]">
        {entry.description}
      </p>
    </ContextCard>
  )
}

type Props = {
  conversationId: number | null
  context: ConversationContextPayload | null
  loading: boolean
  error: string
  onRetry: () => void
}

export function ConversationContextPanel({
  conversationId,
  context,
  loading,
  error,
  onRetry,
}: Props) {
  if (!conversationId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <p className="text-[13px] text-muted">
          Sélectionnez une conversation pour afficher les informations du patient.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <PatientQuickCardSkeleton />
        <AISummarySkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <ContextCard>
        <p className="text-[13px] text-muted">Impossible de charger les informations du patient.</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3 w-full"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={onRetry}
        >
          Réessayer
        </Button>
      </ContextCard>
    )
  }

  if (!context) return null

  return (
    <div className="space-y-4">
      <PatientQuickCard context={context} />
      <ConversationAISummaryCard context={context} />
      <WaitlistCard context={context} />
    </div>
  )
}

export {
  ContextFieldRow,
  SummaryField,
  PatientQuickCardSkeleton,
  AISummarySkeleton,
}
