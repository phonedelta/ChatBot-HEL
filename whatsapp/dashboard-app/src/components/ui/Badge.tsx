import { cn, statusTone } from '@/lib/format'

const tones = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-danger/10 text-danger border-danger/20',
  muted: 'bg-slate-100 text-muted border-slate-200',
  primary: 'bg-primary/10 text-primary border-primary/20',
}

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode
  tone?: keyof typeof tones
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ value, label }: { value?: string | null; label: string }) {
  return <Badge tone={statusTone(value)}>{label}</Badge>
}
