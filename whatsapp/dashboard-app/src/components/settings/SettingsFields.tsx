import { cn } from '@/lib/format'

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-[46px] shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2',
        checked
          ? 'border-primary bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
          : 'border-[#CBD5E1] bg-[#E2E8F0] shadow-[inset_0_1px_2px_rgba(16,42,67,0.06)]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-white',
          'shadow-[0_1px_2px_rgba(16,42,67,0.12),0_2px_6px_rgba(16,42,67,0.1)]',
          'transition-[left] duration-200 ease-out',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

export function SettingsSwitch({
  checked,
  onChange,
  disabled = false,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer justify-between gap-4',
        description ? 'items-start' : 'items-center',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0 flex-1 pr-2">
        <span className="block text-sm font-medium text-navy">{label}</span>
        {description ? (
          <span className="mt-1 block text-xs leading-relaxed text-muted">{description}</span>
        ) : null}
      </span>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
        className={description ? 'mt-0.5' : undefined}
      />
    </label>
  )
}

export function SettingsSelect<T extends string | number>({
  label,
  description,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string
  description?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
}) {
  return (
    <label className={cn('block space-y-1.5', disabled && 'opacity-50')}>
      <span className="block text-sm font-medium text-navy">{label}</span>
      {description ? (
        <span className="block text-xs leading-relaxed text-muted">{description}</span>
      ) : null}
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value
          const opt = options.find((o) => String(o.value) === raw)
          if (opt) onChange(opt.value)
        }}
        className="mt-1 w-full max-w-md rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/20"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SettingsCard({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-[14px] border border-border bg-[#F8FCFD] p-5', className)}>
      {title ? (
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      ) : null}
      <div className="space-y-5">{children}</div>
    </div>
  )
}

export function SettingsSaveBar({
  dirty,
  saving,
  onSave,
  onCancel,
  canEdit,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
  canEdit: boolean
}) {
  if (!canEdit) return null
  return (
    <div className="sticky bottom-0 -mx-7 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white/95 px-7 py-4 backdrop-blur sm:-mx-8 sm:px-8">
      <p className="text-xs text-muted">
        {dirty ? 'Modifications non enregistrées' : 'Toutes les modifications sont enregistrées'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-navy disabled:opacity-40"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
      </div>
    </div>
  )
}
