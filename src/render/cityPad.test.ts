import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, computeCityLayout } from './cityChunk'
import { computePadLot, computePadMarkingPixels, computePadWorld, PAD_RADIUS } from './cityPad'

describe('computePadLot', () => {
  it('is deterministic', () => {
    expect(computePadLot(1234, 2)).toEqual(computePadLot(1234, 2))
  })

  it('picks a cell no building occupies', () => {
    const lot = computePadLot(1234, 2)
    const cell = CITY_BLOCK + CITY_ROAD
    const extent = CITY_TIER_RADIUS[2]
    const lotGx = Math.floor((lot.x + extent) / cell)
    const lotGz = Math.floor((lot.z + extent) / cell)
    for (const b of computeCityLayout(1234, 2)) {
      const same = Math.floor((b.x + extent) / cell) === lotGx && Math.floor((b.z + extent) / cell) === lotGz
      expect(same).toBe(false)
    }
  })

  it('stays clear of the skirt edge', () => {
    const lot = computePadLot(99, 0)
    expect(Math.hypot(lot.x, lot.z)).toBeLessThan(CITY_TIER_RADIUS[0] - PAD_RADIUS)
  })

  it('skips blocked candidates deterministically', () => {
    const free = computePadLot(1234, 2)
    const isBlocked = (x: number, z: number) => x === free.x && z === free.z
    const blocked = computePadLot(1234, 2, isBlocked)
    expect(blocked).not.toEqual(free)
    expect(computePadLot(1234, 2, isBlocked)).toEqual(blocked)
  })

  it('falls back to the nearest free cell when everything is blocked', () => {
    const free = computePadLot(1234, 2)
    expect(computePadLot(1234, 2, () => true)).toEqual(free)
  })
})

describe('computePadWorld', () => {
  const planetPos = new THREE.Vector3(10, -20, 30)
  const site = { direction: new THREE.Vector3(1, 0.2, 0.3).normalize(), tier: 2 as const, seed: 777 }

  it('is deterministic and puts the deck top in the lifted-fabric altitude band', () => {
    const a = computePadWorld(site, planetPos, 1274, 4300)
    const b = computePadWorld(site, planetPos, 1274, 4300)
    expect(a.center.distanceTo(b.center)).toBe(0) // beam and chunk must agree exactly
    expect(a.normal.length()).toBeCloseTo(1, 9)
    const r = a.center.distanceTo(planetPos)
    expect(r).toBeGreaterThan(4300) // above the sphere (SHEET_LIFT + deck)
    expect(r).toBeLessThan(4300 * 1.05) // but still near the surface
  })
})

describe('computePadMarkingPixels', () => {
  it('draws a landing ring: lit at the ring radius and centre dot, dark between', () => {
    const size = 64
    const px = computePadMarkingPixels(size)
    const at = (x: number, y: number) => px[(y * size + x) * 4]
    const c = Math.floor((size - 1) / 2)
    expect(at(c, c)).toBeGreaterThan(200) // centre dot
    expect(at(c + Math.round(c * 0.68), c)).toBeGreaterThan(200) // ring band
    expect(at(c + Math.round(c * 0.4), c)).toBe(0) // between: dark deck
  })
})
