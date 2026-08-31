import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/format'

type ModalShellProps = {
  open: boolean
  onClose: () => void
  titleId?: string
  maxWidth?: number
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
  zIndex?: number
  className?: string
  enableEscape?: boolean
}

export function ModalShell({
  open,
  onClose,
  titleId,
  maxWidth = 720,
  header,
  footer,
  children,
  zIndex = 50,
  className,
  enableEscape = true,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const enableEscapeRef = useRef(enableEscape)
  onCloseRef.current = onClose
  enableEscapeRef.current = enableEscape

  // Focus + scroll lock only when the modal opens — not on every parent re-render
  // (unstable onClose/enableEscape used to steal focus from inputs after each keystroke).
  useEffect(() => {
    if (!open) return undefined
    panelRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && enableEscapeRef.current) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-5 sm:p-6"
          style={{ zIndex }}
          role="presentation"
        >
          <motion.button
            type="button"
            aria-label="Fermer"
            className="absolute inset-0 bg-[rgba(18,50,74,0.30)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onCloseRef.current()}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              'relative flex w-[calc(100%-20px)] max-w-full flex-col overflow-hidden sm:w-[calc(100%-32px)]',
              'rounded-[20px] border border-border bg-white',
              'shadow-[0_24px_60px_rgba(18,50,74,0.18)]',
              'max-h-[calc(100dvh-20px)] sm:max-h-[calc(100dvh-64px)]',
              className,
            )}
            style={{ maxWidth: `${maxWidth}px` }}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="shrink-0 border-b border-border">{header}</header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">{children}</div>
            {footer ? <footer className="shrink-0 border-t border-border bg-white">{footer}</footer> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
