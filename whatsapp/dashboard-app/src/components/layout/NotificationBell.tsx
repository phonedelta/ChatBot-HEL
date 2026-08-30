import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CalendarClock, CheckCheck, X } from 'lucide-react'
import { useNotifications } from '@/context/NotificationContext'
import type { DashNotification } from '@/lib/notification-types'
import { unlockNotificationSound } from '@/lib/notification-sound'
import { cn } from '@/lib/format'

function relativeTime(iso: string) {
  const t = new Date(String(iso).replace(' ', 'T')).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'À l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  return `il y a ${d} j`
}

function formatSlotLabel(date?: string | null, time?: string | null) {
  if (!date) return ''
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = String(time || '').slice(0, 5)
  if (!m) return `${date}${t ? ` · ${t}` : ''}`
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  if (sameDay(d, today)) return `Aujourd’hui${t ? ` à ${t}` : ''}`
  if (sameDay(d, tomorrow)) return `Demain${t ? ` à ${t}` : ''}`
  try {
    const label = d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    return `${label}${t ? ` · ${t}` : ''}`
  } catch {
    return `${date}${t ? ` · ${t}` : ''}`
  }
}

export function NotificationBell() {
  const navigate = useNavigate()
  const { items, unreadCount, refresh, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
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

  function openNotification(n: DashNotification, action: 'view' | 'choose' = 'view') {
    void markRead(n.id)
    setOpen(false)
    if (n.type === 'slot_released' && n.slot_date && n.slot_time) {
      const params = new URLSearchParams({
        from: n.slot_date,
        highlightDate: n.slot_date,
        highlightTime: n.slot_time,
        view: 'week',
      })
      if (action === 'choose') params.set('action', 'choose')
      if (n.slot_available === false) params.set('slotTaken', '1')
      navigate(`/agenda?${params}`)
      return
    }
    if (n.link_path) navigate(n.link_path)
  }

  const badge = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-white text-navy hover:bg-cyan-tint"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          unlockNotificationSound()
          setOpen((v) => !v)
          if (!open) void refresh()
        }}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+8px)] z-40 flex w-[min(100vw-1.5rem,400px)] flex-col overflow-hidden rounded-[14px] border border-border bg-white shadow-soft"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-navy">Notifications</p>
              <p className="text-[11px] text-muted">
                {unreadCount > 0 ? `${unreadCount} nouvelle${unreadCount > 1 ? 's' : ''}` : 'À jour'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary hover:bg-cyan-tint"
                  onClick={() => void markAllRead()}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Tout marquer comme lu
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg p-1 text-muted hover:bg-bg"
                aria-label="Fermer"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            className={cn(
              'overflow-x-hidden overflow-y-auto scrollbar-thin',
              items.length > 2 ? 'max-h-[360px]' : 'max-h-none',
            )}
          >
            {!items.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted">
                Aucune nouvelle notification.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const unread = !n.read_at && !n.is_read
                  const expired = n.type === 'slot_released' && n.slot_available === false
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        'px-4 py-3 transition',
                        unread ? 'bg-cyan-tint/60' : 'bg-white',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-sm">
                          <CalendarClock className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold text-navy">
                              {n.type_label || n.title}
                            </p>
                            {unread ? (
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                            ) : null}
                          </div>
                          {n.slot_date ? (
                            <p className="mt-0.5 text-[13px] font-medium text-navy">
                              {formatSlotLabel(n.slot_date, n.slot_time)}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[12px] text-muted">{n.body}</p>
                          {expired ? (
                            <p className="mt-1 text-[11px] font-semibold text-warning">
                              Créneau déjà repris ou expiré
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-muted">{relativeTime(n.created_at)}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-bg"
                              onClick={() => openNotification(n, 'view')}
                            >
                              Voir le créneau
                            </button>
                            {n.type === 'slot_released' && !expired ? (
                              <button
                                type="button"
                                className="rounded-lg bg-navy px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800"
                                onClick={() => openNotification(n, 'choose')}
                              >
                                Choisir un patient
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export type { DashNotification }
