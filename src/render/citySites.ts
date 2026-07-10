import * as THREE from 'three'
import { isEarthDataReady, latLonToDir } from './earthData'
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

const _axisX = new THREE.Vector3(1, 0, 0)
const _axisY = new THREE.Vector3(0, 1, 0)

export interface CitySite {
  /** unit direction from the planet centre to the city */
  direction: THREE.Vector3
  /** 2 = metropolis, 1 = city, 0 = town — first (flattest) picks get the big lights */
  tier: 0 | 1 | 2
  /** per-site seed for the building layout */
  seed: number
}

/** Real megacities for the NASA-raster Earth — night lights land where the actual
 *  cities are. First entry is Seoul: the "hey, that's home" moment leads the table. */
export const EARTH_CITIES = [
  { name: 'Seoul', lat: 37.57, lon: 126.98, tier: 2 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, tier: 2 },
  { name: 'Shanghai', lat: 31.23, lon: 121.47, tier: 2 },
  { name: 'New York', lat: 40.71, lon: -74.01, tier: 2 },
  { name: 'London', lat: 51.51, lon: -0.13, tier: 1 },
  { name: 'Paris', lat: 48.86, lon: 2.35, tier: 1 },
  { name: 'Cairo', lat: 30.04, lon: 31.24, tier: 1 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, tier: 1 },
  { name: 'Moscow', lat: 55.76, lon: 37.62, tier: 1 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63, tier: 1 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, tier: 1 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, tier: 1 },
  { name: 'Istanbul', lat: 41.01, lon: 28.98, tier: 1 },
  { name: 'Sydney', lat: -33.87, lon: 151.21, tier: 0 },
  { name: 'Lagos', lat: 6.52, lon: 3.38, tier: 0 },
  { name: 'Singapore', lat: 1.35, lon: 103.82, tier: 0 },
] as const

/** Deterministic city placement: sample candidate directions, keep solid non-polar land
 *  that is locally flat (no mountainsides, no coastlines), then greedily pick the
 *  flattest with a minimum angular separation. Same seed → same cities for every pilot.
 *  With the real-Earth rasters loaded, placement switches to the actual megacity table. */
export function computeCitySites(planetSeed: number, radius: number, count = 8): CitySite[] {
  if (isEarthDataReady()) {
    return EARTH_CITIES.map((c, i) => ({
      direction: latLonToDir(c.lat, c.lon),
      tier: c.tier,
      seed: (planetSeed * 31 + i * 101) | 0,
    }))
  }
  const rand = mulberry32(planetSeed ^ 0x5c17e5)
  const candidates: { dir: THREE.Vector3; roughness: number }[] = []
  const probe = new THREE.Vector3()

  for (let i = 0; i < 600; i++) {
    const theta = rand() * Math.PI * 2
    const y = rand() * 2 - 1
    const s = Math.sqrt(1 - y * y)
    const dir = new THREE.Vector3(s * Math.cos(theta), y, s * Math.sin(theta))
    if (Math.abs(dir.y) > 0.7) continue // polar caps stay dark
    const centre = samplePlanetSurface('earth', planetSeed, dir.x, dir.y, dir.z, undefined, radius)
    if (centre.height < 0.05) continue // water, coast — cities want solid land

    // Local flatness: 4 probes ~0.02 rad away along the TANGENT plane (a global-axis
    // offset degenerates near ±X and skews the flatness ranking by longitude).
    const t1 = (Math.abs(dir.y) > 0.99 ? _axisX : _axisY).clone().cross(dir).normalize()
    const t2 = dir.clone().cross(t1).normalize()
    let roughness = 0
    let onLand = true
    for (const [a, b] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]] as const) {
      probe.copy(dir).addScaledVector(t1, a).addScaledVector(t2, b).normalize()
      const p = samplePlanetSurface('earth', planetSeed, probe.x, probe.y, probe.z, undefined, radius)
      if (p.height < 0.05) { onLand = false; break }
      roughness = Math.max(roughness, Math.abs(p.height - centre.height))
    }
    if (!onLand) continue

    // Footprint check: the flatness probes cover ~0.02 rad but a metropolis spans ~0.33 rad —
    // sample two rings across the widest footprint and reject candidates that straddle bays.
    let land = 0
    for (const arc of [0.16, 0.3] as const) {
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2
        probe.copy(dir).addScaledVector(t1, Math.cos(ang) * arc).addScaledVector(t2, Math.sin(ang) * arc).normalize()
        const p = samplePlanetSurface('earth', planetSeed, probe.x, probe.y, probe.z, undefined, radius)
        if (p.height >= 0.05) land++
      }
    }
    if (land < 9) continue // < 75% of the footprint on land
    candidates.push({ dir, roughness })
  }

  candidates.sort((a, b) => a.roughness - b.roughness)
  const picked = pickSeparated(candidates.map((c) => c.dir), count, 0.35)

  return picked.map((dir, i) => ({
    direction: dir,
    tier: (i < 2 ? 2 : i < 5 ? 1 : 0) as 0 | 1 | 2,
    seed: (planetSeed * 31 + i * 101) | 0,
  }))
}

/** Greedy pick by ascending score with a minimum angular separation; one relaxed pass
 *  (×0.6) fills the remainder rather than returning a sparse set. Exported for tests. */
export function pickSeparated(dirs: THREE.Vector3[], count: number, minSeparation: number): THREE.Vector3[] {
  const picked: THREE.Vector3[] = []
  for (const dir of dirs) {
    if (picked.length >= count) break
    if (picked.every((p) => p.angleTo(dir) > minSeparation)) picked.push(dir)
  }
  if (picked.length < count) {
    for (const dir of dirs) {
      if (picked.length >= count) break
      if (!picked.includes(dir) && picked.every((p) => p.angleTo(dir) > minSeparation * 0.6)) picked.push(dir)
    }
  }
  return picked
}
