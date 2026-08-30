import { NavLink } from 'react-router-dom'
import {
  Bot,
  CalendarDays,
  ChartColumn,
  Clock3,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  X,
  BellRing,
  Users,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn, initials } from '@/lib/format'
import { hasPermission, PERMISSIONS, roleLabel } from '@/lib/permissions'
import helLogo from '@/assets/HEL-scaled.webp'
import helIcon from '@/assets/HEL-scaled.png'

const primaryLinks = [
  { to: '/', label: 'Aujourd’hui', icon: LayoutDashboard, end: true, permission: PERMISSIONS.VIEW_TODAY },
  { to: '/messages', label: 'Messages', icon: Inbox, permission: PERMISSIONS.VIEW_MESSAGES },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, permission: PERMISSIONS.VIEW_AGENDA },
  { to: '/patients', label: 'Patients', icon: Users, permission: PERMISSIONS.VIEW_PATIENTS },
  { to: '/relances', label: 'Relances', icon: BellRing, permission: PERMISSIONS.VIEW_FOLLOWUPS },
  { to: '/assistant', label: 'Assistant IA', icon: Bot, permission: PERMISSIONS.VIEW_ASSISTANT },
  { to: '/analyses', label: 'Analyses', icon: ChartColumn, permission: PERMISSIONS.VIEW_ANALYTICS },
  { to: '/historique', label: 'Historique', icon: Clock3, permission: PERMISSIONS.VIEW_HISTORY },
]

const secondaryLinks = [
  { to: '/integrations', label: 'Intégrations', icon: Plug, permission: PERMISSIONS.VIEW_INTEGRATIONS },
  { to: '/parametres', label: 'Paramètres', icon: Settings, permission: PERMISSIONS.VIEW_SETTINGS },
]

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  collapsed,
  onClose,
}: {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
  collapsed: boolean
  onClose: () => void
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      title={label}
      className={cn(collapsed && 'flex w-full justify-center')}
    >
      {({ isActive }) => (
        <div
          className={cn(
            'flex items-center rounded-lg text-[14px] font-medium transition-colors',
            collapsed ? 'h-10 w-10 justify-center' : 'gap-3 px-3 py-2',
            isActive
              ? 'bg-[#F1F5F8] text-navy'
              : 'text-muted hover:bg-[#F8FAFB] hover:text-navy',
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0 stroke-[1.75]" />
          {!collapsed ? <span>{label}</span> : null}
        </div>
      )}
    </NavLink>
  )
}

function SectionLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return <div className="my-2 h-px w-8 bg-border" />
  return (
    <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted/80">
      {children}
    </p>
  )
}

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
  const { user, logout } = useAuth()
  const displayName = user?.displayName || 'Utilisateur'
  const subtitle = user?.roleLabel || roleLabel(user?.role)

  const visiblePrimary = primaryLinks.filter((link) => hasPermission(user, link.permission))
  const visibleSecondary = secondaryLinks.filter((link) => hasPermission(user, link.permission))

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 transition lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-border bg-white transition-all duration-200 lg:translate-x-0',
          collapsed ? 'w-[72px] px-2 py-4' : 'w-[248px] px-3 py-4',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div
          className={cn(
            'mb-2 flex shrink-0 items-center',
            collapsed ? 'flex-col gap-2' : 'justify-between gap-2 px-1',
          )}
        >
          {collapsed ? (
            <>
              <img src={helIcon} alt="HEL" className="h-9 w-9 object-contain" />
              <button
                type="button"
                className="hidden h-8 w-8 items-center justify-center rounded-md border border-border text-muted transition hover:bg-[#F8FAFB] hover:text-navy lg:inline-flex"
                onClick={onToggleCollapsed}
                aria-label="Agrandir le menu"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <img
                src={helLogo}
                alt="Centre Dentaire HEL"
                className="h-11 w-auto max-w-[170px] object-contain object-left"
              />
              <button
                type="button"
                className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted transition hover:bg-[#F8FAFB] hover:text-navy lg:inline-flex"
                onClick={onToggleCollapsed}
                aria-label="Réduire le menu"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-[#F8FAFB] lg:hidden"
            onClick={onClose}
            aria-label="Fermer le menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin',
            collapsed && 'items-center',
          )}
        >
          {visiblePrimary.length ? (
            <>
              <SectionLabel collapsed={collapsed}>Menu</SectionLabel>
              {visiblePrimary.map((link) => (
                <NavItem key={link.to} {...link} collapsed={collapsed} onClose={onClose} />
              ))}
            </>
          ) : null}

          {visibleSecondary.length ? (
            <>
              <SectionLabel collapsed={collapsed}>Système</SectionLabel>
              {visibleSecondary.map((link) => (
                <NavItem key={link.to} {...link} collapsed={collapsed} onClose={onClose} />
              ))}
            </>
          ) : null}
        </nav>

        {collapsed ? (
          <div className="mt-3 flex flex-col items-center gap-2 border-t border-border pt-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-tint text-xs font-semibold text-primary">
              {initials(displayName)}
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-[#F8FAFB] hover:text-danger"
              onClick={() => void logout()}
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-3 shrink-0 rounded-xl border border-border bg-[#FAFCFD] p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
                {initials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy">{displayName}</p>
                <p className="text-xs text-muted">{subtitle}</p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-white hover:text-danger"
                onClick={() => void logout()}
                title="Déconnexion"
                aria-label="Déconnexion"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
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
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white text-navy lg:hidden"
      aria-label="Ouvrir le menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}
