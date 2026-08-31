import { createPortal } from 'react-dom'
import { useEffect, type ReactNode } from 'react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/format'
import { getAppPortalRoot } from '@/lib/portal-root'
import { lockBodyScroll } from '@/lib/scroll-lock'

type Props = {
  children: ReactNode
  onClose: () => void
  className?: string
}

export function Modal({ children, onClose, className }: Props) {
  useEffect(() => {
    const unlock = lockBodyScroll()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unlock()
    }
  }, [onClose])

  return createPortal(
    <div
      className="app-zoom-cover z-[60] flex items-center justify-center bg-text/30 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn('w-full max-w-lg', className)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <Card className="max-h-[min(calc(90dvh/var(--app-zoom)),calc(90vh/var(--app-zoom)))] overflow-y-auto" hover={false}>
          {children}
        </Card>
      </div>
    </div>,
    getAppPortalRoot(),
  )
}
