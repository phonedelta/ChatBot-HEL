import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import { Button } from '@/components/ui/Button'
import { NewAppointmentModal } from '@/components/smart/NewAppointmentModal'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { cn } from '@/lib/format'

type SearchResult = {
  patients: Array<{ id: number; full_name: string; phone_number: string }>
  appointments: Array<{
    id: number
    full_name: string
    appointment_date: string
    appointment_time: string
    status: string
  }>
}

export function TopHeader({ className }: { className?: string }) {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<SearchResult | null>(null)
  const [newApptOpen, setNewApptOpen] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setResults(null)
      return undefined
    }
    const timer = setTimeout(() => {
      void api<SearchResult & { ok: boolean }>(`/dashboard/api/search?q=${encodeURIComponent(q)}`)
        .then((payload) => setResults(payload))
        .catch(() => setResults({ patients: [], appointments: [] }))
    }, 250)
    return () => clearTimeout(timer)
  }, [q])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    navigate(`/patients?q=${encodeURIComponent(q.trim())}`)
    setOpen(false)
  }

  return (
    <>
      <header
        className={cn(
          'mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-white/90 p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between',
          className,
        )}
      >
        <form onSubmit={onSubmit} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Rechercher un patient, un rendez-vous…"
            className="h-11 w-full rounded-xl border border-border bg-bg pl-10 pr-3 text-sm text-navy outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-label="Recherche globale"
          />
          {open && results && (results.patients.length > 0 || results.appointments.length > 0) ? (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border bg-white shadow-soft">
              {results.patients.slice(0, 5).map((p) => (
                <Link
                  key={`p-${p.id}`}
                  to={`/patients/${p.id}`}
                  className="block px-3 py-2 text-sm hover:bg-cyan-tint"
                >
                  <span className="font-medium text-navy">{p.full_name}</span>
                  <span className="ml-2 text-muted">{p.phone_number}</span>
                </Link>
              ))}
              {results.appointments.slice(0, 5).map((a) => (
                <Link
                  key={`a-${a.id}`}
                  to="/agenda"
                  className="block px-3 py-2 text-sm hover:bg-cyan-tint"
                >
                  <span className="font-medium text-navy">{a.full_name}</span>
                  <span className="ml-2 text-muted">
                    {a.appointment_date} {a.appointment_time}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </form>

        <div className="flex items-center gap-2">
          {can(PERMISSIONS.CREATE_APPOINTMENT) ? (
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setNewApptOpen(true)}
            >
              Nouveau rendez-vous
            </Button>
          ) : null}
          <NotificationBell />
        </div>
      </header>

      <NewAppointmentModal
        open={newApptOpen}
        onClose={() => setNewApptOpen(false)}
        onCreated={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('hel:appointment-created'))
          }
        }}
      />
    </>
  )
}
