import { GOOGLE_CLIENT_ID } from './api'

// Just the slice of Google Identity Services this app touches.
type CredentialResponse = { credential: string }
type GoogleId = {
  initialize(config: {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
  }): void
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void
  disableAutoSelect(): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

let loading: Promise<GoogleId> | null = null
let initialized = false
// GIS takes one callback at initialize() time; route it to whichever button is
// currently mounted.
let onCredential: ((credential: string) => void) | null = null

/** Load the GIS script once, on demand — never for a visitor who doesn't sign in. */
function loadGoogleIdentity(): Promise<GoogleId> {
  if (loading == null) {
    loading = new Promise<GoogleId>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => {
        const id = window.google?.accounts.id
        if (id) resolve(id)
        else reject(new Error('Google sign-in failed to load.'))
      }
      script.onerror = () => {
        loading = null // allow a retry on the next mount
        reject(new Error('Google sign-in failed to load.'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

/**
 * Render the "Sign in with Google" button into `parent`. Returns a cleanup
 * that detaches the callback.
 */
export function renderGoogleButton(
  parent: HTMLElement,
  callback: (credential: string) => void,
  onError: (message: string) => void,
): () => void {
  let cancelled = false
  onCredential = callback
  loadGoogleIdentity()
    .then((id) => {
      if (cancelled) return
      if (!initialized) {
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredential?.(response.credential),
        })
        initialized = true
      }
      id.renderButton(parent, {
        theme: 'filled_black',
        shape: 'pill',
        size: 'medium',
        text: 'signin_with',
      })
    })
    .catch((error: unknown) => {
      if (!cancelled) onError(error instanceof Error ? error.message : 'Google sign-in failed to load.')
    })
  return () => {
    cancelled = true
    if (onCredential === callback) onCredential = null
  }
}

/** After sign-out, stop GIS from silently re-selecting the same account. */
export function forgetGoogleSelection(): void {
  window.google?.accounts.id.disableAutoSelect()
}
