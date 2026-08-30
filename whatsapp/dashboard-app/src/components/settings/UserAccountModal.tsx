import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, Eye, EyeOff, Lock, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { cn } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { ModalShell } from '@/components/ui/ModalShell'
import { ToggleSwitch } from '@/components/settings/SettingsFields'

export type DashboardUser = {
  id: number
  displayName: string
  username: string
  role: string
  roleLabel: string
  isActive: boolean
  isPrimaryAdmin?: boolean
  permissionCount: number | null
  permissions?: string[]
}

export type PermissionGroup = {
  group: string
  items: Array<{ key: string; label: string }>
}

function suggestUsername(displayName: string) {
  const parts = displayName
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s.]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0].toLowerCase()
  return `${parts[0].toLowerCase()}.${(parts[1][0] || '').toLowerCase()}`
}

function passwordStrengthLabel(password: string): string | null {
  if (!password) return null
  if (password.length < 8) return 'Faible'
  const hasMix = /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
  if (password.length >= 12 && hasMix) return 'Fort'
  if (password.length >= 8 && hasMix) return 'Correct'
  return 'Faible'
}

function StatusSwitch({ active, onChange }: { active: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleSwitch
      checked={active}
      onChange={onChange}
      aria-label={active ? 'Compte actif' : 'Compte désactivé'}
    />
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:bg-cyan-tint/60"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Masquer' : 'Afficher'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-muted transition-colors hover:bg-[#F5FAFC] hover:text-navy"
      aria-label="Fermer"
    >
      <X className="h-5 w-5" />
    </button>
  )
}

