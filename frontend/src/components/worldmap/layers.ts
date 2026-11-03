// How each of a scan's block types looks on the map: a colour *and* a shape,
// assigned by position in the scan (first block, second block…) and never
// cycled. The same glyph marks the block everywhere it appears — its chip in
// the form, the result line, the legend, the tooltip and the pins — so a
// colour is never the only way to tell two blocks apart (WCAG 1.4.1).
//
// The colours were run through the dataviz validator as a scatter palette
// (every pair, not just neighbours) against the pane, #0b0816: worst
// colour-blind separation ΔE 10.2 (protan), worst normal-vision ΔE 15.7, all
// 3:1 or better. They sit lighter than a chart's fills would, on purpose —
// a pin is a few pixels on near-black. Tritanopia separates the blue and rose
// less well (ΔE 4.6), which the shapes cover.
//
// A scan of a single block keeps the plain white dot the map always drew: one
// series needs no key, and the white reads as the portal's light.

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'ring' | 'cross'

export type LayerStyle = { color: string; shape: Shape }

export const LAYER_STYLES: readonly LayerStyle[] = [
  { color: '#f3a76e', shape: 'circle' },
  { color: '#00c3d8', shape: 'square' },
  { color: '#d75f97', shape: 'diamond' },
  { color: '#d0ed8e', shape: 'triangle' },
  { color: '#6f8bd5', shape: 'ring' },
  { color: '#c27700', shape: 'cross' },
]

const SOLO_STYLE: LayerStyle = { color: '#ffffff', shape: 'circle' }

/** The style for `layer` in a scan of `layerCount` blocks. */
export const layerStyle = (layer: number, layerCount: number): LayerStyle =>
  layerCount <= 1 ? SOLO_STYLE : LAYER_STYLES[layer % LAYER_STYLES.length]

// The glyph as an SVG path centred on (cx, cy) with nominal radius r. One
// geometry serves both the canvas (as a Path2D) and the HTML swatches (as an
// SVG <path>), so the key and the map can't drift apart. Filled shapes are
// scaled so each covers about the same area as the circle; the ring and cross
// are stroked, `stroke` giving their line width.
export function glyph(shape: Shape, cx: number, cy: number, r: number): { d: string; stroke?: number } {
  const f = (n: number) => +n.toFixed(2)
  switch (shape) {
    case 'circle':
      return {
        d: `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`,
      }
    case 'square': {
      const h = r * 0.89
      return { d: `M${f(cx - h)} ${f(cy - h)}h${f(2 * h)}v${f(2 * h)}h${f(-2 * h)}Z` }
    }
    case 'diamond': {
      const h = r * 1.25
      return { d: `M${f(cx)} ${f(cy - h)}L${f(cx + h)} ${f(cy)}L${f(cx)} ${f(cy + h)}L${f(cx - h)} ${f(cy)}Z` }
    }
    case 'triangle': {
      // Equilateral, nudged down so its visual centre sits on the point.
      const h = r * 1.35
      const top = cy - h * 0.9
      const base = cy + h * 0.6
      return { d: `M${f(cx)} ${f(top)}L${f(cx + h * 0.95)} ${f(base)}L${f(cx - h * 0.95)} ${f(base)}Z` }
    }
    case 'ring': {
      const s = Math.max(1.25, r * 0.45)
      const rr = r - s / 2 + 0.25
      return {
        d: `M${f(cx - rr)} ${f(cy)}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0Z`,
        stroke: s,
      }
    }
    case 'cross': {
      const h = r * 0.95
      return {
        d: `M${f(cx - h)} ${f(cy - h)}L${f(cx + h)} ${f(cy + h)}M${f(cx + h)} ${f(cy - h)}L${f(cx - h)} ${f(cy + h)}`,
        stroke: Math.max(1.5, r * 0.55),
      }
    }
  }
}
