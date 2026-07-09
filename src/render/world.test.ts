import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SKY_DOME_FRAC, buildNebula, makeSkyDome, setNebulaFade } from './world'

describe('buildNebula / setNebulaFade', () => {
  it('exposes a uFade uniform (default 0) and clamps applied values to [0, 1]', () => {
    const nebula = buildNebula()
    const mat = nebula.material as THREE.ShaderMaterial
    expect(mat.uniforms.uFade.value).toBe(0)
    setNebulaFade(nebula, 0.6)
    expect(mat.uniforms.uFade.value).toBeCloseTo(0.6)
    setNebulaFade(nebula, 2)
    expect(mat.uniforms.uFade.value).toBe(1)
    setNebulaFade(nebula, -0.5)
    expect(mat.uniforms.uFade.value).toBe(0)
  })
})

describe('makeSkyDome', () => {
  it('reaches gameplay altitude and carries the per-fragment insideness uniforms', () => {
    expect(SKY_DOME_FRAC).toBeGreaterThan(1.06) // taller than the limb shell — covers city flight
    const dome = makeSkyDome(4300, 'earth')
    const mat = dome.material as THREE.ShaderMaterial
    expect(mat.uniforms.uRadius.value).toBe(4300)
    expect(mat.uniforms.uTop.value).toBeCloseTo(4300 * SKY_DOME_FRAC)
    expect(mat.side).toBe(THREE.BackSide)
    expect(mat.blending).toBe(THREE.AdditiveBlending)
    expect(mat.depthWrite).toBe(false)
    expect(mat.fragmentShader).toContain('insideness') // transparent-from-space gate
    const geo = dome.geometry as THREE.SphereGeometry
    expect(geo.parameters.radius).toBeCloseTo(4300 * SKY_DOME_FRAC)
  })
})
