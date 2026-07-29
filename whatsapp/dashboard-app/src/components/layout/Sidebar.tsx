import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Bot,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/format'
import helLogo from '@/assets/HEL-scaled.webp'
import helIcon from '@/assets/HEL-scaled.png'

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/commandes', label: 'Commandes', icon: ShoppingBag },
  { to: '/config', label: 'Config ChatBot', icon: Bot },
  { to: '/parametres', label: 'Paramètres', icon: Settings },
]

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  open: boolean
  onClose: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const { username, logout } = useAuth()

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-text/20 backdrop-blur-sm transition lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          'fixed left-4 top-4 z-50 flex h-[calc(100vh-2rem)] flex-col rounded-[28px] border border-border/80 bg-white/80 shadow-[0_20px_60px_rgba(16,42,67,0.08)] backdrop-blur-xl transition-all duration-300 lg:translate-x-0',
          collapsed ? 'w-[88px] items-center px-2 py-4' : 'w-[280px] p-5',
          open ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0',
        )}
      >
        {collapsed ? (
          <div className="mb-6 flex w-full flex-col items-center gap-3">
            <img
              src={helIcon}
              alt="Centre Dentaire HEL"
              className="h-12 w-12 object-contain"
            />
            <button
              type="button"
              className="hidden h-10 w-10 items-center justify-center rounded-2xl text-muted transition hover:bg-[#f3fbfd] hover:text-primary lg:inline-flex"
              onClick={onToggleCollapsed}
              aria-label="Agrandir le menu"
              title="Agrandir le menu"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-muted hover:bg-bg lg:hidden"
              onClick={onClose}
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="mb-6 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <img
                src={helLogo}
                alt="Centre Dentaire HEL"
                className="h-14 w-auto max-w-full object-contain"
              />
              <p className="text-xs text-muted">Espace Administrateur</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="hidden rounded-xl p-2 text-muted transition hover:bg-[#f3fbfd] hover:text-primary lg:inline-flex"
                onClick={onToggleCollapsed}
                aria-label="Réduire le menu"
                title="Réduire le menu"
              >
                <PanelLeftClose className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="rounded-xl p-2 text-muted hover:bg-bg lg:hidden"
                onClick={onClose}
                aria-label="Fermer le menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        <nav className={cn('flex flex-1 flex-col gap-1.5', collapsed && 'w-full items-center')}>
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              title={label}
              className={cn(collapsed && 'flex w-full justify-center')}
            >
              {({ isActive }) => (
                <motion.div
                  whileHover={{ x: collapsed ? 0 : 2 }}
                  className={cn(
                    'flex items-center rounded-[20px] text-sm font-medium transition duration-250',
                    collapsed ? 'h-11 w-11 justify-center' : 'gap-3 px-4 py-3',
                    isActive
                      ? 'bg-gradient-to-r from-primary to-[#1bb3c6] text-white shadow-[0_10px_24px_rgba(15,159,178,0.28)]'
                      : 'text-muted hover:bg-[#f3fbfd] hover:text-text',
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed ? <span>{label}</span> : null}
                </motion.div>
              )}
            </NavLink>
          ))}
        </nav>

        {collapsed ? (
          <div className="mt-4 flex w-full flex-col items-center gap-2">
            <Avatar name={username || 'Admin'} size="sm" />
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border text-muted transition hover:bg-[#f3fbfd] hover:text-danger"
              onClick={() => void logout()}
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-[22px] border border-border bg-white/90 p-4">
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={username || 'Admin'} />
              <div>
                <p className="text-sm font-semibold text-text">{username || 'Admin'}</p>
                <p className="text-xs text-muted">Administrateur</p>
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              icon={<LogOut className="h-4 w-4" />}
              onClick={() => void logout()}
            >
              Déconnexion
            </Button>
          </div>
        )}
      </aside>
    </>
  )
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-[18px] border border-border bg-white text-text shadow-soft lg:hidden"
      aria-label="Ouvrir le menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}