function PermissionGroupsEditor({
  groups,
  value,
  onChange,
}: {
  groups: PermissionGroup[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const set = useMemo(() => new Set(value), [value])
  const selected = value.length

  const toggle = (key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(Array.from(next))
  }

  const toggleGroup = (keys: string[], enable: boolean) => {
    const next = new Set(set)
    for (const k of keys) {
      if (enable) next.add(k)
      else next.delete(k)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-navy">Accès autorisés</h3>
          <p className="mt-0.5 text-xs text-muted">Choisissez les actions disponibles pour cet utilisateur.</p>
        </div>
        <p className="shrink-0 text-xs font-medium text-primary">
          {selected} accès sélectionné{selected > 1 ? 's' : ''}
        </p>
      </div>
      {groups.map((group, index) => {
        const keys = group.items.map((i) => i.key)
        const onCount = keys.filter((k) => set.has(k)).length
        const allOn = onCount === keys.length
        return (
          <PermissionGroupCard
            key={group.group}
            group={group.group}
            items={group.items}
            onCount={onCount}
            total={keys.length}
            allOn={allOn}
            defaultOpen={onCount > 0 || index < 2}
            set={set}
            onToggle={toggle}
            onToggleGroup={() => toggleGroup(keys, !allOn)}
          />
        )
      })}
    </div>
  )
}

function PermissionGroupCard({
  group,
  items,
  onCount,
  total,
  allOn,
  defaultOpen,
  set,
  onToggle,
  onToggleGroup,
}: {
  group: string
  items: Array<{ key: string; label: string }>
  onCount: number
  total: number
  allOn: boolean
  defaultOpen: boolean
  set: Set<string>
  onToggle: (key: string) => void
  onToggleGroup: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-[#F8FCFD]">
      <div className="flex items-center gap-2 px-4 py-3.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')}
          />
          <span className="text-sm font-medium uppercase tracking-wide text-navy">{group}</span>
          <span className="text-xs text-muted">
            {onCount} / {total} autorisé{onCount > 1 ? 's' : ''}
            {allOn ? <Check className="ml-1 inline h-3 w-3 text-success" /> : null}
          </span>
        </button>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
          onClick={onToggleGroup}
        >
          {allOn ? 'Tout désactiver' : 'Tout autoriser'}
        </button>
      </div>
      {open ? (
        <div className="space-y-0.5 border-t border-border bg-white px-4 py-3">
          {items.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg py-1.5 text-sm text-navy hover:bg-[#F8FCFD]"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#13AEC1]"
                checked={set.has(item.key)}
                onChange={() => onToggle(item.key)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function UnsavedChangesModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <AnimatePresence>
      {open ? (
        <ModalShell
          open
          onClose={onClose}
          maxWidth={440}
          zIndex={80}
          titleId="unsaved-title"
          header={
            <div className="px-6 py-5">
              <h3 id="unsaved-title" className="text-lg font-semibold text-navy">
                Modifications non enregistrées
              </h3>
              <p className="mt-1 text-sm text-muted">Voulez-vous fermer sans enregistrer ?</p>
            </div>
          }
          footer={
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Continuer l&apos;édition
              </Button>
              <Button variant="danger" size="sm" onClick={onConfirm}>
                Fermer sans enregistrer
              </Button>
            </div>
          }
        >
          <div className="px-6 py-2" />
        </ModalShell>
      ) : null}
    </AnimatePresence>
  )
}

function ResetPasswordModal({
  userName,
  open,
  onClose,
  onConfirm,
  loading,
}: {
  userName: string
  open: boolean
  onClose: () => void
  onConfirm: (password: string) => Promise<void>
  loading: boolean
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPassword('')
      setConfirm('')
      setError('')
    }
  }, [open])

  const submit = async () => {
    setError('')
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    await onConfirm(password)
  }

  return (
    <AnimatePresence>
      {open ? (
        <ModalShell
          open
          onClose={onClose}
          maxWidth={480}
          zIndex={70}
          titleId="reset-password-title"
          header={
            <div className="flex items-start justify-between gap-3 px-6 py-5">
              <div>
                <h3 id="reset-password-title" className="text-lg font-semibold text-navy">
                  Réinitialiser le mot de passe
                </h3>
                <p className="mt-1 text-sm text-muted">Nouveau mot de passe pour {userName}.</p>
              </div>
              <CloseButton onClick={onClose} />
            </div>
          }
          footer={
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                Annuler
              </Button>
              <Button loading={loading} size="sm" onClick={() => void submit()}>
                Mettre à jour
              </Button>
            </div>
          }
        >
          <div className="space-y-3 px-6 py-5">
            <Field label="Nouveau mot de passe *">
              <PasswordInput value={password} onChange={setPassword} />
            </Field>
            <Field label="Confirmer *">
              <PasswordInput value={confirm} onChange={setConfirm} />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
        </ModalShell>
      ) : null}
    </AnimatePresence>
  )
}

function AdminChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setCurrent('')
      setPassword('')
      setConfirm('')
      setError('')
      setMessage('')
    }
  }, [open])

  const submit = async () => {
    setError('')
    setMessage('')
    if (!current.trim()) {
      setError('Mot de passe actuel incorrect.')
      return
    }
    if (password.length < 8) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    try {
      await api('/dashboard/api/auth/change-password', {
        method: 'POST',
        body: {
          current_password: current,
          new_password: password,
        },
      })
      setMessage('Mot de passe mis à jour.')
      setTimeout(() => onClose(), 700)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du changement')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <ModalShell
          open
          onClose={onClose}
          maxWidth={480}
          zIndex={70}
          titleId="admin-change-password-title"
          header={
            <div className="flex items-start justify-between gap-3 px-6 py-5">
              <div>
                <h3 id="admin-change-password-title" className="text-lg font-semibold text-navy">
                  Changer le mot de passe
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Mettez à jour le mot de passe du compte administrateur.
                </p>
              </div>
              <CloseButton onClick={onClose} />
            </div>
          }
          footer={
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                Annuler
              </Button>
              <Button loading={loading} size="sm" onClick={() => void submit()}>
                Mettre à jour le mot de passe
              </Button>
            </div>
          }
        >
          <div className="space-y-3 px-6 py-5">
            <Field label="Mot de passe actuel *">
              <PasswordInput value={current} onChange={setCurrent} />
            </Field>
            <Field label="Nouveau mot de passe *">
              <PasswordInput value={password} onChange={setPassword} />
            </Field>
            <Field label="Confirmer le nouveau mot de passe *">
              <PasswordInput value={confirm} onChange={setConfirm} />
            </Field>
            <p className="text-xs text-muted">Minimum 8 caractères.</p>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-success">{message}</p> : null}
          </div>
        </ModalShell>
      ) : null}
    </AnimatePresence>
  )
}

function AdminAccessCard() {
  return (
    <section className="rounded-2xl border border-border bg-[#F8FCFD] p-5">
      <h3 className="text-sm font-semibold text-navy">Autorisations</h3>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-white px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-tint text-primary">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-navy">Accès complet</p>
            <span className="rounded-full bg-cyan-tint px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              Tous les accès
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            Le compte administrateur dispose automatiquement de toutes les autorisations du Dashboard.
          </p>
        </div>
      </div>
    </section>
  )
}

export function DeleteUserConfirmModal({
  user,
  open,
  onClose,
  onConfirm,
  loading,
  error,
}: {
  user: DashboardUser | null
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  loading: boolean
  error?: string
}) {
  return (
    <AnimatePresence>
      {open && user ? (
        <ModalShell
          open
          onClose={onClose}
          maxWidth={480}
          zIndex={70}
          titleId="delete-user-title"
          header={
            <div className="px-6 py-5">
              <h3 id="delete-user-title" className="text-lg font-semibold text-navy">
                Supprimer {user.displayName} ?
              </h3>
            </div>
          }
          footer={
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
                Annuler
              </Button>
              <Button variant="danger" size="sm" loading={loading} onClick={() => void onConfirm()}>
                Supprimer le compte
              </Button>
            </div>
          }
        >
          <div className="space-y-2 px-6 py-5">
            <p className="text-sm text-muted">Ce compte ne pourra plus accéder au Smart CRM.</p>
            <p className="text-sm text-muted">
              Ses actions passées resteront visibles dans l&apos;Historique.
            </p>
            {error ? (
              <p className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
    </AnimatePresence>
  )
}

export function UserAccountModal({
  mode,
  user,
  groups,
  defaultPerms,
  open = true,
  openResetOnMount = false,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  user: DashboardUser | null
  groups: PermissionGroup[]
  defaultPerms: string[]
  open?: boolean
  openResetOnMount?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { user: authUser } = useAuth()
  const isAdminAccount = mode === 'edit' && user?.role === 'admin'
  const canChangeOwnPassword = isAdminAccount && authUser?.id === user?.id

  const initialRef = useRef({
    displayName: user?.displayName || '',
    isActive: user?.isActive ?? true,
    permissions: [...(user?.permissions || defaultPerms)].sort().join(','),
  })

  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [username, setUsername] = useState(user?.username || '')
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [permissions, setPermissions] = useState<string[]>(user?.permissions || defaultPerms)
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(openResetOnMount && !isAdminAccount)
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [unsavedOpen, setUnsavedOpen] = useState(false)

  useEffect(() => {
    if (openResetOnMount && !isAdminAccount) setResetOpen(true)
  }, [openResetOnMount, isAdminAccount])

  useEffect(() => {
    if (mode === 'create' && displayName && !usernameTouched) {
      setUsername(suggestUsername(displayName))
    }
  }, [displayName, mode, usernameTouched])

  const strength = passwordStrengthLabel(password)

  const isDirty = useMemo(() => {
    if (isAdminAccount) return false
    if (mode === 'create') {
      return (
        displayName.trim() !== ''
        || username.trim() !== ''
        || password !== ''
        || confirm !== ''
        || isActive !== true
        || [...permissions].sort().join(',') !== [...defaultPerms].sort().join(',')
      )
    }
    const init = initialRef.current
    return (
      displayName.trim() !== init.displayName
      || isActive !== init.isActive
      || [...permissions].sort().join(',') !== init.permissions
    )
  }, [mode, displayName, username, password, confirm, isActive, permissions, defaultPerms, isAdminAccount])

  const requestClose = () => {
    if (adminPasswordOpen) {
      setAdminPasswordOpen(false)
      return
    }
    if (resetOpen) {
      setResetOpen(false)
      return
    }
    if (deleteOpen) {
      setDeleteOpen(false)
      return
    }
    if (unsavedOpen) {
      setUnsavedOpen(false)
      return
    }
    if (isDirty && !saving) {
      setUnsavedOpen(true)
      return
    }
    onClose()
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!displayName.trim()) errors.displayName = 'Ce nom est obligatoire.'
    if (mode === 'create') {
      if (!username.trim()) errors.username = 'Cet identifiant est obligatoire.'
      if (password.length < 8) errors.password = 'Le mot de passe doit contenir au moins 8 caractères.'
      if (password !== confirm) errors.confirm = 'Les mots de passe ne correspondent pas.'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const save = async () => {
    setFormError('')
    if (!validate()) return
    setSaving(true)
    try {
      if (mode === 'create') {
        await api('/dashboard/api/users', {
          method: 'POST',
          body: {
            display_name: displayName.trim(),
            username: username.trim(),
            role: 'secretary',
            password,
            is_active: isActive,
            permissions,
          },
        })
      } else if (user) {
        await api(`/dashboard/api/users/${user.id}`, {
          method: 'PATCH',
          body: {
            display_name: displayName.trim(),
            is_active: isActive,
            permissions,
          },
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      if (/identifiant.*utilis/i.test(msg)) setFieldErrors((e) => ({ ...e, username: msg }))
      else setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  const resetPassword = async (newPassword: string) => {
    if (!user) return
    setSaving(true)
    try {
      await api(`/dashboard/api/users/${user.id}/reset-password`, {
        method: 'POST',
        body: { password: newPassword },
      })
      setResetOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const deleteUser = async () => {
    if (!user) return
    setDeleting(true)
    try {
      await api(`/dashboard/api/users/${user.id}`, { method: 'DELETE' })
      setDeleteOpen(false)
      onSaved()
      onClose()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Suppression impossible')
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  const titleId = 'user-account-modal-title'

  return (
    <>
      <ModalShell
        open={open}
        onClose={requestClose}
        enableEscape={!resetOpen && !deleteOpen && !unsavedOpen && !adminPasswordOpen}
          maxWidth={760}
          zIndex={50}
          titleId={titleId}
          header={
            <div className="flex items-start justify-between gap-3 px-6 py-[22px]">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {mode === 'create'
                    ? 'Nouveau compte'
                    : isAdminAccount
                      ? 'Compte administrateur'
                      : 'Compte utilisateur'}
                </p>
                <h2 id={titleId} className="mt-1 text-xl font-semibold text-navy">
                  {mode === 'create'
                    ? 'Ajouter un utilisateur'
                    : `Modifier ${displayName || user?.displayName}`}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {mode === 'create'
                    ? 'Créez un accès sécurisé pour un membre de l’équipe.'
                    : isAdminAccount
                      ? 'Gérez les informations et la sécurité du compte administrateur.'
                      : 'Gérez le compte, le statut et les autorisations.'}
                </p>
              </div>
              <CloseButton onClick={requestClose} />
            </div>
          }
          footer={
            isAdminAccount ? (
              <div className="flex justify-end px-6 py-4">
                <Button variant="secondary" size="sm" onClick={requestClose}>
                  Fermer
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 px-6 py-4">
                <Button variant="secondary" size="sm" onClick={requestClose} disabled={saving}>
                  Annuler
                </Button>
                <Button
                  className="min-w-[150px] !h-[46px] !rounded-[14px] !px-6"
                  loading={saving}
                  onClick={() => void save()}
                >
                  {saving
                    ? (mode === 'create' ? 'Création…' : 'Enregistrement…')
                    : (mode === 'create' ? 'Créer le compte' : 'Enregistrer')}
                </Button>
              </div>
            )
          }
        >
          <div className="space-y-4 px-6 py-[22px]">
            <section className="rounded-2xl border border-border bg-[#F8FCFD] p-5">
              <h3 className="text-sm font-semibold text-navy">Informations du compte</h3>
              <p className="mt-0.5 text-xs text-muted">
                {isAdminAccount ? 'Identité du compte administrateur.' : 'Identité utilisée dans le Dashboard.'}
              </p>
              <div className="mt-4 space-y-4">
                {isAdminAccount ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nom affiché">
                        <Input value={user?.displayName || ''} disabled className="bg-[#F4F6F8] text-muted" />
                      </Field>
                      <Field label="Identifiant interne">
                        <Input value={user?.username || ''} disabled className="bg-[#F4F6F8] text-muted" />
                      </Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Rôle">
                        <Input value="Administrateur" disabled className="bg-[#F4F6F8] text-muted" />
                      </Field>
                      <Field label="Statut du compte">
                        <div className="flex h-11 items-center rounded-xl border border-border bg-[#F4F6F8] px-3">
                          <span className="flex items-center gap-1.5 text-sm font-medium text-navy">
                            <span className="inline-block h-2 w-2 rounded-full bg-success" />
                            Actif
                          </span>
                        </div>
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nom affiché *" error={fieldErrors.displayName}>
                        <Input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Sarah A."
                        />
                      </Field>
                      {mode === 'create' ? (
                        <Field label="Identifiant interne *" error={fieldErrors.username}>
                          <Input
                            value={username}
                            onChange={(e) => {
                              setUsernameTouched(true)
                              setUsername(e.target.value)
                            }}
                            placeholder="sarah.a"
                          />
                        </Field>
                      ) : (
                        <Field label="Identifiant interne">
                          <Input value={user?.username || ''} disabled className="bg-[#F4F6F8] text-muted" />
                        </Field>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Rôle">
                        <Input value="Secrétaire" disabled className="bg-[#F4F6F8] text-muted" />
                      </Field>
                      <div className="flex items-center justify-between rounded-xl border border-border bg-white px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted">Statut du compte</p>
                          <p className="flex items-center gap-1.5 text-sm font-medium text-navy">
                            <span className={cn('inline-block h-2 w-2 rounded-full', isActive ? 'bg-success' : 'bg-muted')} />
                            {isActive ? 'Actif' : 'Inactif'}
                          </p>
                          <p className="text-[11px] text-muted">
                            {isActive ? 'Peut se connecter au dashboard.' : 'Ne peut plus se connecter.'}
                          </p>
                        </div>
                        <StatusSwitch active={isActive} onChange={setIsActive} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-white p-5">
              <h3 className="text-sm font-semibold text-navy">Sécurité</h3>
              {mode === 'create' ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Mot de passe *" error={fieldErrors.password}>
                    <PasswordInput value={password} onChange={setPassword} />
                    <p className="mt-1 text-xs text-muted">Minimum 8 caractères.</p>
                    {strength ? (
                      <p
                        className={cn(
                          'mt-0.5 text-xs font-medium',
                          strength === 'Fort' ? 'text-success' : strength === 'Correct' ? 'text-primary' : 'text-warning',
                        )}
                      >
                        {strength}
                      </p>
                    ) : null}
                  </Field>
                  <Field label="Confirmer le mot de passe *" error={fieldErrors.confirm}>
                    <PasswordInput value={confirm} onChange={setConfirm} />
                  </Field>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-[#FAFCFD] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-tint text-primary">
                      <Lock className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-xs font-medium text-muted">Mot de passe</p>
                      <p className="mt-0.5 font-mono text-sm tracking-widest text-navy">••••••••••••</p>
                    </div>
                  </div>
                  {isAdminAccount ? (
                    canChangeOwnPassword ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:underline"
                        onClick={() => setAdminPasswordOpen(true)}
                      >
                        Changer le mot de passe
                      </button>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={() => setResetOpen(true)}
                    >
                      Réinitialiser le mot de passe
                    </button>
                  )}
                </div>
              )}
            </section>

            {isAdminAccount ? (
              <AdminAccessCard />
            ) : (
              <section>
                <PermissionGroupsEditor groups={groups} value={permissions} onChange={setPermissions} />
              </section>
            )}

            {mode === 'edit' && user && user.role !== 'admin' ? (
              <section className="rounded-2xl border border-danger/30 bg-danger/[0.04] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-danger/80">Zone de danger</p>
                <p className="mt-2 text-sm font-medium text-navy">Supprimer ce compte</p>
                <p className="mt-1 text-sm text-muted">
                  Ce compte ne pourra plus accéder au Smart CRM. Son historique d&apos;activité restera conservé.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4 border border-danger bg-white text-danger hover:bg-danger/5"
                  onClick={() => setDeleteOpen(true)}
                >
                  Supprimer le compte
                </Button>
              </section>
            ) : null}

            {formError ? (
              <p className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{formError}</p>
            ) : null}
          </div>
      </ModalShell>

      <ResetPasswordModal
        userName={user?.displayName || ''}
        open={resetOpen && !isAdminAccount}
        onClose={() => setResetOpen(false)}
        onConfirm={resetPassword}
        loading={saving}
      />

      <AdminChangePasswordModal
        open={adminPasswordOpen}
        onClose={() => setAdminPasswordOpen(false)}
      />

      <DeleteUserConfirmModal
        user={user}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteUser}
        loading={deleting}
      />

      <UnsavedChangesModal
        open={unsavedOpen}
        onClose={() => setUnsavedOpen(false)}
        onConfirm={() => {
          setUnsavedOpen(false)
          onClose()
        }}
      />
    </>
  )
}

/** @deprecated Use UserAccountModal */
export const UserDrawer = UserAccountModal
