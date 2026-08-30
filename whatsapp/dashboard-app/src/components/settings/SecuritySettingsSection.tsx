import { cabinetSettingsApi, type SecuritySettings } from '@/lib/cabinet-settings'
import { SettingsCard, SettingsSelect, SettingsSwitch } from '@/components/settings/SettingsFields'
import {
  SettingsPanelFooter,
  SettingsSectionLoader,
  SettingsToast,
  useSettingsSection,
} from '@/components/settings/useSettingsSection'

export function SecuritySettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<SecuritySettings>({
    load: cabinetSettingsApi.getSecurity,
    save: cabinetSettingsApi.saveSecurity,
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
        <SettingsCard title="Session">
          <SettingsSelect
            label="Durée d’une session"
            description="Durée maximale pendant laquelle une connexion reste valide."
            value={d.sessionDurationHours}
            onChange={(v) => s.patch({ sessionDurationHours: Number(v) })}
            disabled={!canEdit}
            options={[
              { value: 8, label: '8 heures' },
              { value: 12, label: '12 heures' },
              { value: 24, label: '24 heures' },
              { value: 72, label: '3 jours' },
              { value: 168, label: '7 jours' },
              { value: 336, label: '14 jours' },
              { value: 720, label: '30 jours' },
            ]}
          />
        </SettingsCard>
        <SettingsCard title="Inactivité">
          <SettingsSwitch
            label="Déconnexion automatique après inactivité"
            checked={d.idleLogoutEnabled}
            onChange={(v) => s.patch({ idleLogoutEnabled: v })}
            disabled={!canEdit}
          />
          {d.idleLogoutEnabled ? (
            <SettingsSelect
              label="Délai d’inactivité"
              description="Déconnecte l’utilisateur après une période sans activité dans le dashboard."
              value={d.idleTimeoutMinutes}
              onChange={(v) => s.patch({ idleTimeoutMinutes: Number(v) })}
              disabled={!canEdit}
              options={[
                { value: 15, label: '15 minutes' },
                { value: 30, label: '30 minutes' },
                { value: 60, label: '1 heure' },
                { value: 120, label: '2 heures' },
                { value: 240, label: '4 heures' },
              ]}
            />
          ) : null}
        </SettingsCard>
      </div>
      <SettingsPanelFooter dirty={s.dirty} saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} canEdit={canEdit} />
    </>
  )
}
