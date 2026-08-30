import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, clearSession, getStoredToken, getStoredUser, setSession } from '@/lib/api'
import type { SecuritySettings } from '@/lib/cabinet-settings'
import { useIdleSession } from '@/hooks/useIdleSession'

export type DashboardUser = {
  id: number
  displayName: string
  role: string
  roleLabel: string
  permissions: string[]
  username?: string
  security?: SecuritySettings | null
}

type AuthState = {
  token: string
  user: DashboardUser | null
  ready: boolean
  login: (accountId: number, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function parseStoredUser(): DashboardUser | null {
  try {
    const raw = getStoredUser()
    if (!raw) return null
    return JSON.parse(raw) as DashboardUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(getStoredToken())
  const [user, setUser] = useState<DashboardUser | null>(parseStoredUser())
  const [ready, setReady] = useState(false)

  const refreshUser = useCallback(async (authToken?: string) => {
    const t = authToken || getStoredToken()
    if (!t) return
    const me = await api<DashboardUser & { ok?: boolean }>('/dashboard/api/auth/me', {
      token: t,
      onUnauthorized: () => {
        clearSession()
        setToken('')
        setUser(null)
      },
    })
    setUser({
      id: me.id,
      displayName: me.displayName,
      role: me.role,
      roleLabel: me.roleLabel,
      permissions: me.permissions || [],
      username: me.username,
      security: (me as DashboardUser).security ?? null,
    })
    setSession(t, JSON.stringify({
      id: me.id,
      displayName: me.displayName,
      role: me.role,
      roleLabel: me.roleLabel,
      permissions: me.permissions || [],
      username: me.username,
      security: (me as DashboardUser).security ?? null,
    }))
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      const stored = getStoredToken()
      if (!stored) {
        if (!cancelled) setReady(true)
        return
      }
      try {
        await refreshUser(stored)
        if (!cancelled) setToken(stored)
      } catch {
        clearSession()
        if (!cancelled) {
          setToken('')
          setUser(null)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [refreshUser])

  const login = useCallback(async (accountId: number, password: string) => {
    const payload = await api<{
      token: string
      user: DashboardUser
    }>('/dashboard/api/auth/login', {
      method: 'POST',
      body: { accountId, password },
    })
    setSession(payload.token, JSON.stringify(payload.user))
    setToken(payload.token)
    setUser(payload.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      if (token) {
        await api('/dashboard/api/auth/logout', { method: 'POST', token })
      }
    } catch {
      /* ignore */
    }
    clearSession()
    setToken('')
    setUser(null)
  }, [token])

  const value = useMemo(
    () => ({ token, user, ready, login, logout, refreshUser }),
    [token, user, ready, login, logout, refreshUser],
  )

  useIdleSession(user?.security, logout)

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
