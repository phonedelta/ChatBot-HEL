import { cn, initials } from '@/lib/format'

export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'h-8 w-8 text-[11px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-12 w-12 text-sm',
  }
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary font-semibold text-white shadow-[0_8px_20px_rgba(15,159,178,0.25)]',
        sizes[size],
      )}
    >
      {initials(name)}
    </div>
  )
}
