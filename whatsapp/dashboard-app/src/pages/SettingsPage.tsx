import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Input'

type PasswordForm = {
  current_password: string
  new_password: string
  confirm_password: string
}

export function SettingsPage() {
  const { username } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<PasswordForm>()

  const onPassword = handleSubmit(async (values) => {
    setMessage('')
    setError('')
    if (values.new_password !== values.confirm_password) {
      setError('Les mots de passe ne correspondent pas.')
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
      setMessage('Mot de passe mis à jour.')
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du changement')
    }
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-text sm:text-4xl">Paramètres</h1>
        <p className="mt-1 text-muted">Sécurité du compte administrateur.</p>
      </header>

      <Card className="max-w-xl">
        <h2 className="mb-1 font-display text-2xl">Mot de passe</h2>
        <p className="mb-5 text-sm text-muted">
          Compte connecté : <span className="font-medium text-text">{username || 'admin'}</span>
        </p>
        <form className="space-y-3" onSubmit={onPassword}>
          <Field label="Mot de passe actuel">
            <Input type="password" autoComplete="current-password" {...register('current_password', { required: true })} />
          </Field>
          <Field label="Nouveau mot de passe">
            <Input type="password" autoComplete="new-password" {...register('new_password', { required: true, minLength: 8 })} />
          </Field>
          <Field label="Confirmer">
            <Input type="password" autoComplete="new-password" {...register('confirm_password', { required: true })} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
          <Button type="submit" loading={isSubmitting}>
            Mettre à jour
          </Button>
        </form>
      </Card>
    </div>
  )
}
