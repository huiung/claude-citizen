// A static singularity in the far system: a steep inward gravity well + an absolute kill radius.
// Pure (math + constants); the flight loop and renderer consume these. All numbers are starting
// values, tuned live in-game so the closest *survivable* approach depends on ship speed + skill.
import { Vector3 } from 'three'

// Remote corner of the system (SYSTEM_RADIUS is 130000) — a long haul from the inner worlds.
export const BLACK_HOLE_CENTER = new Vector3(-118000, 9000, -118000)
export const HORIZON_RADIUS = 1100 // absolute point of no return — crossing it is fatal for any hull
export const INFLUENCE_RADIUS = 10000 // gravity begins here, gentle, and steepens toward the center
// Peak inward pull (m/s²) at the horizon. Tuned so each hull has a distinct "point of no return"
// well outside the horizon: a ship escapes while its engine can out-pull gravity, i.e. until
// g(d) = accelResponse(1.6) × (topSpeed × boost). Capture radius d ≈ HORIZON × √(MAX/(1.6·Vmax)).
// At 6000 that lands roughly: miner ~5800, hauler ~3700, fighter ~2600, interceptor ~2200 —
// so faster hulls dive far deeper before they can no longer pull out. Tuned in-game.
export const MAX_GRAVITY_ACCEL = 6000

const _tmp = new Vector3()

export function distanceToCenter(pos: Vector3): number {
  return pos.distanceTo(BLACK_HOLE_CENTER)
}

export function withinInfluence(pos: Vector3): boolean {
  return distanceToCenter(pos) < INFLUENCE_RADIUS
}

export function isPastHorizon(pos: Vector3): boolean {
  return distanceToCenter(pos) <= HORIZON_RADIUS
}

/** Inward gravitational acceleration at `pos` (m/s²). Grows ~1/d² toward the center, clamped to
 *  MAX_GRAVITY_ACCEL, and is exactly zero at/beyond the influence radius. Writes into `out`. */
export function gravityAccel(pos: Vector3, out: Vector3 = new Vector3()): Vector3 {
  const d = distanceToCenter(pos)
  if (d >= INFLUENCE_RADIUS || d === 0) return out.set(0, 0, 0)
  const mag = Math.min(MAX_GRAVITY_ACCEL, MAX_GRAVITY_ACCEL * (HORIZON_RADIUS / d) ** 2)
  return out.copy(BLACK_HOLE_CENTER).sub(pos).normalize().multiplyScalar(mag)
}

/** Quantum-jump target: a safe staging point just outside the influence radius. Rides the same
 *  PVP_ARENA_DESTINATIONS machinery as the other special destinations. */
export const BLACK_HOLE_APPROACH_DESTINATION = {
  id: 'black-hole-approach',
  name: 'Black Hole',
  kind: 'Singularity',
  position: _tmp.copy(BLACK_HOLE_CENTER).add(new Vector3(INFLUENCE_RADIUS + 2500, 0, 0)).clone(),
  radius: INFLUENCE_RADIUS,
  approachDistance: 1800,
} as const
