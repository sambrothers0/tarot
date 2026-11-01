import { AmbientBackground } from '../../components/layout/AmbientBackground'
import { Prose } from '../../components/layout/Prose'
import docsMarkdown from '../../content/docs.md?raw'

export function Docs() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <AmbientBackground />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-6 pt-14 pb-24 sm:pt-20">
        {/* The app links here in the same tab, so the way back has to be on the
            page. BASE_URL resolves to `/` in dev and `/tarot/` on Pages. */}
        <a
          href={import.meta.env.BASE_URL}
          className="text-sm text-violet-200/70 underline underline-offset-4 transition hover:text-violet-100"
        >
          &larr; Back to Tarot
        </a>

        <header className="mt-10 flex flex-col items-center text-center">
          {/* Lives in public/ rather than the bundle so it can double as the
              favicon; BASE_URL keeps it correct under the /tarot/ subpath. */}
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            className="h-16 w-16 [image-rendering:pixelated]"
          />
          <p className="mt-8 -mr-[0.4em] inline-block text-3xl uppercase tracking-[0.4em] text-violet-200/70 sm:-mr-[0.7em] sm:text-4xl sm:tracking-[0.7em]">
            TAROT
          </p>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            How it works
          </h1>
        </header>

        <div className="mt-14 h-px w-full bg-gradient-to-r from-transparent via-violet-300/25 to-transparent" />

        <Prose markdown={docsMarkdown} />
      </div>
    </main>
  )
}

export default Docs
