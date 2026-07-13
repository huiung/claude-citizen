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

  it('keeps city footprints mostly on land (no metropolis in a bay)', () => {
    for (const site of sites) {
      const t1 = new THREE.Vector3(0, 1, 0).cross(site.direction).normalize()
      const t2 = site.direction.clone().cross(t1).normalize()
      let land = 0
      let total = 0
      const probe = new THREE.Vector3()
      for (const arc of [0.16, 0.3]) {
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2
          probe.copy(site.direction).addScaledVector(t1, Math.cos(ang) * arc).addScaledVector(t2, Math.sin(ang) * arc).normalize()
          const p = samplePlanetSurface('earth', EARTH_SEED, probe.x, probe.y, probe.z, undefined, EARTH_RADIUS)
          total++
          if (p.height >= 0.05) land++
        }
      }
      expect(land / total).toBeGreaterThanOrEqual(0.7)
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

describe('real-earth city sites', () => {
  it('returns the real megacity table once NASA rasters are ready', async () => {
    const { _setEarthRastersForTests, _resetEarthDataForTests, latLonToDir } = await import('./earthData')
    const { EARTH_CITIES } = await import('./citySites')
    // any ready raster switches the path — content is irrelevant for placement
    _setEarthRastersForTests(new Uint8ClampedArray(8), new Uint8ClampedArray(8).fill(255), 4, 2)
    try {
      const real = computeCitySites(EARTH_SEED, EARTH_RADIUS, 8)
      expect(real.length).toBe(EARTH_CITIES.length)
      expect(EARTH_CITIES.length).toBeGreaterThanOrEqual(16)
      const seoul = latLonToDir(EARTH_CITIES[0].lat, EARTH_CITIES[0].lon)
      expect(EARTH_CITIES[0].name).toBe('Seoul')
      expect(real[0].direction.distanceTo(seoul)).toBeLessThan(1e-9)
      expect(real[0].direction.length()).toBeCloseTo(1, 9)
      expect(real.filter((s) => s.tier === 2).length).toBe(4)
      // deterministic per-site seeds, same formula as procedural sites
      expect(real[3].seed).toBe((EARTH_SEED * 31 + 3 * 101) | 0)
    } finally {
      _resetEarthDataForTests()
    }
  })

  it('real-earth sites carry the megacity name (visit-collection key)', async () => {
    const { _setEarthRastersForTests, _resetEarthDataForTests } = await import('./earthData')
    _setEarthRastersForTests(new Uint8ClampedArray(8), new Uint8ClampedArray(8).fill(255), 4, 2)
    try {
      const real = computeCitySites(EARTH_SEED, EARTH_RADIUS, 8)
      expect(real.find((s) => s.name === 'Seoul')).toBeDefined()
      expect(real.filter((s) => s.name).length).toBe(real.length)
    } finally {
      _resetEarthDataForTests()
    }
  })

  it('procedural sites carry no name — landing collection is real-Earth only', () => {
    const procedural = computeCitySites(EARTH_SEED, EARTH_RADIUS, 8)
    expect(procedural.every((s) => s.name === undefined)).toBe(true)
  })
})
