import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  attachGroundFillToMaterial, GROUND_FILL_GLSL, GROUND_FILL_INTERNALS, groundFillStrength, updateGroundFill,
} from './groundFill'

const { GROUND_FILL_ALT_FULL, GROUND_FILL_ALT_NONE, patchGroundFill, uniforms } = GROUND_FILL_INTERNALS

describe('groundFillStrength', () => {
  it('is off in space', () => {
    // The whole reason a hull-local fill is allowed at all: it must not exist outside a planet's air.
    expect(groundFillStrength(100_000, 1)).toBe(0)
    expect(groundFillStrength(GROUND_FILL_ALT_NONE, 1)).toBe(0)
  })

  it('is off on a night side however low it gets', () => {
    // The regression a brighter scene ambient would have caused — a daylit terminator and washed-out
    // night city lights. Sun below the horizon must mean no bounce at any altitude.
    expect(groundFillStrength(0, -1)).toBe(0)
    expect(groundFillStrength(0, -0.12)).toBe(0)
  })

  it('is at full strength on a daylit deck', () => {
    expect(groundFillStrength(0, 1)).toBeCloseTo(1)
    expect(groundFillStrength(GROUND_FILL_ALT_FULL, 0.5)).toBeCloseTo(1)
  })

  it('falls off monotonically with altitude and rises monotonically with the sun', () => {
    const alts = [0, 100, 250, 500, 750, GROUND_FILL_ALT_NONE]
    for (let i = 1; i < alts.length; i++) {
      expect(groundFillStrength(alts[i], 1)).toBeLessThan(groundFillStrength(alts[i - 1], 1))
    }
    const suns = [-0.1, -0.05, 0, 0.08, 0.17]
    for (let i = 1; i < suns.length; i++) {
      expect(groundFillStrength(0, suns[i])).toBeGreaterThan(groundFillStrength(0, suns[i - 1]))
    }
  })

  it('treats a below-surface altitude as on the surface rather than overdriving', () => {
    // The ship is pinned slightly INTO the deck geometry while landed on some pads; a negative
    // altitude must not extrapolate the fade past 1.
    expect(groundFillStrength(-20, 1)).toBeCloseTo(1)
  })
})

describe('updateGroundFill', () => {
  it('scales the fill colour by strength and zeroes it at 0', () => {
    updateGroundFill(new THREE.Vector3(0, 1, 0), 1)
    const full = uniforms.uGroundFill.value.clone()
    expect(full.r).toBeGreaterThan(0)

    updateGroundFill(new THREE.Vector3(0, 1, 0), 0.5)
    expect(uniforms.uGroundFill.value.r).toBeCloseTo(full.r * 0.5)

    updateGroundFill(new THREE.Vector3(0, 1, 0), 0)
    expect(uniforms.uGroundFill.value.getHex()).toBe(0x000000)
  })

  it('clamps a negative strength to off rather than negating the fill', () => {
    updateGroundFill(new THREE.Vector3(0, 1, 0), -3)
    expect(uniforms.uGroundFill.value.getHex()).toBe(0x000000)
  })

  it('records the up vector it was given', () => {
    updateGroundFill(new THREE.Vector3(0, 0, -1), 1)
    expect(uniforms.uGroundFillUp.value.z).toBe(-1)
  })
})

describe('the shader patch', () => {
  /** The real thing three.js will compile, not a stand-in. */
  function realShader(): { fragmentShader: string; uniforms: Record<string, unknown> } {
    return { fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} }
  }

  it('injects into the shader three.js actually ships', () => {
    // Guards against a three.js upgrade renaming the hook. Without this a rename turns the fill into
    // a silent no-op, whose symptom is a black hull underside — i.e. indistinguishable from the bug.
    const shader = realShader()
    const before = shader.fragmentShader
    patchGroundFill(shader)
    expect(shader.fragmentShader).not.toBe(before)
    expect(shader.fragmentShader).toContain(GROUND_FILL_GLSL.trim())
    expect(shader.fragmentShader).toContain('uniform vec3 uGroundFill;')
  })

  it('injects AFTER the ambient irradiance is declared', () => {
    const shader = realShader()
    patchGroundFill(shader)
    const declares = shader.fragmentShader.indexOf('#include <lights_fragment_begin>')
    const uses = shader.fragmentShader.indexOf('irradiance += uGroundFill')
    const consumes = shader.fragmentShader.indexOf('#include <lights_fragment_end>')
    expect(declares).toBeGreaterThan(-1)
    expect(uses).toBeGreaterThan(declares) // `irradiance` is in scope
    expect(uses).toBeLessThan(consumes) // and still accumulating when we add to it
  })

  it('shares the uniform objects so one write drives every hull material', () => {
    const a = realShader()
    const b = realShader()
    patchGroundFill(a)
    patchGroundFill(b)
    expect(a.uniforms.uGroundFill).toBe(b.uniforms.uGroundFill)
    expect(a.uniforms.uGroundFillUp).toBe(b.uniforms.uGroundFillUp)
  })

  it('uses one shared function reference, so patched materials share a compiled program', () => {
    // three.js's default customProgramCacheKey is onBeforeCompile.toString(); a per-material closure
    // would still share the key, but a per-material FUNCTION would not share the compile.
    const a = new THREE.MeshStandardMaterial()
    const b = new THREE.MeshStandardMaterial()
    attachGroundFillToMaterial(a)
    attachGroundFillToMaterial(b)
    expect(a.onBeforeCompile).toBe(b.onBeforeCompile)
  })

  it('is idempotent, so re-tuning a cached hull cannot stack patches', () => {
    const mat = new THREE.MeshStandardMaterial()
    attachGroundFillToMaterial(mat)
    // `needsUpdate` is write-only on a three.js Material; `version` is the counter it bumps, and a
    // bump is what forces the recompile this must not trigger a second time.
    const version = mat.version
    attachGroundFillToMaterial(mat)
    expect(mat.version).toBe(version)

    const shader = realShader()
    ;(mat.onBeforeCompile as unknown as typeof patchGroundFill)(shader)
    const hits = shader.fragmentShader.split('irradiance += uGroundFill').length - 1
    expect(hits).toBe(1)
  })
})
