import { useEffect, useEffectEvent, useRef, useState } from 'react'
import GoogleIcon from '../../assets/icons/google.svg?react'
import { renderGoogleButton } from '../../lib/googleIdentity'

type Props = {
  onCredential: (credential: string) => void
  onError: (message: string) => void
  busy?: boolean
}

// "Sign in with Google", in the site's own glass-and-violet style.
//
// GIS draws its button in a cross-origin iframe that can't be restyled, and it
// only hands out an ID token for a click inside that iframe. So the pill below
// is decoration, and the real GIS button sits over it at zero opacity, sized to
// match: every click and keypress lands on Google's button, and the wrapper's
// `group-hover`/`group-focus-within` keep the visible pill in step with it.
// Until GIS has rendered there is nothing to click, so the pill reads dimmed.
export function GoogleSignInButton({ onCredential, onError, busy = false }: Props) {
  const slot = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const handleCredential = useEffectEvent(onCredential)
  const handleError = useEffectEvent(onError)

  // Once per mount: re-rendering GIS's iframe flickers.
  useEffect(() => {
    if (slot.current == null) return
    return renderGoogleButton(
      slot.current,
      (credential) => handleCredential(credential),
      (message) => handleError(message),
      () => setReady(true),
    )
  }, [])

  const live = ready && !busy
  return (
    <div className={`group relative w-60 ${live ? '' : 'pointer-events-none'}`}>
      <span
        aria-hidden="true"
        className={`flex h-10 items-center gap-3 rounded-full border border-white/15 bg-white/[0.07] pl-1 pr-5 text-sm font-medium text-slate-100 shadow-lg shadow-black/30 backdrop-blur-xl transition group-hover:border-violet-300/40 group-hover:bg-white/[0.12] group-focus-within:border-violet-300/60 group-focus-within:ring-2 group-focus-within:ring-violet-400/40 ${
          live ? '' : 'opacity-60'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white">
          <GoogleIcon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-center">{busy ? 'Signing in…' : 'Sign in with Google'}</span>
      </span>
      {/* Clipped to the pill so the hit area matches what's drawn. */}
      <div ref={slot} className="absolute inset-0 overflow-hidden rounded-full opacity-0" />
    </div>
  )
}
