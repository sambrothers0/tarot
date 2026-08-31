import { useCallback, useEffect, useRef, useState } from 'react'
import { columnCoords } from './columns'
import { writeClipboard } from './clipboard'
import type { Hovered } from './types'

export type Toast = { text: string; ok: boolean }

// How long the confirmation stays up.
const TOAST_MS = 1800

// Click-to-copy plus its transient confirmation. The timer is owned here so it
// can be cancelled on unmount (and restarted when pins are clicked back to
// back), and the toast is set from the promise callback, never an effect body.
export function useCopyToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const copyColumn = useCallback((column: Hovered) => {
    const text = columnCoords(column)
    void writeClipboard(text).then((ok) => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
      setToast(ok ? { text: `Copied ${text}`, ok: true } : { text: "Couldn't copy", ok: false })
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setToast(null)
      }, TOAST_MS)
    })
  }, [])

  return { toast, copyColumn }
}
