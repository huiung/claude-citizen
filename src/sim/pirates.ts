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

export type PirateArchetype = 'chaser' | 'lancer' | 'swarm'

export interface ArchetypeBehavior {
  engageRange: number
  standoff: number
  speed: number
  fireInterval: number
  damage: number
  projSpeed: number
  hullMul: number
  weaveAmp: number
  weaveRate: number
}

// chaser row == the legacy PIRATE_* constants (no-regression). lancer = long-range heavy sniper,
// low hull. swarm = fast, fragile, many. All values are live-tunable starting points.
export const ARCHETYPE_BEHAVIOR: Record<PirateArchetype, ArchetypeBehavior> = {
  chaser: { engageRange: PIRATE_ENGAGE_RANGE, standoff: PIRATE_STANDOFF, speed: PIRATE_SPEED, fireInterval: PIRATE_FIRE_INTERVAL, damage: PIRATE_DAMAGE, projSpeed: PIRATE_PROJECTILE_SPEED, hullMul: 1, weaveAmp: 28, weaveRate: 0.9 },
  lancer: { engageRange: 900, standoff: 700, speed: 40, fireInterval: 2.4, damage: 20, projSpeed: 620, hullMul: 0.6, weaveAmp: 0, weaveRate: 0 },
  swarm:  { engageRange: 260, standoff: 70,  speed: 95, fireInterval: 0.9, damage: 4,  projSpeed: 300, hullMul: 0.35, weaveAmp: 40, weaveRate: 1.6 },
}

// Weighted archetype roll: chaser 50% / lancer 30% / swarm 20%.
export function pickArchetype(rng: () => number): PirateArchetype {
  const r = rng()
  if (r < 0.5) return 'chaser'
  if (r < 0.8) return 'lancer'
  return 'swarm'
}

export type BossAbility = 'summon' | 'volley'

export interface BossKit {
  ability: BossAbility
  abilityIntervalSec: number
  telegraphSec: number
  volleyBolts: number
  volleySpreadRad: number
  summonCount: number
  enrageAtHullFrac: number
  enrageFireMul: number
  enrageSpeedMul: number
}

