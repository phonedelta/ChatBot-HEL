import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MobileMenuButton, Sidebar } from '@/components/layout/Sidebar'
import { TopHeader } from '@/components/layout/TopHeader'
import { cn } from '@/lib/format'
import { pageTitleFromPath, useDocumentTitle } from '@/hooks/useDocumentTitle'

const COLLAPSE_KEY = 'hel-dashboard-sidebar-collapsed'

export function AppShell() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const location = useLocation()
  useDocumentTitle(pageTitleFromPath(location.pathname))

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const isMessages = /\/messages\/?$/.test(location.pathname) || location.pathname.endsWith('/messages')

  useEffect(() => {
    if (!isMessages) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('messages-lock')
    return () => {
      document.body.style.overflow = previousOverflow
      document.documentElement.classList.remove('messages-lock')
    }
  }, [isMessages])

  return (
    <div
      className={cn(
        'w-full overflow-x-hidden',
        isMessages ? 'h-dvh overflow-hidden' : 'min-h-screen',
      )}
    >
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div
        className={cn(
          'flex min-w-0 flex-col transition-[padding] duration-300',
          collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]',
          isMessages ? 'h-full overflow-hidden' : 'min-h-screen',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 flex-col px-4 pt-4 sm:px-6 lg:px-6 lg:pt-4',
            isMessages
              ? 'h-full min-h-0 overflow-hidden pb-3'
              : 'min-h-0 flex-1 pb-8',
          )}
        >
          <div className="mb-3 flex shrink-0 items-center gap-3 lg:hidden">
            <MobileMenuButton onClick={() => setOpen(true)} />
            <p className="text-sm font-semibold text-navy">Smart CRM HEL</p>
          </div>
          <TopHeader className={cn('shrink-0', isMessages ? 'mb-3' : undefined)} />
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className={cn(
                'min-w-0',
                isMessages && 'flex min-h-0 flex-1 flex-col overflow-hidden',
              )}
              initial={{ opacity: 0, y: isMessages ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: isMessages ? 0 : -6 }}
              transition={{ duration: 0.18 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
