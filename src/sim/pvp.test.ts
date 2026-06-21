import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  isInPvpZone,
  PVP_KILL_REWARD,
  PVP_REPEAT_REWARD_COOLDOWN_MS,
  PVP_WEAPONS,
  PVP_ZONE_CENTER,
  PVP_ZONE_RADIUS,
  pvpKillReward,
  pvpWeaponForShip,
  pvpZoneIntensity,
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
})

describe('pvp weapon and reward rules', () => {
  it('gives fast interceptors lower damage than fighters and miners', () => {
    expect(PVP_WEAPONS.interceptor.damage).toBeLessThan(PVP_WEAPONS.fighter.damage)
    expect(PVP_WEAPONS.miner.damage).toBeGreaterThan(PVP_WEAPONS.fighter.damage)
    expect(pvpWeaponForShip('hauler')).toBe(PVP_WEAPONS.hauler)
  })

  it('suppresses rewards for repeat kills during the cooldown window', () => {
    expect(pvpKillReward(null, 1000)).toBe(PVP_KILL_REWARD)
    expect(pvpKillReward(1000, 1000 + PVP_REPEAT_REWARD_COOLDOWN_MS - 1)).toBe(0)
    expect(pvpKillReward(1000, 1000 + PVP_REPEAT_REWARD_COOLDOWN_MS)).toBe(PVP_KILL_REWARD)
  })
})
