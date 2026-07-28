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

type AuthState = {
  token: string
  username: string
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(getStoredToken())
  const [username, setUsername] = useState(getStoredUser())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      const stored = getStoredToken()
      if (!stored) {
        if (!cancelled) setReady(true)
        return
      }
      try {
        const me = await api<{ username: string }>('/dashboard/api/auth/me', {
          token: stored,
          onUnauthorized: () => {
            clearSession()
            setToken('')
            setUsername('')
          },
        })
        if (!cancelled) {
          setToken(stored)
          setUsername(me.username)
        }
      } catch {
        clearSession()
        if (!cancelled) {
          setToken('')
          setUsername('')
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (user: string, password: string) => {
    const payload = await api<{ token: string; username: string }>('/dashboard/api/auth/login', {
      method: 'POST',
      body: { username: user, password },
    })
    setSession(payload.token, payload.username)
    setToken(payload.token)
    setUsername(payload.username)
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
    setUsername('')
  }, [token])

  const value = useMemo(
    () => ({ token, username, ready, login, logout }),
    [token, username, ready, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
