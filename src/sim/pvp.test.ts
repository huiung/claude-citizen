import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { SUN_POSITION, SYSTEM_RADIUS } from './solarSystem'
import {
  isInPvpZone,
  PVP_KILL_REWARD,
  PVP_REPEAT_REWARD_COOLDOWN_MS,
  PVP_WEAPONS,
  PVP_ARENA_APPROACH_DISTANCE,
  PVP_ARENA_DESTINATIONS,
  PVP_ARENA_CLEAR_RADIUS,
  PVP_ARENA_ENTRY_HINT_DISTANCE,
  PVP_PRACTICE_ZONE_CENTER,
  PVP_PEER_HIT_RADIUS,
  PVP_RANKED_MIN_TOKEN_BALANCE,
  PVP_RANKED_ZONE_CENTER,
  PVP_ZONE_CENTER,
  PVP_ZONE_RADIUS,
  pvpArenaApproachPoint,
  pvpKillReward,
  pvpWeaponForShip,
  pvpZoneProximity,
  pvpZoneAt,
  pvpZoneIntensity,
  rankedPvpAccess,
  allowsPveHostiles,
} from './pvp'

describe('pvp zone rules', () => {
  it('activates only inside the combat zone radius', () => {
    expect(isInPvpZone(PVP_ZONE_CENTER.clone())).toBe(true)
    expect(isInPvpZone(PVP_ZONE_CENTER.clone().add(new Vector3(PVP_ZONE_RADIUS + 1, 0, 0)))).toBe(false)
  })

  it('reports strongest intensity at the center and zero outside', () => {
    expect(pvpZoneIntensity(PVP_ZONE_CENTER.clone())).toBe(1)
    expect(pvpZoneIntensity(PVP_ZONE_CENTER.clone().add(new Vector3(PVP_ZONE_RADIUS, 0, 0)))).toBe(0)
  })

  it('defines a quantum beacon that drops pilots outside the arena edge', () => {
    expect(PVP_ARENA_DESTINATIONS.map((dest) => dest.id)).toEqual(['pvp.practice', 'pvp.ranked'])
    expect(PVP_ARENA_DESTINATIONS.map((dest) => dest.name)).toEqual(['Practice Arena', 'Ranked Arena'])
    expect(PVP_ARENA_DESTINATIONS.map((dest) => dest.kind)).toEqual(['Open combat beacon', 'Holder-ranked beacon'])

    const approach = pvpArenaApproachPoint(new Vector3(0, 0, 0), PVP_RANKED_ZONE_CENTER)
    const distFromCenter = approach.distanceTo(PVP_RANKED_ZONE_CENTER)

    expect(distFromCenter).toBeCloseTo(PVP_ARENA_APPROACH_DISTANCE, 5)
    expect(distFromCenter).toBeGreaterThan(PVP_ZONE_RADIUS)
    expect(approach.z).toBeGreaterThan(PVP_RANKED_ZONE_CENTER.z)
  })

  it('separates open practice combat from holder-ranked combat', () => {
    expect(pvpZoneAt(PVP_PRACTICE_ZONE_CENTER.clone())?.id).toBe('practice')
    expect(pvpZoneAt(PVP_RANKED_ZONE_CENTER.clone())?.id).toBe('ranked')
    expect(isInPvpZone(PVP_RANKED_ZONE_CENTER.clone())).toBe(true)
  })

  it('reports nearby arena entry distance while the pilot is just outside the boundary', () => {
    const outside = PVP_PRACTICE_ZONE_CENTER.clone().add(new Vector3(PVP_ZONE_RADIUS + 320, 0, 0))
    const status = pvpZoneProximity(outside)

    expect(PVP_ARENA_ENTRY_HINT_DISTANCE).toBeGreaterThan(320)
    expect(status?.zone.id).toBe('practice')
    expect(status?.inside).toBe(false)
    expect(status?.distanceToBoundary).toBeCloseTo(320, 5)
  })

  it('omits arena entry hints when the pilot is far from every arena', () => {
    const far = PVP_PRACTICE_ZONE_CENTER.clone().add(new Vector3(0, PVP_ZONE_RADIUS + PVP_ARENA_ENTRY_HINT_DISTANCE + 1, 0))
    expect(pvpZoneProximity(far)).toBeNull()
  })

  it('requires at least 1,000 tokens for ranked PvP access', () => {
    expect(PVP_RANKED_MIN_TOKEN_BALANCE).toBe(1000)
    expect(rankedPvpAccess(999.99)).toBe(false)
    expect(rankedPvpAccess(1000)).toBe(true)
  })

  it('places the combat arena outside the named solar system for a deep-space backdrop', () => {
    expect(PVP_ZONE_CENTER.distanceTo(SUN_POSITION)).toBeGreaterThan(SYSTEM_RADIUS + 25000)
    expect(PVP_ARENA_CLEAR_RADIUS).toBeGreaterThan(55000)
  })

  it('suppresses PvE hostiles inside the PvP combat zone', () => {
    expect(allowsPveHostiles(PVP_ZONE_CENTER.clone())).toBe(false)
    expect(allowsPveHostiles(PVP_RANKED_ZONE_CENTER.clone())).toBe(false)
    expect(allowsPveHostiles(PVP_ZONE_CENTER.clone().add(new Vector3(PVP_ZONE_RADIUS + 1, 0, 0)))).toBe(true)
  })
})

describe('pvp weapon and reward rules', () => {
  it('gives fast interceptors lower damage than fighters and miners', () => {
    expect(PVP_WEAPONS.interceptor.damage).toBeLessThan(PVP_WEAPONS.fighter.damage)
    expect(PVP_WEAPONS.miner.damage).toBeGreaterThan(PVP_WEAPONS.fighter.damage)
    expect(pvpWeaponForShip('hauler')).toBe(PVP_WEAPONS.hauler)
  })

  it('uses a forgiving peer hit radius for fast PvP passes', () => {
    expect(PVP_PEER_HIT_RADIUS).toBeGreaterThan(7)
    expect(PVP_PEER_HIT_RADIUS).toBeLessThanOrEqual(14)
  })

  it('suppresses rewards for repeat kills during the cooldown window', () => {
    expect(pvpKillReward(null, 1000)).toBe(PVP_KILL_REWARD)
    expect(pvpKillReward(1000, 1000 + PVP_REPEAT_REWARD_COOLDOWN_MS - 1)).toBe(0)
    expect(pvpKillReward(1000, 1000 + PVP_REPEAT_REWARD_COOLDOWN_MS)).toBe(PVP_KILL_REWARD)
  })
})
