import { cabinetSettingsApi, type AppointmentsSettings } from '@/lib/cabinet-settings'
import { SettingsCard, SettingsSelect, SettingsSwitch } from '@/components/settings/SettingsFields'
import {
  SettingsPanelFooter,
  SettingsSectionLoader,
  SettingsToast,
  useSettingsSection,
} from '@/components/settings/useSettingsSection'

const LEAD_OPTIONS = [
  { value: 0, label: 'Aucun' },
  { value: 60, label: '1 heure' },
  { value: 120, label: '2 heures' },
  { value: 240, label: '4 heures' },
  { value: 720, label: '12 heures' },
  { value: 1440, label: '24 heures' },
]

export function AppointmentsSettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<AppointmentsSettings>({
    load: cabinetSettingsApi.getAppointments,
    save: cabinetSettingsApi.saveAppointments,
    canEdit,
  })

  if (s.loading || !s.draft) {
    return <SettingsSectionLoader error={s.error} onRetry={s.refresh} />
  }

  const d = s.draft

  return (
    <>
      <SettingsToast message={s.toast} />
      <div className="space-y-5">
        <SettingsCard title="Planification">
          <SettingsSelect
            label="Durée standard d’un créneau"
            description="Durée utilisée pour générer les créneaux disponibles."
            value={d.slotDurationMinutes}
            onChange={(v) => s.patch({ slotDurationMinutes: Number(v) })}
            disabled={!canEdit}
            options={[15, 20, 30, 45, 60, 90].map((m) => ({ value: m, label: `${m} minutes` }))}
          />
          <SettingsSelect
            label="Délai minimum avant un rendez-vous"
            description="Empêche la réservation d’un créneau trop proche."
            value={d.minBookingLeadMinutes}
            onChange={(v) => s.patch({ minBookingLeadMinutes: Number(v) })}
            disabled={!canEdit}
            options={LEAD_OPTIONS}
          />
          <SettingsSelect
            label="Réservation maximale à l’avance"
            value={d.bookingHorizonDays}
            onChange={(v) => s.patch({ bookingHorizonDays: Number(v) })}
            disabled={!canEdit}
            options={[7, 14, 30, 60, 90].map((d) => ({ value: d, label: `${d} jours` }))}
          />
          <SettingsSwitch
            label="Autoriser les rendez-vous le jour même"
            checked={d.allowSameDayBooking}
            onChange={(v) => s.patch({ allowSameDayBooking: v })}
            disabled={!canEdit}
          />
        </SettingsCard>

        <SettingsCard title="Modifications">
          <SettingsSelect
            label="Délai minimum pour annuler"
            value={d.minCancelLeadMinutes}
            onChange={(v) => s.patch({ minCancelLeadMinutes: Number(v) })}
            disabled={!canEdit}
            options={LEAD_OPTIONS}
          />
          <SettingsSelect
            label="Délai minimum pour déplacer"
            value={d.minRescheduleLeadMinutes}
            onChange={(v) => s.patch({ minRescheduleLeadMinutes: Number(v) })}
            disabled={!canEdit}
            options={LEAD_OPTIONS}
          />
        </SettingsCard>

        <SettingsCard title="Propositions">
          <SettingsSelect
            label="Durée de validité d’une proposition"
            value={d.proposalValidityMinutes}
            onChange={(v) => s.patch({ proposalValidityMinutes: Number(v) })}
            disabled={!canEdit}
            options={[
              { value: 10, label: '10 minutes' },
              { value: 15, label: '15 minutes' },
              { value: 30, label: '30 minutes' },
              { value: 60, label: '1 heure' },
              { value: 120, label: '2 heures' },
              { value: 240, label: '4 heures' },
            ]}
          />
          <SettingsSelect
            label="Nombre maximum de propositions automatiques par patient"
            value={d.maxAutoProposalsPerPatient}
            onChange={(v) => s.patch({ maxAutoProposalsPerPatient: Number(v) })}
            disabled={!canEdit}
            options={[1, 2, 3, 5].map((n) => ({ value: n, label: String(n) }))}
          />
          <SettingsSwitch
            label="Activer la liste d’attente"
            description="Propose automatiquement les créneaux libérés aux patients éligibles."
            checked={d.waitlistEnabled}
            onChange={(v) => s.patch({ waitlistEnabled: v })}
            disabled={!canEdit}
          />
        </SettingsCard>
      </div>
      <SettingsPanelFooter
        dirty={s.dirty}
        saving={s.saving}
        onSave={s.onSave}
        onCancel={s.onCancel}
        canEdit={canEdit}
      />
    </>
  )
}
