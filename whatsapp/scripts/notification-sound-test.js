/**
 * Notification ingest + sound eligibility tests.
 */
const assert = require('assert')

// Mirror frontend logic (keep in sync with notification-types.ts + NotificationContext)
function parseNotificationTimestamp(iso) {
  const raw = String(iso || '').trim()
  if (!raw) return NaN
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const hasTz = /Z|[+-]\d{2}:\d{2}$/.test(normalized)
  const t = new Date(hasTz ? normalized : `${normalized}Z`).getTime()
  if (Number.isFinite(t)) return t
  return new Date(normalized).getTime()
}

function isRecentNotification(iso, maxAgeMs = 15_000) {
  const t = parseNotificationTimestamp(iso)
  if (!Number.isFinite(t)) return false
  return Date.now() - t <= maxAgeMs
}

const TYPE_MAP = {
  slot_released: 'slotReleased',
  handoff: 'handoff',
}

function shouldPlaySoundForNotification(notification, prefs) {
  if (prefs.soundEnabled === false) return false
  const key = TYPE_MAP[notification.type]
  if (!key) return true
  return prefs[key] !== false
}

function ingestNotifications(incoming, prefs, state) {
  let audibleIds = []
  if (!state.initialized) {
    for (const n of incoming) state.knownIds.add(n.id)
    state.initialized = true
    return { audibleIds }
  }
  const newlyArrived = incoming.filter((n) => !state.knownIds.has(n.id))
  for (const n of incoming) state.knownIds.add(n.id)
  const audible = newlyArrived.filter((n) => {
    if (state.playedIds.has(n.id)) return false
    if (!shouldPlaySoundForNotification(n, prefs)) return false
    if (!isRecentNotification(n.created_at)) return false
    return true
  })
  if (audible.length > 0) {
    audibleIds = audible.map((n) => n.id)
    for (const id of audibleIds) state.playedIds.add(id)
  }
  return { audibleIds }
}

function run() {
  const prefs = { soundEnabled: true, slotReleased: true, handoff: true }
  const now = new Date().toISOString()

  // Initial load — no sound
  const s1 = { initialized: false, knownIds: new Set(), playedIds: new Set() }
  const r1 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 2, type: 'slot_released', created_at: now },
  ], prefs, s1)
  assert.deepStrictEqual(r1.audibleIds, [])
  assert.strictEqual(s1.knownIds.size, 2)

  // New notification — sound once
  const s2 = { ...s1, initialized: true }
  const r2 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 3, type: 'slot_released', created_at: now },
  ], prefs, s2)
  assert.deepStrictEqual(r2.audibleIds, [3])

  // Same poll again — no replay
  const r3 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 3, type: 'slot_released', created_at: now },
  ], prefs, s2)
  assert.deepStrictEqual(r3.audibleIds, [])

  // Batch of 3 new — one sound batch (IDs collected together)
  const s3 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r4 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 4, type: 'slot_released', created_at: now },
    { id: 5, type: 'handoff', created_at: now },
    { id: 6, type: 'slot_released', created_at: now },
  ], prefs, s3)
  assert.deepStrictEqual(r4.audibleIds.sort(), [4, 5, 6])

  // Old notification discovered late — no sound
  const old = new Date(Date.now() - 120_000).toISOString()
  const s4 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r5 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 7, type: 'slot_released', created_at: old },
  ], prefs, s4)
  assert.deepStrictEqual(r5.audibleIds, [])

  // Sound disabled globally
  const s5 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r6 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 8, type: 'slot_released', created_at: now },
  ], { ...prefs, soundEnabled: false }, s5)
  assert.deepStrictEqual(r6.audibleIds, [])

  // Type disabled in settings
  const s6 = { initialized: true, knownIds: new Set(), playedIds: new Set() }
  const r7 = ingestNotifications([
    { id: 9, type: 'slot_released', created_at: now },
  ], { ...prefs, slotReleased: false }, s6)
  assert.deepStrictEqual(r7.audibleIds, [])

  console.log('notification sound logic test: ok')
}

run()
