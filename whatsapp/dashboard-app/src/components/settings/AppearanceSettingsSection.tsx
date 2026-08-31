import { AppZoomControl } from '@/components/settings/AppZoomControl'

export function AppearanceSettingsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-navy">Zoom</h3>
        <p className="mt-1 text-sm text-[var(--color-muted-accessible)]">
          Réduit ou agrandit toute l’interface.
        </p>
        <div className="mt-4">
          <AppZoomControl />
        </div>
      </div>
    </div>
  )
}
