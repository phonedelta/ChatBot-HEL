import {
  BellRing,
  CalendarX,
  MessageCircle,
  PlugZap,
  UserX,
  Zap,
} from 'lucide-react'
import { cabinetSettingsApi, type NotificationsSettings } from '@/lib/cabinet-settings'
import { SettingsSwitch } from '@/components/settings/SettingsFields'
import {
  SettingsPanelFooter,
  SettingsSectionLoader,
  SettingsToast,
  useSettingsSection,
} from '@/components/settings/useSettingsSection'

const NOTIFICATION_ITEMS: {
  key: Exclude<keyof NotificationsSettings, 'soundEnabled'>
  title: string
  description: string
  icon: typeof BellRing
}[] = [
  {
    key: 'newPatientMessage',
    icon: MessageCircle,
    title: 'Nouveau message patient',
    description: 'Notifier lorsqu’un message nécessite l’attention de l’équipe.',
  },
  {
    key: 'patientNoResponse',
    icon: UserX,
    title: 'Patient sans réponse',
    description: 'Notifier après les relances prévues sans réponse.',
  },
  {
    key: 'appointmentCancelled',
    icon: CalendarX,
    title: 'Rendez-vous annulé',
    description: 'Notifier lorsqu’un patient annule un rendez-vous.',
  },
  {
    key: 'appointmentUnconfirmed',
    icon: BellRing,
    title: 'Rendez-vous non confirmé',
    description: 'Notifier lorsqu’un rendez-vous approche sans confirmation.',
  },
  {
    key: 'slotReleased',
    icon: Zap,
    title: 'Créneau libéré',
    description: 'Notifier lorsqu’une annulation rend un créneau disponible.',
  },
  {
    key: 'whatsappError',
    icon: PlugZap,
    title: 'Erreur WhatsApp',
    description: 'Notifier en cas de problème d’envoi ou de connexion WhatsApp.',
  },
]

export function NotificationsSettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<NotificationsSettings>({
    load: cabinetSettingsApi.getNotifications,
    save: cabinetSettingsApi.saveNotifications,
    canEdit,
  })

  if (s.loading || !s.draft) {
    return <SettingsSectionLoader error={s.error} onRetry={s.refresh} />
  }

  const d = s.draft

  return (
    <>
      <SettingsToast message={s.toast} />
      <div className="grid gap-3">
        <div className="rounded-[14px] border border-border bg-white p-4">
          <SettingsSwitch
            label="Sons de notification"
            description="Jouer un son lorsqu’une nouvelle notification arrive dans le Smart CRM."
            checked={d.soundEnabled}
            onChange={(v) => s.patch({ soundEnabled: v })}
            disabled={!canEdit}
          />
        </div>
        {NOTIFICATION_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-[14px] border border-border bg-[#F8FCFD] p-4"
          >
            <SettingsSwitch
              label={item.title}
              description={item.description}
              checked={d[item.key]}
              onChange={(v) => s.patch({ [item.key]: v })}
              disabled={!canEdit}
            />
          </div>
        ))}
      </div>
      <SettingsPanelFooter dirty={s.dirty} saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} canEdit={canEdit} />
    </>
  )
}
