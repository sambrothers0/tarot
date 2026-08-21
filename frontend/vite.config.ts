import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import babel from '@rolldown/plugin-babel'
import svgr from 'vite-plugin-svgr'

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
    babel({ presets: [reactCompilerPreset()] })
  ],
  build: {
    rollupOptions: {
      // Two static entry points, not a client-side router: `docs/index.html`
      // builds to `dist/docs/index.html`, so /docs is a real page that Pages
      // can serve on a cold load.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs/index.html', import.meta.url)),
      },
    },
  },
})
