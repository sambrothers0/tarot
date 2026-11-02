import { describe, expect, it } from 'vitest'
import { parseRegionPath } from './regionPath'

// Invariant 2: this is the single source of truth for which files are region
// files and which dimension they belong to.

describe('parseRegionPath', () => {
  it.each([
    ['world/region/r.0.0.mca', 'overworld', 'world'],
    ['world/region/r.-1.12.mca', 'overworld', 'world'],
    ['world/region/c.3.17.mcc', 'overworld', 'world'],
    ['world/DIM-1/region/r.0.0.mca', 'nether', 'world'],
    ['world/DIM1/region/r.0.0.mca', 'end', 'world'],
    // A zip of the world's *contents* has no root folder at all.
    ['region/r.0.0.mca', 'overworld', ''],
    ['DIM-1/region/r.0.0.mca', 'nether', ''],
    ['DIM1/region/r.0.0.mca', 'end', ''],
    // Deeper nesting: a zip of `saves/`, or a folder pick a level up.
    ['saves/My World/region/r.0.0.mca', 'overworld', 'saves/My World'],
    ['saves/My World/DIM-1/region/r.0.0.mca', 'nether', 'saves/My World'],
    // Modded/datapack dimensions live under dimensions/<ns>/<name>/region and
    // count as "anything else" — the overworld bucket, with their own world key.
    [
      'world/dimensions/mymod/sky/region/r.0.0.mca',
      'overworld',
      'world/dimensions/mymod/sky',
    ],
    // Doubled or leading slashes are tolerated.
    ['/world//region/r.0.0.mca', 'overworld', 'world'],
  ])('%s → %s in %j', (path, dimension, world) => {
    expect(parseRegionPath(path)).toEqual({ dimension, world })
  })

  it.each([
    'world/level.dat',
    'world/region',
    'world/region/',
    'world/region/r.0.0.mca.bak',
    'world/region/r.0.0.MCA',
    'world/entities/r.0.0.mca',
    'world/poi/r.0.0.mca',
    'world/DIM-1/entities/r.0.0.mca',
    'r.0.0.mca',
    'world/regions/r.0.0.mca',
    '',
  ])('%j is not a region file', (path) => {
    expect(parseRegionPath(path)).toBeNull()
  })

  it('gives two worlds in one selection different world keys', () => {
    const a = parseRegionPath('saves/A/region/r.0.0.mca')
    const b = parseRegionPath('saves/B/region/r.0.0.mca')
    expect(a?.world).not.toBe(b?.world)
    // …while every dimension of one world shares a key.
    const nether = parseRegionPath('saves/A/DIM-1/region/r.0.0.mca')
    const end = parseRegionPath('saves/A/DIM1/region/r.0.0.mca')
    expect(new Set([a?.world, nether?.world, end?.world]).size).toBe(1)
  })
})
