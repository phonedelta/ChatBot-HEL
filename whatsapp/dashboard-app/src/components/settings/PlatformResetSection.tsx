import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { cabinetSettingsApi } from '@/lib/cabinet-settings'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

const CONFIRMATION = 'RESET HEL'

export function PlatformResetSection() {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [confirmation, setConfirmation] = useState('')
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 2) inputRef.current?.focus()
  }, [step])

  const close = () => {
    if (resetting) return
    setStep(0)
    setConfirmation('')
    setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (confirmation !== CONFIRMATION || resetting) return
    setResetting(true)
    setError('')
    try {
      const response = await cabinetSettingsApi.resetPlatform(confirmation)
      setSuccess(response.message)
      setStep(0)
      setConfirmation('')
      window.dispatchEvent(new CustomEvent('platform-reset'))
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'La réinitialisation a échoué. Veuillez réessayer.',
      )
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      {success ? (
        <div
          role="status"
          className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {success}
        </div>
      ) : null}

      <section className="rounded-[14px] border border-red-200 bg-red-50/50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Zone de danger</h3>
            </div>
            <h4 className="mt-3 text-base font-semibold text-navy">Réinitialiser les données</h4>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Supprime les patients, rendez-vous, conversations CRM, relances, notifications
              et ancien historique. Les utilisateurs, les paramètres du centre, la Knowledge
              et la connexion WhatsApp seront conservés.
            </p>
          </div>
          <Button
            variant="danger"
            icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setStep(1)}
          >
            Réinitialiser les données
          </Button>
        </div>
      </section>

      {step > 0 ? (
        <Modal onClose={close}>
          <div className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <button
                type="button"
                onClick={close}
                disabled={resetting}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-slate-100 hover:text-navy disabled:opacity-50"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {step === 1 ? (
              <>
                <h2 className="mt-5 text-xl font-semibold text-navy">
                  Réinitialiser toutes les données ?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Cette action supprimera définitivement les données métier : patients,
                  rendez-vous, messages CRM, historique, notifications, relances et états
                  de réservation.
                </p>
                <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan-tint/50 px-4 py-3 text-sm text-navy">
                  La session WhatsApp, les comptes utilisateurs et les paramètres du centre
                  resteront intacts.
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <Button variant="secondary" onClick={close}>Annuler</Button>
                  <Button variant="danger" onClick={() => setStep(2)}>Continuer</Button>
                </div>
              </>
            ) : (
              <form onSubmit={submit}>
                <h2 className="mt-5 text-xl font-semibold text-navy">
                  Confirmation définitive
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Cette action est irréversible. Tapez <strong>{CONFIRMATION}</strong> pour continuer.
                </p>
                <label htmlFor="platform-reset-confirmation" className="mt-5 block text-sm font-medium text-navy">
                  Texte de confirmation
                </label>
                <input
                  ref={inputRef}
                  id="platform-reset-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={resetting}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-navy outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  placeholder={CONFIRMATION}
                />
                {error ? (
                  <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>
                ) : null}
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button variant="secondary" onClick={() => setStep(1)} disabled={resetting}>
                    Retour
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    loading={resetting}
                    disabled={confirmation !== CONFIRMATION}
                  >
                    Réinitialiser définitivement
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
