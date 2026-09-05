import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageCircle, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { WaInstance } from '@/lib/types'
import { cn } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'

type ConnectMode = 'qr' | 'phone'

type QrPayload = {
  ok: boolean
  qr?: string | null
  state?: string
  instance?: WaInstance
  error?: string
  lastError?: string | null
  pairing_code?: string | null
  pairing_code_display?: string | null
  pairing_phone?: string | null
}

type PairPayload = {
  ok: boolean
  state?: string
  instance?: WaInstance
  error?: string
  lastError?: string | null
  pairing_code?: string | null
  pairing_code_display?: string | null
  pairing_phone?: string | null
  pending?: boolean
}

function whatsappStatusLabel(state?: string | null) {
  const v = String(state || '').toLowerCase()
  if (v === 'ready') return 'Connecté'
  if (v === 'authenticated' || v === 'connecting') return 'Connexion en cours'
  if (v === 'qr' || v === 'code') return 'Connexion requise'
  if (v === 'initializing' || v === 'recovering' || v === 'pairing' || v === 'opening') return 'Connexion en cours'
  if (v === 'disconnected' || v === 'missing') return 'Déconnecté'
  if (v === 'auth_failure') return 'Erreur de connexion'
  return 'Connexion requise'
}

function isConnected(state?: string | null) {
  return String(state || '').toLowerCase() === 'ready'
}

function isConnecting(state?: string | null) {
  const v = String(state || '').toLowerCase()
  return ['initializing', 'qr', 'code', 'recovering', 'connecting', 'authenticated', 'pairing', 'opening'].includes(v)
}

function looksLikeTechnicalId(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return true
  if (/@lid|@c\.us|@s\.whatsapp\.net|@g\.us/i.test(raw)) return true
  if (/^\d{13,}$/.test(raw.replace(/\D/g, '')) && !raw.includes('+212')) return true
  return false
}

function phoneOf(instance?: WaInstance | null) {
  const candidate = instance?.account?.phone || instance?.phone_number || (instance as { phone?: string | null } | undefined)?.phone || null
  if (!candidate || looksLikeTechnicalId(candidate)) return null
  return candidate
}

function formatLastActivity(iso?: string | null) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    const today = new Date()
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    if (sameDay) return `Aujourd’hui · ${time}`
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

function mergeInstance(prev: WaInstance[], next?: WaInstance | null) {
  if (!next?.instance_id) return prev
  const others = prev.filter((item) => item.instance_id !== next.instance_id)
  return [next, ...others]
}

