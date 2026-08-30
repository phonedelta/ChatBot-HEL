import {
  BellRing,
  CalendarCheck,
  CalendarX,
  Clock,
  ListOrdered,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { cabinetSettingsApi, type AutomationsSettings } from '@/lib/cabinet-settings'
import { SettingsSwitch } from '@/components/settings/SettingsFields'
import {
  SettingsPanelFooter,
  SettingsSectionLoader,
  SettingsToast,
  useSettingsSection,
} from '@/components/settings/useSettingsSection'
import { cn } from '@/lib/format'

function AutomationCard({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: typeof Zap
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={cn('rounded-[14px] border border-border bg-[#F8FCFD] p-4', disabled && 'opacity-50')}>
      <SettingsSwitch
        label={title}
        description={description}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <Icon className="pointer-events-none absolute opacity-0" aria-hidden />
    </div>
  )
}

export function AutomationsSettingsSection({ canEdit }: { canEdit: boolean }) {
  const s = useSettingsSection<AutomationsSettings>({
    load: cabinetSettingsApi.getAutomations,
    save: cabinetSettingsApi.saveAutomations,
    canEdit,
  })

  if (s.loading || !s.draft) {
    return <SettingsSectionLoader error={s.error} onRetry={s.refresh} />
  }

  const d = s.draft
  const subDisabled = !canEdit || !d.masterEnabled

  const cards = [
    {
      icon: CalendarCheck,
      key: 'confirmationEnabled' as const,
      title: 'Confirmation de rendez-vous',
      description: 'Demande confirmation automatiquement au patient.',
    },
    {
      icon: RefreshCw,
      key: 'followupsEnabled' as const,
      title: 'Relances automatiques',
      description: 'Relance les patients sans réponse selon les délais configurés.',
    },
    {
      icon: CalendarX,
      key: 'slotReleasedDetectionEnabled' as const,
      title: 'Détection des créneaux libérés',
      description: 'Détecte lorsqu’une annulation libère un créneau.',
    },
    {
      icon: Zap,
      key: 'autoSlotProposalEnabled' as const,
      title: 'Proposition automatique de créneaux',
      description: 'Propose un créneau libéré aux patients éligibles.',
    },
    {
      icon: ListOrdered,
      key: 'waitlistAutoEnabled' as const,
      title: 'Gestion automatique de la liste d’attente',
      description: 'Recherche les patients prioritaires lorsqu’un créneau se libère.',
    },
    {
      icon: BellRing,
      key: 'appointmentRemindersEnabled' as const,
      title: 'Rappels avant rendez-vous',
      description: 'Envoie les rappels définis dans Confirmations & rappels.',
    },
    {
      icon: Clock,
      key: 'autoReleaseSlotOnCancel' as const,
      title: 'Libérer automatiquement un créneau après annulation',
      description: 'Le créneau redevient disponible dans l’agenda.',
    },
  ]

  return (
    <>
      <SettingsToast message={s.toast} />
      <div className="space-y-5">
        <div className="rounded-[14px] border border-border bg-white p-5">
          <SettingsSwitch
            label="Automatisations du Smart CRM"
            description="Active les automatisations configurées ci-dessous."
            checked={d.masterEnabled}
            onChange={(v) => s.patch({ masterEnabled: v })}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-3">
          {cards.map((c) => (
            <AutomationCard
              key={c.key}
              icon={c.icon}
              title={c.title}
              description={c.description}
              checked={d[c.key]}
              onChange={(v) => s.patch({ [c.key]: v })}
              disabled={subDisabled}
            />
          ))}
        </div>
      </div>
      <SettingsPanelFooter dirty={s.dirty} saving={s.saving} onSave={s.onSave} onCancel={s.onCancel} canEdit={canEdit} />
    </>
  )
}
