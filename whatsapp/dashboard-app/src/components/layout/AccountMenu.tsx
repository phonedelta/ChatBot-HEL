import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { LogOut, Settings, User } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getAppPortalRoot } from '@/lib/portal-root'
import { cn, initials } from '@/lib/format'
import { roleLabel } from '@/lib/permissions'

type PanelPos = { top: number; left: number; width: number }

function computePanelPos(btn: HTMLElement): PanelPos {
  const rect = btn.getBoundingClientRect()
  const gap = 8
  const width = Math.min(260, window.innerWidth - 16)
  let left = rect.right - width
  if (left < 8) left = 8
  return {
    top: rect.bottom + gap,
    left,
    width,
  }
}

export function AccountMenu({ className }: { className?: string }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PanelPos | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const displayName = user?.displayName || 'Utilisateur'
  const subtitle = user?.roleLabel || roleLabel(user?.role)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null)
      return
    }
    const update = () => {
      if (btnRef.current) setPos(computePanelPos(btnRef.current))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const panel = open && pos
    ? createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label="Menu compte"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-[10040] overflow-hidden rounded-[14px] border border-border bg-white shadow-soft"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
                {initials(displayName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-navy">{displayName}</p>
                <p className="truncate text-xs text-[var(--color-muted-accessible)]">{subtitle}</p>
              </div>
            </div>
          </div>
          <div className="p-1.5">
            <Link
              to="/parametres"
              role="menuitem"
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-navy hover:bg-cyan-tint"
              onClick={() => setOpen(false)}
            >
              <Settings className="h-4 w-4 text-muted" aria-hidden />
              Paramètres
            </Link>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-danger hover:bg-danger/5"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Déconnexion
            </button>
          </div>
        </div>,
        getAppPortalRoot(),
      )
    : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cn(
          'relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#E8EEF2] text-navy transition-colors hover:bg-[#DEE5EC]',
          className,
        )}
        aria-label="Compte"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <User className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </button>
      {panel}
    </>
  )
}
