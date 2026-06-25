import { describe, expect, it } from 'vitest'
import {
  applyPvpRespawn,
  applyPvpHit,
  isInPvpZone,
  normalizeShip,
  PVP_COMBAT_TAG_MS,
  PVP_HIT_RANGE,
  PVP_KILL_REWARD,
  PVP_RANKED_MIN_TOKEN_BALANCE,
  PVP_ZONES,
  PVP_ZONE,
  pvpZoneAt,
  rankedPvpAccess,
  resetPvpHull,
} from './pvp.mjs'

function client(id, ship = 'fighter', p = [PVP_ZONE.x, PVP_ZONE.y, PVP_ZONE.z]) {
  const c = { id, active: true, ship, p: [...p] }
  resetPvpHull(c, ship)
  return c
}

describe('server PvP rules', () => {
  it('normalizes unknown ships to hauler', () => {
    expect(normalizeShip('interceptor')).toBe('interceptor')
    expect(normalizeShip('bogus')).toBe('hauler')
  })

  it('rejects points outside the arena', () => {
    expect(PVP_ZONES.practice.x).toBe(92000)
    expect(PVP_ZONES.practice.y).toBe(26000)
    expect(PVP_ZONES.practice.z).toBe(-210000)
    expect(PVP_ZONES.practice.radius).toBe(1800)
    expect(PVP_ZONES.ranked.radius).toBe(2200)
    expect(PVP_ZONES.ranked.radius).toBeGreaterThan(PVP_ZONES.practice.radius)
    expect(pvpZoneAt([PVP_ZONES.practice.x, PVP_ZONES.practice.y, PVP_ZONES.practice.z])?.id).toBe('practice')
    expect(pvpZoneAt([PVP_ZONES.ranked.x, PVP_ZONES.ranked.y, PVP_ZONES.ranked.z])?.id).toBe('ranked')
    expect(isInPvpZone([PVP_ZONES.ranked.x, PVP_ZONES.ranked.y, PVP_ZONES.ranked.z])).toBe(true)
    expect(isInPvpZone([PVP_ZONE.x + PVP_ZONE.radius + 1, PVP_ZONE.y, PVP_ZONE.z])).toBe(false)
  })

  it('gates ranked combat on a 1,000 token balance', () => {
    expect(PVP_RANKED_MIN_TOKEN_BALANCE).toBe(1000)
    expect(rankedPvpAccess(999)).toBe(false)
    expect(rankedPvpAccess(1000)).toBe(true)

    const attacker = client('a', 'fighter', [PVP_ZONES.ranked.x, PVP_ZONES.ranked.y, PVP_ZONES.ranked.z])
    const target = client('b', 'hauler', [PVP_ZONES.ranked.x + 100, PVP_ZONES.ranked.y, PVP_ZONES.ranked.z])
    attacker.holderBalance = 999
    target.holderBalance = 1000
    expect(applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() }).reason).toBe('ranked-locked')

    attacker.holderBalance = 1000
    const result = applyPvpHit({ attacker, target, now: 2000, rewardMemory: new Map() })
    expect(result.ok).toBe(true)
  })

  it('damages targets only inside the zone', () => {
    const attacker = client('a')
    const target = client('b', 'hauler')
    const result = applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() })
    expect(result.ok).toBe(true)
    expect(target.hull).toBe(88)

    const outside = client('c', 'fighter', [0, 0, 0])
    expect(applyPvpHit({ attacker: outside, target, now: 2000, rewardMemory: new Map() }).reason).toBe('outside-zone')
  })

  it('kills and leaves the target dead until an explicit respawn arrives', () => {
    const rewards = new Map()
    const attacker = client('a', 'miner')
    const target = client('b', 'interceptor')

    let result
    for (let i = 0; i < 4; i++) {
      result = applyPvpHit({ attacker, target, now: 1000 + i * 300, rewardMemory: rewards })
    }

    expect(result.ok).toBe(true)
    expect(result.killed).toBe(true)
    expect(result.reward).toBe(PVP_KILL_REWARD)
    expect(result.hull).toBe(0)
    expect(target.hull).toBe(0)
    expect(applyPvpHit({ attacker, target, now: 3000, rewardMemory: rewards }).reason).toBe('dead-target')

    const respawnPoint = [PVP_ZONE.x + 80, PVP_ZONE.y, PVP_ZONE.z]
    const respawn = applyPvpRespawn(target, { p: respawnPoint, q: [0, 0, 0, 1], ship: 'interceptor' })
    expect(respawn).toEqual({ ok: true, hull: target.maxHull, maxHull: target.maxHull })
    expect(target.hull).toBe(target.maxHull)
    expect(target.p).toEqual(respawnPoint)
    expect(target.q).toEqual([0, 0, 0, 1])

    for (let i = 0; i < 4; i++) result = applyPvpHit({ attacker, target, now: 4000 + i * 300, rewardMemory: rewards })
    expect(result.killed).toBe(true)
    expect(result.reward).toBe(0)
  })

  it('does not let living pilots use respawn as a heal', () => {
    const target = client('b', 'fighter')
    target.hull = target.maxHull - 10
    expect(applyPvpRespawn(target, { p: [1, 2, 3], q: [0, 0, 0, 1], ship: 'fighter' })).toEqual({ ok: false, reason: 'alive' })
    expect(target.hull).toBe(target.maxHull - 10)
  })

  it('lets a tagged pair keep hitting just outside the zone, within range', () => {
    const attacker = client('a', 'fighter')
    const target = client('b', 'hauler')
    const first = applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() })
    expect(first.ok).toBe(true)
    // both are now tagged; move them together well outside the zone but within hit range of each other
    target.p = [attacker.p[0] + 300, attacker.p[1], attacker.p[2] + 50000]
    attacker.p = [target.p[0] + 200, target.p[1], target.p[2]]
    const pursue = applyPvpHit({ attacker, target, now: 1500, rewardMemory: new Map() })
    expect(pursue.ok).toBe(true)
  })

  it('rejects an out-of-zone hit once the combat tag has expired', () => {
    const attacker = client('a', 'fighter')
    const target = client('b', 'hauler')
    applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() }) // seed tags in-zone
    attacker.p = [0, 0, 0]
    target.p = [200, 0, 0] // both far outside any zone, within PVP_HIT_RANGE of each other
    // at the expiry boundary — strict < means the tag has lapsed
    expect(applyPvpHit({ attacker, target, now: 1000 + PVP_COMBAT_TAG_MS, rewardMemory: new Map() }).reason).toBe('outside-zone')
    // one ms before expiry — still allowed
    expect(applyPvpHit({ attacker, target, now: 1000 + PVP_COMBAT_TAG_MS - 1, rewardMemory: new Map() }).ok).toBe(true)
  })

  it('rejects out-of-zone hits when the parties are NOT both tagged', () => {
    const attacker = client('a', 'fighter', [PVP_ZONES.practice.x + 60000, PVP_ZONES.practice.y, PVP_ZONES.practice.z])
    const target = client('b', 'hauler', [PVP_ZONES.practice.x + 60200, PVP_ZONES.practice.y, PVP_ZONES.practice.z])
    expect(applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() }).reason).toBe('outside-zone')
  })

  it('still rejects a tagged pursuit once beyond hit range', () => {
    const attacker = client('a', 'fighter')
    const target = client('b', 'hauler')
    applyPvpHit({ attacker, target, now: 1000, rewardMemory: new Map() })
    target.p = [attacker.p[0] + PVP_HIT_RANGE + 500, attacker.p[1], attacker.p[2] + 50000]
    expect(applyPvpHit({ attacker, target, now: 1500, rewardMemory: new Map() }).reason).toBe('too-far')
  })

  it('stamps lastPvpCombatAt on both parties after a successful hit', () => {
    const attacker = client('a', 'fighter')
    const target = client('b', 'hauler')
    applyPvpHit({ attacker, target, now: 4242, rewardMemory: new Map() })
    expect(attacker.lastPvpCombatAt).toBe(4242)
    expect(target.lastPvpCombatAt).toBe(4242)
  })
})
