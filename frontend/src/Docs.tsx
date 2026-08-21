import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import docsMarkdown from './content/docs.md?raw'

// The docs are one long read, so the markdown maps onto a small fixed set of
// elements rather than a stylesheet: headings, paragraphs, lists, inline code,
// links. Anything beyond that doesn't appear in the source and doesn't need a
// style. Keep this map and `content/docs.md` in step.
const components: Components = {
  h2: ({ children }) => (
    <h2 className="mt-14 mb-5 text-xl font-semibold tracking-tight text-white first:mt-0 sm:text-2xl">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-10 mb-4 text-base font-semibold tracking-tight text-violet-100 sm:text-lg">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="my-5 leading-8 text-slate-300">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-5 grid gap-2 pl-5 text-slate-300 marker:text-violet-300/60 [&>li]:list-disc [&>li]:leading-8">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-5 grid gap-2 pl-5 text-slate-300 marker:text-violet-300/60 [&>li]:list-decimal [&>li]:leading-8">
      {children}
    </ol>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[0.85em] text-violet-100">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-violet-200 underline underline-offset-4 transition hover:text-violet-100"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-12 border-white/10" />,
}

export function Docs() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <div className="bg-blobs" aria-hidden="true">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
        <div className="blob blob-4" />
      </div>

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
            src={`${import.meta.env.BASE_URL}favicon.png`}
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

        <article className="mt-14 text-left text-sm sm:text-base">
          <Markdown components={components}>{docsMarkdown}</Markdown>
        </article>
      </div>
    </main>
  )
}

export default Docs
