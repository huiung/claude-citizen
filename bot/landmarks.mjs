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
