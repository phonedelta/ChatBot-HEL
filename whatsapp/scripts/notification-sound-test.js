/**
 * Notification ingest + sound eligibility + multi-tab claim tests.
 * Mirrors dashboard-app/src/lib/notification-ingest.ts logic.
 */
const assert = require('assert')

const RECENT_MS = 90_000

function parseNotificationTimestamp(iso) {
  const raw = String(iso || '').trim()
  if (!raw) return NaN
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const hasTz = /Z|[+-]\d{2}:\d{2}$/.test(normalized)
  const t = new Date(hasTz ? normalized : `${normalized}Z`).getTime()
  if (Number.isFinite(t)) return t
  return new Date(normalized).getTime()
}

function isRecentNotification(iso, maxAgeMs = RECENT_MS) {
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

function ingestNotifications(incoming, prefs, state, recentMs = RECENT_MS) {
  let audibleIds = []
  let newlyArrived = []
  if (!state.initialized) {
    for (const n of incoming) state.knownIds.add(n.id)
    state.initialized = true
    return { audibleIds, newlyArrived }
  }
  newlyArrived = incoming.filter((n) => !state.knownIds.has(n.id))
  for (const n of incoming) state.knownIds.add(n.id)
  const audible = newlyArrived.filter((n) => {
    if (state.playedIds.has(n.id)) return false
    if (!shouldPlaySoundForNotification(n, prefs)) return false
    if (!isRecentNotification(n.created_at, recentMs)) return false
    return true
  })
  if (audible.length > 0) {
    audibleIds = audible.map((n) => n.id)
    for (const id of audibleIds) state.playedIds.add(id)
  }
  return { audibleIds, newlyArrived }
}

/** Mirror of claimNotificationAlerts with in-memory store (multi-tab sim). */
function createClaimStore() {
  const store = new Map()
  return {
    claim(ids) {
      const claimed = []
      for (const id of ids) {
        if (store.has(id)) continue
        store.set(id, Date.now())
        claimed.push(id)
      }
      return claimed
    },
    has(id) {
      return store.has(id)
    },
  }
}

function run() {
  const prefs = { soundEnabled: true, slotReleased: true, handoff: true }
  const now = new Date().toISOString()

  // TEST 5 — Initial load — no sound for history
  const s1 = { initialized: false, knownIds: new Set(), playedIds: new Set() }
  const r1 = ingestNotifications([
    { id: 90, type: 'slot_released', created_at: now },
    { id: 91, type: 'slot_released', created_at: now },
    { id: 92, type: 'slot_released', created_at: now },
  ], prefs, s1)
  assert.deepStrictEqual(r1.audibleIds, [])
  assert.strictEqual(s1.knownIds.size, 3)

  // New after bootstrap — sound
  const r1b = ingestNotifications([
    { id: 90, type: 'slot_released', created_at: now },
    { id: 91, type: 'slot_released', created_at: now },
    { id: 92, type: 'slot_released', created_at: now },
    { id: 93, type: 'slot_released', created_at: now },
  ], prefs, s1)
  assert.deepStrictEqual(r1b.audibleIds, [93])

  // TEST 1 — New notification — sound once
  const s2 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r2 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 3, type: 'slot_released', created_at: now },
  ], prefs, s2)
  assert.deepStrictEqual(r2.audibleIds, [3])

  // TEST 4 / 7 — Same poll / rerender — no replay
  const r3 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 3, type: 'slot_released', created_at: now },
  ], prefs, s2)
  assert.deepStrictEqual(r3.audibleIds, [])

  // Batch
  const s3 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r4 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 4, type: 'slot_released', created_at: now },
    { id: 5, type: 'handoff', created_at: now },
    { id: 6, type: 'slot_released', created_at: now },
  ], prefs, s3)
  assert.deepStrictEqual(r4.audibleIds.sort(), [4, 5, 6])

  // Old notification beyond recent window — no sound
  const old = new Date(Date.now() - 120_000).toISOString()
  const s4 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r5 = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 7, type: 'slot_released', created_at: old },
  ], prefs, s4)
  assert.deepStrictEqual(r5.audibleIds, [])

  // Within throttled-background window (e.g. 45s) — still audible
  const mid = new Date(Date.now() - 45_000).toISOString()
  const s4b = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  const r5b = ingestNotifications([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 70, type: 'slot_released', created_at: mid },
  ], prefs, s4b)
  assert.deepStrictEqual(r5b.audibleIds, [70])

  // TEST 2 — hidden tab must NOT block sound eligibility (no tabWasHidden gate)
  const sHidden = { initialized: true, knownIds: new Set(), playedIds: new Set() }
  const rHidden = ingestNotifications([
    { id: 101, type: 'slot_released', created_at: now },
  ], prefs, sHidden)
  assert.deepStrictEqual(rHidden.audibleIds, [101])

  // TEST 9 — Sound disabled globally → no audible ids (OS alerts still use alert path separately)
  const s5 = { initialized: true, knownIds: new Set([1]), playedIds: new Set() }
  function ingestSplit(incoming, prefs, state) {
    if (!state.initialized) {
      for (const n of incoming) state.knownIds.add(n.id)
      state.initialized = true
      return { audibleIds: [], alertIds: [] }
    }
    const newlyArrived = incoming.filter((n) => !state.knownIds.has(n.id))
    for (const n of incoming) state.knownIds.add(n.id)
    const alertable = newlyArrived.filter((n) => {
      if (state.playedIds.has(n.id)) return false
      const key = TYPE_MAP[n.type]
      if (key && prefs[key] === false) return false
      if (!isRecentNotification(n.created_at)) return false
      return true
    })
    for (const n of alertable) state.playedIds.add(n.id)
    const audibleIds = prefs.soundEnabled === false ? [] : alertable.map((n) => n.id)
    return { audibleIds, alertIds: alertable.map((n) => n.id) }
  }
  const r6 = ingestSplit([
    { id: 1, type: 'slot_released', created_at: now },
    { id: 8, type: 'slot_released', created_at: now },
  ], { ...prefs, soundEnabled: false }, s5)
  assert.deepStrictEqual(r6.audibleIds, [])
  assert.deepStrictEqual(r6.alertIds, [8])

  // Type disabled
  const s6 = { initialized: true, knownIds: new Set(), playedIds: new Set() }
  const r7 = ingestNotifications([
    { id: 9, type: 'slot_released', created_at: now },
  ], { ...prefs, slotReleased: false }, s6)
  assert.deepStrictEqual(r7.audibleIds, [])

  // Remove old sound-disabled block that expected empty via shouldPlay only
  void 0

  // TEST 6 — Multi-tab claim: only first tab alerts
  const shared = createClaimStore()
  const tabA = shared.claim([104])
  const tabB = shared.claim([104])
  assert.deepStrictEqual(tabA, [104])
  assert.deepStrictEqual(tabB, [])

  // Dedup claim across ids
  const shared2 = createClaimStore()
  const first = shared2.claim([200, 201])
  const second = shared2.claim([201, 202])
  assert.deepStrictEqual(first, [200, 201])
  assert.deepStrictEqual(second, [202])

  console.log('notification sound logic test: ok')
}

run()
