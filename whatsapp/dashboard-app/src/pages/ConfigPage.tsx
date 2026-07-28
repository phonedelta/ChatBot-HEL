import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Info,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { WaInstance } from '@/lib/types'
import { formatStatus } from '@/lib/format'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

type QrPayload = {
  ok: boolean
  qr?: string
  state?: string
  instance?: WaInstance
  error?: string
}

export function ConfigPage() {
  const [instances, setInstances] = useState<WaInstance[]>([])
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [qrLoading, setQrLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [events, setEvents] = useState<Array<{ title: string; detail: string; at: string }>>([])

  const main = useMemo(
    () => instances.find((i) => i.instance_id === 'main') || instances[0],
    [instances],
  )

  const pushEvent = useCallback((title: string, detail: string) => {
    setEvents((prev) => [
      { title, detail, at: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) },
      ...prev,
    ].slice(0, 8))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api<{ instances: WaInstance[] }>('/dashboard/api/instances')
      setInstances(payload.instances || [])
      pushEvent('Synchronisation', 'État des instances actualisé')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [pushEvent])

  useEffect(() => {
    void load()
  }, [load])

  async function reconnect() {
    setBusy(true)
    setError('')
    try {
      await api('/dashboard/api/instances', {
        method: 'POST',
        body: { instance_id: 'main' },
      })
      pushEvent('Connexion', 'Instance main initialisée')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconnexion impossible')
      pushEvent('Erreur', 'Échec de reconnexion')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Déconnecter et supprimer la session WhatsApp ?')) return
    setBusy(true)
    setError('')
    try {
      await api('/dashboard/api/instances/main', { method: 'DELETE' })
      setQr(null)
      pushEvent('Déconnexion', 'Session main supprimée')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Déconnexion impossible')
    } finally {
      setBusy(false)
    }
  }

  async function fetchQr() {
    setQrLoading(true)
    setError('')
    try {
      await api('/dashboard/api/instances', {
        method: 'POST',
        body: { instance_id: 'main' },
      })
      const payload = await api<QrPayload>('/dashboard/api/instances/main/qr', { method: 'POST' })
      if (payload.qr) {
        setQr(payload.qr)
        pushEvent('QR généré', 'Scannez depuis WhatsApp')
      } else {
        setQr(null)
        pushEvent('Connexion', `État: ${payload.state || 'inconnu'}`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR indisponible')
      pushEvent('Erreur', 'Impossible de générer le QR')
    } finally {
      setQrLoading(false)
    }
  }

  const ready = String(main?.state || '').toLowerCase() === 'ready'

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-text sm:text-4xl">Configuration WhatsApp</h1>
        <p className="mt-1 text-muted">Connectez et gérez votre instance WhatsApp.</p>
      </header>

      {error ? (
        <div className="rounded-[20px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">État de connexion</h2>
              <p className="text-sm text-muted">Instance principale du cabinet</p>
            </div>
            {loading ? <Skeleton className="h-8 w-24" /> : (
              <StatusBadge value={main?.state} label={formatStatus(main?.state)} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Nom instance', value: main?.instance_id || 'main' },
              { label: 'Numéro', value: main?.phone_number || '—' },
              { label: 'Version', value: 'whatsapp-web.js' },
              { label: 'État', value: formatStatus(main?.state) },
            ].map((row) => (
              <div key={row.label} className="rounded-[18px] border border-border bg-[#f7fcfd] px-4 py-3">
                <p className="text-xs text-muted">{row.label}</p>
                <p className="mt-1 text-sm font-semibold">{row.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button icon={<Power className="h-4 w-4" />} loading={busy} onClick={() => void reconnect()}>
              Reconnecter
            </Button>
            <Button variant="secondary" icon={<Unplug className="h-4 w-4" />} loading={busy} onClick={() => void disconnect()}>
              Déconnecter
            </Button>
            <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
              Actualiser
            </Button>
          </div>
        </Card>

        <Card className="relative min-h-[360px] overflow-hidden">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl">QR Code</h2>
              <p className="text-sm text-muted">Scannez pour lier WhatsApp</p>
            </div>
            <Button variant="secondary" size="sm" icon={<QrCode className="h-4 w-4" />} loading={qrLoading} onClick={() => void fetchQr()}>
              Générer
            </Button>
          </div>

          <div className="flex min-h-[260px] flex-col items-center justify-center">
            {qrLoading ? (
              <div className="flex flex-col items-center gap-3 text-muted">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm">Génération du QR…</p>
              </div>
            ) : ready ? (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-3 text-center"
              >
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-success/10 text-success">
                  <CheckCircle2 className="h-12 w-12" />
                </div>
                <p className="font-display text-2xl text-success">Connecté</p>
                <p className="text-sm text-muted">L’instance WhatsApp est prête.</p>
              </motion.div>
            ) : qr ? (
              <motion.img
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR WhatsApp"
                className="h-56 w-56 rounded-[20px] border border-border bg-white p-3 shadow-soft"
              />
            ) : (
              <div className="text-center text-muted">
                <QrCode className="mx-auto mb-3 h-12 w-12 opacity-40" />
                <p className="text-sm">Aucun QR affiché. Cliquez sur Générer.</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-display text-2xl">Informations</h2>
          <div className="space-y-3">
            {[
              { label: 'Connexion sécurisée', value: 'TLS / Session LocalAuth', icon: ShieldCheck },
              { label: 'Dernière synchronisation', value: main?.lastSeenAt || '—', icon: RefreshCw },
              { label: 'Version API', value: 'Dashboard v2', icon: Info },
              { label: 'Temps de réponse', value: '< 200 ms (local)', icon: Loader2 },
              { label: 'État Webhook', value: ready ? 'Actif' : 'Inactif', icon: CheckCircle2 },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 rounded-[18px] border border-border px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <row.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted">{row.label}</p>
                  <p className="text-sm font-semibold">{row.value}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-display text-2xl">Historique des événements</h2>
          <div className="space-y-4">
            {(events.length
              ? events
              : [
                  { title: 'Synchronisation', detail: 'En attente d’action', at: '—' },
                ]
            ).map((ev, i) => (
              <div key={`${ev.title}-${i}`} className="flex gap-3">
                <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{ev.title}</p>
                    <Badge tone="muted">{ev.at}</Badge>
                  </div>
                  <p className="text-xs text-muted">{ev.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="border-primary/20 bg-gradient-to-r from-[#e8f8fb] to-white">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-xl">Conseils</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Gardez le téléphone source allumé et connecté à Internet. Si le QR expire, régénérez-le.
              Après connexion, le statut passe à <strong className="text-text">Prête</strong> et le bot
              peut répondre automatiquement aux patients.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
