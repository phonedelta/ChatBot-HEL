import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Hand, ImagePlus, Info, RefreshCw, Send, X } from 'lucide-react'
import { api, ApiError, getStoredToken } from '@/lib/api'
import { cn, initials } from '@/lib/format'
import { conversationStatusLabel, safePersonLabel } from '@/lib/labels'
import type { ConversationContextPayload } from '@/lib/conversation-context'
import { ConversationContextPanel } from '@/components/messages/ConversationContextPanel'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/smart/PageBits'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS } from '@/lib/permissions'
import { useIsLgUp } from '@/hooks/useMediaQuery'
import { Modal } from '@/components/ui/Modal'

type Conversation = {
  id: number
  status: string
  status_label?: string
  owner: string
  owner_user?: string | null
  display_name?: string
  display_subtitle?: string | null
  patient_name?: string | null
  patient_phone?: string | null
  phone_display?: string | null
  last_message_preview?: string | null
  last_message_at?: string | null
  ai_summary?: string | null
  next_action?: string | null
  language?: string | null
  active_language?: string | null
  unread_count?: number
  customer_id?: number | null
  is_unknown_patient?: boolean
}

type Message = {
  id: number
  direction: string
  author_type: string
  author_name?: string | null
  body?: string | null
  message_type?: string
  created_at: string
  external_message_id?: string | null
  media_url?: string | null
  media_mime?: string | null
  media_filename?: string | null
  has_media?: boolean
}

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'TO_PROCESS', label: 'À traiter' },
  { key: 'AI_IN_PROGRESS', label: 'IA en cours' },
  { key: 'WAITING_PATIENT', label: 'En attente patient' },
  { key: 'TRANSFERRED', label: 'Transférées' },
  { key: 'COMPLETED', label: 'Terminées' },
]

function displayName(c?: Conversation | null) {
  if (!c) return 'Contact WhatsApp'
  return safePersonLabel(c.display_name || c.patient_name, 'Contact WhatsApp')
}

