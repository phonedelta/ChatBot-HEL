import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MobileMenuButton, Sidebar } from '@/components/layout/Sidebar'
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

  return (
    <div className="min-h-screen w-full overflow-x-hidden">
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div
        className={cn(
          'min-w-0 transition-[padding] duration-300',
          collapsed ? 'lg:pl-[120px]' : 'lg:pl-[312px]',
        )}
      >
        <div className="min-w-0 px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pt-6">
          <div className="mb-4 lg:hidden">
            <MobileMenuButton onClick={() => setOpen(true)} />
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="min-w-0"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
