import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearSession } from '@/lib/api'
import type { SecuritySettings } from '@/lib/cabinet-settings'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const
const THROTTLE_MS = 30_000
const WARN_BEFORE_MS = 60_000

/**
 * Idle logout — ignores background polling; only real user activity resets timer.
 */
export function useIdleSession(
  security: SecuritySettings | null | undefined,
  onLogout: () => Promise<void>,
) {
  const navigate = useNavigate()
  const lastActivityRef = useRef(Date.now())
  const warnedRef = useRef(false)

  useEffect(() => {
    if (!security?.idleLogoutEnabled) return undefined

    const timeoutMs = security.idleTimeoutMinutes * 60 * 1000

    const bump = () => {
      lastActivityRef.current = Date.now()
      warnedRef.current = false
    }

    let throttleTimer: ReturnType<typeof setTimeout> | null = null
    const onActivity = () => {
      if (throttleTimer) return
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        bump()
      }, THROTTLE_MS)
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true })
    }

    const interval = window.setInterval(async () => {
      const idleFor = Date.now() - lastActivityRef.current
      if (idleFor >= timeoutMs - WARN_BEFORE_MS && idleFor < timeoutMs && !warnedRef.current) {
        warnedRef.current = true
        const stay = window.confirm(
          'Votre session va expirer pour inactivité. Cliquez sur OK pour continuer.',
        )
        if (stay) bump()
      }
      if (idleFor >= timeoutMs) {
        clearSession()
        await onLogout()
        navigate('/login', {
          replace: true,
          state: { reason: 'idle_timeout', message: 'Votre session a expiré pour inactivité.' },
        })
      }
    }, 15_000)

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity)
      }
      if (throttleTimer) clearTimeout(throttleTimer)
      clearInterval(interval)
    }
  }, [navigate, onLogout, security?.idleLogoutEnabled, security?.idleTimeoutMinutes])
}
