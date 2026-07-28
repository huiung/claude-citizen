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

/** `external` orbits the hull; `cockpit` puts the camera on the hull's cockpit eye anchor, the same
 *  one main.ts flies, so the in-cockpit view can be judged without flying the game. */
export type StudioCam = 'external' | 'cockpit'

export interface StudioParams {
  ship: ShipType
  visual: HolderShipVisualId
  tier: number
  rig: StudioRig
  cam: StudioCam
  yawRad: number
  pitchRad: number
  /** Camera distance as a multiple of the hull's bounding-box diagonal, or null to auto-frame. */
  dist: number | null
  /** Whether the procedural detail maps are attached. `off` is the control half of the A/B that
   *  answers whether they are visible at all — the question a single capture cannot answer. */
  detail: boolean
  /** Overrides for the detail pass, or null to use the module's shipped constants. Sweeping these
   *  from the URL means one capture run covers several values instead of one edit-reload per value. */
  normalScale: number | null
  tileWorldSize: number | null
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

/** A number the caller actually supplied, or null. Distinct from `num` because for the detail
 *  overrides "absent" must mean "use the shipped constant", which no sentinel number can express —
 *  0 is a meaningful normalScale (flat) and would be swallowed by a `|| fallback`. */
function optNum(raw: string | null, min: number): number | null {
  if (raw === null) return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= min ? v : null
}

export function parseStudioParams(search: URLSearchParams): StudioParams {
  const distRaw = search.get('dist')
  const distParsed = Number(distRaw)
  const cam = pickEnum(search.get('cam'), ['external', 'cockpit'] as const, 'external')
  // yaw/pitch mean different things per camera — hull orientation for `external`, where the pilot is
  // looking for `cockpit` — so they need different defaults. The 3/4 default is what makes an
  // external shot readable, but in the cockpit it would point the pilot backwards over their
  // shoulder, which is not the shot anyone reaching for ?cam=cockpit is asking for.
  const defaultYaw = cam === 'cockpit' ? 0 : DEFAULT_YAW_DEG
  const defaultPitch = cam === 'cockpit' ? 0 : DEFAULT_PITCH_DEG
  return {
    ship: pickEnum(search.get('ship'), SHIP_TYPES, 'interceptor'),
    visual: pickEnum(search.get('visual'), VISUALS, 'standard'),
    tier: Math.max(0, Math.min(3, Math.floor(num(search.get('tier'), 0)))),
    rig: pickEnum(search.get('rig'), ['game', 'showcase'] as const, 'game'),
    cam,
    yawRad: THREE.MathUtils.degToRad(num(search.get('yaw'), defaultYaw)),
    pitchRad: THREE.MathUtils.degToRad(num(search.get('pitch'), defaultPitch)),
    dist: distRaw !== null && Number.isFinite(distParsed) && distParsed > 0 ? distParsed : null,
    detail: pickEnum(search.get('detail'), ['on', 'off'] as const, 'on') === 'on',
    normalScale: optNum(search.get('nscale'), 0),
    // A tile smaller than this would alias into noise before it read as plating, so reject it
    // rather than capture a frame that says "detail does not work" when the value was the problem.
    tileWorldSize: optNum(search.get('tile'), 0.05),
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
