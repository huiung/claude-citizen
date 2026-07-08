import * as THREE from 'three'
import type { CitySite } from './citySites'

// Deterministic PRNG — duplicated per repo convention (see starSky.ts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sprawling warm glow with speckle — reads as a city from orbit. Pure RGBA, canvas-free. */
export function computeSplatPixels(size = 64, seed = 1): Uint8Array<ArrayBuffer> {
  const rand = mulberry32(seed)
  const data = new Uint8Array(new ArrayBuffer(size * size * 4))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5
      const dy = (y + 0.5) / size - 0.5
      const r = Math.hypot(dx, dy) * 2 // 0 centre → 1 rim
      const falloff = Math.max(0, 1 - r)
      const speckle = 0.55 + rand() * 0.45
      const a = Math.pow(falloff, 1.8) * speckle
      const i = (y * size + x) * 4
      data[i] = 255
      data[i + 1] = 196
      data[i + 2] = 120
      data[i + 3] = Math.round(a * 255)
    }
  }
  return data
}

/** Night factor from (surface normal · sun direction): 0 by day, ramping through the
 *  terminator so lights fade in at dusk rather than snapping on. */
export function cityNightFactor(ndotl: number): number {
  return Math.pow(THREE.MathUtils.clamp(-ndotl + 0.1, 0, 1.1) / 1.1, 1.4)
}

const SPLAT_SCALE = [900, 1500, 2400] as const // town / city / metropolis footprint glow

/** One additive glow quad per city, resting on the sphere. Opacity is driven per frame
 *  by updateCityLightSplats — lights only exist on the night side.
 *  Session-lifetime objects toggled via visibility — no dispose path by design. */
export function buildCityLightSplats(sites: CitySite[], planetPos: THREE.Vector3, radius: number): THREE.Group {
  const group = new THREE.Group()
  for (const site of sites) {
    const texture = new THREE.DataTexture(computeSplatPixels(64, site.seed), 64, 64, THREE.RGBAFormat)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.needsUpdate = true
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    const scale = SPLAT_SCALE[site.tier]
    mesh.scale.set(scale, scale, 1)
    // 1.04: land displacement reaches ~151u at close LOD (0.4 height * r * 0.055 * 1.6) —
    // the glow must float above the peaks or the terrain depth-rejects it from orbit.
    mesh.position.copy(planetPos).addScaledVector(site.direction, radius * 1.04)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), site.direction) // plane +z → surface normal
    mesh.userData.cityDirection = site.direction.clone()
    group.add(mesh)
  }
  return group
}

const _sunDir = new THREE.Vector3()

export function updateCityLightSplats(group: THREE.Group, planetPos: THREE.Vector3, sunPos: THREE.Vector3): void {
  _sunDir.copy(sunPos).sub(planetPos).normalize()
  for (const child of group.children) {
    const mesh = child as THREE.Mesh
    const dir = mesh.userData.cityDirection as THREE.Vector3
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = cityNightFactor(dir.dot(_sunDir)) * 0.75
  }
}
