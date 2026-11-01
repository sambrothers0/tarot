import { apiFetch, setToken } from './api'

export type User = {
  id: string
  email: string
  name: string | null
  picture_url: string | null
  created_at: string
}

type LoginResponse = { token: string; expires_at: string; user: User }

/** Exchange a Google ID token for a session. Creates the account on first use. */
export async function signInWithGoogle(credential: string): Promise<User> {
  const res = await apiFetch<LoginResponse>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  })
  setToken(res.token)
  return res.user
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' })
  } catch {
    // Signed out locally even if the server is unreachable; the session row
    // then just expires on its own.
  }
  setToken(null)
}

export function getMe(): Promise<User> {
  return apiFetch<User>('/me')
}

export async function deleteAccount(): Promise<void> {
  await apiFetch<void>('/me', { method: 'DELETE' })
  setToken(null)
}

/**
 * Fire-and-forget wake-up. The free host scales to zero, so the first request
 * after idle pays a cold start; sending this on page load means the server is
 * usually up by the time anyone clicks "Sign in".
 */
export function pingApi(): void {
  apiFetch<unknown>('/health').catch(() => {})
}
