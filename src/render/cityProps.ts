import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, SKIRT_MARGIN, type BuildingSpec } from './cityLayout'

// Deterministic PRNG — duplicated per repo convention (see starSky.ts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PropLayout {
  masts: { buildingIdx: number; ox: number; oz: number; h: number }[]
  tanks: { buildingIdx: number; ox: number; oz: number; r: number }[]
  beaconsA: { buildingIdx: number }[]
  beaconsB: { buildingIdx: number }[]
  lamps: { x: number; z: number }[]
}

/** Seed-deterministic prop placement — decides only WHICH building/intersection gets
 *  WHAT (world transforms stay with the chunk builder). Masts on ~40% of buildings,
 *  water tanks on 25% of large footprints, aviation beacons on the tallest 15%
 *  (split into A/B groups for alternating night blink), street lamps on every grid
 *  intersection inside the skirt. */
export function computePropLayout(siteSeed: number, tier: 0 | 1 | 2, buildings: BuildingSpec[]): PropLayout {
  const rand = mulberry32(siteSeed ^ 0x9e3779b9)
  const masts: PropLayout['masts'] = []
  const tanks: PropLayout['tanks'] = []
  buildings.forEach((b, i) => {
    if (rand() < 0.4) {
      masts.push({
        buildingIdx: i,
        ox: (rand() - 0.5) * (b.w - 2),
        oz: (rand() - 0.5) * (b.d - 2),
        h: 9 + rand() * 9,
      })
    }
    if (b.w * b.d >= 400 && rand() < 0.25) {
      tanks.push({
        buildingIdx: i,
        ox: (rand() - 0.5) * (b.w - 8),
        oz: (rand() - 0.5) * (b.d - 8),
        r: 3 + rand() * 2.5,
      })
    }
  })
  const byHeight = buildings.map((b, i) => ({ h: b.h, i })).sort((a, b) => b.h - a.h || a.i - b.i)
  const beaconCount = Math.max(2, Math.round(buildings.length * 0.15))
  const beaconsA: PropLayout['beaconsA'] = []
  const beaconsB: PropLayout['beaconsB'] = []
  byHeight.slice(0, beaconCount).forEach((e, k) => {
    (k % 2 === 0 ? beaconsA : beaconsB).push({ buildingIdx: e.i })
  })
  const extent = CITY_TIER_RADIUS[tier]
  const cell = CITY_BLOCK + CITY_ROAD
  const cells = Math.floor((extent * 2) / cell)
  const lamps: PropLayout['lamps'] = []
  for (let gx = 0; gx <= cells; gx++) {
    for (let gz = 0; gz <= cells; gz++) {
      const x = -extent + cell * gx
      const z = -extent + cell * gz
      if (Math.hypot(x, z) < extent - SKIRT_MARGIN) lamps.push({ x, z })
    }
  }
  return { masts, tanks, beaconsA, beaconsB, lamps }
}
