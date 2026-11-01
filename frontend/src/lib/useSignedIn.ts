import { useSyncExternalStore } from 'react'
import { getToken, subscribeToken } from './api'

/**
 * Whether a session token is held. Optimistic — the token may be dead until the
 * server says otherwise — but any 401 clears it, so this settles on its own.
 * Good enough to choose between "Save" and "Sign in to save".
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribeToken, () => getToken() != null)
}
