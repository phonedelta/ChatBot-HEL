import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Clock3,
  Cloud,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  User,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import helLogo from '@/assets/HEL-scaled.webp'

type FormValues = { username: string; password: string; remember: boolean }

const REMEMBER_KEY = 'hel-dashboard-remember-user'

const features = [
  {
    icon: Clock3,
    title: 'Gestion en temps réel',
    desc: 'Suivez votre activité en temps réel',
  },
  {
    icon: ShieldCheck,
    title: 'Sécurité avancée',
    desc: 'Vos données sont protégées',
  },
  {
    icon: Cloud,
    title: 'Accessible partout',
    desc: 'Accédez depuis n’importe où',
  },
]

export function LoginPage() {
  const { login } = useAuth()
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [forgotHint, setForgotHint] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      username: (() => {
        try {
          return localStorage.getItem(REMEMBER_KEY) || 'admin'
        } catch {
          return 'admin'
        }
      })(),
      password: '',
      remember: true,
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setError('')
    setForgotHint(false)
    try {
      await login(values.username.trim(), values.password)
      try {
        if (values.remember) {
          localStorage.setItem(REMEMBER_KEY, values.username.trim())
        } else {
          localStorage.removeItem(REMEMBER_KEY)
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible')
    }
  })

  return (
    <div className="relative h-dvh max-h-dvh overflow-hidden bg-[#F7FCFD]">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.35) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />

      <div className="relative mx-auto flex h-full max-w-7xl flex-col lg:flex-row">
        {/* Left branding panel */}
        <motion.section
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="relative hidden h-full flex-1 flex-col justify-between overflow-hidden px-10 py-8 lg:flex xl:px-14 xl:py-10"
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                'linear-gradient(105deg, rgba(247,252,253,0.94) 0%, rgba(247,252,253,0.78) 45%, rgba(247,252,253,0.4) 100%), url(https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1600&q=80)',
            }}
          />

          <div className="relative z-10">
            <img
              src={helLogo}
              alt="Centre Dentaire HEL"
              className="h-12 w-auto max-w-[180px] object-contain drop-shadow-sm"
            />

            <h1 className="mt-6 max-w-lg font-display text-3xl leading-snug text-text xl:text-4xl">
              Votre solution{' '}
              <span className="text-primary">intelligente</span> pour une gestion simplifiée
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              Gérez vos rendez-vous, patients et communications en toute simplicité et efficacité.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-2.5">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-[18px] border border-white/70 bg-white/90 p-3 shadow-[0_8px_24px_rgba(16,42,67,0.07)] backdrop-blur"
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <feature.icon className="h-4 w-4" />
                </div>
                <p className="text-xs font-semibold text-text">{feature.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{feature.desc}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Right login form */}
        <motion.section
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="relative z-10 flex h-full flex-1 items-center justify-center px-4 py-4 sm:px-6 lg:px-8"
        >
          <div className="flex w-full max-w-[430px] flex-col overflow-hidden rounded-[26px] border border-border bg-white shadow-[0_20px_50px_rgba(16,42,67,0.1)]">
            <div className="px-7 py-6 sm:px-8 sm:py-7">
              <div className="mb-5 text-center">
                <h2 className="font-display text-[1.65rem] text-text">Se connecter</h2>
                <p className="mt-1 text-xs text-muted">Accédez à votre espace administrateur</p>
              </div>

              <form className="space-y-3.5" onSubmit={onSubmit}>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-text">Compte</label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input
                      className="h-[42px] rounded-[15px] py-2.5 pl-10 text-sm"
                      placeholder="Entrez votre nom d’utilisateur"
                      autoComplete="username"
                      {...register('username', { required: true })}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-text">Mot de passe</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      className="h-[42px] rounded-[15px] py-2.5 pl-10 pr-10 text-sm"
                      placeholder="Entrez votre mot de passe"
                      autoComplete="current-password"
                      {...register('password', { required: true })}
                    />
                    <button
                      type="button"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:bg-[#f3fbfd] hover:text-text"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[#0F9FB2]"
                      {...register('remember')}
                    />
                    Se souvenir de moi
                  </label>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() => setForgotHint(true)}
                  >
                    Mot de passe oublié ?
                  </button>
                </div>

                {forgotHint ? (
                  <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    Contactez l’administrateur pour réinitialiser le mot de passe.
                  </p>
                ) : null}

                {error ? (
                  <p className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                    {error}
                  </p>
                ) : null}

                <Button type="submit" className="h-[42px] w-full rounded-[15px] text-sm" loading={isSubmitting}>
                  Se connecter
                  {!isSubmitting ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </form>

              <div className="mt-5 flex items-center gap-2.5">
                <div className="h-px flex-1 bg-border" />
                <img src={helLogo} alt="" className="h-5 w-auto object-contain opacity-80" />
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>

            <div className="border-t border-border bg-[#F7FCFD] px-7 py-3.5 sm:px-8">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text">Connexion sécurisée</p>
                  <p className="text-[11px] leading-snug text-muted">
                    Vos données sont chiffrées et protégées.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
