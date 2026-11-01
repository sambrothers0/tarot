// Regenerates src/content/blocks.json: every block ID in the game, paired with
// its English display name, for the block-type autocomplete.
//
// The data comes from misode/mcmeta, which publishes Mojang's own registry and
// lang files per version — so the IDs are the in-game IDs by construction and
// no name mapping is involved. Run by hand when a new version ships; the output
// is committed, so neither the build nor the browser ever fetches it.
//
//   npm run update:blocks            latest stable release
//   npm run update:blocks -- 1.21.4  a specific version

import { writeFile } from 'node:fs/promises'

const RAW = 'https://raw.githubusercontent.com/misode/mcmeta'
const OUT = new URL('../src/content/blocks.json', import.meta.url)

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

async function latestRelease() {
  const versions = await getJson(`${RAW}/summary/versions/data.min.json`)
  const release = versions.find((v) => v.type === 'release')
  if (!release) throw new Error('No release found in the mcmeta version list')
  return release.id
}

// Wall-mounted variants (`black_wall_banner`, …) have no lang entry of their
// own; title-casing the ID reads fine for those.
const titleCase = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')

const version = process.argv[2] ?? (await latestRelease())
const [registries, lang] = await Promise.all([
  getJson(`${RAW}/${version}-summary/registries/data.min.json`),
  getJson(`${RAW}/${version}-assets/assets/minecraft/lang/en_us.json`),
])

const ids = registries.block
if (!Array.isArray(ids) || ids.length === 0) throw new Error('Registry has no blocks')

const blocks = ids.map((id) => [id, lang[`block.minecraft.${id}`] ?? titleCase(id)])
await writeFile(OUT, JSON.stringify({ version, blocks }) + '\n')
console.log(`Wrote ${blocks.length} blocks from ${version}`)
