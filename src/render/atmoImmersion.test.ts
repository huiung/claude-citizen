import { describe, expect, it } from 'vitest'
import { computeAtmoFog, computeCelestialHide, computeCloudFogBoost, patchEarthGroundDetail } from './atmoImmersion'

describe('computeCelestialHide', () => {
  it('hides above the day-washout threshold, shows below the lower one', () => {
    expect(computeCelestialHide(0.5, 0, false)).toBe(true)
    expect(computeCelestialHide(0.1, 0, true)).toBe(false)
  })

  it('holds the previous state inside the washout hysteresis band', () => {
    expect(computeCelestialHide(0.3, 0, true)).toBe(true)
    expect(computeCelestialHide(0.3, 0, false)).toBe(false)
  })

  it('hides deep in the atmosphere even at night — real planets are points, ours are discs', () => {
    expect(computeCelestialHide(0, 0.9, false)).toBe(true) // night surface
    expect(computeCelestialHide(0, 0.2, true)).toBe(false) // night near-space: planets back
  })

  it('holds the previous state inside the depth hysteresis band', () => {
    expect(computeCelestialHide(0, 0.45, true)).toBe(true)
    expect(computeCelestialHide(0, 0.45, false)).toBe(false)
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
  const RADIUS = 4300
  const SHELL = RADIUS * 0.018 // cloud shell altitude above the sphere surface

  it('peaks at the cloud shell altitude and scales with cover', () => {
    expect(computeCloudFogBoost(SHELL, 1, RADIUS)).toBeCloseTo(1, 5)
    expect(computeCloudFogBoost(SHELL, 0.4, RADIUS)).toBeCloseTo(0.4, 5)
    expect(computeCloudFogBoost(SHELL, 0, RADIUS)).toBe(0)
  })

  it('falls off to ~0 outside the crossing band', () => {
    expect(computeCloudFogBoost(SHELL + 200, 1, RADIUS)).toBeLessThan(0.05)
    expect(computeCloudFogBoost(SHELL - 200, 1, RADIUS)).toBeLessThan(0.05)
    expect(computeCloudFogBoost(SHELL + 40, 1, RADIUS)).toBeGreaterThan(0.4)
  })

  it('tracks the shell to the planet radius', () => {
    expect(computeCloudFogBoost(9000 * 0.018, 1, 9000)).toBeCloseTo(1, 5)
  })
})

describe('patchEarthGroundDetail', () => {
  it('injects distance-gated detail noise right after the map sample', () => {
    const shader = { fragmentShader: 'head\n#include <map_fragment>\ntail' }
    patchEarthGroundDetail(shader)
    const src = shader.fragmentShader
    expect(src).toContain('#include <map_fragment>') // original sample kept
    expect(src).toContain('1.0 - smoothstep(400.0, 6000.0, gdDist)') // low-to-high edges: reversed edges are undefined GLSL (ANGLE returns 0)
    expect(src.indexOf('diffuseColor.rgb')).toBeGreaterThan(src.indexOf('#include <map_fragment>'))
    expect(src.indexOf('tail')).toBeGreaterThan(src.indexOf('diffuseColor.rgb')) // injected before the rest
  })

  it('leaves a shader without a map sample untouched', () => {
    const shader = { fragmentShader: 'no anchor here' }
    patchEarthGroundDetail(shader)
    expect(shader.fragmentShader).toBe('no anchor here')
  })
})
