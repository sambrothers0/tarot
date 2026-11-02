import type { Toast } from './useCopyToast'

// The chrome floating over the canvas. All of it is absolutely positioned
// against the map container and none of it takes the pointer, except the Fit
// button. None of it is the only way to learn anything: the canvas's own
// status regions (in WorldMap) speak what these show.

// Zoom badge and auto-fit, kept top-left so they don't cover the "X →" axis
// chip the canvas draws in the top-right corner.
export function ZoomControls({ zoomPct, onFit }: { zoomPct: number; onFit: () => void }) {
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2">
      <span aria-hidden="true" className="pointer-events-none rounded-lg border border-violet-300/15 bg-slate-950/70 px-2 py-1 font-mono text-[11px] tabular-nums text-violet-200/80 backdrop-blur-sm">
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
    <div aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-violet-300/15 bg-slate-950/70 px-2.5 py-1 font-mono text-xs tabular-nums text-violet-100 backdrop-blur-sm">
      X {x} · Z {z}
    </div>
  )
}

// Copy confirmation. Anchored to the map rather than the cursor so it survives
// the pointer moving off the pin right after the click.
export function CopyToast({ toast }: { toast: Toast }) {
  return (
    <div
      aria-hidden="true"
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

// The keyboard's pointer: a plus at the centre of the map, which is where hover,
// copy and the readout look while arrow keys drive.
export function Crosshair() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
      <span className="absolute h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-violet-100/90 shadow-[0_0_0_1px_rgb(0_0_0/0.6)]" />
      <span className="absolute h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-violet-100/90 shadow-[0_0_0_1px_rgb(0_0_0/0.6)]" />
    </div>
  )
}

// The keys, shown only while the keyboard is driving. Screen readers get the
// same list from the canvas's description, so this one is hidden from them.
export function KeyboardHint() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-8 left-3 mr-36 rounded-lg border border-violet-300/15 bg-slate-950/80 px-2.5 py-1 text-[11px] leading-5 text-violet-100 backdrop-blur-sm"
    >
      Arrows pan · +/− zoom · 0 fit · N/P next match · Enter copy
    </div>
  )
}
