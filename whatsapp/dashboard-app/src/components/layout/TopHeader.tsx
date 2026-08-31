import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { AccountMenu } from '@/components/layout/AccountMenu'
import { cn, formatAppointmentSlot } from '@/lib/format'
import { appointmentStatusLabel } from '@/lib/labels'

type SearchResult = {
  patients: Array<{ id: number; full_name: string; phone_number: string }>
  appointments: Array<{
    id: number
    full_name: string
    appointment_date: string
    appointment_time: string
    status: string
    status_label?: string
  }>
}

export function TopHeader({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResult | null>(null)
  const [searchPending, setSearchPending] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setResults(null)
      setSearchPending(false)
      return undefined
    }
    setSearchPending(true)
    const timer = setTimeout(() => {
      void api<SearchResult & { ok: boolean }>(`/dashboard/api/search?q=${encodeURIComponent(q)}`)
        .then((payload) => setResults(payload))
        .catch(() => setResults({ patients: [], appointments: [] }))
        .finally(() => setSearchPending(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    navigate(`/patients?q=${encodeURIComponent(q.trim())}`)
    setOpen(false)
  }

  const resultsPanel = (
    <>
      {open && q.trim() && !searchPending && results
        && results.patients.length === 0 && results.appointments.length === 0 ? (
          <div
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[min(60vh,420px)] overflow-y-auto rounded-xl border border-border bg-white px-3 py-3 text-sm text-[var(--color-muted-accessible)] shadow-soft"
            role="status"
            aria-live="polite"
          >
            Aucun patient ou rendez-vous trouvé.
            <span className="mt-1 block text-xs">Essayez un autre nom, numéro ou rendez-vous.</span>
          </div>
        ) : null}
      {open && results && (results.patients.length > 0 || results.appointments.length > 0) ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[min(60vh,420px)] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-white shadow-soft">
          {results.patients.slice(0, 5).map((p) => (
            <Link
              key={`p-${p.id}`}
              to={`/patients/${p.id}`}
              className="block px-3 py-2.5 text-sm hover:bg-cyan-tint"
              onClick={() => setOpen(false)}
            >
              <span className="font-medium text-navy break-words">{p.full_name}</span>
              <span className="ml-2 text-[var(--color-muted-accessible)] break-all">{p.phone_number}</span>
            </Link>
          ))}
          {results.appointments.slice(0, 5).map((a) => (
            <Link
              key={`a-${a.id}`}
              to={`/agenda?highlight=${a.id}&from=${a.appointment_date}${a.status === 'cancelled' ? '&status=cancelled' : ''}`}
              className="block px-3 py-2.5 text-sm hover:bg-cyan-tint"
              onClick={() => setOpen(false)}
            >
              <span className="font-medium text-navy break-words">{a.full_name}</span>
              <span className="ml-2 text-[var(--color-muted-accessible)]">
                {formatAppointmentSlot(a.appointment_date, a.appointment_time)}
              </span>
              {a.status === 'cancelled' ? (
                <span className="ml-2 inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                  {a.status_label || appointmentStatusLabel(a.status)}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </>
  )

  return (
    <header
      className={cn(
        'mb-4 flex items-center gap-2 rounded-2xl border border-border bg-white/90 p-2.5 shadow-soft sm:mb-5 sm:gap-3 sm:p-3',
        className,
      )}
    >
      <form onSubmit={onSubmit} className="relative min-w-0 flex-1">
        <label htmlFor="global-search" className="sr-only">
          Rechercher un patient ou un rendez-vous
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          id="global-search"
          name="globalSearch"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Rechercher un patient, un rendez-vous…"
          className="h-11 w-full rounded-xl border border-border bg-bg pl-10 pr-3 text-sm text-navy outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {resultsPanel}
      </form>

      <div className="hidden shrink-0 items-center gap-2 lg:flex">
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  )
}
