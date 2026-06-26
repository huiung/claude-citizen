// Combat core — health, projectiles, weapons. Pure logic, no rendering, no DOM.
// Tested in combat.test.ts. Pirates (pirates.ts) build their AI on top of this.

import { Vector3 } from 'three'

export type Faction = 'player' | 'pirate' | 'peer'

// --- Health
export interface Health {
  hull: number
  max: number
}

export function createHealth(max: number): Health {
  return { hull: max, max }
}

/** Apply `amount` damage, clamped at 0. Mutates. */
export function applyDamage(h: Health, amount: number): void {
  if (amount <= 0) return
  h.hull = Math.max(0, h.hull - amount)
}

/** Repair `amount` hull, clamped at max. Mutates. */
export function repairHull(h: Health, amount: number): void {
  if (amount <= 0) return
  h.hull = Math.min(h.max, h.hull + amount)
}

export function isDead(h: Health): boolean {
  return h.hull <= 0
}

/** Fraction of hull remaining, 0..1 (for HUD bars). */
export function hullFraction(h: Health): number {
  return h.max <= 0 ? 0 : h.hull / h.max
}

// --- Projectiles
// Player shots are fast across the board so fast (boosting) hulls can actually be hit — in PvP and
// against pirates alike. (Pirates use their own slower PIRATE_PROJECTILE_SPEED, so this doesn't make
// enemy fire harder to dodge.)
export const PROJECTILE_SPEED = 1400
export const PROJECTILE_LIFE = 2.2
export const PROJECTILE_DAMAGE = 12

/** How far a bolt travels before it fizzles — the honest "can I land a hit" range. */
export const WEAPON_RANGE = PROJECTILE_SPEED * PROJECTILE_LIFE

/** True when a target at `dist` metres is close enough that a bolt could reach it. */
export function isEngageable(dist: number): boolean {
  return dist <= WEAPON_RANGE
}

export interface Projectile {
  position: Vector3
  previousPosition: Vector3
  velocity: Vector3
  /** Seconds of life remaining before it fizzles. */
  life: number
  faction: Faction
  damage: number
}

/** Spawn a bolt travelling along `dir` (need not be normalized) from `origin`. */
export function spawnProjectile(
  origin: Vector3,
  dir: Vector3,
  faction: Faction,
  speed: number = PROJECTILE_SPEED,
  damage: number = PROJECTILE_DAMAGE,
  inheritedVelocity?: Vector3,
): Projectile {
  const aim = dir.clone()
  if (aim.lengthSq() < 1e-9) aim.set(0, 0, -1)
  aim.normalize()
  const v = aim.clone().multiplyScalar(speed)
  if (inheritedVelocity) {
    v.add(inheritedVelocity)
    const inheritedForward = inheritedVelocity.dot(aim)
    if (inheritedForward < 0) v.addScaledVector(aim, -inheritedForward)
  }
  return { position: origin.clone(), previousPosition: origin.clone(), velocity: v, life: PROJECTILE_LIFE, faction, damage }
}

/** Advance every projectile, decrement life, and remove expired ones in place. */
export function stepProjectiles(projectiles: Projectile[], dt: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    p.previousPosition.copy(p.position)
    p.position.addScaledVector(p.velocity, dt)
    p.life -= dt
    if (p.life <= 0) projectiles.splice(i, 1)
  }
}

// --- Hit resolution
export interface HitTarget {
  id?: string
  position: Vector3
  radius: number
  health: Health
  faction: Faction
}

export interface Hit {
  projectile: Projectile
  target: HitTarget
}

const _hitSegment = new Vector3()
const _hitTargetOffset = new Vector3()
const _hitClosest = new Vector3()

function projectileHitsTarget(p: Projectile, t: HitTarget): boolean {
  const radiusSq = t.radius * t.radius
  if (p.position.distanceToSquared(t.position) <= radiusSq) return true

  const previous = p.previousPosition ?? p.position
  _hitSegment.copy(p.position).sub(previous)
  const segmentLengthSq = _hitSegment.lengthSq()
  if (segmentLengthSq < 1e-9) return previous.distanceToSquared(t.position) <= radiusSq

  const along = _hitTargetOffset.copy(t.position).sub(previous).dot(_hitSegment) / segmentLengthSq
  const clamped = Math.max(0, Math.min(1, along))
  _hitClosest.copy(previous).addScaledVector(_hitSegment, clamped)
  return _hitClosest.distanceToSquared(t.position) <= radiusSq
}

/**
 * Check each projectile against every target of a DIFFERENT faction. On the first
 * hit, apply damage to that target and remove the projectile. Returns the hits
 * (for VFX/audio). A projectile never hits its own faction.
 */
export function resolveHits(projectiles: Projectile[], targets: HitTarget[]): Hit[] {
  const hits: Hit[] = []
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
    for (const t of targets) {
      if (t.faction === p.faction) continue
      if (isDead(t.health)) continue
      if (projectileHitsTarget(p, t)) {
        applyDamage(t.health, p.damage)
        hits.push({ projectile: p, target: t })
        projectiles.splice(i, 1)
        break
      }
    }
  }
  return hits
}

// --- Weapon (fire-rate gate)
export interface Weapon {
  /** Seconds until the weapon can fire again. */
  cooldown: number
  /** Seconds between shots. */
  interval: number
}

export function createWeapon(interval: number): Weapon {
  return { cooldown: 0, interval }
}

export function canFire(w: Weapon): boolean {
  return w.cooldown <= 0
}

/** Put the weapon on cooldown. Call right after a successful shot. */
export function fire(w: Weapon): void {
  w.cooldown = w.interval
}

export function stepWeapon(w: Weapon, dt: number): void {
  w.cooldown = Math.max(0, w.cooldown - dt)
}
