import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn, initials } from '@/lib/format'
import { roleLabel } from '@/lib/permissions'

export type LoginAccount = {
  id: number
  displayName: string
  role: string
  initials?: string
}

type Props = {
  accounts: LoginAccount[]
  value: number | null
  onChange: (id: number) => void
  loading?: boolean
  error?: string
  onRetry?: () => void
  disabled?: boolean
}

export function AccountSelector({
  accounts,
  value,
  onChange,
  loading,
  error,
  onRetry,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = accounts.find((a) => a.id === value) || null

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (loading) {
    return (
      <div className="h-[52px] animate-pulse rounded-[15px] border border-border bg-[#F7FCFD] px-4 py-3 text-sm text-muted">
        Chargement des comptes…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-[15px] border border-danger/20 bg-danger/5 px-3 py-2.5 text-xs text-danger">
        <p>{error}</p>
        {onRetry ? (
          <button type="button" className="mt-1 font-medium text-primary hover:underline" onClick={onRetry}>
            Réessayer
          </button>
        ) : null}
      </div>
    )
  }

  if (!accounts.length) {
    return (
      <div className="rounded-[15px] border border-border bg-[#F7FCFD] px-3 py-2.5 text-sm text-muted">
        Aucun compte disponible.
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-[52px] w-full items-center gap-3.5 rounded-[15px] border border-border bg-white px-4 text-left text-sm transition',
          'hover:border-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {selected ? (
          <>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
              {selected.initials || initials(selected.displayName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold leading-tight text-text">{selected.displayName}</span>
              <span className="block truncate text-xs text-muted">{roleLabel(selected.role)}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-muted">Sélectionnez votre compte</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>

      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-y-auto rounded-[15px] border border-border bg-white py-1 shadow-[0_12px_32px_rgba(16,42,67,0.12)]"
        >
          {accounts.map((account) => {
            const active = account.id === value
            return (
              <li key={account.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-cyan-tint/50',
                    active && 'bg-cyan-tint/60',
                  )}
                  onClick={() => {
                    onChange(account.id)
                    setOpen(false)
                  }}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
                    {account.initials || initials(account.displayName)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-text">{account.displayName}</span>
                    <span className="block truncate text-xs text-muted">{roleLabel(account.role)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
