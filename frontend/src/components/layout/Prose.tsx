import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'

// Long-form pages (docs, privacy, terms) are markdown mapped onto a small
// fixed set of elements rather than a stylesheet: headings, paragraphs, lists,
// inline code, links. Anything beyond that doesn't appear in the sources and
// doesn't need a style. Keep this map and `content/*.md` in step.
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
    <ul className="my-5 grid gap-2 pl-5 text-slate-300 marker:text-violet-300/80 [&>li]:list-disc [&>li]:leading-8">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-5 grid gap-2 pl-5 text-slate-300 marker:text-violet-300/80 [&>li]:list-decimal [&>li]:leading-8">
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

export function Prose({ markdown }: { markdown: string }) {
  return (
    <article className="mt-14 text-left text-sm sm:text-base">
      <Markdown components={components}>{markdown}</Markdown>
    </article>
  )
}
