import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { usePermissions } from '@/hooks/usePermissions'
import { PageHeader } from '@/components/smart/PageBits'
import { UsersAccessSection, type UsersAccessSectionHandle } from '@/components/settings/UsersAccessSection'
import { SettingsSidebar, SettingsIconTabs, SettingsSectionHeader } from '@/components/settings/SettingsSidebar'
import { AppearanceSettingsSection } from '@/components/settings/AppearanceSettingsSection'
import { AppointmentsSettingsSection } from '@/components/settings/AppointmentsSettingsSection'
import { RemindersSettingsSection } from '@/components/settings/RemindersSettingsSection'
import { AutomationsSettingsSection } from '@/components/settings/AutomationsSettingsSection'
import { SecuritySettingsSection } from '@/components/settings/SecuritySettingsSection'
import { NotificationsSettingsSection } from '@/components/settings/NotificationsSettingsSection'
import { Button } from '@/components/ui/Button'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { PERMISSIONS } from '@/lib/permissions'
import { parseSettingsSection, settingsSections, type SettingsSectionId } from '@/lib/settings-sections'

const SECTION_COPY: Record<
  Exclude<SettingsSectionId, 'users'>,
  { overline: string; title: string; subtitle: string }
> = {
  appearance: {
    overline: 'Configuration',
    title: 'Apparence',
    subtitle: 'Personnalisez l’affichage de votre Smart CRM.',
  },
  appointments: {
    overline: 'Rendez-vous',
    title: 'Rendez-vous',
    subtitle: 'Configurez les règles de réservation et de gestion des créneaux.',
  },
  reminders: {
    overline: 'Confirmations & rappels',
    title: 'Confirmations & rappels',
    subtitle: 'Configurez les messages automatiques envoyés avant et après un rendez-vous.',
  },
  automations: {
    overline: 'Automatisations',
    title: 'Automatisations',
    subtitle: 'Activez ou désactivez les actions prises automatiquement par le Smart CRM.',
  },
  security: {
    overline: 'Sécurité & sessions',
    title: 'Sécurité & sessions',
    subtitle: 'Définissez la durée des connexions au Smart CRM.',
  },
  notifications: {
    overline: 'Notifications internes',
    title: 'Notifications internes',
    subtitle: 'Choisissez les événements qui doivent alerter l’équipe dans le dashboard.',
  },
}

export function SettingsPage() {
  const { can } = usePermissions()
  const [searchParams, setSearchParams] = useSearchParams()
  const usersRef = useRef<UsersAccessSectionHandle>(null)
  useDocumentTitle('Paramètres')

  const visibleSections = useMemo(
    () => settingsSections.filter((s) => can(s.viewPermission)),
    [can],
  )

  const sectionParam = searchParams.get('section')
  const activeSection = useMemo(() => {
    const parsed = parseSettingsSection(sectionParam)
    if (visibleSections.some((s) => s.id === parsed)) return parsed
    return visibleSections[0]?.id ?? 'users'
  }, [sectionParam, visibleSections])

  useEffect(() => {
    if (sectionParam !== activeSection && visibleSections.length) {
      setSearchParams({ section: activeSection }, { replace: true })
    }
  }, [activeSection, sectionParam, setSearchParams, visibleSections.length])

  const setSection = useCallback(
    (id: SettingsSectionId) => {
      setSearchParams({ section: id }, { replace: false })
    },
    [setSearchParams],
  )

  if (!visibleSections.length) {
    return (
      <div className="min-w-0 space-y-5 pb-8">
        <PageHeader title="Paramètres" subtitle="Configurez le fonctionnement du cabinet et du Smart CRM." />
        <div className="rounded-[20px] border border-border bg-white p-8 text-sm text-muted">
          Vous n’avez pas l’autorisation d’accéder aux paramètres.
        </div>
      </div>
    )
  }

  const canManageSettings = can(PERMISSIONS.MANAGE_SETTINGS)
  const canManageUsers = can(PERMISSIONS.MANAGE_USERS)

  return (
    <div className="min-w-0 space-y-5 animate-[fadeIn_280ms_ease] pb-8">
      <PageHeader
        title="Paramètres"
        subtitle="Configurez le fonctionnement du cabinet et du Smart CRM."
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <SettingsIconTabs
          sections={visibleSections}
          active={activeSection}
          onSelect={setSection}
        />

        <SettingsSidebar
          sections={visibleSections}
          active={activeSection}
          onSelect={setSection}
          className="hidden w-[270px] shrink-0 lg:block"
        />

        <section className="min-w-0 flex-1 rounded-[20px] border border-border bg-white p-4 sm:p-8">
          {activeSection === 'users' ? (
            <>
              <header className="border-b border-border pb-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Utilisateurs
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-navy">Utilisateurs et accès</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted">
                      Gérez les comptes de l’équipe et leurs autorisations.
                    </p>
                  </div>
                  {canManageUsers ? (
                    <Button
                      size="sm"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => usersRef.current?.openCreate()}
                    >
                      Ajouter un utilisateur
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="pt-6">
                <UsersAccessSection ref={usersRef} embedded />
              </div>
            </>
          ) : (
            <>
              <SettingsSectionHeader {...SECTION_COPY[activeSection]} />
              <div className="pt-6">
                {activeSection === 'appearance' ? <AppearanceSettingsSection /> : null}
                {activeSection === 'appointments' ? (
                  <AppointmentsSettingsSection canEdit={canManageSettings} />
                ) : null}
                {activeSection === 'reminders' ? (
                  <RemindersSettingsSection canEdit={canManageSettings} />
                ) : null}
                {activeSection === 'automations' ? (
                  <AutomationsSettingsSection canEdit={canManageSettings} />
                ) : null}
                {activeSection === 'security' ? (
                  <SecuritySettingsSection canEdit={canManageSettings} />
                ) : null}
                {activeSection === 'notifications' ? (
                  <NotificationsSettingsSection canEdit={canManageSettings} />
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