function parseMessageDate(iso?: string | null) {
  const raw = String(iso || '').trim()
  if (!raw) return null
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function timeLabel(iso?: string | null) {
  const d = parseMessageDate(iso)
  if (!d) return ''
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function dateKey(iso?: string | null) {
  const d = parseMessageDate(iso)
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dateSeparatorLabel(iso?: string | null) {
  const d = parseMessageDate(iso)
  if (!d) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Aujourd’hui'
  if (sameDay(d, yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function authorMeta(m: Message) {
  if (m.author_type === 'patient' || m.direction === 'inbound') {
    return { label: 'Patient', side: 'left' as const, tone: 'patient' as const }
  }
  if (m.author_type === 'human') {
    return {
      label: (m.author_name || 'Assistante').toUpperCase(),
      side: 'right' as const,
      tone: 'human' as const,
    }
  }
  if (m.author_type === 'system') {
    return { label: 'Système', side: 'center' as const, tone: 'system' as const }
  }
  return { label: 'Assistant IA', side: 'right' as const, tone: 'ai' as const }
}

function dedupeMessages(rows: Message[]) {
  const seen = new Set<string>()
  const out: Message[] = []
  for (const row of rows) {
    const key = row.external_message_id
      ? `ext:${row.external_message_id}`
      : `id:${row.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out.sort((a, b) => {
    const ta = parseMessageDate(a.created_at)?.getTime() || 0
    const tb = parseMessageDate(b.created_at)?.getTime() || 0
    if (ta !== tb) return ta - tb
    return Number(a.id) - Number(b.id)
  })
}

function mediaUrlWithAuth(url?: string | null) {
  const raw = String(url || '').trim()
  if (!raw) return null
  const token = getStoredToken()
  if (!token) return raw
  const join = raw.includes('?') ? '&' : '?'
  return `${raw}${join}token=${encodeURIComponent(token)}`
}

export function MessagesPage() {
  const { can } = usePermissions()
  const isLgUp = useIsLgUp()
  const canSend = can(PERMISSIONS.SEND_MANUAL_MESSAGE)
  const canTakeOver = can(PERMISSIONS.TAKE_OVER_CONVERSATION)
  const canReturnToAi = can(PERMISSIONS.RETURN_CONVERSATION_TO_AI)
  const [params, setParams] = useSearchParams()
  const initialStatus = params.get('status') || 'all'
  const initialConv = params.get('c')
  const [status, setStatus] = useState(initialStatus)
  const [q, setQ] = useState('')
  const [list, setList] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(
    initialConv && Number(initialConv) ? Number(initialConv) : null,
  )
  const [mobileInfoOpen, setMobileInfoOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [context, setContext] = useState<ConversationContextPayload | null>(null)
  const [handoffBanner, setHandoffBanner] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showJumpNewest, setShowJumpNewest] = useState(false)

  const messagesRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const nearBottomRef = useRef(true)
  const detailRequestRef = useRef(0)
  const contextRequestRef = useRef(0)

  const loadList = useCallback(async (opts: { soft?: boolean } = {}) => {
    const soft = Boolean(opts.soft)
    if (!soft) setListLoading(true)
    if (!soft) setError('')
    try {
      const query = new URLSearchParams()
      if (status && status !== 'all') query.set('status', status)
      if (q.trim()) query.set('q', q.trim())
      const payload = await api<{ conversations: Conversation[] }>(
        `/dashboard/api/conversations?${query.toString()}`,
      )
      setList(payload.conversations || [])
      // Desktop: keep/select first. Mobile master-detail: never auto-open a thread.
      setSelectedId((prev) => {
        if (prev) return prev
        if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
          return payload.conversations?.[0]?.id || null
        }
        return null
      })
    } catch (err) {
      if (!soft) setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      if (!soft) setListLoading(false)
    }
  }, [status, q])

  const loadDetail = useCallback(async (id: number, opts: { soft?: boolean } = {}) => {
    const soft = Boolean(opts.soft)
    const requestId = ++detailRequestRef.current
    if (!soft) {
      setDetailLoading(true)
      setMessages([])
      setConversation(null)
      setContext(null)
      setHandoffBanner(null)
      setError('')
    }
    try {
      const payload = await api<{
        conversation: Conversation
        messages: Message[]
        handoff_banner?: string | null
      }>(`/dashboard/api/conversations/${id}`)
      if (requestId !== detailRequestRef.current) return
      setConversation(payload.conversation)
      setMessages(dedupeMessages(payload.messages || []))
      setHandoffBanner(payload.handoff_banner || null)
      if (!soft) {
        nearBottomRef.current = true
        setShowJumpNewest(false)
      }
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      if (!soft) setError(err instanceof Error ? err.message : 'Détail impossible')
    } finally {
      if (!soft && requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }, [])

  const loadContext = useCallback(async (id: number, opts: { soft?: boolean } = {}) => {
    const soft = Boolean(opts.soft)
    const requestId = ++contextRequestRef.current
    if (!soft) {
      setContextLoading(true)
      setContext(null)
      setContextError('')
    }
    try {
      const payload = await api<{ context: ConversationContextPayload }>(
        `/dashboard/api/conversations/${id}/context`,
      )
      if (requestId !== contextRequestRef.current) return
      setContext(payload.context)
    } catch (err) {
      if (requestId !== contextRequestRef.current) return
      if (!soft) {
        setContextError(err instanceof Error ? err.message : 'Contexte impossible')
      }
    } finally {
      if (!soft && requestId === contextRequestRef.current) setContextLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  useEffect(() => {
    if (selectedId) void loadContext(selectedId)
  }, [selectedId, loadContext])

  // Sync open conversation to ?c= so the shell can hide global search on mobile.
  useEffect(() => {
    const current = params.get('c')
    const next = selectedId ? String(selectedId) : null
    if ((current || null) === next) return
    const nextParams = new URLSearchParams(params)
    if (next) nextParams.set('c', next)
    else nextParams.delete('c')
    setParams(nextParams, { replace: true })
  }, [selectedId, params, setParams])

  // Live refresh — patient messages must appear without full page reload (esp. HUMAN mode)
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList({ soft: true })
      if (selectedId) {
        void loadDetail(selectedId, { soft: true })
        void loadContext(selectedId, { soft: true })
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [loadList, loadDetail, loadContext, selectedId])

  useEffect(() => {
    if (!detailLoading && nearBottomRef.current && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, detailLoading, selectedId])

  const selected = useMemo(
    () => list.find((c) => c.id === selectedId) || conversation,
    [list, selectedId, conversation],
  )

  const timeline = useMemo(() => {
    const items: Array<
      | { kind: 'sep'; key: string; label: string }
      | { kind: 'msg'; key: string; message: Message }
    > = []
    let lastDay = ''
    for (const msg of messages) {
      const day = dateKey(msg.created_at)
      if (day && day !== lastDay) {
        items.push({ kind: 'sep', key: `sep-${day}`, label: dateSeparatorLabel(msg.created_at) })
        lastDay = day
      }
      items.push({ kind: 'msg', key: `msg-${msg.id}`, message: msg })
    }
    return items
  }, [messages])

  function onMessagesScroll() {
    const el = messagesRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance < 80
    nearBottomRef.current = nearBottom
    setShowJumpNewest(!nearBottom)
  }

  function jumpToNewest() {
    const el = messagesRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    nearBottomRef.current = true
    setShowJumpNewest(false)
  }

  async function handoff(owner: 'HUMAN' | 'AI') {
    if (!selectedId) return
    try {
      const payload = await api<{ message: string; conversation: Conversation }>(
        `/dashboard/api/conversations/${selectedId}/handoff`,
        { method: 'POST', body: { owner } },
      )
      setToast(payload.message)
      setConversation(payload.conversation)
      setHandoffBanner(owner === 'HUMAN' ? payload.message : null)
      void loadList()
      void loadDetail(selectedId)
      void loadContext(selectedId)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : owner === 'HUMAN'
            ? 'Impossible de prendre la main. Réessayez.'
            : 'Impossible de rendre la main à l’IA. Réessayez.',
      )
      throw err
    }
  }

  async function sendMessage() {
    if (!selectedId || sending) return
    const text = draft.trim()
    if (!text && !pendingImage) return

    setSending(true)
    setError('')
    try {
      if (conversation?.owner !== 'HUMAN') {
        await handoff('HUMAN')
      }

      if (pendingImage) {
        const form = new FormData()
        if (text) form.append('body', text)
        form.append('image', pendingImage)
        const postImage = () => api(`/dashboard/api/conversations/${selectedId}/messages`, {
          method: 'POST',
          body: form,
        })
        try {
          await postImage()
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            await handoff('HUMAN')
            await postImage()
          } else {
            throw err
          }
        }
        setToast('Image envoyée.')
        clearPendingImage()
      } else {
        await api(`/dashboard/api/conversations/${selectedId}/messages`, {
          method: 'POST',
          body: { body: text },
        })
        setToast('Message envoyé.')
      }

      setDraft('')
      nearBottomRef.current = true
      await loadDetail(selectedId)
      void loadContext(selectedId)
      void loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’envoyer le message. Réessayer.')
      if (!pendingImage) setDraft(text)
    } finally {
      setSending(false)
    }
  }

  function clearPendingImage() {
    setPendingImage(null)
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl)
      setPendingPreviewUrl(null)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onPickImage(file: File | null) {
    if (!file) return
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const extOk = /\.(jpe?g|png|webp)$/i.test(file.name)
    if (!allowed.includes(file.type) && !extOk) {
      setError('Ce type de fichier n’est pas pris en charge.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('L’image est trop volumineuse.')
      return
    }
    setError('')
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    setPendingImage(file)
    setPendingPreviewUrl(URL.createObjectURL(file))
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const phoneLabel =
    context?.patient.phone_display
    || selected?.phone_display
    || selected?.display_subtitle
    || selected?.patient_phone
    || 'Numéro non identifié'

  const nextApptDisplay = context?.next_appointment?.display || null
  const showListPane = isLgUp || !selectedId
  const showChatPane = isLgUp || Boolean(selectedId)

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <h1 className="sr-only">Messages</h1>
      {toast ? (
        <div className="mb-2 shrink-0 rounded-xl border border-primary/30 bg-cyan-tint px-3 py-2 text-sm text-navy">
          {toast}
        </div>
      ) : null}
      {error ? (
        <div className="mb-2 shrink-0 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 w-full flex-1 overflow-hidden rounded-2xl border border-border bg-white shadow-soft lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)_minmax(260px,330px)] lg:grid-rows-1">
        {/* Colonne conversations */}
        <aside
          className={cn(
            'min-h-0 min-w-0 flex-col overflow-hidden border-border lg:border-r',
            showListPane ? 'flex' : 'hidden lg:flex',
          )}
        >
          <div className="shrink-0 space-y-2 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nom, téléphone…"
                className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 text-sm outline-none focus:border-primary"
                aria-label="Rechercher une conversation"
              />
              <button
                type="button"
                onClick={() => void loadList()}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted hover:bg-cyan-tint hover:text-navy"
                aria-label="Actualiser les conversations"
                title="Actualiser"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={status === f.key}
                  onClick={() => setStatus(f.key)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-2 text-[11px] font-medium',
                    status === f.key
                      ? 'bg-navy text-white'
                      : 'bg-bg text-[var(--color-muted-accessible)] hover:bg-cyan-tint hover:text-navy',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin">
            {listLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : !list.length ? (
              <div className="p-4">
                <EmptyState
                  title="Aucune conversation pour le moment"
                  description="Les nouveaux messages WhatsApp apparaîtront ici."
                />
              </div>
            ) : (
              list.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id)
                    setMobileInfoOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left hover:bg-cyan-tint/60',
                    selectedId === item.id && 'bg-cyan-tint',
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
                    {initials(displayName(item))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-navy">{displayName(item)}</p>
                      <span className="shrink-0 text-[10px] text-muted">{timeLabel(item.last_message_at)}</span>
                    </div>
                    <p
                      dir="auto"
                      className="truncate text-xs text-[var(--color-muted-accessible)]"
                      style={{ unicodeBidi: 'plaintext' }}
                    >
                      {item.last_message_preview || item.display_subtitle || '—'}
                    </p>
                    <p className="mt-1 text-[10px] font-medium text-primary">
                      {item.status_label || conversationStatusLabel(item.status)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Colonne chat */}
        <section
          className={cn(
            'min-h-0 min-w-0 flex-col overflow-hidden',
            showChatPane ? 'flex' : 'hidden lg:flex',
          )}
        >
          {!selectedId ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <EmptyState title="Sélectionnez une conversation pour afficher les messages." />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-white px-2 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy hover:bg-bg lg:hidden"
                    aria-label="Retour aux conversations"
                    onClick={() => {
                      setSelectedId(null)
                      setMobileInfoOpen(false)
                    }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy">{displayName(selected)}</p>
                    <p className="truncate text-xs text-[var(--color-muted-accessible)]">
                      {phoneLabel}
                      {nextApptDisplay ? ` · Prochain RDV : ${nextApptDisplay}` : ''}
                    </p>
                    {handoffBanner ? (
                      <p className="mt-1 text-xs font-medium text-warning">{handoffBanner}</p>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--color-muted-accessible)]">
                        {selected?.owner === 'HUMAN'
                          ? `Prise en charge par ${selected.owner_user || 'l’équipe'} · automation suspendue`
                          : 'Contrôle IA actif'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border text-navy hover:bg-cyan-tint lg:hidden"
                    aria-label="Infos patient"
                    onClick={() => setMobileInfoOpen(true)}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                  {selectedId ? (
                    <Link
                      to={`/historique?conversationId=${selectedId}`}
                      className="hidden rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-cyan-tint/40 hover:text-navy xl:inline"
                    >
                      Historique
                    </Link>
                  ) : null}
                  {selected?.owner === 'HUMAN' ? (
                    canReturnToAi ? (
                      <Button size="sm" variant="secondary" onClick={() => void handoff('AI')}>
                        <span className="hidden sm:inline">Rendre la main à l’IA</span>
                        <span className="sm:hidden">IA</span>
                      </Button>
                    ) : null
                  ) : canTakeOver ? (
                    <Button size="sm" icon={<Hand className="h-4 w-4" />} onClick={() => void handoff('HUMAN')}>
                      <span className="hidden sm:inline">Prendre la main</span>
                      <span className="sm:hidden">Main</span>
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                <div
                  ref={messagesRef}
                  onScroll={onMessagesScroll}
                  className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain bg-bg/40 px-3 py-3 scrollbar-thin sm:px-4"
                >
                  {detailLoading ? (
                    <div className="space-y-3 p-2">
                      <Skeleton className="h-16 w-2/3" />
                      <Skeleton className="ml-auto h-16 w-2/3" />
                      <Skeleton className="h-20 w-3/4" />
                    </div>
                  ) : !messages.length ? (
                    <div className="rounded-xl border border-dashed border-border bg-white p-4 text-sm text-muted">
                      Aucun message enregistré pour cette conversation.
                    </div>
                  ) : (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                      {timeline.map((item) => {
                        if (item.kind === 'sep') {
                          return (
                            <div key={item.key} className="flex items-center gap-3 py-1">
                              <div className="h-px flex-1 bg-border" />
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                                {item.label}
                              </span>
                              <div className="h-px flex-1 bg-border" />
                            </div>
                          )
                        }

                        const m = item.message
                        const meta = authorMeta(m)

                        if (meta.tone === 'system') {
                          return (
                            <div key={item.key} className="py-1 text-center text-xs text-muted">
                              — {m.body || 'Événement système'} · {timeLabel(m.created_at)} —
                            </div>
                          )
                        }

                        const isVoice = m.message_type === 'voice' || m.message_type === 'audio'
                        const isImage = m.message_type === 'image' || Boolean(m.media_url)
                        const mediaSrc = mediaUrlWithAuth(m.media_url)
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              'flex w-full min-w-0',
                              meta.side === 'right' ? 'justify-end' : 'justify-start',
                            )}
                          >
                            <div
                              className={cn(
                                'min-w-0 max-w-[min(88%,520px)] sm:max-w-[min(75%,760px)] rounded-2xl border px-3 py-2 text-sm shadow-sm break-words',
                                meta.tone === 'patient' && 'border-border bg-white text-navy',
                                meta.tone === 'ai' && 'border-primary/20 bg-cyan-tint text-navy',
                                meta.tone === 'human' && 'border-navy/20 bg-navy text-white',
                              )}
                            >
                              <p
                                className={cn(
                                  'mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70',
                                  meta.tone === 'human' ? 'text-white/80' : 'text-muted',
                                )}
                              >
                                {meta.label} · {timeLabel(m.created_at)}
                              </p>
                              {isVoice ? (
                                <p className={cn('mb-1 text-xs', meta.tone === 'human' ? 'text-white/80' : 'text-muted')}>
                                  🎤 Message vocal
                                  {m.body ? ' · Transcription :' : ''}
                                </p>
                              ) : null}
                              {isImage && mediaSrc ? (
                                <button
                                  type="button"
                                  className="mb-2 block overflow-hidden rounded-xl"
                                  onClick={() => setLightboxUrl(mediaSrc)}
                                  aria-label="Agrandir l’image"
                                >
                                  <img
                                    src={mediaSrc}
                                    alt={m.media_filename || 'Image'}
                                    className="max-h-64 max-w-full object-contain"
                                    loading="lazy"
                                  />
                                </button>
                              ) : null}
                              {(m.body || (!isImage && !isVoice)) ? (
                                <p
                                  dir="auto"
                                  className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
                                >
                                  {m.body || (isVoice ? 'Transcription indisponible' : '—')}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {showJumpNewest ? (
                  <button
                    type="button"
                    onClick={jumpToNewest}
                    className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-soft"
                  >
                    ↓ Nouveaux messages
                  </button>
                ) : null}
              </div>

              {canSend ? (
              <div className="shrink-0 border-t border-border bg-[#F4F7F9] px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:bg-white sm:p-3 sm:pb-3">
                {pendingPreviewUrl ? (
                  <div className="mb-2 inline-flex max-w-full items-start gap-2 rounded-2xl border border-border bg-white p-2 shadow-sm">
                    <div className="relative">
                      <img
                        src={pendingPreviewUrl}
                        alt="Aperçu"
                        className="max-h-24 max-w-[180px] rounded-xl object-contain"
                      />
                      {sending ? (
                        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 text-xs font-semibold text-white">
                          Envoi…
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={clearPendingImage}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-navy hover:bg-border"
                      aria-label="Retirer l’image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                />

                {/* Mobile: barre unifiée type messagerie */}
                <div className="flex items-end gap-2 sm:hidden">
                  <button
                    type="button"
                    className="mb-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-white text-navy shadow-sm active:scale-95 disabled:opacity-50"
                    aria-label="Ajouter une image"
                    disabled={sending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-5 w-5" />
                  </button>
                  <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[22px] border border-border bg-white py-1 pl-3.5 pr-1 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                    <label htmlFor="message-composer-mobile" className="sr-only">
                      Écrire une réponse
                    </label>
                    <textarea
                      id="message-composer-mobile"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value)
                        const el = e.target
                        el.style.height = 'auto'
                        el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                      }}
                      onKeyDown={onComposerKeyDown}
                      rows={1}
                      placeholder="Écrire une réponse…"
                      className="max-h-[120px] min-h-[40px] min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-5 text-navy outline-none [scrollbar-width:none] placeholder:text-muted/80 [&::-webkit-scrollbar]:hidden"
                    />
                    <button
                      type="button"
                      className={cn(
                        'mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40',
                        draft.trim() || pendingImage
                          ? 'bg-[var(--color-primary-cta)] text-white shadow-[0_6px_16px_rgba(11,132,148,0.28)]'
                          : 'bg-bg text-muted',
                      )}
                      aria-label="Envoyer"
                      disabled={sending || (!draft.trim() && !pendingImage)}
                      onClick={() => void sendMessage()}
                    >
                      {sending ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Desktop / tablette: composer classique */}
                <div className="hidden items-end gap-2 sm:flex">
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="h-11 w-11 shrink-0 self-center !px-0"
                    icon={<ImagePlus className="h-4 w-4" />}
                    aria-label="Ajouter une image"
                    disabled={sending}
                    onClick={() => fileInputRef.current?.click()}
                  />
                  <label htmlFor="message-composer-desktop" className="sr-only">
                    Écrire une réponse
                  </label>
                  <textarea
                    id="message-composer-desktop"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      const el = e.target
                      el.style.height = 'auto'
                      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
                    }}
                    onKeyDown={onComposerKeyDown}
                    rows={1}
                    placeholder="Écrire une réponse…"
                    className="h-11 min-h-[44px] max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] leading-6 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    aria-label="Écrire une réponse"
                  />
                  <Button
                    size="lg"
                    className="h-11 shrink-0 self-center !px-4"
                    icon={<Send className="h-4 w-4" />}
                    loading={sending}
                    disabled={!draft.trim() && !pendingImage}
                    onClick={() => void sendMessage()}
                    aria-label="Envoyer"
                  >
                    Envoyer
                  </Button>
                </div>
              </div>
              ) : (
                <div className="shrink-0 border-t border-border bg-[#FAFCFD] px-4 py-3 text-sm text-muted">
                  Consultation seule — vous n’avez pas l’autorisation d’envoyer des messages.
                </div>
              )}
            </>
          )}
        </section>

        {/* Colonne patient — desktop */}
        <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-white lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 scrollbar-thin">
            <ConversationContextPanel
              conversationId={selectedId}
              context={context}
              loading={contextLoading}
              error={contextError}
              onRetry={() => {
                if (selectedId) void loadContext(selectedId)
              }}
            />
          </div>
        </aside>
      </div>

      {mobileInfoOpen && selectedId ? (
        <Modal onClose={() => setMobileInfoOpen(false)} className="max-w-lg">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-navy">Infos conversation</h2>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-bg"
              aria-label="Fermer"
              onClick={() => setMobileInfoOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 max-h-[min(70dvh,560px)] overflow-y-auto overflow-x-hidden">
            <ConversationContextPanel
              conversationId={selectedId}
              context={context}
              loading={contextLoading}
              error={contextError}
              onRetry={() => {
                if (selectedId) void loadContext(selectedId)
              }}
            />
          </div>
        </Modal>
      ) : null}

      {lightboxUrl ? (
        <div
          className="app-zoom-cover z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu image"
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-navy"
            aria-label="Fermer"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Aperçu agrandi"
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
