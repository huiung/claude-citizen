import { describe, expect, it } from 'vitest'
import { computeCitySites } from './citySites'
import { samplePlanetSurface } from './planetTextures'

const EARTH_SEED = 1274
const EARTH_RADIUS = 4300

describe('computeCitySites', () => {
  const sites = computeCitySites(EARTH_SEED, EARTH_RADIUS, 8)

  it('finds a healthy number of sites on the real Earth seed', () => {
    expect(sites.length).toBeGreaterThanOrEqual(6)
    expect(sites.length).toBeLessThanOrEqual(8)
  })

  it('is deterministic for the same seed', () => {
    const again = computeCitySites(EARTH_SEED, EARTH_RADIUS, 8)
    expect(again.length).toBe(sites.length)
    expect(again[0].direction.x).toBe(sites[0].direction.x)
    expect(again[again.length - 1].seed).toBe(sites[sites.length - 1].seed)
  })

  it('places every site on solid non-polar land', () => {
    for (const site of sites) {
      expect(Math.abs(site.direction.y)).toBeLessThanOrEqual(0.7)
      const s = samplePlanetSurface('earth', EARTH_SEED, site.direction.x, site.direction.y, site.direction.z, 0x3a72a8, EARTH_RADIUS)
      expect(s.height).toBeGreaterThanOrEqual(0.05)
    }
  })

  it('keeps sites apart (no two cities on top of each other)', () => {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        expect(sites[i].direction.angleTo(sites[j].direction)).toBeGreaterThan(0.2)
      }
    }
  })

  it('assigns descending tiers — first picks are the metropolises', () => {
    expect(sites[0].tier).toBe(2)
    expect(sites[sites.length - 1].tier).toBeLessThanOrEqual(sites[0].tier)
    for (const site of sites) expect([0, 1, 2]).toContain(site.tier)
  })
})
