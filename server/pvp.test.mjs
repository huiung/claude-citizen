import { describe, expect, it } from 'vitest'
import {
  applyPvpHit,
  isInPvpZone,
  normalizeShip,
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

  it('kills, reports zero hull, resets target hull, and suppresses repeated rewards', () => {
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
    expect(target.hull).toBe(target.maxHull)

    for (let i = 0; i < 4; i++) {
      result = applyPvpHit({ attacker, target, now: 3000 + i * 300, rewardMemory: rewards })
    }
    expect(result.killed).toBe(true)
    expect(result.reward).toBe(0)
  })
})
