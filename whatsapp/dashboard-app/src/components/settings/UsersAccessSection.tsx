import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, initials } from '@/lib/format'
import { roleLabel } from '@/lib/permissions'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  DeactivateUserConfirmModal,
  DeleteUserConfirmModal,
  UserAccountModal,
  type DashboardUser,
  type PermissionGroup,
} from '@/components/settings/UserAccountModal'

type DrawerMode = 'create' | 'edit' | null

export type UsersAccessSectionHandle = {
  openCreate: () => void
}

function UserActionsMenu({
  user,
  onEdit,
  onResetPassword,
  onToggleActive,
  onDelete,
}: {
  user: DashboardUser
  onEdit: () => void
  onResetPassword: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded-lg p-2 text-muted hover:bg-cyan-tint/60"
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[200px] rounded-xl border border-border bg-white py-1 shadow-soft">
          <button type="button" className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-[#F8FCFD]" onClick={() => { setOpen(false); onEdit() }}>
            Modifier
          </button>
          <button type="button" className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-[#F8FCFD]" onClick={() => { setOpen(false); onResetPassword() }}>
            Réinitialiser le mot de passe
          </button>
          <button type="button" className="block w-full px-3 py-2 text-left text-sm text-navy hover:bg-[#F8FCFD]" onClick={() => { setOpen(false); onToggleActive() }}>
            {user.isActive ? 'Désactiver' : 'Réactiver'}
          </button>
          <button type="button" className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger/5" onClick={() => { setOpen(false); onDelete() }}>
            Supprimer le compte
          </button>
        </div>
      ) : null}
    </div>
  )
}

type Props = {
  embedded?: boolean
}

export const UsersAccessSection = forwardRef<UsersAccessSectionHandle, Props>(function UsersAccessSection(
  { embedded = false },
  ref,
) {
  const [users, setUsers] = useState<DashboardUser[]>([])
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const [defaultPerms, setDefaultPerms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState<DrawerMode>(null)
  const [editUser, setEditUser] = useState<DashboardUser | null>(null)
  const [openResetOnMount, setOpenResetOnMount] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DashboardUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deactivateTarget, setDeactivateTarget] = useState<DashboardUser | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [usersRes, permsRes] = await Promise.all([
        api<{ users: DashboardUser[] }>('/dashboard/api/users'),
        api<{ groups: PermissionGroup[]; defaultSecretaryPermissions: string[] }>('/dashboard/api/permissions'),
      ])
      setUsers(usersRes.users || [])
      setGroups(permsRes.groups || [])
      setDefaultPerms(permsRes.defaultSecretaryPermissions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les utilisateurs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = useCallback(() => {
    setEditUser(null)
    setDrawer('create')
  }, [])

  useImperativeHandle(ref, () => ({ openCreate }), [openCreate])

  const openEdit = async (user: DashboardUser, opts?: { resetPassword?: boolean }) => {
    const detail = await api<{ user: DashboardUser }>(`/dashboard/api/users/${user.id}`)
    setEditUser(detail.user)
    setOpenResetOnMount(Boolean(opts?.resetPassword) && user.role !== 'admin')
    setDrawer('edit')
  }

  const toggleActive = async (user: DashboardUser) => {
    if (user.isActive) {
      setDeactivateTarget(user)
      setDeactivateError('')
      return
    }
    try {
      await api(`/dashboard/api/users/${user.id}/enable`, { method: 'POST' })
      await load()
    } catch {
      /* ignore */
    }
  }

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return
    setDeactivating(true)
    setDeactivateError('')
    try {
      await api(`/dashboard/api/users/${deactivateTarget.id}/disable`, { method: 'POST' })
      setDeactivateTarget(null)
      await load()
    } catch (err) {
      setDeactivateError(err instanceof Error ? err.message : 'Désactivation impossible.')
    } finally {
      setDeactivating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api(`/dashboard/api/users/${deleteTarget.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      await load()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Suppression impossible.')
    } finally {
      setDeleting(false)
    }
  }

  const listContent = loading ? (
    <div className="space-y-3">
      {[1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}
    </div>
  ) : error ? (
    <div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
      <p className="text-sm text-navy">{error}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
        Réessayer
      </Button>
    </div>
  ) : (
    <div className="divide-y divide-border rounded-2xl border border-border">
      {users.map((user) => (
        <div key={user.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-tint text-sm font-semibold text-primary">
            {initials(user.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-navy">{user.displayName}</p>
            <p className="text-sm text-muted">{user.roleLabel || roleLabel(user.role)}</p>
            <p className="mt-0.5 text-xs text-muted">
              {user.role === 'admin'
                ? 'Tous les accès'
                : `${user.permissionCount ?? user.permissions?.length ?? 0} accès autorisés`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                user.isActive ? 'bg-success/10 text-success' : 'bg-border text-muted',
              )}
            >
              {user.isActive ? 'Actif' : 'Inactif'}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void openEdit(user)}>
              Modifier
            </Button>
            {user.role !== 'admin' ? (
              <UserActionsMenu
                user={user}
                onEdit={() => void openEdit(user)}
                onResetPassword={() => void openEdit(user, { resetPassword: true })}
                onToggleActive={() => void toggleActive(user)}
                onDelete={() => {
                  setDeleteError('')
                  setDeleteTarget(user)
                }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )

  if (!embedded) {
    return (
      <section className="card-surface mt-6 p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
          <div>
            <h2 className="font-display text-2xl text-text">Utilisateurs et accès</h2>
            <p className="mt-1 text-sm text-muted">Gérez les comptes de l’équipe et leurs autorisations.</p>
          </div>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Ajouter un utilisateur
          </Button>
        </div>
        {listContent}
        <UserAccountModal
          open={drawer !== null}
          mode={drawer === 'edit' ? 'edit' : 'create'}
          user={editUser}
          groups={groups}
          defaultPerms={defaultPerms}
          openResetOnMount={openResetOnMount}
          onClose={() => {
            setDrawer(null)
            setOpenResetOnMount(false)
          }}
          onSaved={() => void load()}
        />
        <DeleteUserConfirmModal
          user={deleteTarget}
          open={Boolean(deleteTarget)}
          onClose={() => {
            setDeleteTarget(null)
            setDeleteError('')
          }}
          onConfirm={confirmDelete}
          loading={deleting}
          error={deleteError}
        />
        <DeactivateUserConfirmModal
          user={deactivateTarget}
          open={Boolean(deactivateTarget)}
          onClose={() => {
            setDeactivateTarget(null)
            setDeactivateError('')
          }}
          onConfirm={confirmDeactivate}
          loading={deactivating}
          error={deactivateError}
        />
      </section>
    )
  }

  return (
    <>
      {listContent}
      <UserAccountModal
        open={drawer !== null}
        mode={drawer === 'edit' ? 'edit' : 'create'}
        user={editUser}
        groups={groups}
        defaultPerms={defaultPerms}
        openResetOnMount={openResetOnMount}
        onClose={() => {
          setDrawer(null)
          setOpenResetOnMount(false)
        }}
        onSaved={() => void load()}
      />
      <DeleteUserConfirmModal
        user={deleteTarget}
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteError('')
        }}
        onConfirm={confirmDelete}
        loading={deleting}
        error={deleteError}
      />
      <DeactivateUserConfirmModal
        user={deactivateTarget}
        open={Boolean(deactivateTarget)}
        onClose={() => {
          setDeactivateTarget(null)
          setDeactivateError('')
        }}
        onConfirm={confirmDeactivate}
        loading={deactivating}
        error={deactivateError}
      />
    </>
  )
})
