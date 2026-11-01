import { DIMENSION_TONES } from './dimensionTones'
import type { Dimension } from '../../lib/scanOptions'

type Props = {
  points: [number, number][]
  dimension: Dimension
}

const SIZE = 64
const PAD = 10

// A saved scan's thumbnail: its preview columns, fitted to a square the way the
// map fits the real thing (+X right, +Z down). Uniform scale, so a long thin
// spread stays long and thin.
export function ScanConstellation({ points, dimension }: Props) {
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ, 1)
  const scale = (SIZE - PAD * 2) / span
  // Centre the shorter axis.
  const offX = PAD + (SIZE - PAD * 2 - (Math.max(...xs) - minX) * scale) / 2
  const offZ = PAD + (SIZE - PAD * 2 - (Math.max(...zs) - minZ) * scale) / 2
  const color = DIMENSION_TONES[dimension].dot

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-20 w-20 shrink-0 sm:h-24 sm:w-24 rounded-2xl border border-white/10 bg-slate-950/60"
      aria-hidden="true"
    >
      <path
        d={`M${SIZE / 2} 6V${SIZE - 6}M6 ${SIZE / 2}H${SIZE - 6}`}
        stroke="rgba(196,181,253,0.08)"
        strokeWidth="1"
      />
      {points.length === 0 ? null : (
        <g fill={color}>
          {points.map(([x, z], i) => (
            <circle
              key={i}
              cx={offX + (x - minX) * scale}
              cy={offZ + (z - minZ) * scale}
              r={1.6}
              opacity={0.85}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
