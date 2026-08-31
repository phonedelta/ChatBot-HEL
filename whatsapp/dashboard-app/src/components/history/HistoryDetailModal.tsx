import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/format'
import { activityCategoryLabel, appointmentStatusLabel } from '@/lib/labels'
import {
  formatHistoryChangeValue,
  historyActionDetailText,
  historyCategoryIcon,
  historyCategoryTint,
  historyDrawerCategoryLabel,
  historyOriginLabel,
  isDashboardUserEvent,
} from '@/lib/history-ui'
import { ActorBadge, type HistoryActor, type ExecutedByUser } from '@/components/history/ActorBadge'
import type { HistoryTargetUser } from '@/lib/history-ui'
import { Button } from '@/components/ui/Button'

export type HistoryDetailItem = {
  id: number
  event_type: string
  category: string
  actor?: HistoryActor
  executedBy: ExecutedByUser | null
  targetUser?: HistoryTargetUser | null
  actor_type: string
  origin?: string | null
  source: string | null
  patient_id: number | null
  patient_name: string | null
  conversation_id: number | null
  appointment_id: number | null
  title: string
  description: string | null
  severity: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  source_event_id?: string | null
  created_at: string
}

function formatFullDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ProfileCard({
  user,
  statusLabel,
}: {
  user: {
    displayName: string
    role?: string | null
    roleLabel?: string | null
    initials?: string
  }
  statusLabel?: string | null
}) {
  const initials = user.role === 'admin'
    ? 'AD'
    : (user.initials || user.displayName.slice(0, 2).toUpperCase())
  const role = user.roleLabel || null

  return (
    <div className="rounded-[14px] border border-border bg-[#F9FCFD] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-navy">{user.displayName}</p>
          {role ? <p className="truncate text-[13px] text-muted">{role}</p> : null}
          {statusLabel ? <p className="mt-0.5 text-xs text-muted">{statusLabel}</p> : null}
        </div>
      </div>
    </div>
  )
}

function ModalBadge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'warning' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-semibold',
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-cyan-tint text-primary',
      )}
    >
      {children}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</p>
  )
}

