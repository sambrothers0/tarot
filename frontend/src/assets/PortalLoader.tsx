import spiralGif from './portal-loader.gif'

export function PortalLoader() {
  return (
    <img
      src={spiralGif}
      alt=""
      className="h-20 w-20"
      style={{
        maskImage: 'radial-gradient(circle, black 40%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(circle, black 40%, transparent 70%)',
      }}
    />
  )
}
