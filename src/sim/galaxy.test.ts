import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { COLONY_POS, REFINERY_POS } from '../render/world'
import { PVP_ARENA_CLEAR_RADIUS, PVP_ZONE_CENTER } from './pvp'
import {
  CELL_SIZE, type Celestial, EXCLUSION_RADIUS, isSolidCelestial, queryCelestials,
} from './galaxy'

describe('isSolidCelestial', () => {
  it('planets and moons are solid; small filler stays pass-through', () => {
    expect(isSolidCelestial('planet')).toBe(true)
    expect(isSolidCelestial('moon')).toBe(true)
    expect(isSolidCelestial('station')).toBe(false)
    expect(isSolidCelestial('derelict')).toBe(false)
    expect(isSolidCelestial('asteroid-cluster')).toBe(false)
  })
})

/** Stable key for set-comparing two body lists irrespective of order. */
function sig(bodies: Celestial[]): string[] {
  return bodies
    .map((b) => `${b.id}|${b.type}|${b.position.x},${b.position.y},${b.position.z}|${b.radius}|${b.seed}`)
    .sort()
}

describe('galaxy', () => {
  it('is deterministic — the same query yields identical bodies', () => {
    const center = new Vector3(140000, -52000, 88000)
    const a = queryCelestials(center, 30000)
    const b = queryCelestials(center.clone(), 30000)
    expect(a.length).toBeGreaterThan(0)
    expect(sig(a)).toEqual(sig(b))
  })

  it('is stable across overlapping queries — shared region matches exactly', () => {
    const c1 = new Vector3(200000, 0, 0)
    const c2 = new Vector3(220000, 0, 0) // shifted, large overlap
    const r = 60000
    const s1 = queryCelestials(c1, r)
    const s2 = queryCelestials(c2, r)

    // Any body within r of BOTH centers must appear identically in both results.
    const inBoth1 = s1.filter((b) => b.position.distanceTo(c2) <= r)
    const inBoth2 = s2.filter((b) => b.position.distanceTo(c1) <= r)
    expect(inBoth1.length).toBeGreaterThan(0)
    expect(sig(inBoth1)).toEqual(sig(inBoth2))
  })

  it('is stable across adjacent (non-overlapping) queries — no duplicate ids, bodies do not shift', () => {
    const left = new Vector3(-400000, 0, 0)
    const right = new Vector3(-400000 + CELL_SIZE * 4, 0, 0)
    const r = CELL_SIZE * 1.5 // radii sum < gap → spheres do not overlap
    const sl = queryCelestials(left, r)
    const sr = queryCelestials(right, r)
    const ids = new Set<string>()
    for (const b of [...sl, ...sr]) {
      expect(ids.has(b.id)).toBe(false) // every body has a unique cell-derived id
      ids.add(b.id)
    }
    // A wide query that subsumes both must re-report the same bodies, unmoved.
    const mid = new Vector3((left.x + right.x) / 2, 0, 0)
    const wide = queryCelestials(mid, CELL_SIZE * 4)
    const byId = new Map(wide.map((b) => [b.id, b]))
    for (const b of [...sl, ...sr]) {
      const w = byId.get(b.id)
      if (w) {
        expect(w.position.x).toBe(b.position.x)
        expect(w.position.y).toBe(b.position.y)
        expect(w.position.z).toBe(b.position.z)
        expect(w.radius).toBe(b.radius)
      }
    }
  })

  it('contains genuinely huge planets somewhere in the field', () => {
    let sawHuge = false
    let sawPlanet = false
    // Sweep a corridor of cells far from origin.
    for (let i = 0; i < 60 && !sawHuge; i++) {
      const center = new Vector3(i * CELL_SIZE * 2 + 100000, (i % 7) * CELL_SIZE, (i % 5) * CELL_SIZE)
      for (const b of queryCelestials(center, CELL_SIZE)) {
        if (b.type === 'planet') {
          sawPlanet = true
          expect(b.radius).toBeGreaterThanOrEqual(3000)
          expect(b.radius).toBeLessThanOrEqual(20000)
          if (b.radius >= 10000) sawHuge = true
        }
      }
    }
    expect(sawPlanet).toBe(true)
    expect(sawHuge).toBe(true)
  })

  it('suppresses bodies inside the exclusion zones (origin, refinery, colony)', () => {
    for (const anchor of [new Vector3(0, 0, 0), REFINERY_POS, COLONY_POS]) {
      const bodies = queryCelestials(anchor, EXCLUSION_RADIUS)
      for (const b of bodies) {
        // No body center may sit inside any exclusion radius.
        const dOrigin = b.position.length()
        const dRef = b.position.distanceTo(REFINERY_POS)
        const dCol = b.position.distanceTo(COLONY_POS)
        expect(dOrigin).toBeGreaterThan(EXCLUSION_RADIUS)
        expect(dRef).toBeGreaterThan(EXCLUSION_RADIUS)
        expect(dCol).toBeGreaterThan(EXCLUSION_RADIUS)
      }
    }
  })

  it('keeps the immediate spawn sphere completely empty', () => {
    expect(queryCelestials(new Vector3(0, 0, 0), EXCLUSION_RADIUS - 1000)).toEqual([])
  })

  it('keeps the PvP arena clear of procedural celestial bodies', () => {
    expect(PVP_ARENA_CLEAR_RADIUS).toBeGreaterThan(0)
    expect(queryCelestials(PVP_ZONE_CENTER, PVP_ARENA_CLEAR_RADIUS - 1000)).toEqual([])
  })

  it('is sparse — space feels vast, not cluttered', () => {
    // Count bodies across a big volume and check density per cell is well under 1.
    const r = CELL_SIZE * 5
    const center = new Vector3(1_000_000, 500_000, -750_000)
    const bodies = queryCelestials(center, r)
    // Cells touched by the bounding box of the query sphere.
    const span = Math.ceil((2 * r) / CELL_SIZE) + 1
    const cellsTouched = span * span * span
    const perCell = bodies.length / cellsTouched
    expect(perCell).toBeLessThan(1) // sparse
    expect(bodies.length).toBeGreaterThan(0) // but not empty
  })

  it('returns bodies within the requested radius only', () => {
    const center = new Vector3(333000, -120000, 47000)
    const r = 40000
    for (const b of queryCelestials(center, r)) {
      expect(b.position.distanceTo(center)).toBeLessThanOrEqual(r + 1e-6)
    }
  })
})
