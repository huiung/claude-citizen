import * as THREE from 'three'

// City-fabric primitives shared by the chunk builder (cityChunk) and the pad placement
// (cityPad). Both must agree EXACTLY on the tangent frame, the terrain-following ground
// radius, and the block grid — the guidance beam computes the pad spot before the chunk
// exists, and any drift would land the player beside the deck. Keeping the single source
// here also breaks the cityChunk ↔ cityPad import cycle.

// Deterministic PRNG — duplicated per repo convention (see starSky.ts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** City footprint radius (tangent-plane units ≈ metres) per tier: town / city / metropolis. */
export const CITY_TIER_RADIUS = [500, 900, 1400] as const

export const CITY_BLOCK = 96
export const CITY_ROAD = 24

/** Radial lift applied to the whole city fabric (sheet, buildings, pad). The planet render
 *  mesh linearly interpolates between its vertices, so in rough terrain its surface can sit
 *  well above the analytic sample — the fabric rides clear of those chords. */
export const SHEET_LIFT = 30

/** Lots this close to the round city edge are skipped — the sheet's skirt dives there. */
export const SKIRT_MARGIN = 24

/** Analytic terrain height → displaced-mesh radius factor (0.055 height scale × 1.6 LOD0). */
export const CITY_TERRAIN_SCALE = 0.055 * 1.6

/** Terrain-following radius for city fabric. Water clamps to coast level so bays inside a
 *  footprint become flat harbor platforms instead of holes. */
export function cityGroundRadius(radius: number, height: number): number {
  return radius + Math.max(0.05, height) * radius * CITY_TERRAIN_SCALE
}

/** The city-local tangent frame at a site direction — u/v span the ground plane. */
export function cityTangentFrame(n: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const u = (Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).cross(n).normalize()
  return { u, v: n.clone().cross(u).normalize() }
}

export interface BuildingSpec { x: number; z: number; w: number; d: number; h: number }

/** Dense block-grid, pure and deterministic: 3-5 tight-footprint (12-32u) buildings per
 *  built block, 18% plaza blocks, power-law heights peaking downtown. Streets are drawn
 *  by the ground sheet's repeating grid texture, so the layout only emits buildings. */
export function computeCityLayout(siteSeed: number, tier: 0 | 1 | 2): BuildingSpec[] {
  const rand = mulberry32(siteSeed)
  const extent = CITY_TIER_RADIUS[tier]
  const cell = CITY_BLOCK + CITY_ROAD
  const cells = Math.floor((extent * 2) / cell)
  const buildings: BuildingSpec[] = []
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx = -extent + cell * (gx + 0.5)
      const cz = -extent + cell * (gz + 0.5)
      const r = Math.hypot(cx, cz)
      if (r > extent) continue
      if (rand() < 0.18) continue // plaza/park — paved but unbuilt
      const core = Math.max(0, 1 - r / extent)
      const perBlock = 3 + Math.floor(rand() * 3) // 3-5
      for (let b = 0; b < perBlock; b++) {
        const w = 12 + rand() * 20
        const d = 12 + rand() * 20
        const h = 10 + Math.pow(rand(), 5.0) * 210 * (0.2 + core * 0.8) + rand() * 14
        buildings.push({
          x: cx + (rand() - 0.5) * (CITY_BLOCK - w - 6),
          z: cz + (rand() - 0.5) * (CITY_BLOCK - d - 6),
          w, d, h,
        })
      }
    }
  }
  return buildings
}
