import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { isDead, WEAPON_RANGE } from './combat'
import {
  ARCHETYPE_BEHAVIOR, pickArchetype, weaveOffset,
  PIRATE_DAMAGE, PIRATE_ENGAGE_RANGE, PIRATE_FIRE_INTERVAL, PIRATE_HULL, PIRATE_LEASH_RANGE,
  PIRATE_PROJECTILE_SPEED, PIRATE_REWARD, PIRATE_SPEED, PIRATE_STANDOFF, shouldDespawnPirate,
  spawnPirate, spawnPositionAround, stepPirate,
} from './pirates'
import { BOSS_KITS } from './pirates'

describe('BOSS_KITS', () => {
  it('vex is a summoner; captain is a telegraphed gunner', () => {
    expect(BOSS_KITS.vex.ability).toBe('summon')
    expect(BOSS_KITS.vex.summonCount).toBeGreaterThan(0)
    expect(BOSS_KITS.captain.ability).toBe('volley')
    expect(BOSS_KITS.captain.telegraphSec).toBeGreaterThan(0)
    expect(BOSS_KITS.captain.volleyBolts).toBeGreaterThan(1)
  })
  it('both enrage below a hull fraction with faster fire + speed', () => {
    for (const k of [BOSS_KITS.vex, BOSS_KITS.captain]) {
      expect(k.enrageAtHullFrac).toBeGreaterThan(0)
      expect(k.enrageAtHullFrac).toBeLessThan(1)
      expect(k.enrageFireMul).toBeLessThan(1) // faster
      expect(k.enrageSpeedMul).toBeGreaterThan(1)
    }
  })
})

describe('weaveOffset', () => {
  const forward = new Vector3(0, 0, -1)
  it('returns zero when amplitude is 0 (lancer flies straight)', () => {
    expect(weaveOffset(1.2, 0, 1, 3).lengthSq()).toBe(0)
  })
  it('is perpendicular to forward and bounded by amplitude', () => {
    for (const t of [0.1, 0.5, 1.0, 2.3]) {
      const off = weaveOffset(t, 40, 1.5, 7, forward)
      expect(Math.abs(off.dot(forward))).toBeLessThan(1e-6) // perpendicular
      expect(off.length()).toBeLessThanOrEqual(40 + 1e-6)   // bounded by amp
    }
  })
  it('oscillates over time (not constant)', () => {
    const a = weaveOffset(0.0, 40, 1.5, 0, forward)
    const b = weaveOffset(0.5, 40, 1.5, 0, forward)
    expect(a.distanceTo(b)).toBeGreaterThan(1e-3)
  })
  it('is deterministic for the same inputs', () => {
    const a = weaveOffset(0.7, 40, 1.5, 2, forward)
    const b = weaveOffset(0.7, 40, 1.5, 2, forward)
    expect(a.equals(b)).toBe(true)
  })
})

describe('ARCHETYPE_BEHAVIOR', () => {
  it('chaser stats equal the legacy pirate constants (no regression)', () => {
    const c = ARCHETYPE_BEHAVIOR.chaser
    expect(c.engageRange).toBe(PIRATE_ENGAGE_RANGE)
    expect(c.standoff).toBe(PIRATE_STANDOFF)
    expect(c.speed).toBe(PIRATE_SPEED)
    expect(c.fireInterval).toBe(PIRATE_FIRE_INTERVAL)
    expect(c.damage).toBe(PIRATE_DAMAGE)
    expect(c.projSpeed).toBe(PIRATE_PROJECTILE_SPEED)
    expect(c.hullMul).toBe(1)
  })
  it('lancer snipes from long range; swarm is fast and fragile', () => {
    expect(ARCHETYPE_BEHAVIOR.lancer.engageRange).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.engageRange)
    expect(ARCHETYPE_BEHAVIOR.lancer.damage).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.damage)
    expect(ARCHETYPE_BEHAVIOR.swarm.speed).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.speed)
  })
  it('hull order: swarm < lancer < chaser', () => {
    expect(ARCHETYPE_BEHAVIOR.swarm.hullMul).toBeLessThan(ARCHETYPE_BEHAVIOR.lancer.hullMul)
    expect(ARCHETYPE_BEHAVIOR.lancer.hullMul).toBeLessThan(ARCHETYPE_BEHAVIOR.chaser.hullMul)
  })
})

