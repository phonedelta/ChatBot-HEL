import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { formatStatus, statusTone, cn } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'

export const STATUS_OPTIONS = [
  { value: 'non_confirme', label: 'À confirmer' },
  { value: 'confirmed', label: 'Confirmé' },
  { value: 'cancelled', label: 'Annulé' },
] as const

export function normalizeStatus(value?: string | null) {
  const v = String(value || '').toLowerCase()
  if (v === 'confirmed' || v === 'confirmé' || v === 'confirme') return 'confirmed'
  if (v === 'cancelled' || v === 'annule' || v === 'annulé') return 'cancelled'
  return 'non_confirme'
}

type Props = {
  value?: string | null
  disabled?: boolean
  onChange: (next: string) => void | Promise<void>
}

function computeMenuPos(btn: HTMLElement) {
  const rect = btn.getBoundingClientRect()
  const menuWidth = 196
  const menuHeight = 148
  const gap = 8
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < menuHeight + gap
  const top = openUp ? Math.max(8, rect.top - menuHeight - gap) : rect.bottom + gap
  let left = rect.left
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, rect.right - menuWidth)
  }
  return { top, left, width: menuWidth }
}

export function StatusSelect({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = normalizeStatus(value)

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
      setPos(null)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setPos(null)
      }
    }

    function onReposition() {
      if (!btnRef.current) return
      setPos(computeMenuPos(btnRef.current))
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  function toggle() {
    if (disabled || saving) return
    if (open) {
      setOpen(false)
      setPos(null)
      return
    }
    if (!btnRef.current) return
    setPos(computeMenuPos(btnRef.current))
    setOpen(true)
  }

  async function select(next: string) {
    if (next === current || saving || disabled) return
    setSaving(true)
    try {
      await onChange(next)
    } finally {
      setSaving(false)
      setOpen(false)
      setPos(null)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || saving}
        onClick={toggle}
        className={cn(
          'inline-flex items-center rounded-full transition duration-250 disabled:opacity-60',
          'hover:ring-2 hover:ring-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/30',
        )}
        title="Changer le statut"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Badge tone={statusTone(current)} className="gap-1 pr-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              current === 'confirmed' && 'bg-success',
              current === 'cancelled' && 'bg-danger',
              current === 'non_confirme' && 'bg-warning',
            )}
          />
          {saving ? '…' : formatStatus(current)}
          <ChevronDown className={cn('h-3.5 w-3.5 opacity-70 transition', open && 'rotate-180')} />
        </Badge>
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              className="fixed z-[10050] rounded-2xl border border-border bg-white p-1.5 shadow-[0_16px_40px_rgba(16,42,67,0.16)]"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_OPTIONS.map((opt) => {
                const active = opt.value === current
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={saving}
                    onPointerDown={(e) => {
                      // Apply on pointerdown so the menu choice wins over outside-close handlers
                      e.preventDefault()
                      e.stopPropagation()
                      void select(opt.value)
                    }}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                      active ? 'bg-primary/10 font-semibold text-primary' : 'text-text hover:bg-[#f3fbfd]',
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          opt.value === 'confirmed' && 'bg-success',
                          opt.value === 'cancelled' && 'bg-danger',
                          opt.value === 'non_confirme' && 'bg-warning',
                        )}
                      />
                      {opt.label}
                    </span>
                    {active ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
