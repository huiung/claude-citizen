// Procedural galaxy — pure, deterministic celestial field. No Math.random, no DOM,
// no three.js scene graph (Vector3 math only). Tested in galaxy.test.ts.
//
// The world is an infinite CELL GRID. Each cubic cell hashes its integer
// coordinates into a fixed set of celestial bodies, so a cell ALWAYS yields the
// SAME bodies regardless of which query touched it. Overlapping or adjacent
// queries therefore stitch together seamlessly: fly any direction and new
// bodies keep appearing, but the field never shifts or flickers under you.

import { Vector3 } from 'three'
import { COLONY_POS, REFINERY_POS } from '../render/world'
import { PVP_ARENA_CLEAR_RADIUS, PVP_ZONE_CENTER } from './pvp'

export type CelestialType = 'planet' | 'moon' | 'asteroid-cluster' | 'station' | 'derelict'

/** Galaxy bodies the ship collides with. Planets and moons are landmarks you fly around; the small
 *  filler (stations, derelicts, asteroid clusters) stays pass-through. */
export function isSolidCelestial(type: CelestialType): boolean {
  return type === 'planet' || type === 'moon'
}

export interface Celestial {
  /** Stable id derived from cell + index — same body, same id, forever. */
  id: string
  type: CelestialType
  /** World-space center. */
  position: Vector3
  /** Bounding radius in world units. Planets dwarf everything else. */
  radius: number
  /** Per-body integer seed; feed it to a render-side PRNG for stable detail. */
  seed: number
}

/**
 * Edge length of one grid cell, in world units. Large so the field is sparse:
 * a cell averages well under one body, so space feels vast rather than cluttered.
 */
export const CELL_SIZE = 24000

/**
 * Hand-placed starting area is sacred: no procedural body spawns within this
 * distance of the origin, REFINERY_POS, or COLONY_POS.
 */
export const EXCLUSION_RADIUS = 26000

/** Anchors whose neighbourhoods stay pristine. */
const EXCLUSION_ZONES: ReadonlyArray<{ center: Vector3; radius: number }> = [
  { center: new Vector3(0, 0, 0), radius: EXCLUSION_RADIUS },
  { center: REFINERY_POS, radius: EXCLUSION_RADIUS },
  { center: COLONY_POS, radius: EXCLUSION_RADIUS },
  { center: PVP_ZONE_CENTER, radius: PVP_ARENA_CLEAR_RADIUS },
]

// --- Integer hashing -------------------------------------------------------
// A 32-bit integer mix. Deterministic across platforms (all ops |0 / >>> 0),
// no floating point, no Math.random.

