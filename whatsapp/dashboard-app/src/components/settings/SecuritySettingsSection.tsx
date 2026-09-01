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
