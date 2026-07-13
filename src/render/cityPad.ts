import * as THREE from 'three'
import { samplePlanetSurface } from './planetTextures'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, computeCityLayout } from './cityChunk'
import type { CitySite } from './citySites'

/** Landing deck radius (tangent-plane units ≈ metres). */
export const PAD_RADIUS = 45

/** The city-local cell the skypad sits on — seed-deterministic. Replays
 *  computeCityLayout to avoid building-occupied cells and walks the free cells
 *  nearest-the-centre first, taking the first one `isBlocked` (water etc.) allows.
 *  The chunk builder and the guidance beam pass the SAME callback so both paths
 *  always agree on the spot. If everything is blocked the nearest free cell wins —
 *  the ground sheet lays a harbor platform there anyway. */
export function computePadLot(
  siteSeed: number, tier: 0 | 1 | 2, isBlocked?: (x: number, z: number) => boolean,
): { x: number; z: number } {
  const extent = CITY_TIER_RADIUS[tier]
  const cell = CITY_BLOCK + CITY_ROAD
  const cells = Math.floor((extent * 2) / cell)
  const occupied = new Set<number>()
  for (const b of computeCityLayout(siteSeed, tier)) {
    occupied.add(Math.floor((b.x + extent) / cell) * 1024 + Math.floor((b.z + extent) / cell))
  }
  const cand: { x: number; z: number; r: number }[] = []
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      if (occupied.has(gx * 1024 + gz)) continue
      const x = -extent + cell * (gx + 0.5)
      const z = -extent + cell * (gz + 0.5)
      const r = Math.hypot(x, z)
      if (r > extent - PAD_RADIUS - 24) continue // matches the sheet's SKIRT_MARGIN
      cand.push({ x, z, r })
    }
  }
  cand.sort((a, b) => a.r - b.r || a.x - b.x || a.z - b.z)
  for (const c of cand) if (!isBlocked?.(c.x, c.z)) return { x: c.x, z: c.z }
  return cand.length > 0 ? { x: cand[0].x, z: cand[0].z } : { x: 0, z: 0 }
}

/** Pad world position/normal — computed with exactly the same tangent frame and
 *  terrain sample as buildCityChunk, so the guidance beam stands on the true spot
 *  even while the chunk itself hasn't streamed in yet (altitude > 1200u). */
export function computePadWorld(
  site: CitySite, planetPos: THREE.Vector3, planetSeed: number, radius: number,
): { center: THREE.Vector3; normal: THREE.Vector3 } {
  const n = site.direction
  const u = (Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).cross(n).normalize()
  const v = n.clone().cross(u).normalize()
  const isWater = (x: number, z: number) => {
    const d = n.clone().multiplyScalar(radius).addScaledVector(u, x).addScaledVector(v, z).normalize()
    return samplePlanetSurface('earth', planetSeed, d.x, d.y, d.z, undefined, radius).height < 0.05
  }
  const lot = computePadLot(site.seed, site.tier, isWater)
  const normal = n.clone().multiplyScalar(radius).addScaledVector(u, lot.x).addScaledVector(v, lot.z).normalize()
  const t = samplePlanetSurface('earth', planetSeed, normal.x, normal.y, normal.z, undefined, radius)
  // Same terrain frame as the ground sheet: water clamp + SHEET_LIFT(30), deck top +3.
  const ground = radius + Math.max(0.05, t.height) * radius * 0.055 * 1.6 + 30 + 3
  return { center: planetPos.clone().addScaledVector(normal, ground), normal }
}

/** Deck-top landing marking (circle ring + centre dot) — emissiveMap, pure, canvas-free. */
export function computePadMarkingPixels(size = 64): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c
      const lit = (r > 0.62 && r < 0.74) || r < 0.1
      const i = (y * size + x) * 4
      data[i] = lit ? 255 : 0
      data[i + 1] = lit ? 235 : 0
      data[i + 2] = lit ? 190 : 0
      data[i + 3] = 255
    }
  }
  return data
}
