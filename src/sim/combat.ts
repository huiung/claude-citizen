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

export function isDead(h: Health): boolean {
  return h.hull <= 0
}

/** Fraction of hull remaining, 0..1 (for HUD bars). */
export function hullFraction(h: Health): number {
  return h.max <= 0 ? 0 : h.hull / h.max
}

// --- Projectiles
export const PROJECTILE_SPEED = 380
export const PROJECTILE_LIFE = 2.2
export const PROJECTILE_DAMAGE = 12

export interface Projectile {
  position: Vector3
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
): Projectile {
  const v = dir.clone()
  if (v.lengthSq() < 1e-9) v.set(0, 0, -1)
  v.normalize().multiplyScalar(speed)
  return { position: origin.clone(), velocity: v, life: PROJECTILE_LIFE, faction, damage }
}

/** Advance every projectile, decrement life, and remove expired ones in place. */
export function stepProjectiles(projectiles: Projectile[], dt: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]
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
      if (p.position.distanceToSquared(t.position) <= t.radius * t.radius) {
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
