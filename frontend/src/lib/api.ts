// The accounts API. Optional by design: with VITE_API_URL or
// VITE_GOOGLE_CLIENT_ID unset there is no account UI at all, and the app works
// exactly as it does signed out. Nothing about a scan ever goes through here.

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const accountsEnabled = API_URL !== '' && GOOGLE_CLIENT_ID !== ''

const TOKEN_KEY = 'tarot.session'

// A bearer token, not a cookie: the API is on a different site from Pages, so
// a session cookie would be a third-party cookie, which browsers block.
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage disabled (private mode, policy): the session lasts the page.
  }
  tokenListeners.forEach((listener) => listener())
}

// Sign-in can now start from two places (the account menu and the save
// prompt), and a 401 anywhere ends the session, so whoever shows session state
// subscribes here rather than tracking it alone.
const tokenListeners = new Set<() => void>()

export function subscribeToken(listener: () => void): () => void {
  tokenListeners.add(listener)
  return () => {
    tokenListeners.delete(listener)
  }
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body != null) headers.set('Content-Type', 'application/json')

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Could not reach the accounts server.')
  }

  // Any 401 means the stored token is dead (expired, revoked, account gone).
  if (res.status === 401) setToken(null)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
        detail = body.detail
      }
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
