import { cn } from '@/lib/format'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-2xl bg-[#e4f4f7]', className)} />
}
