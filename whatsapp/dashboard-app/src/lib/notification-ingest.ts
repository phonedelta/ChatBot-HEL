/**
 * Pure notification ingest — decide which new IDs should alert.
 * Keep in sync with scripts/notification-sound-test.js mirror.
 */
import {
  type DashNotification,
  type NotificationAlertPreferences,
  isRecentNotification,
  shouldAlertForNotification,
  shouldPlaySoundForNotification,
  parseNotificationTimestamp,
} from '@/lib/notification-types'

/** Allow late polls when Chrome throttles background timers (~1 min). */
export const NOTIFICATION_RECENT_MS = 90_000

export type IngestState = {
  initialized: boolean
  knownIds: Set<number>
  playedIds: Set<number>
}

export type IngestResult = {
  initialized: boolean
  newlyArrived: DashNotification[]
  /** IDs eligible for sound (respects soundEnabled). */
  audibleIds: number[]
  audibleNotifications: DashNotification[]
  /** IDs eligible for any user alert including OS (type toggles only). */
  alertNotifications: DashNotification[]
}

export function ingestNotifications(
  incoming: DashNotification[],
  prefs: NotificationAlertPreferences,
  state: IngestState,
  recentMs = NOTIFICATION_RECENT_MS,
): IngestResult {
  if (!state.initialized) {
    for (const n of incoming) state.knownIds.add(n.id)
    state.initialized = true
    return {
      initialized: true,
      newlyArrived: [],
      audibleIds: [],
      audibleNotifications: [],
      alertNotifications: [],
    }
  }

  const newlyArrived = incoming.filter((n) => !state.knownIds.has(n.id))
  for (const n of incoming) state.knownIds.add(n.id)

  if (newlyArrived.length === 0) {
    return {
      initialized: true,
      newlyArrived: [],
      audibleIds: [],
      audibleNotifications: [],
      alertNotifications: [],
    }
  }

  const alertNotifications = newlyArrived.filter((n) => {
    if (state.playedIds.has(n.id)) return false
    if (!shouldAlertForNotification(n, prefs)) return false
    if (!isRecentNotification(n.created_at, recentMs)) return false
    return true
  })

  const audibleNotifications = alertNotifications.filter((n) => (
    shouldPlaySoundForNotification(n, prefs)
  ))

  const alertIds = alertNotifications.map((n) => n.id)
  for (const id of alertIds) state.playedIds.add(id)

  return {
    initialized: true,
    newlyArrived,
    audibleIds: audibleNotifications.map((n) => n.id),
    audibleNotifications,
    alertNotifications,
  }
}

export function formatIngestDebug(newlyArrived: DashNotification[], audibleIds: number[]) {
  return {
    new: newlyArrived.length,
    newIds: newlyArrived.map((n) => n.id),
    audibleIds,
    delays: newlyArrived.map((n) => ({
      id: n.id,
      delayFromCreatedMs: Date.now() - parseNotificationTimestamp(n.created_at),
    })),
  }
}
