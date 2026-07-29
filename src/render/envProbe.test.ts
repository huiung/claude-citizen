import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { attachEnvProbeToMaterial, ENV_PROBE_INTERNALS, hullEnvProbeReport, setHullEnvIntensity, updateHullEnvProbe } from './envProbe'

const { registered, PROBE_REFRESH_DISTANCE, HULL_ENV_INTENSITY } = ENV_PROBE_INTERNALS

/** There is no WebGL context here, so the probe itself is never initialised. Everything below is
 *  therefore about the contract that has to hold WITHOUT one — the probe is cosmetic and must never
 *  be able to break a hull load, a headless test run or a browser that refuses a context. */
describe('hull env probe with no probe initialised', () => {
  it('registers materials and leaves them untouched', () => {
    const mat = new THREE.MeshStandardMaterial({ metalness: 0.7 })
    attachEnvProbeToMaterial(mat)
    expect(registered.has(mat)).toBe(true)
    // No probe means no texture to hand out. A material that quietly gained a null envMap and a
    // needsUpdate would still be fine, but one that gained a BROKEN envMap would render as a hull
    // with no reflection term at all — the silent no-op this module exists to avoid.
    expect(mat.envMap).toBeNull()
  })

  it('does nothing per frame', () => {
    expect(updateHullEnvProbe(new THREE.Vector3(), [])).toBe(false)
  })

  it('reports that it is off rather than pretending to have swept', () => {
    // The studio label is the only place a capture can say which of "swept a dark sky" and "never
    // swept" produced a frame that did not change, and those need opposite fixes.
    expect(hullEnvProbeReport()).toBe('env off')
  })
})

describe('probe strength override', () => {
  it('reaches materials registered before and after the change', () => {
    const before = new THREE.MeshStandardMaterial()
    attachEnvProbeToMaterial(before)
    setHullEnvIntensity(7)
    expect(before.envMapIntensity).toBe(7)
    const after = new THREE.MeshStandardMaterial()
    attachEnvProbeToMaterial(after)
    expect(after.envMapIntensity).toBe(7)
    setHullEnvIntensity(HULL_ENV_INTENSITY)
  })

  it('ships at the physically neutral strength', () => {
    // Guards the one lesson the removed fabricated-environment attempt taught: gain cannot rescue a
    // source with no light in it, so a shipped multiplier above 1 would be a smell rather than a fix.
    expect(HULL_ENV_INTENSITY).toBe(1)
  })
})

describe('refresh distance', () => {
  it('is far larger than a hull, so manoeuvring never sweeps', () => {
    // Hulls are 6-17 units long. A threshold near that scale would sweep on every turn for a
    // reflection of a sky that has not measurably moved.
    expect(PROBE_REFRESH_DISTANCE).toBeGreaterThan(100)
  })
})

describe('material clones', () => {
  it('inherit the probe assignment by value', () => {
    // This is the bug that made the first version of the probe measure exactly zero. The ship loader
    // runs the material pass on a CACHED source model and hands every spawned hull `material.clone()`.
    // Clones are not in the registry, so they can only ever get the probe by inheriting it at clone
    // time — which is why the probe's texture is allocated at init rather than on the first sweep.
    const source = new THREE.MeshStandardMaterial()
    source.envMap = new THREE.Texture()
    source.envMapIntensity = 3
    const clone = source.clone()
    expect(clone.envMap).toBe(source.envMap)
    expect(clone.envMapIntensity).toBe(3)
  })
})
