import { Vector3 } from 'three'
import type { ShipType } from './shipTypes'

export const PVP_PRACTICE_ZONE_RADIUS = 1800
export const PVP_RANKED_ZONE_RADIUS = 2200
export const PVP_ZONE_RADIUS = PVP_PRACTICE_ZONE_RADIUS
export const PVP_ARENA_CLEAR_RADIUS = 90000
export const PVP_ARENA_ENTRY_HINT_DISTANCE = 4500
export const PVP_HIT_RANGE = 900
export const PVP_PEER_HIT_RADIUS = 12
export const PVP_KILL_REWARD = 180
export const PVP_REPEAT_REWARD_COOLDOWN_MS = 5 * 60 * 1000
export const PVP_RANKED_MIN_TOKEN_BALANCE = 1000
export const TRAINING_RANGE_RADIUS = 1500
export const TRAINING_RANGE_CENTER = new Vector3(88000, 26000, -206000)
export const PVP_PRACTICE_ZONE_CENTER = new Vector3(92000, 26000, -210000)
export const PVP_RANKED_ZONE_CENTER = new Vector3(96000, 26000, -214000)
export const PVP_ZONE_CENTER = PVP_PRACTICE_ZONE_CENTER
export const PVP_ARENA_APPROACH_DISTANCE = Math.max(PVP_RANKED_ZONE_RADIUS * 1.5, 650)

export const TRAINING_RANGE_DESTINATION = {
  id: 'training.range',
  name: 'Training Arena',
  kind: 'Drone training arena',
  position: TRAINING_RANGE_CENTER,
  radius: TRAINING_RANGE_RADIUS,
} as const

export interface PvpZone {
  id: 'practice' | 'ranked'
  quantumId: string
  name: string
  kind: string
  center: Vector3
  radius: number
}

export interface PvpZoneProximity {
  zone: PvpZone
  inside: boolean
  distanceToBoundary: number
}

export const PVP_ZONES: readonly PvpZone[] = [
  {
    id: 'practice',
    quantumId: 'pvp.practice',
    name: 'Practice Arena',
    kind: 'Open combat beacon',
    center: PVP_PRACTICE_ZONE_CENTER,
    radius: PVP_PRACTICE_ZONE_RADIUS,
  },
  {
    id: 'ranked',
    quantumId: 'pvp.ranked',
    name: 'Ranked Arena',
    kind: 'Holder-ranked beacon',
    center: PVP_RANKED_ZONE_CENTER,
    radius: PVP_RANKED_ZONE_RADIUS,
  },
]

export const PVP_ARENA_DESTINATIONS = [
  TRAINING_RANGE_DESTINATION,
  ...PVP_ZONES.map(({ quantumId, name, kind, center, radius }) => ({
    id: quantumId,
    name,
    kind,
    position: center,
    radius,
  })),
] as readonly {
  id: string
  name: string
  kind: string
  position: Vector3
  radius: number
}[]

export const PVP_ARENA_ID = PVP_ARENA_DESTINATIONS[0].id
export const PVP_ARENA_NAME = PVP_ARENA_DESTINATIONS[0].name
export const PVP_ARENA_KIND = PVP_ARENA_DESTINATIONS[0].kind

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

export function pvpZoneAt(position: Vector3): PvpZone | null {
  return PVP_ZONES.find((zone) => position.distanceToSquared(zone.center) <= zone.radius * zone.radius) ?? null
}

export function pvpZoneProximity(position: Vector3): PvpZoneProximity | null {
  let nearest: PvpZoneProximity | null = null
  for (const zone of PVP_ZONES) {
    const signedDistance = position.distanceTo(zone.center) - zone.radius
    const distanceToBoundary = Math.abs(signedDistance)
    if (signedDistance > PVP_ARENA_ENTRY_HINT_DISTANCE) continue
    if (!nearest || distanceToBoundary < nearest.distanceToBoundary) {
      nearest = { zone, inside: signedDistance <= 0, distanceToBoundary }
    }
  }
  return nearest
}

export function isInPvpZone(position: Vector3): boolean {
  return pvpZoneAt(position) !== null
}

export function isInTrainingRange(position: Vector3): boolean {
  return position.distanceToSquared(TRAINING_RANGE_CENTER) <= TRAINING_RANGE_RADIUS * TRAINING_RANGE_RADIUS
}

export function trainingDronesActive(position: Vector3, isMobileCivilian: boolean): boolean {
  if (isMobileCivilian) return false
  return isInTrainingRange(position)
}

export function pvpCombatActive(position: Vector3, isMobileCivilian: boolean): boolean {
  return !isMobileCivilian && isInPvpZone(position)
}

export function isInRankedPvpZone(position: Vector3): boolean {
  return pvpZoneAt(position)?.id === 'ranked'
}

export function rankedPvpAccess(holderBalance: number): boolean {
  return Number(holderBalance) >= PVP_RANKED_MIN_TOKEN_BALANCE
}

export function allowsPveHostiles(position: Vector3, isMobileCivilian = false): boolean {
  return !isMobileCivilian && !isInPvpZone(position) && !isInTrainingRange(position)
}

export function shouldClearPveHostiles({
  safe,
  pvpActive,
  trainingActive = false,
  mobileCivilian = false,
  pirates,
  pirateProjectiles,
}: {
  safe: boolean
  pvpActive: boolean
  trainingActive?: boolean
  mobileCivilian?: boolean
  pirates: number
  pirateProjectiles: number
}): boolean {
  return (safe || pvpActive || trainingActive || mobileCivilian) && (pirates > 0 || pirateProjectiles > 0)
}

export function pvpZoneIntensity(position: Vector3): number {
  const intensity = Math.max(...PVP_ZONES.map((zone) => 1 - position.distanceTo(zone.center) / zone.radius))
  return Math.max(0, Math.min(1, intensity))
}

export function pvpArenaApproachPoint(from: Vector3, center = PVP_ZONE_CENTER, approachDistance = PVP_ARENA_APPROACH_DISTANCE): Vector3 {
  const dir = from.clone().sub(center)
  if (dir.lengthSq() < 1) dir.set(0, 0, 1)
  return center.clone().add(dir.normalize().multiplyScalar(approachDistance))
}

export function pvpWeaponForShip(type: ShipType): PvpWeaponStat {
  return PVP_WEAPONS[type] ?? PVP_WEAPONS.hauler
}

export function pvpKillReward(lastRewardAt: number | null, now: number): number {
  if (lastRewardAt !== null && now - lastRewardAt < PVP_REPEAT_REWARD_COOLDOWN_MS) return 0
  return PVP_KILL_REWARD
}
