import { glyph, layerStyle } from './layers'

type Props = {
  layer: number
  layerCount: number
  // Rendered size in CSS pixels; the glyph scales with it.
  size?: number
  className?: string
}

// A block type's map glyph, drawn small beside its name wherever the block is
// listed — the form, the result line, the legend, the tooltip. Decorative: the
// name next to it is what a screen reader hears.
export function LayerSwatch({ layer, layerCount, size = 12, className = '' }: Props) {
  const style = layerStyle(layer, layerCount)
  const { d, stroke } = glyph(style.shape, 6, 6, 3.6)
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path
        d={d}
        fill={stroke ? 'none' : style.color}
        stroke={stroke ? style.color : 'none'}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  )
}
