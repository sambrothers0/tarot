// The drifting blobs behind every page. Purely decorative — the animation and
// the blur live in `index.css` next to the `bg-blobs` rules.
export function AmbientBackground() {
  return (
    <div className="bg-blobs" aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
      <div className="blob blob-4" />
    </div>
  )
}