export function IntegrationsPage() {
  const [instances, setInstances] = useState<WaInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [connectMode, setConnectMode] = useState<ConnectMode>('qr')
  const [pairPhoneInput, setPairPhoneInput] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }, [])

  const main = useMemo(
    () => instances.find((i) => i.instance_id === 'main') || instances[0] || null,
    [instances],
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError('')
    try {
      const payload = await api<{ instances: WaInstance[] }>('/dashboard/api/instances')
      setInstances(payload.instances || [])
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Impossible de récupérer l’état des intégrations.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const waitingNumber = isConnected(main?.state) && !phoneOf(main)
    if ((!isConnecting(main?.state) || isConnected(main?.state)) && !waitingNumber) return
    const timer = window.setInterval(() => {
      void load(true)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [main?.state, main?.phone_number, main?.account?.phone, load])

  useEffect(() => {
    if (isConnected(main?.state)) {
      setQr(null)
      setPairingCode(null)
      if (qrOpen) {
        showToast('WhatsApp connecté.')
        setQrOpen(false)
        setManageOpen(false)
      }
    }
  }, [main?.state, qrOpen, showToast])

  async function fetchQr() {
    setConnectMode('qr')
    setQrLoading(true)
    setError('')
    setQrError('')
    setQr(null)
    setPairingCode(null)
    try {
      const started = await api<QrPayload>('/dashboard/api/instances/main/qr', {
        method: 'POST',
        body: { force: true, wait_ms: 60000 },
      })
      if (started.instance) {
        setInstances((prev) => mergeInstance(prev, started.instance))
      }
      if (started.qr) {
        setQr(started.qr)
        await load(true)
        return
      }
      if (started.lastError) {
        setQrError(started.lastError)
      }
      if (isConnected(started.state)) {
        showToast('WhatsApp connecté.')
        await load(true)
        return
      }

      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        const payload = await api<QrPayload>('/dashboard/api/instances/main/qr')
        if (payload.instance) {
          setInstances((prev) => mergeInstance(prev, payload.instance))
        }
        if (payload.qr) {
          setQr(payload.qr)
          return
        }
        if (payload.lastError) {
          setQrError(payload.lastError)
        }
        if (isConnected(payload.state)) {
          showToast('WhatsApp connecté.')
          return
        }
      }
      setQrError((prev) => prev || 'QR non généré à temps. Sur Railway, le premier lancement peut prendre 1 à 2 minutes — réessayez.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de générer le QR'
      setQrError(message)
      setError(message)
    } finally {
      setQrLoading(false)
    }
  }

  async function fetchPairingCode() {
    const phone = pairPhoneInput.trim()
    if (!phone) {
      setQrError('Indiquez le numéro WhatsApp du cabinet (ex. 0612345678).')
      return
    }

    setConnectMode('phone')
    setQrLoading(true)
    setError('')
    setQrError('')
    setQr(null)
    setPairingCode(null)
    try {
      const started = await api<PairPayload>('/dashboard/api/instances/main/pair', {
        method: 'POST',
        body: { phone_number: phone, force: true, wait_ms: 60000 },
      })
      if (started.instance) {
        setInstances((prev) => mergeInstance(prev, started.instance))
      }
      const code = started.pairing_code_display || started.pairing_code || null
      if (code) {
        setPairingCode(code)
        await load(true)
        return
      }
      if (started.lastError) {
        setQrError(started.lastError)
      }
      if (isConnected(started.state)) {
        showToast('WhatsApp connecté.')
        await load(true)
        return
      }

      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
        const payload = await api<PairPayload>('/dashboard/api/instances/main/pair')
        if (payload.instance) {
          setInstances((prev) => mergeInstance(prev, payload.instance))
        }
        const nextCode = payload.pairing_code_display || payload.pairing_code || null
        if (nextCode) {
          setPairingCode(nextCode)
          return
        }
        if (payload.lastError) {
          setQrError(payload.lastError)
        }
        if (isConnected(payload.state)) {
          showToast('WhatsApp connecté.')
          return
        }
      }
      setQrError((prev) => prev || 'Code de jumelage non généré à temps. Réessayez.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de générer le code'
      setQrError(message)
      setError(message)
    } finally {
      setQrLoading(false)
    }
  }

  async function reconnect() {
    setBusy(true)
    setError('')
    try {
      await api('/dashboard/api/instances', {
        method: 'POST',
        body: { instance_id: 'main', force: true },
      })
      await load()
      setManageOpen(false)
      setQrOpen(true)
      setConnectMode('qr')
      await fetchQr()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconnexion impossible')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await api('/dashboard/api/instances/main', { method: 'DELETE' })
      setQr(null)
      setPairingCode(null)
      setDisconnectOpen(false)
      setManageOpen(false)
      showToast('WhatsApp déconnecté.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Déconnexion impossible')
    } finally {
      setBusy(false)
    }
  }

  function openConnect() {
    setManageOpen(false)
    setQrOpen(true)
    setConnectMode('qr')
    void fetchQr()
  }

  const connected = isConnected(main?.state)
  const statusLabel = whatsappStatusLabel(main?.state)
  const phone = phoneOf(main)
  const lastActivity = formatLastActivity(main?.lastSeenAt || null)

  if (loading && !instances.length) {
    return (
      <div className="mx-auto max-w-[960px] space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }

  if (error && !instances.length && !loading) {
    return (
      <EmptyState
        title="Impossible de récupérer l’état des intégrations."
        description={error}
        action={
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-5 animate-[fadeIn_280ms_ease]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Intégrations</h1>
          <p className="mt-1 text-sm text-muted">Connectez les canaux utilisés par le cabinet.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          title="Actualiser"
          aria-label="Actualiser"
          onClick={() => void load()}
          icon={<RefreshCw className="h-4 w-4" />}
        />
      </header>

      {toast ? (
        <div className="rounded-xl border border-success/20 bg-[#EAF7F0] px-4 py-2.5 text-sm text-navy">
          {toast}
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {!connected && !main ? (
        <EmptyState
          title="Aucune intégration active."
          description="Connectez WhatsApp pour recevoir et envoyer les messages patients."
          action={
            <Button size="sm" onClick={openConnect}>
              Connecter WhatsApp
            </Button>
          }
        />
      ) : (
        <article className="rounded-2xl border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E8F8EF] text-[#25D366]">
                <MessageCircle className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-navy">WhatsApp</h2>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  Canal utilisé par l’assistant pour échanger avec les patients.
                </p>
              </div>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold',
                connected ? 'bg-[#EAF7F0] text-success' : 'bg-warning/10 text-warning',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-warning')} />
              {statusLabel}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] bg-[#F5FAFC] px-3.5 py-3">
              <p className="text-xs text-muted">Session</p>
              <p className="mt-1 text-sm font-semibold text-navy">
                {connected ? 'Active' : statusLabel}
              </p>
            </div>
            {lastActivity ? (
              <div className="rounded-[10px] bg-[#F5FAFC] px-3.5 py-3">
                <p className="text-xs text-muted">Dernière activité</p>
                <p className="mt-1 text-sm font-semibold text-navy">{lastActivity}</p>
              </div>
            ) : null}
            {phone ? (
              <div className="rounded-[10px] bg-[#F5FAFC] px-3.5 py-3 sm:col-span-2">
                <p className="text-xs text-muted">Compte WhatsApp</p>
                <p className="mt-1 text-sm font-semibold text-navy">{phone}</p>
              </div>
            ) : connected ? (
              <div className="rounded-[10px] bg-[#F5FAFC] px-3.5 py-3 sm:col-span-2">
                <p className="text-xs text-muted">Compte WhatsApp</p>
                <p className="mt-1 text-sm font-semibold text-navy">Compte connecté — récupération du numéro...</p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {connected ? (
              <Button size="sm" onClick={() => setManageOpen(true)}>
                Gérer la connexion
              </Button>
            ) : (
              <Button size="sm" loading={qrLoading} onClick={openConnect}>
                Connecter WhatsApp
              </Button>
            )}
          </div>
        </article>
      )}

      {manageOpen ? (
        <Modal onClose={() => setManageOpen(false)}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Gérer WhatsApp</h3>
            <p className="mt-1 text-sm text-muted">État de la session WhatsApp du cabinet.</p>
            <dl className="mt-4 space-y-3 rounded-[10px] bg-[#F5FAFC] px-3.5 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">État</dt>
                <dd className="font-medium text-navy">{statusLabel}</dd>
              </div>
              {phone ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Compte</dt>
                  <dd className="font-medium text-navy">{phone}</dd>
                </div>
              ) : connected ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Compte</dt>
                  <dd className="font-medium text-navy">Récupération du numéro...</dd>
                </div>
              ) : null}
              {lastActivity ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Dernière activité</dt>
                  <dd className="font-medium text-navy">{lastActivity}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setManageOpen(false)}>
                Fermer
              </Button>
              <Button size="sm" loading={busy || qrLoading} onClick={() => void reconnect()}>
                Reconnecter
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={busy}
                onClick={() => setDisconnectOpen(true)}
              >
                Déconnecter
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {disconnectOpen ? (
        <Modal onClose={() => setDisconnectOpen(false)}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Déconnecter WhatsApp ?</h3>
            <p className="mt-2 text-sm text-muted">
              L’assistant ne pourra plus recevoir ni envoyer de nouveaux messages jusqu’à une nouvelle
              connexion.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDisconnectOpen(false)}>
                Annuler
              </Button>
              <Button variant="danger" size="sm" loading={busy} onClick={() => void disconnect()}>
                Déconnecter
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {qrOpen ? (
        <Modal onClose={() => setQrOpen(false)} className="max-w-md">
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Connecter WhatsApp</h3>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#F5FAFC] p-1">
              <button
                type="button"
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  connectMode === 'qr' ? 'bg-white text-navy shadow-sm' : 'text-muted',
                )}
                onClick={() => {
                  setConnectMode('qr')
                  setQrError('')
                  if (!qr && !qrLoading) void fetchQr()
                }}
              >
                QR code
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  connectMode === 'phone' ? 'bg-white text-navy shadow-sm' : 'text-muted',
                )}
                onClick={() => {
                  setConnectMode('phone')
                  setQrError('')
                  setQr(null)
                }}
              >
                Numéro (Android)
              </button>
            </div>

            {connectMode === 'qr' ? (
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-muted">
                <li>Ouvrez WhatsApp sur votre téléphone.</li>
                <li>Accédez aux appareils connectés.</li>
                <li>Scannez ce QR code.</li>
              </ol>
            ) : (
              <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-muted">
                <li>Ouvrez WhatsApp → Appareils connectés → Lier un appareil.</li>
                <li>Choisissez « Lier avec un numéro de téléphone ».</li>
                <li>Saisissez le code à 8 caractères affiché ici.</li>
              </ol>
            )}

            {connectMode === 'phone' ? (
              <div className="mt-4 space-y-2">
                <label className="block text-xs font-medium text-muted" htmlFor="pair-phone">
                  Numéro WhatsApp du cabinet
                </label>
                <input
                  id="pair-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="06XXXXXXXX ou 2126XXXXXXXX"
                  value={pairPhoneInput}
                  onChange={(e) => setPairPhoneInput(e.target.value)}
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-cyan"
                />
              </div>
            ) : null}

            <div className="mt-5 flex min-h-[240px] flex-col items-center justify-center">
              {qrLoading ? (
                <div className="flex flex-col items-center gap-3 text-muted">
                  <Loader2 className="h-9 w-9 animate-spin text-cyan" />
                  <p className="text-sm">
                    {connectMode === 'phone' ? 'Génération du code…' : 'Génération du QR…'}
                  </p>
                  {qrError ? (
                    <p className="max-w-xs rounded-xl bg-danger/10 px-3 py-2 text-center text-xs text-danger">
                      {qrError}
                    </p>
                  ) : null}
                </div>
              ) : connected ? (
                <p className="text-sm font-medium text-success">WhatsApp connecté avec succès.</p>
              ) : connectMode === 'phone' && pairingCode ? (
                <>
                  <p className="font-mono text-3xl font-semibold tracking-[0.2em] text-navy">
                    {pairingCode}
                  </p>
                  <p className="mt-3 max-w-xs text-center text-xs text-muted">
                    Entrez ce code dans WhatsApp Android. Il se renouvelle environ toutes les 3 minutes.
                  </p>
                </>
              ) : connectMode === 'qr' && qr ? (
                <>
                  <img
                    src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                    alt="QR code WhatsApp"
                    className="h-52 w-52 rounded-2xl border border-border bg-white p-3"
                  />
                  <p className="mt-3 text-xs text-muted">En attente de connexion…</p>
                </>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-muted">
                    {connectMode === 'phone'
                      ? 'Saisissez le numéro puis générez le code.'
                      : 'Impossible d’afficher le QR pour le moment.'}
                  </p>
                  {qrError ? (
                    <p className="rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{qrError}</p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setQrOpen(false)}>
                Fermer
              </Button>
              {!connected ? (
                <Button
                  size="sm"
                  loading={qrLoading}
                  onClick={() => void (connectMode === 'phone' ? fetchPairingCode() : fetchQr())}
                >
                  {connectMode === 'phone' ? (pairingCode ? 'Régénérer' : 'Générer le code') : 'Régénérer'}
                </Button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
