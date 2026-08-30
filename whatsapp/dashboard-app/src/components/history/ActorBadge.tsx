import { Bot } from 'lucide-react'
import { cn } from '@/lib/format'
import { roleLabel } from '@/lib/permissions'

export type HistoryActor = {
  type: string
  userId?: number | null
  displayName: string
  role?: string | null
  roleLabel?: string | null
  initials?: string
}

export type ExecutedByUser = {
  userId: number
  displayName: string
  role?: string | null
  roleLabel?: string | null
  initials?: string
}

function normalizeActorType(type?: string | null) {
  const v = String(type || '').toLowerCase()
  if (v === 'assistant_ai' || v === 'ai' || v === 'assistant' || v === 'patient' || v === 'system') {
    return 'assistant_ai'
  }
  return 'dashboard_user'
}

function actorInitials(name: string, role?: string | null, initials?: string) {
  if (initials) return initials
  if (role === 'admin') return 'AD'
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function actorRoleLabel(actor: { role?: string | null; roleLabel?: string | null; type?: string }) {
  if (normalizeActorType(actor.type) === 'assistant_ai') return 'Automatisation'
  if (actor.roleLabel) return actor.roleLabel
  if (actor.role) return roleLabel(actor.role)
  return null
}

export function ExecutedBy({
  actor,
  className,
}: {
  actor: HistoryActor | null | undefined
  className?: string
}) {
  if (!actor?.displayName) {
    return <span className={cn('text-sm text-muted', className)}>—</span>
  }
  return <ActorBadge actor={actor} className={className} />
}

export function ActorBadge({
  actor,
  compact = false,
  className,
}: {
  actor: HistoryActor
  compact?: boolean
  className?: string
}) {
  const type = normalizeActorType(actor.type)
  const role = actorRoleLabel({ ...actor, type })

  if (type === 'assistant_ai') {
    return (
      <div className={cn('inline-flex items-center gap-2.5', className)}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-primary">
          <Bot className="h-4 w-4" aria-hidden />
        </span>
        {!compact ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-navy">Assistant IA</p>
            <p className="truncate text-xs text-muted">Automatisation</p>
          </div>
        ) : null}
      </div>
    )
  }

  const name = actor.displayName || 'Utilisateur'
  const initials = actorInitials(name, actor.role, actor.initials)

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-xs font-semibold text-primary">
        {initials}
      </span>
      {!compact ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-navy">{name}</p>
          {role ? <p className="truncate text-xs text-muted">{role}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export function ActorInline({ actor }: { actor: HistoryActor }) {
  const type = normalizeActorType(actor.type)
  const role = actorRoleLabel({ ...actor, type })

  if (type === 'assistant_ai') {
    return <span className="text-sm text-navy">Assistant IA</span>
  }

  return (
    <span className="text-sm text-navy">
      {actor.displayName}
      {role ? <span className="text-muted"> · {role}</span> : null}
    </span>
  )
}
