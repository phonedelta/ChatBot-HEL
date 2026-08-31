import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { todayISO, toDateISO } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'

type FormState = {
  full_name: string
  phone_number: string
  city: string
  problem: string
  appointment_date: string
  appointment_time: string
}

function emptyForm(): FormState {
  return {
    full_name: '',
    phone_number: '',
    city: '',
    problem: '',
    appointment_date: todayISO(),
    appointment_time: '',
  }
}

type Props = {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  initialDate?: string
  initialTime?: string
  initialName?: string
  initialPhone?: string
  initialCity?: string
}

export function NewAppointmentModal({
  open,
  onClose,
  onCreated,
  initialDate,
  initialTime,
  initialName,
  initialPhone,
  initialCity,
}: Props) {
  const [form, setForm] = useState<FormState>(() => ({
    ...emptyForm(),
    full_name: initialName || '',
    phone_number: initialPhone || '',
    city: initialCity || '',
    appointment_date: initialDate || todayISO(),
    appointment_time: initialTime || '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  useEffect(() => {
    if (!open) return
    setForm({
      ...emptyForm(),
      full_name: initialName || '',
      phone_number: initialPhone || '',
      city: initialCity || '',
      appointment_date: initialDate || todayISO(),
      appointment_time: initialTime || '',
    })
    setError('')
    setFieldErrors({})
  }, [open, initialDate, initialTime, initialName, initialPhone, initialCity])

  if (!open) return null

  function close() {
    setError('')
    setFieldErrors({})
    setForm({
      ...emptyForm(),
      appointment_date: initialDate || todayISO(),
      appointment_time: initialTime || '',
    })
    onClose()
  }

  async function save() {
    const nextErrors: Partial<Record<keyof FormState, string>> = {}
    if (!form.full_name.trim()) nextErrors.full_name = 'Le nom est obligatoire.'
    if (!form.phone_number.trim()) nextErrors.phone_number = 'Le téléphone est obligatoire.'
    if (!form.problem.trim()) nextErrors.problem = 'Le motif est obligatoire.'
    if (!form.appointment_date) nextErrors.appointment_date = 'La date est obligatoire.'
    if (!form.appointment_time.trim()) nextErrors.appointment_time = 'L’heure est obligatoire.'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError('Veuillez compléter les champs obligatoires.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await api('/dashboard/api/crm/appointments', {
        method: 'POST',
        body: {
          full_name: form.full_name.trim(),
          phone_number: form.phone_number.trim(),
          city: form.city.trim(),
          problem: form.problem.trim(),
          appointment_date: toDateISO(form.appointment_date) || form.appointment_date,
          appointment_time: form.appointment_time.trim(),
          status: 'confirmed',
        },
      })
      setForm(emptyForm())
      onCreated?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={close}>
      <h2 className="font-display text-2xl text-navy">Nouveau rendez-vous</h2>
      <p className="mb-5 text-sm text-[var(--color-muted-accessible)]">
        Remplissage manuel — le rendez-vous sera créé avec le statut Confirmé.
      </p>
      {error ? (
        <div className="mb-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="space-y-3">
        <Field label="Nom complet" id="appt-full-name" required error={fieldErrors.full_name}>
          <Input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Ex: Salim Zouhairi"
            autoFocus
          />
        </Field>
        <Field label="Téléphone" id="appt-phone" required error={fieldErrors.phone_number}>
          <Input
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
            placeholder="06XXXXXXXX"
          />
        </Field>
        <Field label="Ville" id="appt-city">
          <Input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            placeholder="Casablanca"
          />
        </Field>
        <Field label="Motif" id="appt-problem" required error={fieldErrors.problem}>
          <Input
            value={form.problem}
            onChange={(e) => setForm({ ...form, problem: e.target.value })}
            placeholder="Ex: douleur dentaire"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" id="appt-date" required error={fieldErrors.appointment_date}>
            <Input
              type="date"
              value={form.appointment_date}
              onChange={(e) => setForm({ ...form, appointment_date: e.target.value })}
            />
          </Field>
          <Field label="Heure" id="appt-time" required error={fieldErrors.appointment_time}>
            <Input
              value={form.appointment_time}
              onChange={(e) => setForm({ ...form, appointment_time: e.target.value })}
              placeholder="Ex: 10:30"
            />
          </Field>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={close}>
          Annuler
        </Button>
        <Button loading={saving} onClick={() => void save()}>
          Créer le rendez-vous
        </Button>
      </div>
    </Modal>
  )
}
