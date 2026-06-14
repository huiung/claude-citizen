import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { isDead } from './combat'
import {
  PIRATE_ENGAGE_RANGE, PIRATE_HULL, PIRATE_STANDOFF, spawnPirate, spawnPositionAround, stepPirate,
} from './pirates'

describe('spawnPirate', () => {
  it('starts at full hull with a ready weapon', () => {
    const p = spawnPirate('p1', new Vector3(0, 0, 1000))
    expect(p.health.hull).toBe(PIRATE_HULL)
    expect(isDead(p.health)).toBe(false)
    expect(p.weapon.cooldown).toBe(0)
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
