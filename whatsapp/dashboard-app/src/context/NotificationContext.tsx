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
} from '@/lib/notification-types'
import {
  ensureNotificationSoundUnlockListeners,
  playNotificationSound,
  preloadNotificationSound,
} from '@/lib/notification-sound'
import {
  dispatchUserAlerts,
  resetNotificationAlertClaims,
} from '@/lib/notification-alerts'
import {
  formatIngestDebug,
  ingestNotifications,
} from '@/lib/notification-ingest'
import { useAuth } from '@/context/AuthContext'

const POLL_MS = 4000

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
  appointmentCreated: true,
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

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth()
  const [items, setItems] = useState<DashNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const knownIdsRef = useRef<Set<number>>(new Set())
  const playedIdsRef = useRef<Set<number>>(new Set())
  const initializedRef = useRef(false)
  const prefsRef = useRef<NotificationAlertPreferences>({ ...DEFAULT_PREFS })
  const sessionTokenRef = useRef<string | null>(null)
  const fetchingRef = useRef(false)

  const resetSession = useCallback(() => {
    knownIdsRef.current = new Set()
    playedIdsRef.current = new Set()
    initializedRef.current = false
    resetNotificationAlertClaims()
    setItems([])
    setUnreadCount(0)
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!token || fetchingRef.current) return
    fetchingRef.current = true
    try {
      const payload = await api<NotificationPayload>('/dashboard/api/notifications?limit=30')
      const list = payload.items || payload.notifications || []
      const unread = Number(
        payload.unreadCount ?? list.filter((n) => !n.read_at && !n.is_read).length,
      )
      prefsRef.current = mergePreferences(payload.alertPreferences)

      const ingestState = {
        initialized: initializedRef.current,
        knownIds: knownIdsRef.current,
        playedIds: playedIdsRef.current,
      }
      const result = ingestNotifications(list, prefsRef.current, ingestState)
      initializedRef.current = result.initialized

      setItems(list)
      setUnreadCount(unread)

      if (import.meta.env.DEV && result.newlyArrived.length > 0) {
        console.info('[NOTIFICATIONS]', {
          received: list.length,
          unread,
          phase: 'poll',
          ...formatIngestDebug(result.newlyArrived, result.audibleIds),
          visibility: document.visibilityState,
        })
      }

      if (result.alertNotifications.length > 0) {
        dispatchUserAlerts(
          result.alertNotifications,
          result.audibleNotifications,
          playNotificationSound,
        )
      }
    } catch {
      /* silent */
    } finally {
      fetchingRef.current = false
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

  // Visibility: never skip alerts when hidden — only refresh promptly when returning.
  useEffect(() => {
    function onVisibility() {
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
