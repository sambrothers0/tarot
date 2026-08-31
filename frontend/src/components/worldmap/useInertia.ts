import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { View } from './types'

// Per-ms exponential decay of the release glide; higher = stops sooner.
const FRICTION = 0.004
// A release slower than this shouldn't drift at all.
const MIN_FLING = 0.02
// ...and the glide ends once it decays below this.
const REST = 0.01

// The momentum-scroll feel you get from flicking a touch surface: the drag
// handler keeps `vel` fed with a smoothed pointer velocity (screen px/ms), and
// the release keeps panning in that direction while easing to a stop.
export function useInertia(viewRef: RefObject<View>, draw: () => void) {
  const velRef = useRef({ vx: 0, vz: 0 })
  const rafRef = useRef<number | null>(null)

  const stopInertia = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    velRef.current.vx = 0
    velRef.current.vz = 0
  }, [])

  const startInertia = useCallback(() => {
    if (Math.hypot(velRef.current.vx, velRef.current.vz) < MIN_FLING) return
    let last = performance.now()
    const step = () => {
      const now = performance.now()
      const dt = now - last
      last = now
      const v = velRef.current
      const view = viewRef.current
      view.cx -= (v.vx * dt) / view.ppb
      view.cz -= (v.vz * dt) / view.ppb
      const decay = Math.exp(-FRICTION * dt)
      v.vx *= decay
      v.vz *= decay
      draw()
      if (Math.hypot(v.vx, v.vz) < REST) {
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [draw, viewRef])

  // Null the ref after cancelling — see the note in WorldMap about StrictMode
  // remounts wedging a stale frame handle.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  return { velRef, stopInertia, startInertia }
}
