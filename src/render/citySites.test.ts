import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { computeCitySites, pickSeparated } from './citySites'
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

  it('assigns tiers by pick order — metropolises first', () => {
    expect(sites.map((s) => s.tier)).toEqual([2, 2, 1, 1, 1, 0, 0, 0].slice(0, sites.length))
  })
})

describe('pickSeparated', () => {
  const clustered = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(1, 0.01, 0).normalize(), // ~0.01 rad from the first
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0.3, 0).normalize(), // ~0.29 rad — passes only the relaxed 0.21 gate
  ]
  it('greedy pass skips near-duplicates', () => {
    const picked = pickSeparated(clustered, 2, 0.35)
    expect(picked[0]).toBe(clustered[0])
    expect(picked[1]).toBe(clustered[2])
  })
  it('relaxation fills the remainder without re-adding picked entries', () => {
    const picked = pickSeparated(clustered, 3, 0.35)
    expect(picked.length).toBe(3)
    expect(picked[2]).toBe(clustered[3])
    expect(new Set(picked).size).toBe(3)
  })
})
