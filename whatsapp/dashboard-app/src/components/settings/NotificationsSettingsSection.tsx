import { useEffect, useState } from 'react'
import {
  BellRing,
  CalendarPlus,
  CalendarX,
  MessageCircle,
  PlugZap,
  UserX,
  Volume2,
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
import { Button } from '@/components/ui/Button'
import {
  playNotificationSound,
  unlockNotificationSound,
} from '@/lib/notification-sound'
import {
  enableBrowserNotifications,
  getBrowserNotificationsPref,
  getNotificationPermission,
  setBrowserNotificationsPref,
} from '@/lib/notification-alerts'

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
    key: 'appointmentCreated',
    icon: CalendarPlus,
    title: 'Nouveau rendez-vous WhatsApp',
    description: 'Notifier lorsqu’un patient réserve un rendez-vous via WhatsApp.',
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

function permissionLabel(p: NotificationPermission | 'unsupported') {
  if (p === 'granted') return 'Autorisée'
  if (p === 'denied') return 'Refusée'
  if (p === 'unsupported') return 'Non supportée'
  return 'Non demandée'
}

export function NotificationsSettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<NotificationsSettings>({
    load: cabinetSettingsApi.getNotifications,
    save: cabinetSettingsApi.saveNotifications,
    canEdit,
  })
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => getNotificationPermission())
  const [browserOn, setBrowserOn] = useState(() => getBrowserNotificationsPref())
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    setPerm(getNotificationPermission())
    setBrowserOn(getBrowserNotificationsPref())
  }, [])

  if (s.loading || !s.draft) {
    return <SettingsSectionLoader error={s.error} onRetry={s.refresh} />
  }

  const d = s.draft

  async function onEnableBrowser() {
    const result = await enableBrowserNotifications()
    setPerm(result)
    setBrowserOn(true)
    await unlockNotificationSound()
    if (result === 'granted') setTestMsg('Notifications navigateur activées.')
    else if (result === 'denied') {
      setTestMsg('Permission refusée par le navigateur. Réactivez-la dans les paramètres Chrome du site.')
    } else if (result === 'unsupported') {
      setTestMsg('Ce navigateur ne prend pas en charge les notifications système.')
    } else {
      setTestMsg('Permission non accordée.')
    }
  }

  async function onTestSound() {
    const unlocked = await unlockNotificationSound()
    if (!unlocked) {
      setTestMsg('Le navigateur bloque le son. Cliquez à nouveau après interaction avec la page.')
      return
    }
    playNotificationSound([-1])
    setTestMsg('Son de test joué.')
  }

  return (
    <>
      <SettingsToast message={s.toast || testMsg} />
      <div className="grid gap-3">
        <div className="rounded-[14px] border border-border bg-white p-4">
          <SettingsSwitch
            label="Sons de notification"
            description="Jouer un son lorsqu’une nouvelle notification arrive dans le Smart CRM."
            checked={d.soundEnabled}
            onChange={(v) => s.patch({ soundEnabled: v })}
            disabled={!canEdit}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Volume2 className="h-4 w-4" />}
              onClick={() => void onTestSound()}
            >
              Tester le son
            </Button>
          </div>
        </div>

        <div className="rounded-[14px] border border-border bg-white p-4">
          <SettingsSwitch
            label="Notifications navigateur"
            description="Afficher une notification système Windows/macOS lorsque le Smart CRM est en arrière-plan."
            checked={browserOn && perm !== 'denied'}
            onChange={(v) => {
              setBrowserOn(v)
              setBrowserNotificationsPref(v)
              if (v && perm !== 'granted') void onEnableBrowser()
            }}
            disabled={!canEdit || perm === 'unsupported'}
          />
          <p className="mt-2 text-xs text-muted">
            Permission navigateur : {permissionLabel(perm)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<BellRing className="h-4 w-4" />}
              onClick={() => void onEnableBrowser()}
              disabled={!canEdit || perm === 'unsupported'}
            >
              Activer les notifications
            </Button>
          </div>
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
