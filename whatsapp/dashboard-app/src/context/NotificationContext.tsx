import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '@/lib/api'
import {
  type DashNotification,
  type NotificationAlertPreferences,
  isRecentNotification,
  shouldPlaySoundForNotification,
  parseNotificationTimestamp,
} from '@/lib/notification-types'
import {
  ensureNotificationSoundUnlockListeners,
  playNotificationSound,
  preloadNotificationSound,
} from '@/lib/notification-sound'
import { useAuth } from '@/context/AuthContext'

const POLL_MS = 4000
const RECENT_MS = 15_000

type NotificationPayload = {
  items?: DashNotification[]
  notifications?: DashNotification[]
  unreadCount?: number
  alertPreferences?: NotificationAlertPreferences
}

type NotificationState = {
  items: DashNotification[]
  unreadCount: number
  loading: boolean
  refresh: () => Promise<void>
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
}

const NotificationContext = createContext<NotificationState | null>(null)

const DEFAULT_PREFS: NotificationAlertPreferences = {
  soundEnabled: true,
  newPatientMessage: true,
  patientNoResponse: true,
  appointmentCancelled: true,
  appointmentUnconfirmed: true,
  slotReleased: true,
  handoff: true,
  whatsappError: true,
  automationFailure: true,
}

function mergePreferences(raw?: NotificationAlertPreferences | null): NotificationAlertPreferences {
  if (!raw) return { ...DEFAULT_PREFS }
  return { ...DEFAULT_PREFS, ...raw }
}

function ingestNotifications(
  incoming: DashNotification[],
  prefs: NotificationAlertPreferences,
  state: {
    initialized: boolean
    knownIds: Set<number>
    playedIds: Set<number>
    tabWasHidden: boolean
  },
): {
  initialized: boolean
  audibleIds: number[]
} {
  const dev = import.meta.env.DEV
  let audibleIds: number[] = []

  if (!state.initialized) {
    for (const n of incoming) state.knownIds.add(n.id)
    state.initialized = true
    if (dev) {
      console.info('[NOTIFICATIONS]', {
        received: incoming.length,
        new: 0,
        newIds: [],
        unread: incoming.filter((n) => !n.read_at && !n.is_read).length,
        phase: 'initial_load',
      })
    }
    return { initialized: true, audibleIds: [] }
  }

  const newlyArrived = incoming.filter((n) => !state.knownIds.has(n.id))
  for (const n of incoming) state.knownIds.add(n.id)

  if (newlyArrived.length === 0) {
    return { initialized: true, audibleIds: [] }
  }

  const audible = newlyArrived.filter((n) => {
    if (state.playedIds.has(n.id)) return false
    if (!shouldPlaySoundForNotification(n, prefs)) return false
    if (!isRecentNotification(n.created_at, RECENT_MS)) return false
    if (state.tabWasHidden && !isRecentNotification(n.created_at, 5000)) return false
    return true
  })

  if (audible.length > 0) {
    audibleIds = audible.map((n) => n.id)
    for (const id of audibleIds) state.playedIds.add(id)
  }

  if (dev) {
    const delays = newlyArrived.map((n) => ({
      id: n.id,
      delayFromCreatedMs: Date.now() - parseNotificationTimestamp(n.created_at),
    }))
    console.info('[NOTIFICATIONS]', {
      received: incoming.length,
      new: newlyArrived.length,
      newIds: newlyArrived.map((n) => n.id),
      audibleIds,
      delays,
    })
  }

  state.tabWasHidden = false
  return { initialized: true, audibleIds }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth()
  const [items, setItems] = useState<DashNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const knownIdsRef = useRef<Set<number>>(new Set())
  const playedIdsRef = useRef<Set<number>>(new Set())
  const initializedRef = useRef(false)
  const tabWasHiddenRef = useRef(false)
  const prefsRef = useRef<NotificationAlertPreferences>({ ...DEFAULT_PREFS })
  const sessionTokenRef = useRef<string | null>(null)

  const resetSession = useCallback(() => {
    knownIdsRef.current = new Set()
    playedIdsRef.current = new Set()
    initializedRef.current = false
    tabWasHiddenRef.current = false
    setItems([])
    setUnreadCount(0)
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!token) return
    try {
      const payload = await api<NotificationPayload>('/dashboard/api/notifications?limit=30')
      const list = payload.items || payload.notifications || []
      const unread = Number(
        payload.unreadCount ?? list.filter((n) => !n.read_at && !n.is_read).length,
      )
      prefsRef.current = mergePreferences(payload.alertPreferences)

      const { audibleIds } = ingestNotifications(list, prefsRef.current, {
        initialized: initializedRef.current,
        knownIds: knownIdsRef.current,
        playedIds: playedIdsRef.current,
        tabWasHidden: tabWasHiddenRef.current,
      })
      initializedRef.current = true

      setItems(list)
      setUnreadCount(unread)

      if (audibleIds.length > 0) {
        playNotificationSound(audibleIds)
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    preloadNotificationSound()
    ensureNotificationSoundUnlockListeners()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (!token) {
      resetSession()
      sessionTokenRef.current = null
      setLoading(false)
      return
    }
    if (sessionTokenRef.current !== token) {
      resetSession()
      sessionTokenRef.current = token
    }
    void fetchNotifications()
    const timer = window.setInterval(() => {
      void fetchNotifications()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [ready, token, fetchNotifications, resetSession])

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        tabWasHiddenRef.current = true
        return
      }
      if (document.visibilityState === 'visible' && token) {
        void fetchNotifications()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [token, fetchNotifications])

  const markRead = useCallback(async (id: number) => {
    try {
      await api(`/dashboard/api/notifications/${id}/read`, { method: 'POST', body: {} })
      await fetchNotifications()
    } catch {
      /* ignore */
    }
  }, [fetchNotifications])

  const markAllRead = useCallback(async () => {
    try {
      await api('/dashboard/api/notifications/read-all', { method: 'POST', body: {} })
      await fetchNotifications()
    } catch {
      /* ignore */
    }
  }, [fetchNotifications])

  const value: NotificationState = {
    items,
    unreadCount,
    loading,
    refresh: fetchNotifications,
    markRead,
    markAllRead,
  }

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
