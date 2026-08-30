/**
 * Centralized HEL notification sound — preloaded, reusable, autoplay-safe.
 */
import notificationSoundUrl from '@/assets/Notification Sound/Notification_HEL.mp3'

const DEV = import.meta.env.DEV
const BATCH_COOLDOWN_MS = 1500

let audioEl: HTMLAudioElement | null = null
let unlocked = false
let unlockListenersAttached = false
let lastPlayAt = 0

function logDev(action: string, extra: Record<string, unknown> = {}) {
  if (!DEV) return
  console.info('[NOTIFICATION_AUDIO]', { action, ...extra })
}

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio(notificationSoundUrl)
    audioEl.preload = 'auto'
    audioEl.volume = 0.6
  }
  return audioEl
}

/** Preload at module load. */
try {
  getAudio().load()
} catch {
  /* ignore */
}

export function preloadNotificationSound() {
  try {
    getAudio().load()
  } catch {
    /* ignore */
  }
}

export function isNotificationSoundUnlocked() {
  return unlocked
}

/** Call after user gesture so later autoplay is allowed. Safe to call multiple times. */
export function unlockNotificationSound(): Promise<boolean> {
  if (unlocked) return Promise.resolve(true)
  try {
    const a = getAudio()
    a.muted = true
    return a.play()
      .then(() => {
        a.pause()
        a.currentTime = 0
        a.muted = false
        unlocked = true
        logDev('unlocked')
        return true
      })
      .catch((err) => {
        a.muted = false
        logDev('unlock_failed', { reason: String(err?.name || err) })
        return false
      })
  } catch {
    return Promise.resolve(false)
  }
}

/** Attach one-shot listeners until audio is unlocked. */
export function ensureNotificationSoundUnlockListeners() {
  if (unlockListenersAttached || unlocked) return
  unlockListenersAttached = true

  const tryUnlock = () => {
    void unlockNotificationSound().then((ok) => {
      if (ok) {
        window.removeEventListener('pointerdown', tryUnlock)
        window.removeEventListener('keydown', tryUnlock)
        window.removeEventListener('touchstart', tryUnlock)
      }
    })
  }

  window.addEventListener('pointerdown', tryUnlock)
  window.addEventListener('keydown', tryUnlock)
  window.addEventListener('touchstart', tryUnlock)
}

/**
 * Play notification sound once (batch-safe cooldown).
 * Returns true if playback started; false if skipped/blocked.
 */
export function playNotificationSound(notificationIds: number[] = []): boolean {
  const now = Date.now()
  if (now - lastPlayAt < BATCH_COOLDOWN_MS) {
    logDev('skipped_cooldown', { notificationIds })
    return false
  }

  try {
    const a = getAudio()
    a.pause()
    a.currentTime = 0
    a.loop = false
    a.volume = 0.6
    lastPlayAt = now
    logDev('play', { notificationIds })

    void a.play().catch((err) => {
      logDev('blocked', {
        notificationIds,
        reason: String(err?.name || err),
      })
    })
    return true
  } catch (err) {
    logDev('failed', { notificationIds, reason: String(err) })
    return false
  }
}
