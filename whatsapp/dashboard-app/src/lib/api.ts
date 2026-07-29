const TOKEN_KEY = 'hel-dashboard-token'
const USER_KEY = 'hel-dashboard-user'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function getStoredUser() {
  return localStorage.getItem(USER_KEY) || ''
}

export function setSession(token: string, username: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ApiOptions = {
  method?: string
  body?: unknown
  token?: string
  onUnauthorized?: () => void
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = options.token ?? getStoredToken()
  if (token) headers['x-dashboard-token'] = token
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(
      'Serveur injoignable. Vérifiez que le bot tourne (npm start) sur http://127.0.0.1:8081',
      0,
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login')) {
      options.onUnauthorized?.()
    }
    throw new ApiError(payload?.error || `HTTP ${response.status}`, response.status)
  }

  return payload as T
}
