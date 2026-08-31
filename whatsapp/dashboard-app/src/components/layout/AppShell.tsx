import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MobileMenuButton, Sidebar } from '@/components/layout/Sidebar'
import { AccountMenu } from '@/components/layout/AccountMenu'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { TopHeader } from '@/components/layout/TopHeader'
import { useIsLgUp } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/format'
import { pageTitleFromPath, useDocumentTitle } from '@/hooks/useDocumentTitle'
import helIcon from '@/assets/HEL-scaled.png'

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
  const isLgUp = useIsLgUp()
  useDocumentTitle(pageTitleFromPath(location.pathname))

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  const isMessages = /\/messages\/?$/.test(location.pathname) || location.pathname.endsWith('/messages')
  // Global search: desktop only. Always visible on Messages (desktop).
  const showGlobalSearch = isLgUp

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
    <div className="flex h-app w-full min-w-0 overflow-hidden">
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-200',
          collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 lg:px-6 lg:pt-4',
            isMessages
              ? 'overflow-hidden pb-[max(0.5rem,env(safe-area-inset-bottom))]'
              : 'overflow-y-auto scrollbar-thin pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mb-2 flex shrink-0 items-center gap-2 lg:hidden">
            <MobileMenuButton onClick={() => setOpen(true)} expanded={open} />
            <img src={helIcon} alt="" className="h-8 w-8 object-contain" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy">
              Centre dentaire HEL
            </p>
            <NotificationBell />
            <AccountMenu />
          </div>
          {showGlobalSearch ? (
            <TopHeader className={cn('shrink-0', isMessages ? 'mb-2 sm:mb-3' : undefined)} />
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className={cn(
                'min-w-0',
                isMessages ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'w-full',
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
