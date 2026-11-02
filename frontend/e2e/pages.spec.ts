import { expect, test } from './test'

// Every static entry point builds, loads, renders, and logs no errors. The
// legal pages' URLs are linked from Google's OAuth consent screen, so their
// paths are pinned here too.

const PAGES = [
  { path: '/', title: 'Tarot - Home', text: 'Instantly plot any block type' },
  { path: '/docs/', title: /Docs/, text: 'What is Tarot' },
  { path: '/privacy/', title: /Privacy/, text: 'Last updated' },
  { path: '/terms/', title: /Terms/, text: 'Last updated' },
  // Built without VITE_API_URL, so accounts are off and the page says so.
  { path: '/scans/', title: /Tarot/, text: "Readings aren't available here" },
]

for (const { path, title, text } of PAGES) {
  test(`${path} renders without errors`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(title)
    await expect(page.getByText(text).first()).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('an unknown path gets the 404 page with a 404 status', async ({ page }) => {
  const response = await page.goto('/no/such/page')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})

test('with accounts off there is no sign-in UI', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0)
})
