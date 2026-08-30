import { cabinetSettingsApi, type RemindersSettings } from '@/lib/cabinet-settings'
import { SettingsCard, SettingsSelect, SettingsSwitch } from '@/components/settings/SettingsFields'
import {
  SettingsPanelFooter,
  SettingsSectionLoader,
  SettingsToast,
  useSettingsSection,
} from '@/components/settings/useSettingsSection'

export function RemindersSettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<RemindersSettings>({
    load: cabinetSettingsApi.getReminders,
    save: cabinetSettingsApi.saveReminders,
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
        <SettingsCard title="Confirmation">
          <SettingsSwitch
            label="Demander automatiquement la confirmation du rendez-vous"
            checked={d.confirmationEnabled}
            onChange={(v) => s.patch({ confirmationEnabled: v })}
            disabled={!canEdit}
          />
          <SettingsSelect
            label="Envoyer la demande de confirmation"
            value={d.confirmationHoursBefore}
            onChange={(v) => s.patch({ confirmationHoursBefore: Number(v) })}
            disabled={!canEdit || !d.confirmationEnabled}
            options={[12, 24, 48, 72].map((h) => ({ value: h, label: `${h} heures avant` }))}
          />
        </SettingsCard>

        <SettingsCard title="Relances">
          <SettingsSwitch
            label="Relancer si le patient ne répond pas"
            checked={d.firstReminderEnabled}
            onChange={(v) => s.patch({ firstReminderEnabled: v })}
            disabled={!canEdit}
          />
          <SettingsSelect
            label="Délai après la première demande"
            value={d.firstReminderHoursAfter}
            onChange={(v) => s.patch({ firstReminderHoursAfter: Number(v) })}
            disabled={!canEdit || !d.firstReminderEnabled}
            options={[2, 4, 6, 12].map((h) => ({ value: h, label: `${h} heures` }))}
          />
          <SettingsSwitch
            label="Activer une deuxième relance (tâche équipe)"
            checked={d.secondReminderEnabled}
            onChange={(v) => s.patch({ secondReminderEnabled: v })}
            disabled={!canEdit}
          />
          <SettingsSelect
            label="Délai deuxième relance"
            value={d.secondReminderHoursAfter}
            onChange={(v) => s.patch({ secondReminderHoursAfter: Number(v) })}
            disabled={!canEdit || !d.secondReminderEnabled}
            options={[12, 24, 36].map((h) => ({ value: h, label: `${h} heures` }))}
          />
        </SettingsCard>

        <SettingsCard title="Rappel jour J">
          <SettingsSwitch
            label="Envoyer un rappel le jour du rendez-vous"
            checked={d.dayOfReminderEnabled}
            onChange={(v) => s.patch({ dayOfReminderEnabled: v })}
            disabled={!canEdit}
          />
          <SettingsSelect
            label="Combien de temps avant ?"
            value={d.dayOfReminderHoursBefore}
            onChange={(v) => s.patch({ dayOfReminderHoursBefore: Number(v) })}
            disabled={!canEdit || !d.dayOfReminderEnabled}
            options={[1, 2, 3, 4].map((h) => ({ value: h, label: `${h} heure${h > 1 ? 's' : ''}` }))}
          />
        </SettingsCard>

        <SettingsCard title="Plage horaire d’envoi">
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsSelect
              label="Début"
              value={d.sendWindowStart}
              onChange={(v) => s.patch({ sendWindowStart: String(v) })}
              disabled={!canEdit}
              options={['07:00', '08:00', '09:00'].map((t) => ({ value: t, label: t }))}
            />
            <SettingsSelect
              label="Fin"
              value={d.sendWindowEnd}
              onChange={(v) => s.patch({ sendWindowEnd: String(v) })}
              disabled={!canEdit}
              options={['18:00', '20:00', '21:00'].map((t) => ({ value: t, label: t }))}
            />
          </div>
          <p className="text-xs text-muted">
            Les rappels non urgents sont envoyés uniquement pendant cette plage.
          </p>
        </SettingsCard>
      </div>
      <SettingsPanelFooter dirty={s.dirty} saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} canEdit={canEdit} />
    </>
  )
}
