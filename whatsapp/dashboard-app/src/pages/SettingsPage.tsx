import { useMemo, useState } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { initials } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

type PasswordForm = {
  current_password: string
  new_password: string
  confirm_password: string
}

function PasswordField({
  label,
  autoComplete,
  registration,
  show,
  onToggle,
}: {
  label: string
  autoComplete: string
  registration: UseFormRegisterReturn
  show: boolean
  onToggle: () => void
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="pr-12"
          {...registration}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-1.5 text-muted transition hover:bg-[#f3fbfd] hover:text-primary"
          aria-label={show ? 'Masquer' : 'Afficher'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  )
}

export function SettingsPage() {
  const { username } = useAuth()
  useDocumentTitle('Paramètres')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<PasswordForm>({
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: '',
    },
  })

  const newPassword = watch('new_password') || ''
  const strength = useMemo(() => {
    let score = 0
    if (newPassword.length >= 8) score += 1
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score += 1
    if (/\d/.test(newPassword)) score += 1
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 1
    return score
  }, [newPassword])

  const strengthLabel = ['', 'Faible', 'Moyen', 'Bon', 'Fort'][strength] || ''
  const strengthColor = [
    'bg-border',
    'bg-danger',
    'bg-warning',
    'bg-secondary',
    'bg-success',
  ][strength] || 'bg-border'

  const onPassword = handleSubmit(async (values) => {
    setMessage('')
    setError('')
    if (values.new_password !== values.confirm_password) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    if (values.new_password.length < 8) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.')
      return
    }
    try {
      await api('/dashboard/api/auth/change-password', {
        method: 'POST',
        body: {
          current_password: values.current_password,
          new_password: values.new_password,
        },
      })
      setMessage('Mot de passe mis à jour avec succès.')
      reset()
      setShowCurrent(false)
      setShowNew(false)
      setShowConfirm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du changement')
    }
  })

  const displayName = username || 'admin'

  return (
    <div className="min-w-0 space-y-6">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-3xl text-text sm:text-4xl"
        >
          Paramètres
        </motion.h1>
        <p className="mt-1 text-muted">Sécurité et accès du compte administrateur.</p>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        {/* Account / security panel */}
        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-[28px] border border-primary/15 bg-gradient-to-br from-[#0f9fb2] via-[#12b0c4] to-[#0b7f90] p-6 text-white shadow-[0_18px_40px_rgba(15,159,178,0.28)] sm:p-7"
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-16 left-8 h-44 w-44 rounded-full bg-[#6fd6e3]/30 blur-3xl"
            aria-hidden
          />

          <div className="relative flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 font-display text-lg font-semibold ring-1 ring-white/25 backdrop-blur-sm">
              {initials(displayName)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                Compte connecté
              </p>
              <p className="mt-1 truncate font-display text-2xl">{displayName}</p>
              <p className="mt-0.5 text-sm text-white/80">Administrateur HEL</p>
            </div>
          </div>

          <div className="relative mt-8 space-y-3">
            {[
              {
                icon: ShieldCheck,
                title: 'Accès protégé',
                desc: 'Seuls les administrateurs autorisés peuvent gérer le cabinet.',
              },
              {
                icon: KeyRound,
                title: 'Mot de passe fort',
                desc: '8 caractères minimum, idéalement lettres, chiffres et symbole.',
              },
              {
                icon: Lock,
                title: 'Changement régulier',
                desc: 'Mettez à jour votre mot de passe si l’accès a pu être exposé.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <item.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/75">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.aside>

        {/* Password form */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06 }}
          className="card-surface min-w-0 p-5 sm:p-7"
        >
          <div className="mb-6 flex items-start gap-3 border-b border-border pb-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl text-text">Mot de passe</h2>
              <p className="mt-1 text-sm text-muted">
                Modifiez le mot de passe utilisé pour vous connecter au dashboard.
              </p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={onPassword}>
            <PasswordField
              label="Mot de passe actuel"
              autoComplete="current-password"
              registration={register('current_password', { required: true })}
              show={showCurrent}
              onToggle={() => setShowCurrent((v) => !v)}
            />
            <PasswordField
              label="Nouveau mot de passe"
              autoComplete="new-password"
              registration={register('new_password', { required: true, minLength: 8 })}
              show={showNew}
              onToggle={() => setShowNew((v) => !v)}
            />

            {newPassword ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Solidité</span>
                  <span className="font-semibold text-text">{strengthLabel}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 4].map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 rounded-full transition ${
                        strength >= step ? strengthColor : 'bg-[#e8f4f6]'
                      }`}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <PasswordField
              label="Confirmer le nouveau mot de passe"
              autoComplete="new-password"
              registration={register('confirm_password', { required: true })}
              show={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
            />

            {error ? (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm text-danger"
              >
                {error}
              </motion.p>
            ) : null}
            {message ? (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex w-full items-center gap-2 rounded-2xl border border-success/20 bg-success/5 px-3.5 py-2.5 text-sm text-success"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {message}
              </motion.p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" loading={isSubmitting} icon={<Lock className="h-4 w-4" />}>
                Mettre à jour le mot de passe
              </Button>
              <p className="text-xs text-muted">Minimum 8 caractères</p>
            </div>
          </form>
        </motion.section>
      </div>
    </div>
  )
}
