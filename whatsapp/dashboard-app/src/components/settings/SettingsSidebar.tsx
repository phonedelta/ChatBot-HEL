import { cn } from '@/lib/format'
import type { SettingsSection, SettingsSectionId } from '@/lib/settings-sections'

export function SettingsSidebar({
  sections,
  active,
  onSelect,
  className,
}: {
  sections: SettingsSection[]
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
  className?: string
}) {
  return (
    <nav
      className={cn(
        'rounded-[18px] border border-border bg-white p-4',
        className,
      )}
      aria-label="Sections paramètres"
    >
      <ul className="space-y-1">
        {sections.map((section) => {
          const Icon = section.icon
          const selected = section.id === active
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'bg-cyan-tint text-navy'
                    : 'text-muted hover:bg-[#F8FCFD] hover:text-navy',
                )}
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-cyan' : 'text-muted')} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.label}</span>
                  <span className="block text-[11px] leading-snug opacity-80">{section.description}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function SettingsSectionHeader({
  overline,
  title,
  subtitle,
}: {
  overline: string
  title: string
  subtitle: string
}) {
  return (
    <header className="border-b border-border pb-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{overline}</p>
      <h2 className="mt-1 text-xl font-semibold text-navy">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
    </header>
  )
}
