// Pirate NPCs — spawn, chase, and shoot. Pure logic built on combat.ts.
// Tested in pirates.test.ts. main.ts owns the array, meshes, and projectile list.

import { Vector3 } from 'three'
import {
  createHealth, createWeapon, type Health, type Projectile, spawnProjectile, type Weapon,
} from './combat'

export const PIRATE_HULL = 36
export const PIRATE_SPEED = 55
export const PIRATE_ENGAGE_RANGE = 320 // start shooting within this distance
export const PIRATE_STANDOFF = 120 // try to hold this distance; back off if closer
export const PIRATE_FIRE_INTERVAL = 1.1
export const PIRATE_DAMAGE = 7
export const PIRATE_PROJECTILE_SPEED = 300
export const PIRATE_REWARD = 250 // credits for a kill
// A pirate this far from the player is neither a threat (it only fires within
// PIRATE_ENGAGE_RANGE) nor hittable (past WEAPON_RANGE ≈ 3080m), and at PIRATE_SPEED 55
// it would crawl for ~30 min to re-close. Cull it so the MAX_PIRATES slot frees up for a
// fresh near spawn. Sits well beyond WEAPON_RANGE so an active dogfight never culls a pirate.
export const PIRATE_LEASH_RANGE = 5000

export type PirateTier = 'grunt' | 'elite' | 'named'

// Per-tier toughness + payout (starting values, tuned live). Named is a sector miniboss.
export const PIRATE_TIER_HULL_MUL: Record<PirateTier, number> = { grunt: 1, elite: 2.5, named: 8 }
export const PIRATE_TIER_REWARD: Record<PirateTier, number> = { grunt: PIRATE_REWARD, elite: 700, named: 4000 }

export interface Pirate {
  id: string
  position: Vector3
  velocity: Vector3
  health: Health
  weapon: Weapon
  /** Credits paid for killing this pirate (richer the deeper it spawned). */
  reward: number
  /** Threat tier: grunt (default), elite, or a named sector miniboss. */
  tier: PirateTier
  /** Display name — set only for named minibosses. */
  name?: string
}

export interface SpawnPirateOpts {
  hullMul?: number
  reward?: number
  tier?: PirateTier
  name?: string
}

/** Spawn a pirate. `opts.hullMul` toughens it, `opts.reward` overrides payout, `opts.tier`/`opts.name`
 *  mark elites and named minibosses. Defaults reproduce the original base grunt. */
export function spawnPirate(id: string, position: Vector3, opts: SpawnPirateOpts = {}): Pirate {
  const tier = opts.tier ?? 'grunt'
  return {
    id,
    position: position.clone(),
    velocity: new Vector3(),
    health: createHealth(Math.round(PIRATE_HULL * (opts.hullMul ?? 1))),
    weapon: createWeapon(PIRATE_FIRE_INTERVAL),
    reward: opts.reward ?? PIRATE_REWARD,
    tier,
    name: opts.name,
  }
}

/** True when a pirate at `dist` metres should be culled — too far to threaten or be hit. */
export function shouldDespawnPirate(dist: number): boolean {
  return dist > PIRATE_LEASH_RANGE
}

export interface PirateStepResult {
  /** A projectile the pirate fired this step, or null. */
  fired: Projectile | null
}

const _toTarget = new Vector3()

/**
 * Advance one pirate toward `targetPos`:
 *  - beyond engage range: close in at full speed
 *  - within engage range but past standoff: drift in slowly, shoot when ready
 *  - inside standoff: back off (avoid hugging the player)
 * Mutates the pirate's position/velocity/weapon. Returns any shot fired.
 */
export function stepPirate(pirate: Pirate, targetPos: Vector3, dt: number): PirateStepResult {
  pirate.weapon.cooldown = Math.max(0, pirate.weapon.cooldown - dt)

  _toTarget.subVectors(targetPos, pirate.position)
  const dist = _toTarget.length()
  const dir = dist > 1e-6 ? _toTarget.clone().multiplyScalar(1 / dist) : new Vector3(0, 0, -1)

  let speed: number
  if (dist > PIRATE_ENGAGE_RANGE) speed = PIRATE_SPEED
  else if (dist < PIRATE_STANDOFF) speed = -PIRATE_SPEED * 0.6 // back off
  else speed = PIRATE_SPEED * 0.25 // hold and harass

  pirate.velocity.copy(dir).multiplyScalar(speed)
  pirate.position.addScaledVector(pirate.velocity, dt)

  let fired: Projectile | null = null
  if (dist <= PIRATE_ENGAGE_RANGE && pirate.weapon.cooldown <= 0) {
    fired = spawnProjectile(pirate.position, dir, 'pirate', PIRATE_PROJECTILE_SPEED, PIRATE_DAMAGE)
    pirate.weapon.cooldown = pirate.weapon.interval
  }
  return { fired }
}

/**
 * Deterministic spawn position on a sphere around `center` at `radius`, derived
 * from an integer `n` (no Math.random — keeps spawns reproducible/testable).
 */
export function spawnPositionAround(center: Vector3, radius: number, n: number): Vector3 {
  // Cheap golden-angle-ish distribution over the sphere.
  const ga = 2.399963 // golden angle
  const y = 1 - (2 * ((n % 16) + 0.5)) / 16
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = ga * n
  return new Vector3(
    center.x + radius * r * Math.cos(theta),
    center.y + radius * y,
    center.z + radius * r * Math.sin(theta),
  )
}
