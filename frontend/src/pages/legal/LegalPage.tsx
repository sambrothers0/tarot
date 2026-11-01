import { AmbientBackground } from '../../components/layout/AmbientBackground'
import { Prose } from '../../components/layout/Prose'

/**
 * The privacy policy and terms of service. Both are linked from Google's OAuth
 * consent screen, so each must be a real page at a stable public URL — hence
 * static entry points (`privacy/index.html`, `terms/index.html`), like docs.
 */
export function LegalPage({ title, markdown }: { title: string; markdown: string }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06040d] text-white">
      <AmbientBackground />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-6 pt-14 pb-24 sm:pt-20">
        <a
          href={import.meta.env.BASE_URL}
          className="text-sm text-violet-200/70 underline underline-offset-4 transition hover:text-violet-100"
        >
          &larr; Back to Tarot
        </a>

        <header className="mt-10">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        </header>

        <div className="mt-10 h-px w-full bg-gradient-to-r from-transparent via-violet-300/25 to-transparent" />

        <Prose markdown={markdown} />
      </div>
    </main>
  )
}
