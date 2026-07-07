import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MILKY_WAY_NORMAL, buildStarSky, computeStarAttributes, setStarSkyScale, starTemperatureColor } from './starSky'

describe('starTemperatureColor', () => {
  it('is warm (r>g>b) at t=0 and blue-leaning (b>r) at t=1', () => {
    const cool = starTemperatureColor(0)
    expect(cool.r).toBeGreaterThan(cool.g)
    expect(cool.g).toBeGreaterThan(cool.b)
    const hot = starTemperatureColor(1)
    expect(hot.b).toBeGreaterThan(hot.r)
  })

  it('passes near-white around the midpoint and clamps out-of-range t', () => {
    const mid = starTemperatureColor(0.55)
    expect(Math.min(mid.r, mid.g, mid.b)).toBeGreaterThan(0.9)
    expect(starTemperatureColor(-1)).toEqual(starTemperatureColor(0))
    expect(starTemperatureColor(2)).toEqual(starTemperatureColor(1))
  })
})

describe('computeStarAttributes', () => {
  const attrs = computeStarAttributes(18000, 42)

  it('produces position/color/size arrays for every star', () => {
    expect(attrs.positions.length).toBe(18000 * 3)
    expect(attrs.colors.length).toBe(18000 * 3)
    expect(attrs.sizes.length).toBe(18000)
  })

  it('is deterministic for the same seed', () => {
    const again = computeStarAttributes(18000, 42)
    expect(again.positions[0]).toBe(attrs.positions[0])
    expect(again.sizes[17999]).toBe(attrs.sizes[17999])
  })

  it('concentrates stars toward the galactic plane (mean |dot| below uniform 0.5)', () => {
    let sum = 0
    for (let i = 0; i < 18000; i++) {
      const x = attrs.positions[i * 3], y = attrs.positions[i * 3 + 1], z = attrs.positions[i * 3 + 2]
      const len = Math.hypot(x, y, z)
      sum += Math.abs((x * MILKY_WAY_NORMAL.x + y * MILKY_WAY_NORMAL.y + z * MILKY_WAY_NORMAL.z) / len)
    }
    expect(sum / 18000).toBeLessThan(0.42)
  })

  it('follows a magnitude power law — few big stars, many small', () => {
    const sorted = Array.from(attrs.sizes).sort((a, b) => a - b)
    const median = sorted[9000]
    const p99 = sorted[Math.floor(18000 * 0.99)]
    expect(median).toBeLessThan(14)
    expect(p99).toBeGreaterThan(median * 3)
  })

  it('keeps every color channel in [0, 1]', () => {
    for (let i = 0; i < attrs.colors.length; i++) {
      expect(attrs.colors[i]).toBeGreaterThanOrEqual(0)
      expect(attrs.colors[i]).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildStarSky', () => {
  it('builds one Points object carrying per-star position/color/size attributes', () => {
    const points = buildStarSky(1000, 7)
    expect(points).toBeInstanceOf(THREE.Points)
    const geo = points.geometry as THREE.BufferGeometry
    expect(geo.getAttribute('position').count).toBe(1000)
    expect(geo.getAttribute('color').count).toBe(1000)
    expect(geo.getAttribute('aSize').count).toBe(1000)
    const mat = points.material as THREE.ShaderMaterial
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.blending).toBe(THREE.AdditiveBlending)
    expect(mat.vertexColors).toBe(true)
    expect(mat.uniforms.uScale.value).toBe(900)
  })

  it('setStarSkyScale keys point attenuation to half the drawing-buffer height (DPR-aware)', () => {
    const points = buildStarSky(10, 1)
    setStarSkyScale(points, 2100) // e.g. 1050px CSS height at dpr 2
    expect((points.material as THREE.ShaderMaterial).uniforms.uScale.value).toBe(1050)
  })
})
