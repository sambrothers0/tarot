import type { Dimension } from '../../lib/scanOptions'

// Each dimension's colour, borrowed from its ground: grass, netherrack, end stone.
export const DIMENSION_TONES: Record<Dimension, { badge: string; dot: string }> = {
  overworld: { badge: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200', dot: '#6ee7b7' },
  nether: { badge: 'border-orange-300/25 bg-orange-500/10 text-orange-200', dot: '#fdba74' },
  end: { badge: 'border-amber-100/25 bg-amber-100/10 text-amber-100', dot: '#fef3c7' },
}
