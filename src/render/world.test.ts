import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildNebula, makeAtmosphere, setNebulaFade } from './world'

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

describe('makeAtmosphere sky mode', () => {
  it('enables the inside-sky term only when skyEnabled is passed (Earth)', () => {
    const mat = makeAtmosphere(4300, 'earth', true).material as THREE.ShaderMaterial
    expect(mat.uniforms.uSkyEnabled.value).toBe(1)
    expect(mat.uniforms.uRadius.value).toBe(4300)
    expect(mat.uniforms.uShellRadius.value).toBeCloseTo(4300 * 1.06)
    expect(mat.fragmentShader).toContain('insideness') // sky dome branch present
  })

  it('keeps the sky term off by default (other planets unchanged)', () => {
    const mat = makeAtmosphere(2200, 'mars').material as THREE.ShaderMaterial
    expect(mat.uniforms.uSkyEnabled.value).toBe(0)
  })
})
