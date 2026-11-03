import { expect, test } from './test'
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
  options: { block?: string; blocks?: string[]; dimension?: Dimension } = {},
) {
  await page.goto('/')
  // Folder is the default; a zip needs the toggle.
  if (save.kind === 'zip') {
    await page.getByRole('group', { name: 'Save format' }).getByRole('button', { name: 'Zip file' }).click()
  }
  await page.locator('input[type=file]').setInputFiles(save.path)
  // The form starts with the nether portal listed; replace it with what was asked.
  await page.getByRole('button', { name: 'Remove Nether Portal' }).click()
  const field = page.getByRole('combobox', { name: 'Block types' })
  for (const block of options.blocks ?? [options.block ?? TARGET]) {
    await field.fill(block)
    await field.press('Enter')
  }
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

// The canvas has a keyboard path for anyone not using a pointer (see
// `accessibility.md`): N steps to a column and says where it is, Enter copies it.
test('the map can be driven from the keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await scan(page, { kind: 'zip', path: fx.zip })
  await resultCount(page)
  const map = page.getByRole('application', { name: /^Map of 7 matches$/ })
  await map.focus()
  await page.keyboard.press('n')
  await expect(page.getByRole('status').filter({ hasText: /^Location 1 of \d+: X -?\d+, Z -?\d+/ })).toBeAttached()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: /^Copied -?\d+ -?\d+ -?\d+$/ })).toBeAttached()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^-?\d+ -?\d+ -?\d+$/)
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

// With no save of their own, a visitor can still run the whole flow: the
// sample world (`src/assets/sample-world.zip`) is selected until they pick one.
// It's a real superflat save with two nether portals in the overworld.
test.describe('sample world', () => {
  test('is selected when no save is picked, and scans', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('selected until you choose your own')).toBeVisible()
    await page.getByRole('button', { name: 'Scan the sample world' }).click()
    expect(await resultCount(page)).toBe(2)
    await expect(page.getByTitle('Sample world')).toBeVisible()
  })

  test('gives way to a picked save, and comes back when the format changes', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles(fx.folder)
    await expect(page.getByText('selected until you choose your own')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Scan world' })).toBeEnabled()

    await page.getByRole('group', { name: 'Save format' }).getByRole('button', { name: 'Zip file' }).click()
    await expect(page.getByRole('button', { name: 'Scan the sample world' })).toBeEnabled()
  })

  test('says it has no Nether without downloading anything', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const requests: string[] = []
    page.on('request', (r) => requests.push(r.url()))
    await page
      .getByRole('radiogroup', { name: 'Dimension' })
      .getByRole('radio', { name: 'Nether' })
      .check({ force: true })
    await page.getByRole('button', { name: 'Scan the sample world' }).click()
    await expect(errorPanel(page)).toContainText('The sample world has no Nether')
    expect(requests.filter((url) => url.includes('sample-world'))).toEqual([])
  })
})

test.describe('errors', () => {

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

// Several blocks at once (see "Several block types per scan" in CLAUDE.md). The
// synthetic overworld holds 7 portal blocks and stone in two sections: one
// uniform (4096) and one around a 4-tall portal column (4092).
const STONE = 4096 + 4092

test.describe('several block types', () => {
  test('are found in one pass, each counted, and copied keyed by block', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await scan(page, { kind: 'zip', path: fx.zip }, { blocks: ['nether_portal', 'Stone'] })
    const line = page.getByText(/^Found [\d,]+ matching blocks across 2 block types/)
    await expect(line).toBeVisible({ timeout: 30_000 })
    const portal = EXPECTED.overworld.count
    await expect(line).toContainText(`${(portal + STONE).toLocaleString('en-US')} matching`)

    await page.getByRole('button', { name: 'Copy coordinates as JSON' }).click()
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
    expect(Object.keys(copied)).toEqual([TARGET, 'minecraft:stone'])
    expect(copied[TARGET]).toHaveLength(portal)
    expect(copied[TARGET][0]).toEqual(EXPECTED.overworld.first)
    expect(copied['minecraft:stone']).toHaveLength(STONE)
  })

  test('each get a legend toggle that takes them off the map', async ({ page }) => {
    await scan(page, { kind: 'zip', path: fx.zip }, { blocks: ['nether_portal', 'stone'] })
    const legend = page.getByRole('group', { name: 'Block types on the map' })
    const stone = legend.getByRole('button', { name: /Stone/ })
    await expect(stone).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('application', { name: /across 2 block types$/ })).toBeVisible()

    await stone.click()
    await expect(stone).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('application', { name: /across 2 block types, 1 shown$/ })).toBeVisible()
    // The last block showing can't be hidden too.
    const portal = legend.getByRole('button', { name: /Nether Portal/ })
    await expect(portal).toHaveAttribute('aria-disabled', 'true')
    await expect(portal).toHaveAttribute('aria-pressed', 'true')

    await stone.click()
    await expect(page.getByRole('application', { name: /across 2 block types$/ })).toBeVisible()
  })

  test('refuses a duplicate and stops at six', async ({ page }) => {
    await page.goto('/')
    const field = page.getByRole('combobox', { name: 'Block types' })
    await field.fill('Nether Portal')
    await field.press('Enter')
    await expect(page.getByText('Nether Portal is already on the list.')).toBeVisible()
    for (const block of ['stone', 'dirt', 'obsidian', 'bedrock', 'glass']) {
      await field.fill(block)
      await field.press('Enter')
    }
    await expect(page.getByText('6 of 6')).toBeVisible()
    await expect(field).toBeHidden()
    await page.getByRole('button', { name: 'Remove Glass' }).click()
    await expect(page.getByRole('combobox', { name: 'Block types' })).toBeVisible()
  })
})
