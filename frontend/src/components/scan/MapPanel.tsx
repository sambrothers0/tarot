import { PortalLoader } from '../../assets/PortalLoader'
import type { BlockMatch } from '../worldmap/types'
import { WorldMap } from '../worldmap/WorldMap'

type Props = {
  matches: BlockMatch[] | null
  busy: boolean
}

// The map and the frame around it. Square, sized to 90% of the smaller viewport
// dimension: `max-w-full` + `aspect-square` keeps it square while never spilling
// past the page padding on narrow portrait phones (where 90vmin == 90vw).
export function MapPanel({ matches, busy }: Props) {
  return (
    <div className="relative z-10 mx-auto mt-12 flex w-full flex-col items-center px-6">
      <div className="relative aspect-square w-[90vmin] max-w-full overflow-hidden rounded-3xl border border-violet-300/15 bg-slate-950/40 shadow-2xl shadow-black/40 backdrop-blur-sm">
        {matches ? (
          <WorldMap matches={matches} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {busy ? (
              <PortalLoader />
            ) : (
              <p className="text-xs text-slate-600">
                Choose a save and hit Scan to generate the map
              </p>
            )}
          </div>
        )}
        {/* While scanning, keep the loader visible even if a previous map is shown */}
        {busy && matches ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
            <PortalLoader />
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-center text-xs text-slate-500">
        Drag to pan · scroll to zoom · hover a pin for its coordinates
      </p>
    </div>
  )
}
