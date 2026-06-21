import { Vector3 } from 'three'
import type { ShipType } from './shipTypes'

export const PVP_ZONE_CENTER = new Vector3(-850, -260, -3600)
export const PVP_ZONE_RADIUS = 1250
export const PVP_HIT_RANGE = 900
export const PVP_KILL_REWARD = 180
export const PVP_REPEAT_REWARD_COOLDOWN_MS = 5 * 60 * 1000

export interface PvpWeaponStat {
  damage: number
  interval: number
}

export const PVP_WEAPONS: Record<ShipType, PvpWeaponStat> = {
  hauler: { damage: 10, interval: 0.18 },
  fighter: { damage: 12, interval: 0.16 },
  miner: { damage: 16, interval: 0.22 },
  interceptor: { damage: 9, interval: 0.14 },
}

export function isInPvpZone(position: Vector3): boolean {
  return position.distanceToSquared(PVP_ZONE_CENTER) <= PVP_ZONE_RADIUS * PVP_ZONE_RADIUS
}

export function pvpZoneIntensity(position: Vector3): number {
  const d = position.distanceTo(PVP_ZONE_CENTER)
  return Math.max(0, Math.min(1, 1 - d / PVP_ZONE_RADIUS))
}

export function pvpWeaponForShip(type: ShipType): PvpWeaponStat {
  return PVP_WEAPONS[type] ?? PVP_WEAPONS.hauler
}

export function pvpKillReward(lastRewardAt: number | null, now: number): number {
  if (lastRewardAt !== null && now - lastRewardAt < PVP_REPEAT_REWARD_COOLDOWN_MS) return 0
  return PVP_KILL_REWARD
}
