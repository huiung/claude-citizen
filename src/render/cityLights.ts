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

/** Satellite-photo night city: compact near-white core, warm sodium filaments radiating
 *  along highways, a speckled suburb field, detached satellite towns. A plain radial
 *  falloff reads as a fireball under bloom — the structure is what says "city".
 *  Pure RGBA, canvas-free. */
export function computeSplatPixels(size = 128, seed = 1): Uint8Array<ArrayBuffer> {
  const rand = mulberry32(seed)
  const arms: { ang: number; len: number; w: number }[] = []
  for (let i = 0, n = 5 + Math.floor(rand() * 3); i < n; i++) {
    arms.push({ ang: rand() * Math.PI * 2, len: 0.5 + rand() * 0.45, w: 0.09 + rand() * 0.08 })
  }
  const towns: { x: number; y: number; r: number; b: number }[] = []
  for (let i = 0, n = 7 + Math.floor(rand() * 6); i < n; i++) {
    const ta = rand() * Math.PI * 2
    const td = 0.35 + rand() * 0.55
    towns.push({ x: Math.cos(ta) * td, y: Math.sin(ta) * td, r: 0.05 + rand() * 0.08, b: 0.25 + rand() * 0.45 })
  }
  const data = new Uint8Array(new ArrayBuffer(size * size * 4))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size - 0.5) * 2 // -1..1
      const dy = ((y + 0.5) / size - 0.5) * 2
      const r = Math.hypot(dx, dy) // 0 centre → 1 rim
      const edge = Math.max(0, 1 - r) // hard zero at the rim — corners stay transparent
      const core = Math.pow(Math.max(0, 1 - r / 0.3), 1.7)
      let arm = 0
      for (const a of arms) {
        let d = Math.abs(Math.atan2(dy, dx) - a.ang) % (Math.PI * 2)
        if (d > Math.PI) d = Math.PI * 2 - d
        if (r < a.len) arm = Math.max(arm, Math.max(0, 1 - d / a.w) * (1 - r / a.len))
      }
      let town = 0
      for (const t of towns) town = Math.max(town, t.b * Math.max(0, 1 - Math.hypot(dx - t.x, dy - t.y) / t.r))
      const suburb = Math.pow(edge, 3.0) * 0.38
      const speckle = 0.55 + rand() * 0.45
      const a = Math.min(1, core + arm * 0.6 + town + suburb) * speckle * Math.min(1, edge * 3)
      const warm = Math.min(1, r * 1.6) // near-white downtown → sodium-orange outskirts
      const i = (y * size + x) * 4
      data[i] = 255
      data[i + 1] = Math.round(214 - warm * 34)
      data[i + 2] = Math.round(178 - warm * 78)
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

const SPLAT_SCALE = [500, 900, 1500] as const // town / city / metropolis footprint glow

/** One additive glow quad per city, resting on the sphere. Opacity is driven per frame
 *  by updateCityLightSplats — lights only exist on the night side. Disposed via the
 *  caller's generic disposeObject when the site table is swapped (real-Earth rebuild). */
export function buildCityLightSplats(sites: CitySite[], planetPos: THREE.Vector3, radius: number): THREE.Group {
  const group = new THREE.Group()
  for (const site of sites) {
    const texture = new THREE.DataTexture(computeSplatPixels(128, site.seed), 128, 128, THREE.RGBAFormat)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.needsUpdate = true
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      // fog:false — an additive splat blending toward the aerial-haze fog color would
      // wash grey before adding; the glow must stay pure emission under any fog tuning.
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
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
    ;(mesh.material as THREE.MeshBasicMaterial).opacity = cityNightFactor(dir.dot(_sunDir)) * 0.65
  }
}
