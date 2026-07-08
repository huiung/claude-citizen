import * as THREE from 'three'
import { samplePlanetSurface } from './planetTextures'

// Deterministic PRNG — duplicated per repo convention (see starSky.ts: importing a
// sibling render module for 8 lines would couple unrelated systems).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface CitySite {
  /** unit direction from the planet centre to the city */
  direction: THREE.Vector3
  /** 2 = metropolis, 1 = city, 0 = town — first (flattest) picks get the big lights */
  tier: 0 | 1 | 2
  /** per-site seed for the building layout */
  seed: number
}

/** Deterministic city placement: sample candidate directions, keep solid non-polar land
 *  that is locally flat (no mountainsides, no coastlines), then greedily pick the
 *  flattest with a minimum angular separation. Same seed → same cities for every pilot. */
export function computeCitySites(planetSeed: number, radius: number, count = 8): CitySite[] {
  const rand = mulberry32(planetSeed ^ 0x5c17e5)
  const candidates: { dir: THREE.Vector3; roughness: number }[] = []
  const probe = new THREE.Vector3()

  for (let i = 0; i < 600; i++) {
    const theta = rand() * Math.PI * 2
    const y = rand() * 2 - 1
    const s = Math.sqrt(1 - y * y)
    const dir = new THREE.Vector3(s * Math.cos(theta), y, s * Math.sin(theta))
    if (Math.abs(dir.y) > 0.7) continue // polar caps stay dark
    const centre = samplePlanetSurface('earth', planetSeed, dir.x, dir.y, dir.z, 0x3a72a8, radius)
    if (centre.height < 0.05) continue // water, coast — cities want solid land

    // Local flatness: 4 probes ~0.02 rad away must also be land, with little height spread.
    let roughness = 0
    let onLand = true
    for (const [ox, oy] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]] as const) {
      probe.set(dir.x + ox, dir.y + oy, dir.z).normalize()
      const p = samplePlanetSurface('earth', planetSeed, probe.x, probe.y, probe.z, 0x3a72a8, radius)
      if (p.height < 0.05) { onLand = false; break }
      roughness = Math.max(roughness, Math.abs(p.height - centre.height))
    }
    if (!onLand) continue
    candidates.push({ dir, roughness })
  }

  candidates.sort((a, b) => a.roughness - b.roughness)
  const picked: THREE.Vector3[] = []
  const minSeparation = 0.35
  for (const c of candidates) {
    if (picked.length >= count) break
    if (picked.every((p) => p.angleTo(c.dir) > minSeparation)) picked.push(c.dir)
  }
  // Sparse seeds can leave gaps — relax separation once rather than return a dark planet.
  if (picked.length < count) {
    for (const c of candidates) {
      if (picked.length >= count) break
      if (!picked.includes(c.dir) && picked.every((p) => p.angleTo(c.dir) > minSeparation * 0.6)) picked.push(c.dir)
    }
  }

  return picked.map((dir, i) => ({
    direction: dir,
    tier: (i < 2 ? 2 : i < 5 ? 1 : 0) as 0 | 1 | 2,
    seed: (planetSeed * 31 + i * 101) | 0,
  }))
}
