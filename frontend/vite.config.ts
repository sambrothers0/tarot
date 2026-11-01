import type { IncomingMessage } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import babel from '@rolldown/plugin-babel'
import svgr from 'vite-plugin-svgr'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** The pathname a request is asking for, minus query/hash and percent-escapes. */
function requestPath(url: string): string {
  const raw = url.split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The file a page request resolves to, mirroring how a static host looks one up. */
function resolvePage(dirs: readonly string[], urlPath: string): string | null {
  const rel = urlPath.replace(/^\/+/, '')
  const candidates = urlPath.endsWith('/')
    ? [`${rel}index.html`]
    : [rel, `${rel}.html`, `${rel}/index.html`]
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const file = path.join(dir, candidate)
      if (isFile(file)) return file
    }
  }
  return null
}

/** True for a navigation to a path no file backs — what should get the 404 page. */
function isMissingPage(req: IncomingMessage, dirs: readonly string[], base: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const wantsDocument =
    req.headers['sec-fetch-dest'] === 'document' ||
    (req.headers.accept ?? '').includes('text/html')
  if (!wantsDocument) return false
  let urlPath = requestPath(req.url ?? '/')
  // Requests still carry the base here, and anything outside it is Vite's to
  // answer. `base` is normalised to leading and trailing slashes.
  if (base !== '/') {
    if (!urlPath.startsWith(base)) return false
    urlPath = urlPath.slice(base.length - 1)
  }
  // Vite's own dev endpoints (/@vite/client, /@fs/…) are never pages.
  if (urlPath.startsWith('/@')) return false
  return resolvePage(dirs, urlPath) === null
}

/**
 * Serve `404.html` for unknown paths locally, the way the deployed site does.
 *
 * GitHub Pages answers a request it has no file for with `404.html`, but Vite's
 * dev and preview servers fall back to `index.html`, so a bogus slug rendered
 * the app under a URL that doesn't exist. This closes that gap — a miss gets
 * the 404 page and a 404 status in dev, preview and production alike.
 */
function notFoundFallback(): Plugin {
  return {
    name: 'tarot:not-found-fallback',
    configureServer(server) {
      // Added from the hook body, so it runs ahead of Vite's SPA fallback.
      const dirs = [projectRoot, server.config.publicDir].filter(Boolean)
      const source = path.join(projectRoot, '404.html')
      server.middlewares.use((req, res, next) => {
        if (!isMissingPage(req, dirs, server.config.base)) return next()
        server
          .transformIndexHtml('/404.html', readFileSync(source, 'utf8'), req.originalUrl)
          .then((html) => {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
          }, next)
      })
    },
    configurePreviewServer(server) {
      const outDir = path.resolve(projectRoot, server.config.build.outDir)
      const built = path.join(outDir, '404.html')
      server.middlewares.use((req, res, next) => {
        if (!isFile(built) || !isMissingPage(req, [outDir], server.config.base)) return next()
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/html')
        res.end(readFileSync(built, 'utf8'))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served from a subpath on GitHub Pages (https://<user>.github.io/tarot/).
  // CI sets VITE_BASE=/tarot/; local dev/build defaults to root.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    tailwindcss(),
    react(),
    // `?react` imports turn src/assets/*.svg into components that inherit
    // currentColor and take a className.
    svgr(),
    babel({ presets: [reactCompilerPreset()] }),
    // Unknown paths get 404.html locally too, matching GitHub Pages.
    notFoundFallback()
  ],
  build: {
    rollupOptions: {
      // Static entry points, not a client-side router: `docs/index.html`
      // builds to `dist/docs/index.html`, so /docs is a real page that Pages
      // can serve on a cold load; `scans/index.html` likewise. `404.html` builds to the site root, which is
      // where Pages looks for the page it serves on an unknown path.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs/index.html', import.meta.url)),
        scans: fileURLToPath(new URL('./scans/index.html', import.meta.url)),
        // Linked from Google's OAuth consent screen, so they need stable URLs.
        privacy: fileURLToPath(new URL('./privacy/index.html', import.meta.url)),
        terms: fileURLToPath(new URL('./terms/index.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
      },
    },
  },
})
