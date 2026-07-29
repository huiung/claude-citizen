import * as THREE from 'three'
import { samplePlanetSurface } from './planetTextures'
import {
  CITY_BLOCK, CITY_ROAD, CITY_SHEET_SEGMENTS, CITY_TIER_RADIUS, cityGroundRadius, cityTangentFrame,
  computeCityLayout, SHEET_LIFT, SKIRT_MARGIN,
} from './cityLayout'
import type { CitySite } from './citySites'

/** Landing deck radius (tangent-plane units ≈ metres). */
export const PAD_RADIUS = 45
/** Deck slab thickness — padCenter sits on the TOP face. */
export const PAD_DECK_HEIGHT = 3

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
      if (r > extent - PAD_RADIUS - SKIRT_MARGIN) continue // the sheet's skirt dives past here
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
  const { u, v } = cityTangentFrame(n) // the exact frame buildCityChunk lays the sheet with
  const isWater = (x: number, z: number) => {
    const d = n.clone().multiplyScalar(radius).addScaledVector(u, x).addScaledVector(v, z).normalize()
    return samplePlanetSurface('earth', planetSeed, d.x, d.y, d.z, undefined, radius).height < 0.05
  }
  const lot = computePadLot(site.seed, site.tier, isWater)
  const normal = n.clone().multiplyScalar(radius).addScaledVector(u, lot.x).addScaledVector(v, lot.z).normalize()
  const t = samplePlanetSurface('earth', planetSeed, normal.x, normal.y, normal.z, undefined, radius)
  // Same terrain frame as the ground sheet, lifted with it, deck top on top.
  const ground = cityGroundRadius(radius, t.height) + SHEET_LIFT + PAD_DECK_HEIGHT
  return { center: planetPos.clone().addScaledVector(normal, ground), normal }
}

const _sheetDir = new THREE.Vector3()
const _triA = new THREE.Vector3()
const _triB = new THREE.Vector3()
const _triC = new THREE.Vector3()
const _triNormal = new THREE.Vector3()
const _triEdge = new THREE.Vector3()

/** Radius of one ground-sheet VERTEX, including the skirt dive past the city edge. Mirrors the
 *  per-vertex maths in buildCityChunk exactly; the two are kept in step by both going through
 *  cityGroundRadius / SHEET_LIFT / CITY_SHEET_SEGMENTS rather than by repeating numbers. */
function sheetVertexRadius(
  n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3,
  planetSeed: number, radius: number, extent: number, x: number, z: number,
): number {
  _sheetDir.copy(n).multiplyScalar(radius).addScaledVector(u, x).addScaledVector(v, z).normalize()
  const t = samplePlanetSurface('earth', planetSeed, _sheetDir.x, _sheetDir.y, _sheetDir.z, undefined, radius)
  const g = cityGroundRadius(radius, t.height) + SHEET_LIFT
  const lr = Math.hypot(x, z)
  return lr > extent ? g - (lr - extent) * 0.9 : g
}

/** Position of one ground-sheet vertex, relative to the planet centre. */
function sheetVertexPoint(
  target: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3,
  planetSeed: number, radius: number, extent: number, x: number, z: number,
): THREE.Vector3 {
  const r = sheetVertexRadius(n, u, v, planetSeed, radius, extent, x, z)
  return target.copy(n).multiplyScalar(radius).addScaledVector(u, x).addScaledVector(v, z).normalize().multiplyScalar(r)
}

/** Radius of the city ground sheet's SURFACE at a tangent-plane point — what a pedestrian stands on.
 *
 *  Three things this is deliberately NOT, each of which was tried and each of which a capture threw
 *  out. The residuals are all in the 0.1-0.3 unit range, which reads as nothing written down and as
 *  a person buried to the ankles or hovering a hand's width off the ground when you look at it.
 *
 *  1. `cityGroundRadius(radius, samplePlanetSurface(...))`. That is the sheet's *input*, a continuous
 *     field. The sheet is a 40x40 quad grid over a footprint up to 2800 units across, so it is flat
 *     across 70-unit cells and departs from its own input by whatever the terrain does in between.
 *     A ship at altitude never notices — `resolvePlanetCollisions` lives with exactly this — but one
 *     cell here spans ~100 km of Earth's real elevation raster.
 *  2. Bilinear over the four surrounding vertices. The GPU draws two flat triangles, not a bilinear
 *     patch, and with neighbouring vertices routinely several units apart the two disagree.
 *  3. Interpolating the corner RADII over the correct triangle. Better, but a triangle is flat in 3D
 *     while interpolated radii trace an arc through the same corners; the chord sag over a 70-unit
 *     cell at radius 4300 is ~0.12 units, and it is always in the same direction, so the walker
 *     floats consistently.
 *
 *  So: intersect the ray from the planet centre with the PLANE of the triangle the point falls in.
 *  `PlaneGeometry` emits each quad as (a,b,d) and (b,c,d) with a=(ix,iy), b=(ix,iy+1),
 *  c=(ix+1,iy+1), d=(ix+1,iy), which splits it along the diagonal from the (-x,+z) corner to the
 *  (+x,-z) corner — remembering that the plane's local Y, which becomes the site frame's v/z axis
 *  here, runs the opposite way to its vertex index.
 */
