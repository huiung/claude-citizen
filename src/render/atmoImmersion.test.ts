import { describe, expect, it } from 'vitest'
import { computeAtmoFog, computeCelestialHide, computeCloudFogBoost } from './atmoImmersion'

describe('computeCelestialHide', () => {
  it('hides above the upper threshold, shows below the lower one', () => {
    expect(computeCelestialHide(0.5, false)).toBe(true)
    expect(computeCelestialHide(0.1, true)).toBe(false)
  })

  it('holds the previous state inside the hysteresis band', () => {
    expect(computeCelestialHide(0.3, true)).toBe(true)
    expect(computeCelestialHide(0.3, false)).toBe(false)
  })
})

describe('computeAtmoFog', () => {
  it('is null outside the atmosphere', () => {
    expect(computeAtmoFog(0, 1)).toBeNull()
    expect(computeAtmoFog(-0.2, 1)).toBeNull()
  })

  it('thickens monotonically with depth into the shell', () => {
    const high = computeAtmoFog(0.2, 1)!
    const low = computeAtmoFog(0.9, 1)!
    expect(low.near).toBeLessThan(high.near)
    expect(low.far).toBeLessThan(high.far)
    expect(low.near).toBeGreaterThan(0)
    expect(low.near).toBeLessThan(low.far)
  })

  it('exists on the night side too, but dark', () => {
    const night = computeAtmoFog(0.8, -1)!
    const day = computeAtmoFog(0.8, 1)!
    expect(night.far).toBe(day.far) // density is altitude-driven, not sun-driven
    const lum = (c: [number, number, number]) => c[0] + c[1] + c[2]
    expect(lum(night.color)).toBeLessThan(lum(day.color) * 0.25)
  })
})

describe('computeCloudFogBoost', () => {
  const SHELL = 4300 * 0.018 // cloud shell altitude above the sphere surface

  it('peaks at the cloud shell altitude and scales with cover', () => {
    expect(computeCloudFogBoost(SHELL, 1)).toBeCloseTo(1, 5)
    expect(computeCloudFogBoost(SHELL, 0.4)).toBeCloseTo(0.4, 5)
    expect(computeCloudFogBoost(SHELL, 0)).toBe(0)
  })

  it('falls off to ~0 outside the crossing band', () => {
    expect(computeCloudFogBoost(SHELL + 200, 1)).toBeLessThan(0.05)
    expect(computeCloudFogBoost(SHELL - 200, 1)).toBeLessThan(0.05)
    expect(computeCloudFogBoost(SHELL + 40, 1)).toBeGreaterThan(0.4)
  })
})