export const BOSS_KITS: Record<'vex' | 'captain', BossKit> = {
  vex:     { ability: 'summon', abilityIntervalSec: 9,   telegraphSec: 0,   volleyBolts: 0, volleySpreadRad: 0,    summonCount: 3, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
  captain: { ability: 'volley', abilityIntervalSec: 6.5, telegraphSec: 0.8, volleyBolts: 5, volleySpreadRad: 0.16, summonCount: 0, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
}

export interface BossRuntime {
  kit: BossKit
  abilityCd: number
  telegraphCd: number
  enraged: boolean
}

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
  /** Behavior archetype — drives the AI in stepPirate (orthogonal to tier). */
  archetype: PirateArchetype
  /** Per-unit weave phase so units don't strafe in sync. */
  seed: number
  /** Present only for named campaign bosses — drives the ability kit in stepPirate. */
  boss?: BossRuntime
  /** Display name — set only for named minibosses. */
  name?: string
}

/** Spawn overrides. NOTE: `tier`/`name` are labels only — they do NOT auto-apply
 *  PIRATE_TIER_HULL_MUL / PIRATE_TIER_REWARD; pass `hullMul`/`reward` explicitly for tier-scaled stats. */
export interface SpawnPirateOpts {
  hullMul?: number
  reward?: number
  tier?: PirateTier
  archetype?: PirateArchetype
  seed?: number
  name?: string
  bossKey?: 'vex' | 'captain'
}

/** Spawn a pirate. `opts.hullMul` toughens it, `opts.reward` overrides payout, `opts.tier`/`opts.name`
 *  mark elites and named minibosses. Defaults reproduce the original base grunt. */
export function spawnPirate(id: string, position: Vector3, opts: SpawnPirateOpts = {}): Pirate {
  const tier = opts.tier ?? 'grunt'
  const archetype = opts.archetype ?? 'chaser'
  const behavior = ARCHETYPE_BEHAVIOR[archetype]
  const boss: BossRuntime | undefined = opts.bossKey
    ? { kit: BOSS_KITS[opts.bossKey], abilityCd: BOSS_KITS[opts.bossKey].abilityIntervalSec, telegraphCd: 0, enraged: false }
    : undefined
  return {
    id,
    position: position.clone(),
    velocity: new Vector3(),
    health: createHealth(Math.round(PIRATE_HULL * behavior.hullMul * (opts.hullMul ?? 1))),
    weapon: createWeapon(behavior.fireInterval),
    reward: opts.reward ?? PIRATE_REWARD,
    tier,
    archetype,
    seed: opts.seed ?? 0,
    name: opts.name,
    boss,
  }
}

const _weavePerp = new Vector3()
const _weaveUp = new Vector3(0, 1, 0)
const _weaveAlt = new Vector3(1, 0, 0)
/** A lateral (perpendicular-to-`forward`) strafe offset that oscillates over time. `seed` shifts the
 *  phase so units don't weave in sync. amp<=0 → zero vector. Pure (deterministic in its inputs). */
export function weaveOffset(nowSec: number, amp: number, rate: number, seed: number, forward: Vector3 = new Vector3(0, 0, -1)): Vector3 {
  if (amp <= 0) return new Vector3()
  // A perpendicular axis: cross(forward, up), or cross(forward, x-axis) if forward is ~parallel to up.
  const f = forward.lengthSq() > 1e-9 ? forward.clone().normalize() : new Vector3(0, 0, -1)
  _weavePerp.crossVectors(f, Math.abs(f.y) < 0.99 ? _weaveUp : _weaveAlt).normalize()
  const s = Math.sin((nowSec * rate + seed) * Math.PI * 2)
  return _weavePerp.multiplyScalar(amp * s).clone()
}

/** True when a pirate at `dist` metres should be culled — too far to threaten or be hit. */
export function shouldDespawnPirate(dist: number): boolean {
  return dist > PIRATE_LEASH_RANGE
}

export interface PirateStepResult {
  fired: Projectile | null
  volley?: Projectile[]
  telegraphStart?: boolean
  summon?: number
}

const _toTarget = new Vector3()

/**
 * Advance one pirate toward `targetPos`:
 *  - beyond engage range: close in at full speed
 *  - within engage range but past standoff: drift in slowly, shoot when ready
 *  - inside standoff: back off (avoid hugging the player)
 * Mutates the pirate's position/velocity/weapon. Returns any shot fired.
 */
export function stepPirate(pirate: Pirate, targetPos: Vector3, dt: number, nowSec = 0): PirateStepResult {
  const b = ARCHETYPE_BEHAVIOR[pirate.archetype]
  pirate.weapon.cooldown = Math.max(0, pirate.weapon.cooldown - dt)

  _toTarget.subVectors(targetPos, pirate.position)
  const dist = _toTarget.length()
  const dir = dist > 1e-6 ? _toTarget.clone().multiplyScalar(1 / dist) : new Vector3(0, 0, -1)

  let speed: number
  if (dist > b.engageRange) speed = b.speed
  else if (dist < b.standoff) speed = -b.speed * 0.6 // back off
  else speed = b.speed * 0.25 // hold and harass

  // Radial move toward/away from the target, plus a perpendicular weave strafe (chaser/swarm).
  pirate.velocity.copy(dir).multiplyScalar(speed)
  pirate.position.addScaledVector(pirate.velocity, dt)
  if (b.weaveAmp > 0) {
    const w = weaveOffset(nowSec, b.weaveAmp, b.weaveRate, pirate.seed, dir)
    pirate.position.addScaledVector(w, dt)
  }

  let fired: Projectile | null = null
  if (dist <= b.engageRange && pirate.weapon.cooldown <= 0) {
    fired = spawnProjectile(pirate.position, dir, 'pirate', b.projSpeed, b.damage) // aim stays straight at target
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