function hash3(ix: number, iy: number, iz: number, salt: number): number {
  let h = (ix | 0) * 0x27d4eb2d
  h = (h ^ ((iy | 0) * 0x165667b1)) | 0
  h = (h ^ ((iz | 0) * 0x9e3779b1)) | 0
  h = (h ^ (salt | 0)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h = (h ^ (h >>> 15)) | 0
  return h >>> 0
}

/** Deterministic float in [0, 1) from an unsigned 32-bit hash. */
function unitFloat(h: number): number {
  return (h >>> 0) / 4294967296
}

// --- Body composition per cell ---------------------------------------------
// Type weights: planets and moons are rare (they are the landmarks); clusters
// and derelicts are the common filler. Tuned so a body is more likely to be
// "something interesting on the horizon" than dense traffic.
interface TypeSpec {
  type: CelestialType
  weight: number
  /** Inclusive radius range [min, max] in world units. */
  minRadius: number
  maxRadius: number
}

const TYPE_SPECS: ReadonlyArray<TypeSpec> = [
  { type: 'planet', weight: 0.10, minRadius: 3000, maxRadius: 20000 },
  { type: 'moon', weight: 0.18, minRadius: 600, maxRadius: 2600 },
  { type: 'asteroid-cluster', weight: 0.22, minRadius: 200, maxRadius: 1400 },
  { type: 'station', weight: 0.14, minRadius: 60, maxRadius: 140 },
  { type: 'derelict', weight: 0.24, minRadius: 20, maxRadius: 90 },
]

const TOTAL_WEIGHT = TYPE_SPECS.reduce((s, t) => s + t.weight, 0)

function pickType(u: number): TypeSpec {
  let acc = u * TOTAL_WEIGHT
  for (const spec of TYPE_SPECS) {
    acc -= spec.weight
    if (acc <= 0) return spec
  }
  return TYPE_SPECS[TYPE_SPECS.length - 1]
}

/**
 * Bodies in a single cell. Most cells hold 0 or 1 body (sparse field). At most
 * one of any cell's bodies is large enough to need wide spacing, which the cell
 * size guarantees.
 */
const MAX_BODIES_PER_CELL = 2

/** True if `p` falls inside any pristine exclusion zone. */
function inExclusionZone(p: Vector3): boolean {
  for (const zone of EXCLUSION_ZONES) {
    if (p.distanceToSquared(zone.center) <= zone.radius * zone.radius) return true
  }
  return false
}

/**
 * Compute every celestial body owned by the cell at integer coords (cx,cy,cz).
 * Pure function of the coordinates: identical input → identical output, always.
 */
// A cell's contents are a pure function of its coordinates, so memoize them — querying the same
// region every stream tick (e.g. while parked) otherwise re-hashes + re-allocates every cell each
// time, which shows up as a periodic frame hitch. Bounded so the map can't grow without limit.
const cellCache = new Map<string, Celestial[]>()
const CELL_CACHE_LIMIT = 8192

function bodiesInCell(cx: number, cy: number, cz: number): Celestial[] {
  const key = `${cx},${cy},${cz}`
  const cached = cellCache.get(key)
  if (cached) return cached
  const out: Celestial[] = []
  // How many bodies this cell holds. Bias toward 0/1 so the field is sparse.
  const countRoll = unitFloat(hash3(cx, cy, cz, 0x1111))
  const count = countRoll < 0.62 ? 0 : countRoll < 0.92 ? 1 : MAX_BODIES_PER_CELL

  const baseX = cx * CELL_SIZE
  const baseY = cy * CELL_SIZE
  const baseZ = cz * CELL_SIZE

  for (let i = 0; i < count; i++) {
    const hType = hash3(cx, cy, cz, 0x2000 + i)
    const hx = hash3(cx, cy, cz, 0x3000 + i)
    const hy = hash3(cx, cy, cz, 0x4000 + i)
    const hz = hash3(cx, cy, cz, 0x5000 + i)
    const hr = hash3(cx, cy, cz, 0x6000 + i)
    const hSeed = hash3(cx, cy, cz, 0x7000 + i)

    const spec = pickType(unitFloat(hType))
    const position = new Vector3(
      baseX + unitFloat(hx) * CELL_SIZE,
      baseY + unitFloat(hy) * CELL_SIZE,
      baseZ + unitFloat(hz) * CELL_SIZE,
    )

    // Keep the hand-authored starting area special.
    if (inExclusionZone(position)) continue

    const radius = spec.minRadius + unitFloat(hr) * (spec.maxRadius - spec.minRadius)
    out.push({
      id: `cel.${cx}.${cy}.${cz}.${i}`,
      type: spec.type,
      position,
      radius,
      seed: hSeed | 0,
    })
  }
  if (cellCache.size >= CELL_CACHE_LIMIT) cellCache.clear() // simple bound; cells are cheap to rebuild
  cellCache.set(key, out)
  return out
}

/**
 * Every celestial body whose CENTER lies within `radius` of `center`.
 *
 * Stable & seamless: results come from per-cell hashing, so two queries that
 * overlap return byte-identical bodies in their shared region, and flying
 * across a cell boundary never makes a body pop into a different place.
 *
 * Note: a body's *visual* extent (its own `radius`) may poke past the query
 * sphere; this returns bodies by center membership. Callers that need every
 * body that *intersects* the sphere can simply query with a padded radius.
 */
export function queryCelestials(center: Vector3, radius: number): Celestial[] {
  const r = Math.max(0, radius)
  const minCx = Math.floor((center.x - r) / CELL_SIZE)
  const maxCx = Math.floor((center.x + r) / CELL_SIZE)
  const minCy = Math.floor((center.y - r) / CELL_SIZE)
  const maxCy = Math.floor((center.y + r) / CELL_SIZE)
  const minCz = Math.floor((center.z - r) / CELL_SIZE)
  const maxCz = Math.floor((center.z + r) / CELL_SIZE)

  const r2 = r * r
  const result: Celestial[] = []
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bodies = bodiesInCell(cx, cy, cz)
        for (const body of bodies) {
          if (body.position.distanceToSquared(center) <= r2) result.push(body)
        }
      }
    }
  }
  return result
}
