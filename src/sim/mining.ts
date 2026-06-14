// Asteroid mining — pure logic, no rendering, no DOM. Tested in mining.test.ts.
//
// Asteroids hold finite ORE reserves. When the ship is within MINING_RANGE of an
// asteroid and the mining laser is active, ORE accrues over time at MINING_YIELD
// units/second and flows into the player's cargo, capped by both the asteroid's
// remaining reserves and the cargo's free space. Reserves deplete permanently.

import { Vector3 } from 'three'
import { CARGO_CAPACITY, cargoFree, type PlayerEconomy } from './economy'

/** Distance (world units) within which the mining laser can reach an asteroid. */
export const MINING_RANGE = 60

/** ORE units mined per second from an in-range asteroid while active. */
export const MINING_YIELD = 2

export interface Asteroid {
  id: string
  position: Vector3
  /** Remaining ORE this asteroid can give up. Depletes toward 0 and never refills. */
  reserves: number
}

/** Caller-owned mining world: the set of asteroids that can be mined. */
export interface AsteroidField {
  asteroids: Asteroid[]
}

export interface MineStepResult {
  /** The nearest asteroid within range, or null if none was reachable. */
  asteroid: Asteroid | null
  /** ORE actually transferred into cargo this step (0 if nothing mined). */
  mined: number
  /** Whether a minable asteroid was within range this step. */
  inRange: boolean
}

const NO_OP: MineStepResult = { asteroid: null, mined: 0, inRange: false }

/**
 * Create an asteroid field from raw spec. Positions are cloned so the field owns
 * its own Vector3 instances.
 */
export function createAsteroidField(
  specs: ReadonlyArray<{ id: string; position: Vector3; reserves: number }>,
): AsteroidField {
  return {
    asteroids: specs.map((s) => ({
      id: s.id,
      position: s.position.clone(),
      reserves: s.reserves,
    })),
  }
}

/** Find the nearest asteroid to `shipPos` that is within MINING_RANGE and still has reserves. */
function nearestInRange(field: AsteroidField, shipPos: Vector3): Asteroid | null {
  let best: Asteroid | null = null
  let bestDistSq = MINING_RANGE * MINING_RANGE
  for (const a of field.asteroids) {
    if (a.reserves <= 0) continue
    const distSq = a.position.distanceToSquared(shipPos)
    if (distSq <= bestDistSq) {
      bestDistSq = distSq
      best = a
    }
  }
  return best
}

/**
 * Advance mining by `dt` seconds. When `active` and a minable asteroid is within
 * range, transfer up to `MINING_YIELD * dt` ORE — clamped by the asteroid's
 * remaining reserves and the cargo's free space — into `econ.cargo.ORE`.
 *
 * Pure with respect to inputs other than the two pieces of caller-owned state it
 * mutates: it depletes `asteroid.reserves` and fills `econ.cargo.ORE`.
 *
 * Returns which asteroid was targeted, how much ORE was mined, and whether any
 * asteroid was in range. A no-op (mined: 0) when inactive, out of range, the
 * asteroid is empty, or the cargo hold is full.
 */
export function mineStep(
  field: AsteroidField,
  shipPos: Vector3,
  econ: PlayerEconomy,
  dt: number,
  active: boolean,
  capacity: number = CARGO_CAPACITY,
): MineStepResult {
  if (!active || dt <= 0) return NO_OP

  const asteroid = nearestInRange(field, shipPos)
  if (!asteroid) return NO_OP

  // In range, but how much can we actually take?
  const wanted = MINING_YIELD * dt
  const mined = Math.max(0, Math.min(wanted, asteroid.reserves, cargoFree(econ, capacity)))

  asteroid.reserves -= mined
  econ.cargo.ORE += mined

  return { asteroid, mined, inRange: true }
}
