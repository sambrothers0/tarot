import type { Ref } from 'react'
import { PortalLoader } from '../../assets/PortalLoader'
import type { BlockMatch } from '../worldmap/types'
import { WorldMap } from '../worldmap/WorldMap'

type Props = {
  matches: BlockMatch[] | null
  busy: boolean
  ref?: Ref<HTMLElement>
}

export const MAP_ID = 'map'

// The map and the obsidian frame around it. The frame is the portal: the
// `.portal-frame` rules in `index.css` draw the block seams and the violet light
// the pane casts. Only the HTML around the canvas is styled here; the drawing
// stays in `worldmap/render.ts`.
// Sits under the form at 90% of the smaller viewport side, snapped down to whole
// blocks in `index.css`. Square-cornered on purpose, frame and pane alike: it
// is a block of obsidian, not a card.
export function MapPanel({ matches, busy, ref }: Props) {
  return (
    <section
      ref={ref}
      id={MAP_ID}
      tabIndex={-1}
      aria-label="Map of matches"
      className={`portal-frame scroll-my-6 outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 ${matches ? 'is-lit' : ''}`}
    >
      <div className="portal-pane relative aspect-square w-full overflow-hidden">
        {matches ? (
          <WorldMap matches={matches} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            {busy ? (
              <PortalLoader />
            ) : (
              <p className="text-sm text-slate-400">
                Choose a save and scan it
              </p>
            )}
          </div>
        )}
        {/* While scanning, keep the loader visible even if a previous map is shown */}
        {busy && matches ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#08050f]/70 backdrop-blur-sm">
            <PortalLoader />
          </div>
        ) : null}
      </div>
    </section>
  )
}
