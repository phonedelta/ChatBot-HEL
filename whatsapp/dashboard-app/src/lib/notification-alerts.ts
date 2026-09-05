/**
 * Cross-tab alert coordination + system (OS) notifications.
 * Sound/system alerts are claimed once per notification id across tabs.
 */
import type { DashNotification } from '@/lib/notification-types'

const CHANNEL_NAME = 'hel-crm-notification-alerts'
const LS_PREFIX = 'hel:notif:alerted:'
const LS_BROWSER_PREF = 'hel:browser-notifications'
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

let channel: BroadcastChannel | null = null
let storageListenerAttached = false
const localAlerted = new Set<number>()

function alertKey(id: number) {
  return `${LS_PREFIX}${id}`
}

function pruneExpiredClaims() {
  try {
    const now = Date.now()
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LS_PREFIX)) continue
      const ts = Number(localStorage.getItem(key) || 0)
      if (!ts || now - ts > CLAIM_TTL_MS) localStorage.removeItem(key)
    }
  } catch {
    /* private mode */
  }
}

function markAlertedLocal(ids: number[]) {
  for (const id of ids) localAlerted.add(id)
}

function readBrowserNotificationsPref(): boolean {
  try {
    const v = localStorage.getItem(LS_BROWSER_PREF)
    if (v === null) return true
    return v !== '0' && v !== 'false'
  } catch {
    return true
  }
}

export function setBrowserNotificationsPref(enabled: boolean) {
  try {
    localStorage.setItem(LS_BROWSER_PREF, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function getBrowserNotificationsPref() {
  return readBrowserNotificationsPref()
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** User-gesture entry: request OS permission + persist preference. */
export async function enableBrowserNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  setBrowserNotificationsPref(true)
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return Notification.permission
  }
}

function ensureChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (ev) => {
        const data = ev.data
        if (data?.type === 'alerted' && Array.isArray(data.ids)) {
          markAlertedLocal(data.ids.map(Number).filter((n: number) => Number.isFinite(n)))
        }
      }
    } catch {
      channel = null
    }
  }
  return channel
}

function ensureStorageListener() {
  if (storageListenerAttached || typeof window === 'undefined') return
  storageListenerAttached = true
  window.addEventListener('storage', (ev) => {
    if (!ev.key || !ev.key.startsWith(LS_PREFIX) || !ev.newValue) return
    const id = Number(ev.key.slice(LS_PREFIX.length))
    if (Number.isFinite(id)) localAlerted.add(id)
  })
}

/**
 * Claim alert responsibility for notification ids across tabs.
 * Returns ids this tab should alert for (sound / system).
 */
export function claimNotificationAlerts(ids: number[]): number[] {
  if (!ids.length) return []
  ensureChannel()
  ensureStorageListener()
  pruneExpiredClaims()

  const claimed: number[] = []
  const now = String(Date.now())
  const nonce = Math.random().toString(36).slice(2, 10)

  for (const id of ids) {
    if (!Number.isFinite(id) || id <= 0) continue
    if (localAlerted.has(id)) continue
    try {
      const key = alertKey(id)
      const existing = localStorage.getItem(key)
      if (existing) {
        localAlerted.add(id)
        continue
      }
      const claim = `${now}:${nonce}`
      localStorage.setItem(key, claim)
      const stored = localStorage.getItem(key)
      if (stored !== claim) {
        localAlerted.add(id)
        continue
      }
      localAlerted.add(id)
      claimed.push(id)
    } catch {
      if (!localAlerted.has(id)) {
        localAlerted.add(id)
        claimed.push(id)
      }
    }
  }

  if (claimed.length) {
    try {
      ensureChannel()?.postMessage({ type: 'alerted', ids: claimed })
    } catch {
      /* ignore */
    }
  }

  return claimed
}

export function showSystemNotification(notification: DashNotification): boolean {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false
  if (!readBrowserNotificationsPref()) return false
  if (Notification.permission !== 'granted') return false

  const title = notification.title || 'Smart CRM HEL'
  const bodyParts = [
    notification.body,
    notification.slot_date && notification.slot_time
      ? `${notification.slot_date} · ${String(notification.slot_time).slice(0, 5)}`
      : null,
  ].filter(Boolean)
  const body = bodyParts.join(' — ') || notification.type_label || 'Nouvelle notification'

  try {
    const n = new Notification(title, {
      body,
      tag: `hel-notif-${notification.id}`,
    })
    n.onclick = () => {
      try {
        window.focus()
        const path = String(notification.link_path || '').trim()
        if (path.startsWith('/')) {
          const target = path.startsWith('/dashboard')
            ? path
            : `/dashboard${path}`
          window.location.assign(target)
        }
      } catch {
        /* ignore */
      }
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Dispatch user-facing alerts for newly arrived notifications.
 * - Exactly one tab claims each id (BroadcastChannel + localStorage).
 * - Plays sound only for `soundNotifications` subset.
 * - Shows OS notification when tab is hidden and permission granted.
 */
export function dispatchUserAlerts(
  alertNotifications: DashNotification[],
  soundNotifications: DashNotification[],
  playSound: (ids: number[]) => boolean,
): { claimedIds: number[]; systemShown: number; soundPlayed: boolean } {
  const ids = alertNotifications.map((n) => n.id)
  const claimedIds = claimNotificationAlerts(ids)
  if (!claimedIds.length) {
    return { claimedIds: [], systemShown: 0, soundPlayed: false }
  }

  const claimedSet = new Set(claimedIds)
  const claimedAlerts = alertNotifications.filter((n) => claimedSet.has(n.id))
  const claimedSoundIds = soundNotifications
    .map((n) => n.id)
    .filter((id) => claimedSet.has(id))

  let soundPlayed = false
  if (claimedSoundIds.length) {
    soundPlayed = playSound(claimedSoundIds)
  }

  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
  let systemShown = 0
  if (hidden) {
    for (const n of claimedAlerts) {
      if (showSystemNotification(n)) systemShown += 1
    }
  }

  return { claimedIds, systemShown, soundPlayed }
}

/** Test helpers / reset (logout). */
export function resetNotificationAlertClaims() {
  localAlerted.clear()
}
