import * as THREE from 'three'
import type { ShipType } from '../sim/shipTypes'
import type { HolderShipVisualId } from '../ui/holderShipVisual'

/** Pure param parsing + framing math for the ship studio, split out so it is unit-testable
 *  without a WebGL context. */

const SHIP_TYPES: readonly ShipType[] = ['hauler', 'fighter', 'miner', 'interceptor']
const VISUALS: readonly HolderShipVisualId[] = [
  'standard', 'doge-runner', 'void-interceptor', 'sovereign-wraith', 'eclipse-corvette', 'abyssal-driller',
]

/** Placeholder tints for buildCraft() before the GLB swaps in. Only visible for a few frames. */
export const STUDIO_HULL_TINT: Record<ShipType, number> = {
  hauler: 0x8f9aa6,
  fighter: 0xb58a3a,
  miner: 0x6f7d8a,
  interceptor: 0x7a6fa8,
}

export type StudioRig = 'game' | 'showcase'

export interface StudioParams {
  ship: ShipType
  visual: HolderShipVisualId
  tier: number
  rig: StudioRig
  yawRad: number
  pitchRad: number
  /** Camera distance as a multiple of the hull's bounding-box diagonal, or null to auto-frame. */
  dist: number | null
}

/** Default 3/4 view — shows a lit face, a shadowed face and the silhouette in one frame, which is
 *  what a straight-on or fully-lit angle cannot do. */
const DEFAULT_YAW_DEG = 215
const DEFAULT_PITCH_DEG = 12

function pickEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  const v = (raw ?? '').trim().toLowerCase()
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function num(raw: string | null, fallback: number): number {
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

export function parseStudioParams(search: URLSearchParams): StudioParams {
  const distRaw = search.get('dist')
  const distParsed = Number(distRaw)
  return {
    ship: pickEnum(search.get('ship'), SHIP_TYPES, 'interceptor'),
    visual: pickEnum(search.get('visual'), VISUALS, 'standard'),
    tier: Math.max(0, Math.min(3, Math.floor(num(search.get('tier'), 0)))),
    rig: pickEnum(search.get('rig'), ['game', 'showcase'] as const, 'game'),
    yawRad: THREE.MathUtils.degToRad(num(search.get('yaw'), DEFAULT_YAW_DEG)),
    pitchRad: THREE.MathUtils.degToRad(num(search.get('pitch'), DEFAULT_PITCH_DEG)),
    dist: distRaw !== null && Number.isFinite(distParsed) && distParsed > 0 ? distParsed : null,
  }
}

/** Frame the hull from its bounding box so every ship class fills a comparable share of the frame —
 *  the hauler is several times the interceptor's size, and a fixed distance would make them
 *  incomparable. `distMultiple` overrides the auto multiple of the box diagonal. */
export function studioCameraPosition(size: THREE.Vector3, distMultiple: number | null): THREE.Vector3 {
  const diagonal = Math.max(1e-3, size.length())
  const distance = diagonal * (distMultiple ?? 1.45)
  // Slightly above and to the right, so the default yaw presents a three-quarter view.
  return new THREE.Vector3(0.62, 0.34, 1).normalize().multiplyScalar(distance)
}