export function cityGroundRadiusAt(
  site: CitySite, planetSeed: number, radius: number, x: number, z: number,
): number {
  const n = site.direction
  const { u, v } = cityTangentFrame(n)
  const extent = CITY_TIER_RADIUS[site.tier]
  const span = extent * 2
  const cell = span / CITY_SHEET_SEGMENTS
  // Vertices sit at -span/2 + k*cell on both axes. Clamp rather than extrapolate: past the sheet's
  // own rim the skirt is already diving underground and there is nothing to stand on either way.
  const gx = Math.min(CITY_SHEET_SEGMENTS - 1, Math.max(0, Math.floor((x + span / 2) / cell)))
  const gz = Math.min(CITY_SHEET_SEGMENTS - 1, Math.max(0, Math.floor((z + span / 2) / cell)))
  const x0 = -span / 2 + gx * cell
  const z0 = -span / 2 + gz * cell
  const fx = Math.min(1, Math.max(0, (x - x0) / cell))
  const fz = Math.min(1, Math.max(0, (z - z0) / cell))
  // Row index runs against z, so the diagonal in (fx, fz) space is fx = fz.
  if (fx <= fz) {
    sheetVertexPoint(_triA, n, u, v, planetSeed, radius, extent, x0, z0 + cell)
    sheetVertexPoint(_triB, n, u, v, planetSeed, radius, extent, x0, z0)
    sheetVertexPoint(_triC, n, u, v, planetSeed, radius, extent, x0 + cell, z0 + cell)
  } else {
    sheetVertexPoint(_triA, n, u, v, planetSeed, radius, extent, x0 + cell, z0)
    sheetVertexPoint(_triB, n, u, v, planetSeed, radius, extent, x0, z0)
    sheetVertexPoint(_triC, n, u, v, planetSeed, radius, extent, x0 + cell, z0 + cell)
  }
  _triNormal.copy(_triC).sub(_triA).cross(_triEdge.copy(_triB).sub(_triA))
  _sheetDir.copy(n).multiplyScalar(radius).addScaledVector(u, x).addScaledVector(v, z).normalize()
  const denom = _sheetDir.dot(_triNormal)
  // Degenerate only if the triangle is edge-on to the ray, which a terrain sheet never is; fall
  // back to the corner radius rather than returning a NaN that would drop the walker to the core.
  if (Math.abs(denom) < 1e-9) return _triA.length()
  return _triA.dot(_triNormal) / denom
}

/** Radius of the skypad's deck top along a direction from the planet centre.
 *
 *  The deck is a cylinder whose top face is FLAT and perpendicular to the pad normal, so its
 *  distance from the planet centre grows with distance from the pad's own centre — by 0.23 units at
 *  the 45-unit rim, on a 4300-unit planet. Treating the deck as a sphere at padCenter's radius, which
 *  is what "the pad is flat, just use its radius" gives you, therefore buries a pedestrian's boots
 *  anywhere but the middle of the pad. The ship never noticed because it lands dead centre.
 */
export function padDeckRadiusAt(padRadius: number, padNormal: THREE.Vector3, dir: THREE.Vector3): number {
  const denom = dir.dot(padNormal)
  return denom > 1e-6 ? padRadius / denom : padRadius
}

/** Deck-top ALBEDO — apron concrete plus the painted landing marking.
 *
 *  Why this exists separately from `computePadMarkingPixels`. That one is an emissiveMap, and its
 *  intensity is night-weighted, so in daylight the marking it draws is swamped by the lit concrete
 *  around it and the deck renders as a single flat tone. Measured from a `?earthview=seoul-foot`
 *  capture, the whole 90-unit deck sat within ±3 of one value: the top face of a `CylinderGeometry`
 *  is ONE flat face with ONE normal, so a single distant light gives it exactly one shade, and with
 *  no albedo variation there is nothing else for the eye to read distance from. That is the real
 *  cause of the "the pad flattens into haze" report — not the aerial-perspective fog, which at
 *  pedestrian eye height cannot reach the ground at all (its near plane sits at ~710 units and the
 *  geometric horizon from a 10-unit eye on a 4300-unit sphere is ~290).
 *
 *  So: paint the markings into the albedo, where daylight can see them, and give the concrete slab
 *  seams and wear so the surface carries its own texture gradient. Deterministic hash noise rather
 *  than Math.random, so two captures never differ by the noise.
 *
 *  `CylinderGeometry` maps the cap into the unit circle inscribed in [0,1]², which is the convention
 *  `computePadMarkingPixels` already assumes — the two must keep agreeing or the painted ring and the
 *  glowing one would sit at different radii. */
export function computePadDeckPixels(size = 128): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * 4)
  const c = (size - 1) / 2
  // Concrete grey, matching the flat colour this replaces so the deck's overall exposure — tuned
  // against the ~45%-albedo Blue Marble terrain it sits on — does not move.
  const base = [0x9a, 0xa2, 0xab]
  // Warm off-white paint. Bright enough to read against lit concrete, dull enough to look like paint
  // on a working apron rather than a decal.
  const paint = [0xd6, 0xcd, 0xb6]
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  // Slab grid in TEXELS. At size 128 over a 90-unit deck, 16 texels is ~11 units — apron slab scale.
  const slab = size / 8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c
      // Two frequencies: slab-sized patches of differing pour colour, plus fine aggregate grain.
      let mul = 1 + (hash(Math.floor(x / slab), Math.floor(y / slab)) - 0.5) * 0.13
        + (hash(x, y) - 0.5) * 0.06
      // Slab seams: a darker line where two pours meet. One texel wide, so it survives mipmapping
      // as a soft line rather than vanishing.
      if (x % slab === 0 || y % slab === 0) mul *= 0.9
      const painted = (r > 0.62 && r < 0.74) || r < 0.1
      const src = painted ? paint : base
      const i = (y * size + x) * 4
      for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, Math.round(src[k] * mul)))
      data[i + 3] = 255
    }
  }
  return data
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
