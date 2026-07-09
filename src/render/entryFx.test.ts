import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildEntryPlasma, computeEntryHeat } from './entryFx'

describe('computeEntryHeat', () => {
  it('is 0 outside the atmosphere, at slow speed, and in level flight', () => {
    expect(computeEntryHeat(0, 1.2, 1)).toBe(0) // vacuum
    expect(computeEntryHeat(0.8, 0.3, 1)).toBe(0) // too slow — cruising down is uneventful
    expect(computeEntryHeat(0.8, 1.2, 0)).toBe(0) // level flight — no descent
  })

  it('peaks on a full-speed dive deep in the atmosphere', () => {
    expect(computeEntryHeat(1, 1.4, 1)).toBeGreaterThanOrEqual(0.9)
    expect(computeEntryHeat(1, 1.4, 1)).toBeLessThanOrEqual(1)
  })

  it('grows monotonically with density, speed, and descent', () => {
    expect(computeEntryHeat(0.4, 1, 1)).toBeLessThan(computeEntryHeat(0.8, 1, 1))
    expect(computeEntryHeat(0.8, 0.7, 1)).toBeLessThan(computeEntryHeat(0.8, 1.1, 1))
    expect(computeEntryHeat(0.8, 1, 0.3)).toBeLessThan(computeEntryHeat(0.8, 1, 0.9))
  })

  it('clamps out-of-range inputs', () => {
    expect(computeEntryHeat(2, 5, 2)).toBeLessThanOrEqual(1)
    expect(computeEntryHeat(-1, -1, -1)).toBe(0)
  })
})

describe('buildEntryPlasma', () => {
  it('builds an additive shell with heat/color/time uniforms, hidden while cold', () => {
    const plasma = buildEntryPlasma()
    expect(plasma.mesh).toBeInstanceOf(THREE.Mesh)
    const mat = plasma.mesh.material as THREE.ShaderMaterial
    expect(mat.blending).toBe(THREE.AdditiveBlending)
    expect(mat.depthWrite).toBe(false)
    expect(mat.transparent).toBe(true)
    expect(mat.uniforms.uHeat.value).toBe(0)
    expect(plasma.mesh.visible).toBe(false)
  })

  it('update() drives heat/color/time and toggles visibility around the cold threshold', () => {
    const plasma = buildEntryPlasma()
    const mat = plasma.mesh.material as THREE.ShaderMaterial
    plasma.update(0.7, 0xff9a55, 1.5)
    expect(mat.uniforms.uHeat.value).toBeCloseTo(0.7)
    expect(mat.uniforms.uTime.value).toBeCloseTo(1.5)
    expect((mat.uniforms.uColor.value as THREE.Color).getHex()).toBe(0xff9a55)
    expect(plasma.mesh.visible).toBe(true)
    plasma.update(0.005, 0xff9a55, 2)
    expect(plasma.mesh.visible).toBe(false)
    plasma.update(2, 0xff9a55, 2.1) // heat clamps to 1
    expect(mat.uniforms.uHeat.value).toBe(1)
  })

  it('dispose() releases geometry and material', () => {
    const plasma = buildEntryPlasma()
    let disposed = 0
    plasma.mesh.geometry.addEventListener('dispose', () => disposed++)
    plasma.dispose()
    expect(disposed).toBe(1)
  })
})
