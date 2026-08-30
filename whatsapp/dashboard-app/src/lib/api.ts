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

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined
        ? undefined
        : (isFormData ? options.body as FormData : JSON.stringify(options.body)),
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
    const msg = payload?.message || payload?.error || `HTTP ${response.status}`
    throw new ApiError(msg, response.status)
  }

  return payload as T
}
