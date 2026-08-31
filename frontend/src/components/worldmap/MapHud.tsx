import type { Toast } from './useCopyToast'

// The chrome floating over the canvas. All of it is absolutely positioned
// against the map container and none of it takes the pointer, except the Fit
// button.

// Zoom badge and auto-fit, kept top-left so they don't cover the "X →" axis
// chip the canvas draws in the top-right corner.
export function ZoomControls({ zoomPct, onFit }: { zoomPct: number; onFit: () => void }) {
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2">
      <span className="pointer-events-none rounded-lg border border-violet-300/15 bg-slate-950/70 px-2 py-1 font-mono text-[11px] tabular-nums text-violet-200/80 backdrop-blur-sm">
        {zoomPct}%
      </span>
      <button
        type="button"
        onClick={onFit}
        className="rounded-lg border border-violet-300/20 bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium text-violet-100 backdrop-blur-sm transition hover:bg-violet-500/20"
      >
        Fit
      </button>
    </div>
  )
}

// Where the cursor is in world coordinates.
export function CoordinateReadout({ x, z }: { x: number; z: number }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-violet-300/15 bg-slate-950/70 px-2.5 py-1 font-mono text-xs tabular-nums text-violet-100 backdrop-blur-sm">
      X {x} · Z {z}
    </div>
  )
}

// Copy confirmation. Anchored to the map rather than the cursor so it survives
// the pointer moving off the pin right after the click.
export function CopyToast({ toast }: { toast: Toast }) {
  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border px-3 py-1.5 font-mono text-xs tabular-nums shadow-lg shadow-black/40 backdrop-blur ${
        toast.ok
          ? 'border-violet-300/25 bg-slate-950/85 text-violet-50'
          : 'border-rose-400/30 bg-rose-950/80 text-rose-100'
      }`}
    >
      {toast.text}
    </div>
  )
}
