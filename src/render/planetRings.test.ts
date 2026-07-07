import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { computeRingBands, createRingTexture, remapRingUVs } from './planetRings'

describe('computeRingBands', () => {
  it('produces a full-width RGBA row with alpha fading to zero at both edges', () => {
    const row = computeRingBands(512, 7)
    expect(row.length).toBe(512 * 4)
    expect(row[3]).toBe(0)
    expect(row[511 * 4 + 3]).toBe(0)
  })

  it('contains both bright bands and dark gaps (not a flat wash)', () => {
    const row = computeRingBands(512, 7)
    const alphas = Array.from({ length: 512 }, (_, i) => row[i * 4 + 3])
    expect(Math.max(...alphas)).toBeGreaterThan(150)
    expect(Math.min(...alphas.slice(40, 472))).toBeLessThan(80)
  })
})

describe('createRingTexture', () => {
  it('creates a linear-filtered sRGB strip texture (DataTexture defaults to Nearest, which bands)', () => {
    const tex = createRingTexture(512, 7)
    expect(tex.magFilter).toBe(THREE.LinearFilter)
    expect(tex.minFilter).toBe(THREE.LinearFilter)
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(tex.image.width).toBe(512)
  })
})

describe('remapRingUVs', () => {
  it('rewrites u as normalized radial distance inner→outer', () => {
    const geo = new THREE.RingGeometry(10, 20, 8)
    remapRingUVs(geo, 10, 20)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i))
      expect(uv.getX(i)).toBeCloseTo((r - 10) / 10, 5)
    }
  })
})
