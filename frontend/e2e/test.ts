import { expect, test as base } from '@playwright/test'

// Every spec imports `test` from here, not from Playwright directly: it fails
// any test whose page reports a Content-Security-Policy violation, so the
// policy vite.config.ts stamps into the build cannot quietly break a feature.
export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ page }, use) => {
      const violations: string[] = []
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
      })
      await use()
      expect(violations, 'CSP violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
