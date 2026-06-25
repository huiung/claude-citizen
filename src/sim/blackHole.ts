// A static singularity in the far system: a steep inward gravity well + an absolute kill radius.
// Pure (math + constants); the flight loop and renderer consume these. All numbers are starting
// values, tuned live in-game so the closest *survivable* approach depends on ship speed + skill.
import { Vector3 } from 'three'

// Remote corner of the system (SYSTEM_RADIUS is 130000) — a long haul from the inner worlds.
export const BLACK_HOLE_CENTER = new Vector3(-118000, 9000, -118000)
// Radii are sized to the game's speed scale: a fully-upgraded hull boosts at ~4000+ m/s, so a tiny
// well is crossed in under a second. These give a fully-upgraded fighter a ~10s influence-edge→horizon
// dive, with a few seconds inside the tidal zone to commit and pull out. (Visual auto-scales off HORIZON.)
export const HORIZON_RADIUS = 5500 // absolute point of no return — crossing it is fatal for any hull
export const INFLUENCE_RADIUS = 50000 // gravity begins here, gentle, and steepens toward the center
// Peak inward pull (m/s²) at the horizon. Kept moderate so a boosting ship can climb out of the
// danger zone — the real depth limit is the tidal damage below, not gravity capture. Gravity is
// for the "you're being dragged in, fight it" tension + drama. (Capture radius ≈ HORIZON·√(MAX/(1.6·Vmax)),
// which at 800 sits at/inside the horizon for fast hulls — i.e. they can always pull out.)
export const MAX_GRAVITY_ACCEL = 800

// Tidal-shear damage zone: inside TIDAL_RADIUS the hull takes damage per second that ramps from 0 at
// the zone edge to TIDAL_MAX_DPS at the horizon (steep, ∝ depth²). This is the true challenge — dive
// deep, bleed hull, and pull out before it kills you. The hard horizon below is the instant-death backstop.
// DPS is lower than it looks: the zone is ~12.5k thick, so a hull lingers seconds, and damage compounds.
export const TIDAL_RADIUS = 18000
export const TIDAL_MAX_DPS = 30

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

/** Hull damage per second from tidal shear at `pos`: 0 at/beyond TIDAL_RADIUS, ramping ∝ depth²
 *  to TIDAL_MAX_DPS at the horizon. Pure. The flight loop multiplies this by dt and subtracts it. */
export function tidalDamageRate(pos: Vector3): number {
  const d = distanceToCenter(pos)
  if (d >= TIDAL_RADIUS) return 0
  if (d <= HORIZON_RADIUS) return TIDAL_MAX_DPS
  const q = (TIDAL_RADIUS - d) / (TIDAL_RADIUS - HORIZON_RADIUS) // 0 at the edge → 1 at the horizon
  return TIDAL_MAX_DPS * q * q
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
