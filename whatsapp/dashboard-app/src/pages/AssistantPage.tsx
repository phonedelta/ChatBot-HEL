import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'

type KnowledgeItem = {
  id: number
  category: string
  key: string
  label: string
  value?: string | null
  status?: string
}

type AssistantPayload = {
  assistant: {
    name: string
    tone: string
    active: boolean
  }
  knowledge: KnowledgeItem[]
  knowledge_stats?: { filled: number; total: number }
}

const KNOWLEDGE_GROUPS: Array<{
  id: string
  label: string
  match: (item: KnowledgeItem) => boolean
}> = [
  {
    id: 'hours',
    label: 'Horaires du cabinet',
    match: (i) => i.category === 'horaires',
  },
  {
    id: 'address',
    label: 'Adresse et accès',
    match: (i) => i.category === 'cabinet' && ['address', 'neighborhood', 'city'].includes(i.key),
  },
  {
    id: 'admin',
    label: 'Informations administratives',
    match: (i) => i.category === 'cabinet' && ['name', 'phone', 'email'].includes(i.key),
  },
  {
    id: 'appointments',
    label: 'Types de rendez-vous',
    match: (i) => i.category === 'medecins' || i.category === 'rdv' || i.category === 'services',
  },
  {
    id: 'faq',
    label: 'Questions fréquentes',
    match: (i) => i.category === 'faq',
  },
]

function isFilled(item: KnowledgeItem) {
  return item.status === 'filled' || Boolean(String(item.value || '').trim())
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13AEC1]/30 focus-visible:ring-offset-2',
        checked ? 'bg-[#20B26B]' : 'bg-[#DCEAF0]',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  )
}

export function AssistantPage() {
  const [data, setData] = useState<AssistantPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [savingKnowledge, setSavingKnowledge] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [pauseModal, setPauseModal] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeItem | null>(null)
  const [knowledgeValue, setKnowledgeValue] = useState('')

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await api<AssistantPayload & { ok: boolean }>('/dashboard/api/assistant')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger la configuration de l’assistant.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const knowledgeGroups = useMemo(() => {
    const items = data?.knowledge || []
    return KNOWLEDGE_GROUPS.map((group) => {
      const matched = items.filter(group.match)
      const configured = matched.length > 0 && matched.every(isFilled)
      const partial = matched.some(isFilled)
      return {
        ...group,
        items: matched,
        status: matched.length === 0 ? 'empty' : configured ? 'configured' : partial ? 'partial' : 'empty',
      }
    })
  }, [data])

  async function setActive(next: boolean) {
    setToggling(true)
    setError('')
    try {
      await api('/dashboard/api/assistant', { method: 'PATCH', body: { active: next } })
      showToast(next ? 'Assistant activé.' : 'Assistant mis en pause.')
      setPauseModal(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mise à jour impossible')
    } finally {
      setToggling(false)
    }
  }

  function onToggleActive(next: boolean) {
    if (!next && data?.assistant.active) {
      setPauseModal(true)
      return
    }
    void setActive(true)
  }

  async function saveKnowledge() {
    if (!editing) return
    setSavingKnowledge(true)
    setError('')
    try {
      await api('/dashboard/api/knowledge', {
        method: 'PUT',
        body: {
          category: editing.category,
          key: editing.key,
          label: editing.label,
          value: knowledgeValue,
        },
      })
      showToast('Information mise à jour — l’assistant utilisera la nouvelle valeur.')
      setEditing(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSavingKnowledge(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-56" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <EmptyState
        title="Impossible de charger la configuration de l’assistant."
        description={error}
        action={
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
        }
      />
    )
  }

  if (!data) return null

  const active = data.assistant.active

  return (
    <div className="relative mx-auto max-w-5xl space-y-5 animate-[fadeIn_280ms_ease]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Assistant IA</h1>
          <p className="mt-1 text-sm text-muted">
            Statut de l’assistant et base de connaissances du cabinet.
          </p>
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

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', active ? 'bg-success' : 'bg-warning')}
            aria-hidden
          />
          <div>
            <p className="text-base font-semibold text-navy">
              {active ? 'Assistant actif' : 'Assistant en pause'}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {active
                ? 'L’assistant répond automatiquement aux conversations autorisées.'
                : 'Les nouveaux messages restent visibles mais aucune réponse automatique n’est envoyée.'}
            </p>
            <p className="mt-2 text-sm text-navy">
              {data.assistant.name || 'Assistant du cabinet'}
              <span className="text-muted"> · </span>
              <span className="text-muted">{data.assistant.tone || 'Professionnel et chaleureux'}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
          <span className="text-sm font-medium text-muted">{active ? 'Actif' : 'Désactivé'}</span>
          <Toggle
            checked={active}
            onChange={onToggleActive}
            label="Assistant actif"
            disabled={toggling}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-navy">Base de connaissances</h2>
            <p className="mt-0.5 text-sm text-muted">
              Informations utilisées par l’assistant pour répondre aux patients. Toute modification est appliquée immédiatement.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setKnowledgeOpen(true)}>
            Gérer les informations
          </Button>
        </div>
        <ul className="mt-4 space-y-2">
          {knowledgeGroups.map((group) => (
            <li
              key={group.id}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border/80 px-3.5 py-3"
            >
              <div className="flex items-start gap-2.5">
                {group.status === 'configured' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                )}
                <div>
                  <p className="text-sm font-medium text-navy">{group.label}</p>
                  <p className="text-xs text-muted">
                    {group.status === 'configured' ? 'Configuré' : 'À compléter'}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {pauseModal ? (
        <Modal onClose={() => setPauseModal(false)}>
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Mettre l’assistant en pause ?</h3>
            <p className="mt-2 text-sm text-muted">
              L’assistant ne répondra plus automatiquement aux nouveaux messages.
            </p>
            <p className="mt-1 text-sm text-muted">
              Les conversations et messages continueront à être reçus.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPauseModal(false)}>
                Annuler
              </Button>
              <Button size="sm" loading={toggling} onClick={() => void setActive(false)}>
                Mettre en pause
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {knowledgeOpen ? (
        <Modal onClose={() => { setKnowledgeOpen(false); setEditing(null) }} className="max-w-2xl">
          <div className="p-5">
            <h3 className="text-lg font-semibold text-navy">Gérer les informations</h3>
            <p className="mt-1 text-sm text-muted">
              Ces contenus alimentent directement les réponses de l’assistant sur WhatsApp.
            </p>
            {editing ? (
              <div className="mt-4">
                <Field label={editing.label}>
                  <Textarea
                    value={knowledgeValue}
                    onChange={(e) => setKnowledgeValue(e.target.value)}
                    rows={5}
                  />
                </Field>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={savingKnowledge}>
                    Retour
                  </Button>
                  <Button size="sm" loading={savingKnowledge} onClick={() => void saveKnowledge()}>
                    Enregistrer
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto scrollbar-thin">
                {(data.knowledge || []).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(item)
                        setKnowledgeValue(item.value || '')
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 text-left transition hover:border-navy/25 hover:bg-cyan-tint/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-navy">{item.label}</p>
                        <p className="truncate text-xs text-muted">
                          {item.value || 'Non renseigné'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold',
                          isFilled(item) ? 'bg-[#EAF7F0] text-success' : 'bg-warning/10 text-warning',
                        )}
                      >
                        {isFilled(item) ? 'Configuré' : 'À compléter'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!editing ? (
              <div className="mt-4 flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => setKnowledgeOpen(false)}>
                  Fermer
                </Button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
