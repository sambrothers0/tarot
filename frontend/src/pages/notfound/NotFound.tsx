import { AmbientBackground } from '../../components/layout/AmbientBackground'

// The page GitHub Pages serves for any path no built file backs. It is a static
// entry point of its own (`404.html` at the site root) rather than a route —
// there is no client-side router to catch the miss.
export function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-x-hidden bg-[#06040d] px-6 py-24 text-center text-white">
      <AmbientBackground />

      <div className="relative z-10 flex flex-col items-center">
        {/* Lives in public/ rather than the bundle so it can double as the
            favicon; BASE_URL keeps it correct under the /tarot/ subpath. */}
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt=""
          className="h-40 w-40"
        />

        <div className="mt-12 h-px w-full max-w-md bg-gradient-to-r from-transparent via-violet-300/25 to-transparent" />

        <h1 className="mt-12 text-5xl font-semibold tracking-tight sm:text-6xl">404</h1>
        <p className="mt-5 max-w-sm leading-8 text-slate-300">
          Nothing here. We couldn't find the page you were looking for.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm">
          {/* BASE_URL resolves to `/` in dev and `/tarot/` on Pages. */}
          <a
            href={import.meta.env.BASE_URL}
            className="text-violet-200/70 underline underline-offset-4 transition hover:text-violet-100"
          >
            &larr; Back to Tarot
          </a>
        </div>
      </div>
    </main>
  )
}

export default NotFound
