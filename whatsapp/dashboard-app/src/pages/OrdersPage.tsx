import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { AppointmentOrder, OrdersPayload } from '@/lib/types'
import { isTodayDate, todayISO, toDateISO } from '@/lib/format'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusSelect, normalizeStatus } from '@/components/ui/StatusSelect'

function emptyAppointment(): AppointmentOrder {
  return {
    id: 'new',
    appointment_id: 0,
    full_name: '',
    phone_number: '',
    city: '',
    problem: '',
    problem_details: '',
    problem_ai: '',
    problem_client: '',
    appointment_date: todayISO(),
    appointment_time: '10:00',
    status: 'non_confirme',
  }
}

export function OrdersPage() {
  const [orders, setOrders] = useState<AppointmentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('')
  /** Show appointments from this day onward (today → future). Empty = all dates including past. */
  const [dateFrom, setDateFrom] = useState(todayISO)
  const [type, setType] = useState('upcoming')
  const [editing, setEditing] = useState<AppointmentOrder | null>(null)
  const [creating, setCreating] = useState<AppointmentOrder | null>(null)
  const [deleting, setDeleting] = useState<AppointmentOrder | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (query = q) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ tab: 'appointments', limit: '200' })
      if (query.trim()) params.set('q', query.trim())
      const payload = await api<OrdersPayload>(`/dashboard/api/orders?${params}`)
      setOrders(payload.orders || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    void load('')
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load(q)
    }, 250)
    return () => window.clearTimeout(t)
  }, [q])

  const cities = useMemo(
    () => Array.from(new Set(orders.map((o) => o.city).filter(Boolean))).sort() as string[],
    [orders],
  )

  const filtered = useMemo(() => {
    let list = [...orders]
    if (city) list = list.filter((o) => (o.city || '') === city)

    if (status) {
      list = list.filter((o) => normalizeStatus(o.status) === normalizeStatus(status === 'pending' ? 'non_confirme' : status))
    }

    if (type === 'today') {
      list = list.filter(
        (o) => isTodayDate(o.appointment_date) && normalizeStatus(o.status) === 'confirmed',
      )
    } else if (type === 'upcoming' || dateFrom) {
      const from = dateFrom || todayISO()
      list = list.filter((o) => {
        const d = toDateISO(o.appointment_date)
        return Boolean(d && d >= from)
      })
    }

    list.sort((a, b) => {
      if (type === 'upcoming' || type === 'today' || dateFrom) {
        const da = toDateISO(a.appointment_date)
        const db = toDateISO(b.appointment_date)
        if (da !== db) return da.localeCompare(db)
        const ta = String(a.appointment_time || '')
        const tb = String(b.appointment_time || '')
        if (ta !== tb) return ta.localeCompare(tb)
        return Number(a.appointment_id || 0) - Number(b.appointment_id || 0)
      }
      const ta = Date.parse(String(a.created_at || '')) || 0
      const tb = Date.parse(String(b.created_at || '')) || 0
      if (ta !== tb) return ta - tb
      return Number(a.appointment_id || 0) - Number(b.appointment_id || 0)
    })
    return list
  }, [orders, city, status, type, dateFrom])

  const stats = useMemo(() => {
    const confirmed = orders.filter((o) => normalizeStatus(o.status) === 'confirmed').length
    const cancelled = orders.filter((o) => normalizeStatus(o.status) === 'cancelled').length
    const pending = orders.filter((o) => normalizeStatus(o.status) === 'non_confirme').length
    const today = orders.filter(
      (o) => isTodayDate(o.appointment_date) && normalizeStatus(o.status) === 'confirmed',
    ).length
    return { confirmed, pending, cancelled, today }
  }, [orders])

  async function saveEdit() {
    if (!editing?.appointment_id) return
    setSaving(true)
    try {
      await api(`/dashboard/api/crm/appointments/${editing.appointment_id}`, {
        method: 'PATCH',
        body: {
          full_name: editing.full_name,
          phone_number: editing.phone_number,
          city: editing.city,
          problem: editing.problem === '—' ? '' : editing.problem,
          problem_details: editing.problem_details || editing.problem_client || '',
          appointment_date: toDateISO(editing.appointment_date) || editing.appointment_date,
          appointment_time: editing.appointment_time,
          status: editing.status,
        },
      })
      setEditing(null)
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  async function saveCreate() {
    if (!creating) return
    setSaving(true)
    setError('')
    try {
      await api('/dashboard/api/crm/appointments', {
        method: 'POST',
        body: {
          full_name: creating.full_name,
          phone_number: creating.phone_number,
          city: creating.city,
          problem: creating.problem || creating.problem_details || 'consultation générale',
          problem_details: creating.problem_details || creating.problem_client || creating.problem || '',
          appointment_date: toDateISO(creating.appointment_date) || creating.appointment_date,
          appointment_time: creating.appointment_time,
          status: creating.status || 'non_confirme',
        },
      })
      setCreating(null)
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setSaving(false)
    }
  }

  async function confirmRemove() {
    if (!deleting?.appointment_id) return
    setSaving(true)
    setError('')
    try {
      await api(`/dashboard/api/crm/appointments/${deleting.appointment_id}`, { method: 'DELETE' })
      setDeleting(null)
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(item: AppointmentOrder, nextStatus: string) {
    setError('')
    const previous = item.status
    // Optimistic update for snappy UI
    setOrders((prev) =>
      prev.map((o) =>
        o.appointment_id === item.appointment_id ? { ...o, status: nextStatus } : o,
      ),
    )
    try {
      await api(`/dashboard/api/crm/appointments/${item.appointment_id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      })
    } catch (err) {
      setOrders((prev) =>
        prev.map((o) =>
          o.appointment_id === item.appointment_id ? { ...o, status: previous } : o,
        ),
      )
      setError(err instanceof Error ? err.message : 'Impossible de changer le statut')
      throw err
    }
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <header>
        <h1 className="font-display text-3xl text-text sm:text-4xl">Commandes</h1>
        <p className="mt-1 text-muted">Gestion des rendez-vous patients.</p>
      </header>

      {error ? (
        <div className="rounded-[20px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { id: 'all', label: 'Confirmés', value: stats.confirmed, color: 'text-success', filterStatus: 'confirmed' as const },
          { id: 'all', label: 'En attente', value: stats.pending, color: 'text-warning', filterStatus: 'pending' as const },
          { id: 'all', label: 'Annulés', value: stats.cancelled, color: 'text-danger', filterStatus: 'cancelled' as const },
          { id: 'today', label: 'Aujourd’hui', value: stats.today, color: 'text-primary', filterStatus: '' as const },
        ].map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setType(s.id)
              setStatus(s.filterStatus)
              setDateFrom('')
            }}
            className="min-w-0 text-left"
            title={s.id === 'today' ? 'Uniquement les RDV confirmés du jour' : undefined}
          >
            <Card
              padding="p-4"
              hover
              className={`min-w-0 transition ${
                (s.id === 'today' && type === 'today')
                  || (s.filterStatus && status === s.filterStatus && type === 'all')
                  ? 'ring-2 ring-primary/30'
                  : ''
              }`}
            >
              <p className="text-xs text-muted">{s.label}</p>
              <p className={`mt-1 font-display text-2xl ${s.color}`}>{s.value}</p>
              {s.id === 'today' ? (
                <p className="mt-1 text-[11px] text-muted">Confirmés du jour seulement</p>
              ) : null}
            </Card>
          </button>
        ))}
      </div>

      <Card className="min-w-0">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative min-w-0 sm:col-span-2 lg:col-span-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-11"
              placeholder="Rechercher par nom, téléphone..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Input
            type="date"
            aria-label="À partir de la date"
            title="Afficher les RDV à partir de cette date (jusqu’aux plus lointains)"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value)
              setType('upcoming')
            }}
          />
          <Select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Ville</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Statut (tous)</option>
            <option value="confirmed">Confirmé</option>
            <option value="pending">en attente</option>
            <option value="cancelled">Annulé</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'Tous' },
            { id: 'today', label: 'Aujourd’hui' },
            { id: 'upcoming', label: 'À venir' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id === 'upcoming') {
                  setDateFrom(todayISO())
                  setStatus('')
                  setType('upcoming')
                  return
                }
                if (t.id === 'all') {
                  setDateFrom('')
                  setStatus('')
                  setType('all')
                  return
                }
                setDateFrom('')
                setStatus('')
                setType(t.id)
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                type === t.id
                  ? 'bg-primary text-white'
                  : 'bg-[#f3fbfd] text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
          {type === 'upcoming' && dateFrom ? (
            <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              À partir du {dateFrom} →
            </span>
          ) : null}
          <Button
            className="ml-auto"
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setCreating(emptyAppointment())}
          >
            Nouveau rendez-vous
          </Button>
        </div>
      </Card>

      <Card padding="p-0" className="min-w-0 overflow-hidden" hover={false}>
        <div className="max-w-full overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[#f7fcfd] text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-4 font-semibold sm:px-5">Patient</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Téléphone</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Ville</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Motif</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Date</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Heure</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Statut</th>
                <th className="px-4 py-4 font-semibold sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="px-5 py-3">
                        <Skeleton className="h-12" />
                      </td>
                    </tr>
                  ))
                : filtered.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-border transition hover:bg-[#f7fcfd]"
                    >
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={item.full_name} size="sm" />
                          <span className="truncate font-medium">{item.full_name}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted sm:px-5">
                        {item.phone_display || item.phone_number}
                      </td>
                      <td className="px-4 py-3 sm:px-5">{item.city || '—'}</td>
                      <td className="max-w-[220px] px-4 py-3 sm:px-5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#0F9FB2]">
                            {item.problem_ai || item.problem || '—'}
                          </p>
                          {(item.problem_client || item.problem_details) ? (
                            <p
                              className="mt-0.5 truncate text-xs text-muted"
                              title={item.problem_client || item.problem_details}
                            >
                              {item.problem_client || item.problem_details}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 sm:px-5">{item.appointment_date}</td>
                      <td className="whitespace-nowrap px-4 py-3 sm:px-5">{item.appointment_time}</td>
                      <td className="px-4 py-3 sm:px-5">
                        <StatusSelect
                          value={item.status}
                          onChange={(next) => changeStatus(item, next)}
                        />
                      </td>
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-xl p-2 text-muted hover:bg-white hover:text-primary"
                            onClick={() => setEditing(item)}
                            title="Voir"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-xl p-2 text-muted hover:bg-white hover:text-primary"
                            onClick={() => setEditing(item)}
                            title="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-xl p-2 text-muted hover:bg-white hover:text-danger"
                            onClick={() => setDeleting(item)}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!loading && !filtered.length ? (
          <p className="px-6 py-12 text-center text-sm text-muted">Aucun rendez-vous trouvé.</p>
        ) : null}
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs text-muted">
            {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
          </p>
        </div>
      </Card>

      {creating ? (
        <Modal onClose={() => setCreating(null)}>
          <h2 className="font-display text-2xl">Nouveau rendez-vous</h2>
          <p className="mb-5 text-sm text-muted">Ajoutez un rendez-vous manuellement dans le CRM.</p>
          <div className="space-y-3">
            <Field label="Nom complet">
              <Input
                value={creating.full_name}
                onChange={(e) => setCreating({ ...creating, full_name: e.target.value })}
                placeholder="Ex: Salim Zouhairi"
              />
            </Field>
            <Field label="Téléphone">
              <Input
                value={creating.phone_number}
                onChange={(e) => setCreating({ ...creating, phone_number: e.target.value })}
                placeholder="06XXXXXXXX"
              />
            </Field>
            <Field label="Ville">
              <Input
                value={creating.city || ''}
                onChange={(e) => setCreating({ ...creating, city: e.target.value })}
                placeholder="Casablanca"
              />
            </Field>
            <Field label="Motif (IA / résumé)">
              <Input
                value={creating.problem || ''}
                onChange={(e) => setCreating({ ...creating, problem: e.target.value, problem_ai: e.target.value })}
                placeholder="Ex: douleur dentaire"
              />
            </Field>
            <Field label="Message / détail patient">
              <Input
                value={creating.problem_details || ''}
                onChange={(e) => setCreating({
                  ...creating,
                  problem_details: e.target.value,
                  problem_client: e.target.value,
                })}
                placeholder="Texte exact du patient"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={creating.appointment_date}
                  onChange={(e) => setCreating({ ...creating, appointment_date: e.target.value })}
                />
              </Field>
              <Field label="Heure">
                <Input
                  value={creating.appointment_time}
                  onChange={(e) => setCreating({ ...creating, appointment_time: e.target.value })}
                  placeholder="10:00"
                />
              </Field>
            </div>
            <Field label="Statut">
              <Select
                value={creating.status}
                onChange={(e) => setCreating({ ...creating, status: e.target.value })}
              >
                <option value="non_confirme">en attente</option>
                <option value="confirmed">Confirmé</option>
                <option value="cancelled">Annulé</option>
              </Select>
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(null)}>
              Annuler
            </Button>
            <Button loading={saving} onClick={() => void saveCreate()}>
              Créer le rendez-vous
            </Button>
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal onClose={() => setEditing(null)}>
          <h2 className="font-display text-2xl">Modifier le rendez-vous</h2>
          <p className="mb-5 text-sm text-muted">Mettez à jour les informations patient.</p>
          <div className="space-y-3">
            <Field label="Nom">
              <Input
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
              />
            </Field>
            <Field label="Téléphone">
              <Input
                value={editing.phone_number}
                onChange={(e) => setEditing({ ...editing, phone_number: e.target.value })}
              />
            </Field>
            <Field label="Ville">
              <Input
                value={editing.city || ''}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
              />
            </Field>
            <Field label="Motif IA">
              <Input
                value={editing.problem === '—' ? '' : editing.problem || ''}
                onChange={(e) => setEditing({
                  ...editing,
                  problem: e.target.value,
                  problem_ai: e.target.value,
                })}
              />
            </Field>
            <Field label="Message client (exact)">
              <Input
                value={editing.problem_details || editing.problem_client || ''}
                onChange={(e) => setEditing({
                  ...editing,
                  problem_details: e.target.value,
                  problem_client: e.target.value,
                })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={editing.appointment_date}
                  onChange={(e) => setEditing({ ...editing, appointment_date: e.target.value })}
                />
              </Field>
              <Field label="Heure">
                <Input
                  value={editing.appointment_time}
                  onChange={(e) => setEditing({ ...editing, appointment_time: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Statut">
              <Select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
              >
                <option value="non_confirme">en attente</option>
                <option value="confirmed">Confirmé</option>
                <option value="cancelled">Annulé</option>
              </Select>
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Fermer
            </Button>
            <Button loading={saving} onClick={() => void saveEdit()}>
              Enregistrer
            </Button>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal onClose={() => !saving && setDeleting(null)} className="max-w-md">
          <h2 className="font-display text-2xl">Supprimer le rendez-vous</h2>
          <p className="mt-2 text-sm text-muted">
            Voulez-vous vraiment supprimer le rendez-vous de{' '}
            <span className="font-semibold text-text">{deleting.full_name || 'ce patient'}</span>
            {deleting.appointment_date ? (
              <>
                {' '}du {deleting.appointment_date}
                {deleting.appointment_time ? ` à ${deleting.appointment_time}` : ''}
              </>
            ) : null}
            ? Cette action est irréversible.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => setDeleting(null)}>
              Annuler
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void confirmRemove()}>
              Supprimer
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
