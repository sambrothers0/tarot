import { defineConfig } from 'vitest/config'

// Unit tests. Deliberately not `vite.config.ts`: the units under test are plain
// TypeScript (zip reader, pool scheduler, map maths, API client), so the React
// Compiler, Tailwind and svgr plugins would only slow the run down. Browser
// behaviour — workers, wasm, the real UI — is covered by Playwright in `e2e/`.

// Fixed so date grouping ("Today", "Yesterday") is the same on every machine.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Every test file runs its own module graph, so env stubs never leak.
    isolate: true,
  },
})
