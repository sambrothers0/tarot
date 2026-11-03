import { useState } from 'react'
import type { BlockMatch } from './types'

const NONE: ReadonlySet<number> = new Set()

/**
 * Which of a result's layers are switched off. Kept against the result it
 * belongs to, so a new scan starts with everything showing without an effect
 * having to reset it.
 */
export function useHiddenLayers(matches: BlockMatch[] | null) {
  const [state, setState] = useState<{ for: BlockMatch[] | null; hidden: ReadonlySet<number> }>({
    for: matches,
    hidden: NONE,
  })
  const hidden = state.for === matches ? state.hidden : NONE
  const toggle = (layer: number) => {
    const next = new Set(hidden)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    setState({ for: matches, hidden: next })
  }
  return { hidden, toggle }
}