function InfoCard({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-[#F9FCFD]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-sm text-muted">{row.label}</dt>
          <dd className="text-right text-sm font-medium text-navy">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function historyActorFromItem(item: HistoryDetailItem): HistoryActor {
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
    displayName: item.executedBy?.displayName || 'Utilisateur',
    role: item.executedBy?.role ?? null,
    roleLabel: item.executedBy?.roleLabel ?? null,
  }
}

function ExecutedBySection({ item }: { item: HistoryDetailItem }) {
  const actor = historyActorFromItem(item)

  if (actor.type === 'dashboard_user' && actor.userId) {
    return (
      <ProfileCard
        user={{
          displayName: actor.displayName,
          role: actor.role,
          roleLabel: actor.roleLabel || undefined,
        }}
      />
    )
  }

  return (
    <div className="rounded-[14px] border border-border bg-[#F9FCFD] px-4 py-3">
      <ActorBadge actor={actor} />
    </div>
  )
}

function ConcernedSection({ item }: { item: HistoryDetailItem }) {
  const targetUser = item.targetUser ?? null
  const meta = item.metadata || {}

  if (targetUser) {
    return (
      <section>
        <SectionTitle>Utilisateur concerné</SectionTitle>
        <div className="mt-2">
          <ProfileCard user={targetUser} statusLabel={targetUser.statusLabel} />
        </div>
      </section>
    )
  }

  if (item.appointment_id || item.category === 'appointment' || String(item.event_type).includes('appointment')) {
    const apptValue = item.new_value || item.old_value || meta
    const dateStr = apptValue?.date ? formatHistoryChangeValue({ date: apptValue.date, time: apptValue.time }) : null
    const status = apptValue?.status ? appointmentStatusLabel(String(apptValue.status)) : null

    return (
      <section>
        <SectionTitle>Rendez-vous concerné</SectionTitle>
        <div className="mt-2 rounded-[14px] border border-border bg-[#F9FCFD] px-4 py-3 text-sm">
          {item.patient_name ? (
            <p><span className="text-muted">Patient : </span><span className="font-medium text-navy">{item.patient_name}</span></p>
          ) : null}
          {dateStr ? (
            <p className={item.patient_name ? 'mt-2' : ''}><span className="text-muted">Date : </span><span className="text-navy">{dateStr}</span></p>
          ) : null}
          {status ? (
            <p className="mt-2"><span className="text-muted">Statut : </span><span className="text-navy">{status}</span></p>
          ) : null}
        </div>
      </section>
    )
  }

  if (item.patient_id || item.patient_name) {
    return (
      <section>
        <SectionTitle>Patient concerné</SectionTitle>
        <div className="mt-2 rounded-[14px] border border-border bg-[#F9FCFD] px-4 py-3">
          <p className="text-[15px] font-semibold text-navy">{item.patient_name || `Patient #${item.patient_id}`}</p>
        </div>
      </section>
    )
  }

  return null
}

function ModalPanel({ item, onClose }: { item: HistoryDetailItem; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    panelRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const meta = item.metadata || {}
  const Icon = historyCategoryIcon(item.category, item.event_type)
  const tint = historyCategoryTint(item.category, item.severity)
  const origin = historyOriginLabel(item.source, item.actor_type, item.origin)
  const categoryBadge = historyDrawerCategoryLabel(item.event_type, item.category)
  const categoryLabel = isDashboardUserEvent(item.event_type)
    ? 'Utilisateurs'
    : activityCategoryLabel(item.category)
  const targetUser = item.targetUser ?? null
  const actionDetail = historyActionDetailText(item.event_type, targetUser, item.description)

  const hasPatientLink = Boolean(item.patient_id)
  const hasConversationLink = Boolean(item.conversation_id)
  const hasAppointmentLink = Boolean(item.appointment_id)

  return (
    <div
      className="app-zoom-cover z-50 flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <motion.button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-[rgba(18,50,74,0.32)] backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-detail-title"
        tabIndex={-1}
        className={cn(
          'relative flex w-full max-w-[720px] flex-col overflow-hidden',
          'rounded-[20px] border border-border bg-white',
          'shadow-[0_24px_60px_rgba(18,50,74,0.18)]',
          'max-h-[min(760px,calc(100dvh/var(--app-zoom)-64px))] sm:max-h-[calc(100dvh/var(--app-zoom)-64px)]',
        )}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed */}
        <header className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
          <div className="flex gap-3">
            <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tint)}>
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 id="history-detail-title" className="text-lg font-semibold leading-snug text-navy">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted">{formatFullDateTime(item.created_at)}</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <ModalBadge>{categoryBadge}</ModalBadge>
                    {item.severity === 'sensitive' ? (
                      <ModalBadge tone="warning">Action sensible</ModalBadge>
                    ) : null}
                    {item.severity === 'error' ? (
                      <ModalBadge tone="warning">Erreur</ModalBadge>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted transition-colors hover:bg-[#F5FAFC] hover:text-navy"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Body — scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 scrollbar-thin">
          <div className="space-y-5">
            <section>
              <SectionTitle>Exécuté par</SectionTitle>
              <div className="mt-2">
                <ExecutedBySection item={item} />
              </div>
            </section>

            <ConcernedSection item={item} />

            {actionDetail ? (
              <section>
                <SectionTitle>Détail de l&apos;action</SectionTitle>
                <div className="mt-2 rounded-[14px] border border-border bg-[#F8FCFD] p-4">
                  <p className="text-sm leading-relaxed text-navy">{actionDetail}</p>
                </div>
              </section>
            ) : null}

            {item.old_value && item.new_value ? (
              <section>
                <SectionTitle>Modification</SectionTitle>
                <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="rounded-[14px] border border-border bg-[#F8FCFD] p-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Avant</p>
                    <p className="mt-1 text-sm text-navy">{formatHistoryChangeValue(item.old_value)}</p>
                  </div>
                  <span className="hidden text-center text-muted sm:block">→</span>
                  <div className="rounded-[14px] border border-border bg-[#F8FCFD] p-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Après</p>
                    <p className="mt-1 text-sm text-navy">{formatHistoryChangeValue(item.new_value)}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {item.event_type === 'dental_problem_detected' && meta ? (
              <section className="rounded-[14px] border border-border bg-cyan-tint/30 p-4">
                <SectionTitle>Classification</SectionTitle>
                <dl className="mt-2 space-y-1 text-sm">
                  {meta.problem_label ? (
                    <div>
                      <dt className="inline text-muted">Problème : </dt>
                      <dd className="inline text-navy">{String(meta.problem_label)}</dd>
                    </div>
                  ) : null}
                  {meta.service ? (
                    <div>
                      <dt className="inline text-muted">Service : </dt>
                      <dd className="inline text-navy">{String(meta.service)}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            <section>
              <SectionTitle>Informations</SectionTitle>
              <div className="mt-2">
                <InfoCard
                  rows={[
                    { label: 'Origine', value: origin },
                    { label: 'Catégorie', value: categoryLabel },
                  ]}
                />
              </div>
            </section>
          </div>
        </div>

        {/* Footer — fixed */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap gap-2">
            {hasPatientLink ? (
              <Link
                to={`/patients?patient=${item.patient_id}`}
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-2xl border border-border bg-white px-3 text-sm font-medium text-navy transition-colors hover:border-primary hover:bg-cyan-tint"
              >
                Voir le patient
              </Link>
            ) : null}
            {hasAppointmentLink ? (
              <Link
                to={`/agenda?highlight=${item.appointment_id}`}
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-2xl border border-border bg-white px-3 text-sm font-medium text-navy transition-colors hover:border-primary hover:bg-cyan-tint"
              >
                Voir le rendez-vous
              </Link>
            ) : null}
            {hasConversationLink ? (
              <Link
                to={`/messages?c=${item.conversation_id}`}
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-2xl border border-border bg-white px-3 text-sm font-medium text-navy transition-colors hover:border-primary hover:bg-cyan-tint"
              >
                Voir la conversation
              </Link>
            ) : null}
          </div>
          <Button variant="secondary" size="sm" onClick={onClose} className="ml-auto">
            Fermer
          </Button>
        </footer>
      </motion.div>
    </div>
  )
}

export function HistoryDetailModal({
  item,
  onClose,
}: {
  item: HistoryDetailItem | null
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {item ? <ModalPanel key={item.id} item={item} onClose={onClose} /> : null}
    </AnimatePresence>
  )
}

/** @deprecated Use HistoryDetailModal */
export const HistoryDetailDrawer = HistoryDetailModal
