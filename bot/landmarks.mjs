import { Vector3 } from 'three'

// Destinations the bot flies between. Coordinates mirror the game's named system (stable after the
// respacing). If the system is respaced again, update these to match src/sim/solarSystem.ts.
const SUN = new Vector3(0, -4000, -52000)
const PLANET_SPEC = [
  { id: 'planet-mercury', name: 'Mercury', dist: 40000, angle: 225 },
  { id: 'planet-venus', name: 'Venus', dist: 55000, angle: 160 },
  { id: 'planet-earth', name: 'Earth', dist: 70000, angle: 90 },
  { id: 'planet-mars', name: 'Mars', dist: 85000, angle: 315 },
  { id: 'planet-jupiter', name: 'Jupiter', dist: 100000, angle: 25 },
  { id: 'planet-saturn', name: 'Saturn', dist: 116000, angle: 200 },
]

function planetPos(dist, angleDeg) {
  const a = (angleDeg * Math.PI) / 180
  return new Vector3(SUN.x + Math.cos(a) * dist, SUN.y, SUN.z + Math.sin(a) * dist)
}

// `weight` biases the bot toward the start-area outposts (where players spawn) so it actually gets
// within the relay's small AOI of real pilots, instead of wandering empty space around far planets.
export const LANDMARKS = [
  ...PLANET_SPEC.map((p) => ({ id: p.id, name: p.name, position: planetPos(p.dist, p.angle), weight: 1 })),
  { id: 'refinery', name: 'Meridian Refinery', position: new Vector3(120, 30, -350), weight: 6 },
  { id: 'colony', name: 'Helios Mining Colony', position: new Vector3(-1900, -800, -7000), weight: 4 },
]

/** Weighted pick of a landmark other than `currentId`. `rng` returns a float in [0,1). */
export function pickDestination(landmarks, currentId, rng) {
  const options = landmarks.filter((l) => l.id !== currentId)
  const pool = options.length ? options : landmarks
  const total = pool.reduce((s, l) => s + (l.weight ?? 1), 0)
  let r = rng() * total
  for (const l of pool) { r -= l.weight ?? 1; if (r <= 0) return l }
  return pool[pool.length - 1]
}

// --- Activity destinations (mirror src/sim values; the bot can't import the TS) ---
export const BLACK_HOLE_CENTER = new Vector3(118000, 9000, 118000)
export const BLACK_HOLE_TIDAL = 18000      // hull-damage radius in-game; the bot skims just outside it
export const BLACK_HOLE_INFLUENCE = 50000  // gravity/lensing visual begins here

export const PVP_ARENA_CENTER = new Vector3(92000, 26000, -210000)   // PVP_PRACTICE_ZONE_CENTER in src/sim/pvp.ts (player-vs-player)
export const TRAINING_ARENA_CENTER = new Vector3(88000, 26000, -206000) // TRAINING_RANGE_CENTER in src/sim/pvp.ts (where drones spawn)
export const SEASON_HUB_CENTER = new Vector3(93000, 26300, -218800)  // race time-trial origin

// Offsets from src/main.ts hubRoutePoint calls (hub time-trial gates); no sim-level source file.
const RACE_GATE_OFFSETS = [
  [0, 210, 1620], [-760, 280, 1240], [-1380, 320, 360], [-1180, 230, -720],
  [-250, 390, -1450], [760, 280, -1220], [1440, 250, -240], [1120, 340, 850],
  [380, 300, 1450], [0, 240, 2120],
]
export const RACE_GATES = RACE_GATE_OFFSETS.map(
  ([x, y, z]) => new Vector3(SEASON_HUB_CENTER.x + x, SEASON_HUB_CENTER.y + y, SEASON_HUB_CENTER.z + z),
)

// Stations the bot can tour. Refinery/colony reuse the existing LANDMARKS entries.
const REFINERY = LANDMARKS.find((l) => l.id === 'refinery')
const COLONY = LANDMARKS.find((l) => l.id === 'colony')
if (!REFINERY || !COLONY) throw new Error('landmarks.mjs: refinery/colony entries missing from LANDMARKS')
export const STATIONS = [
  REFINERY,
  COLONY,
  { id: 'season-hub', name: 'Citizen Season Hub', position: SEASON_HUB_CENTER },
]

// Bundle of every coordinate the activity engine needs, so the engine itself is world-agnostic and
// can be driven by either the Node bot (these mirror coords) or the browser (the same bundle).
export const BOT_WORLD = {
  landmarks: LANDMARKS,
  stations: STATIONS,
  raceGates: RACE_GATES,
  pvpArenaCenter: PVP_ARENA_CENTER,
  trainingArenaCenter: TRAINING_ARENA_CENTER, // bot pvp-training spars drones here (not the PvP-practice zone)
  blackHoleCenter: BLACK_HOLE_CENTER,
  blackHoleInfluence: BLACK_HOLE_INFLUENCE,
}
