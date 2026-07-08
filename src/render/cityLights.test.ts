import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCityLightSplats, cityNightFactor, computeSplatPixels, updateCityLightSplats } from './cityLights'
import { computeCitySites } from './citySites'

describe('computeSplatPixels', () => {
  it('produces an RGBA square that fades to transparent at the rim and glows at the centre', () => {
    const size = 64
    const px = computeSplatPixels(size, 7)
    expect(px.length).toBe(size * size * 4)
    const centre = ((size / 2) * size + size / 2) * 4
    expect(px[centre + 3]).toBeGreaterThan(120)
    expect(px[3]).toBe(0) // corner fully transparent
    expect(px[(size * size - 1) * 4 + 3]).toBe(0)
  })
})

describe('cityNightFactor', () => {
  it('is 0 at local noon, rises through the terminator, saturates at deep night', () => {
    expect(cityNightFactor(1)).toBe(0)
    expect(cityNightFactor(0)).toBeGreaterThan(0)
    expect(cityNightFactor(-1)).toBeGreaterThan(cityNightFactor(-0.2))
    expect(cityNightFactor(-1)).toBeLessThanOrEqual(1)
  })
})

describe('buildCityLightSplats', () => {
  it('builds one additive splat per site, sized by tier, and night-gates the opacity', () => {
    const sites = computeCitySites(1274, 4300, 8)
    const planetPos = new THREE.Vector3(100, 200, 300)
    const group = buildCityLightSplats(sites, planetPos, 4300)
    expect(group.children.length).toBe(sites.length)
    const mesh = group.children[0] as THREE.Mesh
    expect((mesh.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending)
    expect((mesh.material as THREE.MeshBasicMaterial).depthWrite).toBe(false)
    // sun exactly behind site 0's zenith → local noon → invisible
    const sunAtZenith = planetPos.clone().addScaledVector(sites[0].direction, 100000)
    updateCityLightSplats(group, planetPos, sunAtZenith)
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0)
    // sun on the opposite side → deep night → lit
    const sunAtNadir = planetPos.clone().addScaledVector(sites[0].direction, -100000)
    updateCityLightSplats(group, planetPos, sunAtNadir)
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.4)
  })
})
