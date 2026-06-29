import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { isDead, WEAPON_RANGE } from './combat'
import {
  PIRATE_ENGAGE_RANGE, PIRATE_HULL, PIRATE_LEASH_RANGE, PIRATE_REWARD, PIRATE_STANDOFF, shouldDespawnPirate,
  spawnPirate, spawnPositionAround, stepPirate,
} from './pirates'

describe('spawnPirate', () => {
  it('starts at full hull with a ready weapon', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, 1000))
    expect(p.health.hull).toBe(PIRATE_HULL)
    expect(isDead(p.health)).toBe(false)
    expect(p.weapon.cooldown).toBe(0)
  })

  it('defaults to base hull and reward', () => {
    const p = spawnPirate('p1', new Vector3())
    expect(p.health.hull).toBe(PIRATE_HULL)
    expect(p.reward).toBe(PIRATE_REWARD)
  })

  it('scales hull and reward for deep-space spawns', () => {
    const deep = spawnPirate('p2', new Vector3(), { hullMul: 2, reward: 600 })
    expect(deep.health.hull).toBe(Math.round(PIRATE_HULL * 2))
    expect(deep.reward).toBe(600)
  })

  it('defaults to the grunt tier with no name', () => {
    const p = spawnPirate('p1', new Vector3())
    expect(p.tier).toBe('grunt')
    expect(p.name).toBeUndefined()
  })

  it('carries an explicit tier and name', () => {
    const named = spawnPirate('boss', new Vector3(), { tier: 'named', name: 'Vex Marrow', hullMul: 8, reward: 4000 })
    expect(named.tier).toBe('named')
    expect(named.name).toBe('Vex Marrow')
    expect(named.health.hull).toBe(Math.round(PIRATE_HULL * 8))
  })
})

describe('stepPirate', () => {
  const origin = new Vector3(0, 0, 0)

  it('closes in when beyond engage range', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, PIRATE_ENGAGE_RANGE + 500))
    const before = p.position.distanceTo(origin)
    stepPirate(p, origin, 0.5)
    expect(p.position.distanceTo(origin)).toBeLessThan(before)
  })

  it('fires when within engage range and off cooldown', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, PIRATE_ENGAGE_RANGE - 50))
    const r = stepPirate(p, origin, 0.016)
    expect(r.fired).not.toBeNull()
    expect(r.fired!.faction).toBe('pirate')
    // weapon now on cooldown — next immediate step does not fire
    expect(stepPirate(p, origin, 0.016).fired).toBeNull()
  })

  it('does not fire when out of range', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, PIRATE_ENGAGE_RANGE + 800))
    expect(stepPirate(p, origin, 0.016).fired).toBeNull()
  })

  it('backs off when closer than standoff', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, PIRATE_STANDOFF - 40))
    const before = p.position.distanceTo(origin)
    stepPirate(p, origin, 0.3)
    expect(p.position.distanceTo(origin)).toBeGreaterThan(before)
  })

  it('fires a bolt aimed toward the target', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, PIRATE_ENGAGE_RANGE - 50))
    const r = stepPirate(p, origin, 0.016)
    // target is at -Z from the pirate, so the bolt should travel in -Z
    expect(r.fired!.velocity.z).toBeLessThan(0)
  })
})

describe('leash despawn', () => {
  it('PIRATE_LEASH_RANGE sits beyond weapon range so a dogfight never culls a pirate', () => {
    expect(PIRATE_LEASH_RANGE).toBeGreaterThan(WEAPON_RANGE)
  })

  it('despawns only beyond the leash range', () => {
    expect(shouldDespawnPirate(0)).toBe(false)
    expect(shouldDespawnPirate(PIRATE_ENGAGE_RANGE)).toBe(false)
    expect(shouldDespawnPirate(WEAPON_RANGE)).toBe(false)
    expect(shouldDespawnPirate(PIRATE_LEASH_RANGE)).toBe(false)
    expect(shouldDespawnPirate(PIRATE_LEASH_RANGE + 1)).toBe(true)
    expect(shouldDespawnPirate(100_000)).toBe(true)
  })
})

describe('spawnPositionAround', () => {
  it('is deterministic and sits on the sphere', () => {
    const c = new Vector3(10, 20, 30)
    const a = spawnPositionAround(c, 500, 3)
    const b = spawnPositionAround(c, 500, 3)
    expect(a).toEqual(b)
    expect(a.distanceTo(c)).toBeCloseTo(500, 3)
  })

  it('different n gives different positions', () => {
    const c = new Vector3()
    expect(spawnPositionAround(c, 500, 1)).not.toEqual(spawnPositionAround(c, 500, 2))
  })
})