describe('pickArchetype', () => {
  it('maps the weighted bands (chaser 50 / lancer 30 / swarm 20)', () => {
    expect(pickArchetype(() => 0)).toBe('chaser')
    expect(pickArchetype(() => 0.49)).toBe('chaser')
    expect(pickArchetype(() => 0.5)).toBe('lancer')
    expect(pickArchetype(() => 0.79)).toBe('lancer')
    expect(pickArchetype(() => 0.8)).toBe('swarm')
    expect(pickArchetype(() => 0.999)).toBe('swarm')
  })
})

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

  it('carries the elite tier', () => {
    const e = spawnPirate('e1', new Vector3(), { tier: 'elite' })
    expect(e.tier).toBe('elite')
    expect(e.name).toBeUndefined()
  })

  it('carries an explicit tier and name', () => {
    const named = spawnPirate('boss', new Vector3(), { tier: 'named', name: 'Vex Marrow', hullMul: 8, reward: 4000 })
    expect(named.tier).toBe('named')
    expect(named.name).toBe('Vex Marrow')
    expect(named.health.hull).toBe(Math.round(PIRATE_HULL * 8))
  })
})

describe('spawnPirate boss', () => {
  it('attaches a boss runtime for a bossKey (kit + timers + not enraged)', () => {
    const p = spawnPirate('b', new Vector3(0, 0, 100), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
    expect(p.boss).toBeDefined()
    expect(p.boss!.kit).toBe(BOSS_KITS.vex)
    expect(p.boss!.abilityCd).toBe(BOSS_KITS.vex.abilityIntervalSec)
    expect(p.boss!.telegraphCd).toBe(0)
    expect(p.boss!.enraged).toBe(false)
  })
  it('is undefined for a normal pirate', () => {
    expect(spawnPirate('n', new Vector3(0, 0, 100)).boss).toBeUndefined()
  })
})

describe('spawnPirate archetype', () => {
  it('defaults to chaser with legacy hull + fire interval', () => {
    const p = spawnPirate('c', new Vector3(0, 0, 100))
    expect(p.archetype).toBe('chaser')
    expect(p.weapon.interval).toBe(PIRATE_FIRE_INTERVAL)
    expect(p.health.hull).toBe(PIRATE_HULL) // chaser hullMul 1
  })
  it('applies a lancer: longer fire interval + lower hull', () => {
    const p = spawnPirate('l', new Vector3(0, 0, 100), { archetype: 'lancer' })
    expect(p.archetype).toBe('lancer')
    expect(p.weapon.interval).toBe(ARCHETYPE_BEHAVIOR.lancer.fireInterval)
    expect(p.health.hull).toBe(Math.round(PIRATE_HULL * ARCHETYPE_BEHAVIOR.lancer.hullMul))
  })
  it('combines archetype hullMul with tier hullMul', () => {
    const p = spawnPirate('s', new Vector3(0, 0, 100), { archetype: 'swarm', hullMul: 2 })
    expect(p.health.hull).toBe(Math.round(PIRATE_HULL * ARCHETYPE_BEHAVIOR.swarm.hullMul * 2))
  })
  it('carries the seed it was given', () => {
    expect(spawnPirate('x', new Vector3(0, 0, 100), { seed: 5 }).seed).toBe(5)
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

describe('stepPirate archetype behavior', () => {
  const origin = new Vector3(0, 0, 0)
  it('a lancer fires from long range where a chaser cannot', () => {
    const far = () => new Vector3(0, 0, 600) // 600u: > chaser engage (320), < lancer engage (900)
    const chaser = spawnPirate('c', far(), { archetype: 'chaser' })
    const lancer = spawnPirate('l', far(), { archetype: 'lancer' })
    expect(stepPirate(chaser, origin, 0.016).fired).toBeNull()      // out of chaser range
    expect(stepPirate(lancer, origin, 0.016).fired).not.toBeNull()  // in lancer range
  })
  it('a lancer bolt carries the lancer damage + speed', () => {
    const l = spawnPirate('l', new Vector3(0, 0, 600), { archetype: 'lancer' })
    const r = stepPirate(l, origin, 0.016)
    expect(r.fired!.damage).toBe(ARCHETYPE_BEHAVIOR.lancer.damage)
    expect(r.fired!.velocity.length()).toBeCloseTo(ARCHETYPE_BEHAVIOR.lancer.projSpeed, 3)
  })
  it('a swarm unit closes faster than a chaser over the same step', () => {
    const start = new Vector3(0, 0, 500)
    const chaser = spawnPirate('c', start.clone(), { archetype: 'chaser' })
    const swarm = spawnPirate('s', start.clone(), { archetype: 'swarm' })
    stepPirate(chaser, origin, 0.5, 0)
    stepPirate(swarm, origin, 0.5, 0)
    expect(swarm.position.distanceTo(origin)).toBeLessThan(chaser.position.distanceTo(origin))
  })
  it('a chaser strafes laterally at nowSec>0 (weave wiring is live)', () => {
    const start = new Vector3(0, 0, 500)
    const straight = spawnPirate('a', start.clone(), { archetype: 'chaser', seed: 0.25 })
    const weaved = spawnPirate('b', start.clone(), { archetype: 'chaser', seed: 0.25 })
    stepPirate(straight, origin, 0.2, 0)     // weave phase 0 → sin=0 → no lateral offset
    stepPirate(weaved, origin, 0.2, 0.37)    // weave phase != 0 → lateral offset
    // same radial approach, but the weaved unit is displaced off the z-axis (x or y != straight's)
    const dx = Math.abs(weaved.position.x - straight.position.x)
    const dy = Math.abs(weaved.position.y - straight.position.y)
    expect(dx + dy).toBeGreaterThan(1e-3)
  })
})

describe('stepPirate boss abilities', () => {
  const origin = new Vector3(0, 0, 0)
  const summoner = () => spawnPirate('v', new Vector3(0, 0, 200), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
  const gunner = () => spawnPirate('c', new Vector3(0, 0, 600), { tier: 'named', name: 'Raider Captain', archetype: 'lancer', bossKey: 'captain' })

  it('summoner returns summon count once its interval elapses, not before', () => {
    const v = summoner()
    expect(stepPirate(v, origin, 1.0).summon).toBeUndefined()          // 1s < 9s interval
    v.boss!.abilityCd = 0.001                                          // fast-forward to the trigger
    expect(stepPirate(v, origin, 0.002).summon).toBe(BOSS_KITS.vex.summonCount)
  })
  it('gunner telegraphs first, then fires a volley after the telegraph', () => {
    const c = gunner()
    c.boss!.abilityCd = 0.001
    const t = stepPirate(c, origin, 0.002)                             // ability fires → telegraph starts
    expect(t.telegraphStart).toBe(true)
    expect(t.volley).toBeUndefined()
    // still winding up
    expect(stepPirate(c, origin, 0.1).volley).toBeUndefined()
    // finish the telegraph
    const v = stepPirate(c, origin, BOSS_KITS.captain.telegraphSec)
    expect(v.volley).toHaveLength(BOSS_KITS.captain.volleyBolts)
    expect(v.volley!.every((p) => p.faction === 'pirate')).toBe(true)
    // one volley per windup only
    expect(stepPirate(c, origin, 0.1).volley).toBeUndefined()
  })
  it('enrages below the hull fraction (faster ability interval)', () => {
    const v = summoner()
    v.health.hull = v.health.max * 0.3   // < 0.35
    v.boss!.abilityCd = 0.001
    stepPirate(v, origin, 0.002)          // triggers summon + resets abilityCd
    expect(v.boss!.enraged).toBe(true)
    expect(v.boss!.abilityCd).toBeCloseTo(BOSS_KITS.vex.abilityIntervalSec * BOSS_KITS.vex.enrageFireMul, 3)
  })
  it('a normal pirate never returns boss events', () => {
    const g = spawnPirate('g', new Vector3(0, 0, 100))
    const r = stepPirate(g, origin, 0.5)
    expect(r.summon).toBeUndefined()
    expect(r.volley).toBeUndefined()
    expect(r.telegraphStart).toBeUndefined()
  })
  it('enrage is exclusive: not enraged at exactly the hull fraction or full hull', () => {
    const boundary = spawnPirate('vb', new Vector3(0, 0, 200), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
    boundary.health.hull = boundary.health.max * BOSS_KITS.vex.enrageAtHullFrac // exactly at frac
    stepPirate(boundary, origin, 0.016)
    expect(boundary.boss!.enraged).toBe(false)
    const full = spawnPirate('vf', new Vector3(0, 0, 200), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
    stepPirate(full, origin, 0.016)
    expect(full.boss!.enraged).toBe(false)
  })
  it('a summoner never produces a volley or telegraph', () => {
    const v = summoner()
    v.boss!.abilityCd = 0.001
    const r = stepPirate(v, origin, 0.002)
    expect(r.summon).toBe(BOSS_KITS.vex.summonCount)
    expect(r.volley).toBeUndefined()
    expect(r.telegraphStart).toBeUndefined()
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
