import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { EXPECTED, TARGET } from '../src/test/world'
import { writeFixtures } from './fixtures'
import type { Fixtures } from './fixtures'

// The whole scan, in a real browser: pick a save, scan it, read the result.
// The save is synthetic (`src/test/world.ts`), so every count is known exactly.

let fx: Fixtures
test.beforeAll(() => {
  fx = writeFixtures()
})

type Dimension = keyof typeof EXPECTED
const LABEL: Record<Dimension, string> = { overworld: 'Overworld', nether: 'Nether', end: 'End' }

async function scan(
  page: Page,
  save: { kind: 'zip' | 'folder'; path: string },
  options: { block?: string; dimension?: Dimension } = {},
) {
  await page.goto('/')
  // Folder is the default; a zip needs the toggle.
  if (save.kind === 'zip') {
    await page.getByRole('group', { name: 'Save format' }).getByRole('button', { name: 'Zip file' }).click()
  }
  await page.locator('input[type=file]').setInputFiles(save.path)
  await page.getByLabel('Block type').fill(options.block ?? TARGET)
  await page
    .getByRole('radiogroup', { name: 'Dimension' })
    .getByRole('radio', { name: LABEL[options.dimension ?? 'overworld'] })
    // The radio is visually hidden under its block icon, which takes the click.
    .check({ force: true })
  await page.getByRole('button', { name: 'Scan world' }).click()
}

/** Wait for the result line and return its count. */
async function resultCount(page: Page): Promise<number> {
  // A zero count reads "Found no matching blocks for …".
  const line = page.getByText(/^Found (?:[\d,]+|no) matching blocks for/)
  await expect(line).toBeVisible({ timeout: 30_000 })
  const match = /Found ([\d,]+)/.exec((await line.textContent()) ?? '')
  return match ? Number(match[1].replaceAll(',', '')) : 0
}

/** The error panel's text, once it appears. */
const errorPanel = (page: Page) => page.locator('.text-red-100')

for (const dimension of Object.keys(EXPECTED) as Dimension[]) {
  test(`zip and folder agree in the ${dimension}`, async ({ page }) => {
    await scan(page, { kind: 'zip', path: fx.zip }, { dimension })
    const fromZip = await resultCount(page)
    await expect(page.getByText(`in the ${LABEL[dimension]}.`)).toBeVisible()

    await scan(page, { kind: 'folder', path: fx.folder }, { dimension })
    const fromFolder = await resultCount(page)

    expect(fromZip).toBe(EXPECTED[dimension].count)
    expect(fromFolder).toBe(fromZip)
  })
}

test('a zip without a root folder and with stored members scans the same', async ({ page }) => {
  await scan(page, { kind: 'zip', path: fx.flatZip })
  expect(await resultCount(page)).toBe(EXPECTED.overworld.count)
})

test('a bare block id is namespaced, and coordinates copy out exactly', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await scan(page, { kind: 'zip', path: fx.zip }, { block: 'nether_portal' })
  expect(await resultCount(page)).toBe(EXPECTED.overworld.count)
  await expect(page.getByText(TARGET, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Copy coordinates as JSON' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
  expect(copied).toHaveLength(EXPECTED.overworld.count)
  // Region files are scanned in sorted order, so the first match is fixed.
  expect(copied[0]).toEqual(EXPECTED.overworld.first)
})

test('the map draws once a scan finishes', async ({ page }) => {
  await scan(page, { kind: 'zip', path: fx.zip })
  await resultCount(page)
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box?.width).toBeGreaterThan(100)
})

test('scanning does no network I/O beyond loading the site', async ({ page }) => {
  const requests: string[] = []
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  page.on('request', (r) => requests.push(r.url()))
  // Re-run the flow on the already-loaded page.
  await page.getByRole('group', { name: 'Save format' }).getByRole('button', { name: 'Zip file' }).click()
  await page.locator('input[type=file]').setInputFiles(fx.zip)
  await page.getByRole('button', { name: 'Scan world' }).click()
  await resultCount(page)
  // Workers and the wasm module come from the same origin; nothing else may.
  const origin = new URL(page.url()).origin
  expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith('blob:'))).toEqual([])
})

test.describe('errors', () => {
  test('will not scan until a save is chosen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Choose a save to scan' })).toBeDisabled()
  })

  test('says so when the dimension has no region files', async ({ page }) => {
    await scan(page, { kind: 'zip', path: fx.emptyZip })
    await expect(errorPanel(page)).toContainText('No overworld region files found')
    await expect(page.getByRole('button', { name: 'Scan world' })).toBeEnabled()
  })

  test('rejects a file that is not a zip', async ({ page }) => {
    await scan(page, { kind: 'zip', path: fx.notZip })
    await expect(errorPanel(page)).toContainText('damaged or is not a zip')
  })

  test('refuses a folder holding two worlds instead of merging them', async ({ page }) => {
    await scan(page, { kind: 'folder', path: fx.savesFolder })
    await expect(errorPanel(page)).toContainText('holds 2 worlds')
    await expect(errorPanel(page)).toContainText('OtherWorld')
  })
})
