import CoffeeIcon from '../../assets/icons/coffee.svg?react'
import GithubIcon from '../../assets/icons/github.svg?react'

export function SiteFooter() {
  return (
    <footer className="relative z-10 pb-16">
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-400 sm:text-base">
        Created by{' '}
        <a
          href="https://sambrothers0.github.io"
          className="text-violet-200 underline underline-offset-4 transition hover:text-violet-100"
          target="_blank"
          rel="noreferrer"
        >
          Sam Brothers
        </a>
      </p>

      <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-slate-400 sm:text-base">
        {/* The docs are a static entry point of their own, not a route, so this is a
            plain same-tab navigation. BASE_URL keeps it right in dev (`/`) and
            under the Pages subpath (`/tarot/`). */}
        <a
          href={`${import.meta.env.BASE_URL}docs/`}
          className="underline underline-offset-4 transition hover:text-slate-200"
        >
          How it works
        </a>
        <span className="mx-3 text-slate-600" aria-hidden="true">&middot;</span>
        <a
          href={`${import.meta.env.BASE_URL}privacy/`}
          className="underline underline-offset-4 transition hover:text-slate-200"
        >
          Privacy
        </a>
        <span className="mx-3 text-slate-600" aria-hidden="true">&middot;</span>
        <a
          href={`${import.meta.env.BASE_URL}terms/`}
          className="underline underline-offset-4 transition hover:text-slate-200"
        >
          Terms
        </a>
      </p>

      <div className="mx-auto mt-6 flex items-center justify-center gap-3">
        <a
          href="https://github.com/sambrothers0/tarot"
          className="rounded-full p-1.5 text-violet-200/70 transition hover:bg-white/10 hover:text-violet-100"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
        >
          <GithubIcon className="h-4 w-4" aria-hidden="true" />
        </a>
        <div className="h-4 w-px bg-violet-300/20" />
        <a
          href="https://buymeacoffee.com/sambrothers"
          className="rounded-full p-1.5 text-violet-200/70 transition hover:bg-white/10 hover:text-violet-100"
          target="_blank"
          rel="noreferrer"
          aria-label="Buy me a coffee"
        >
          <CoffeeIcon className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-slate-400">
        Tarot is pronounced "TARE-oh"
      </p>
    </footer>
  )
}
