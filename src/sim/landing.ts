import type * as THREE from 'three'

/** Ceiling above the deck face where the LAND prompt appears (world units). */
export const LANDING_MAX_ALT = 40
/** Speed gate — hovering, not strafing past (units/s). */
export const LANDING_MAX_SPEED = 30

/** Pad tangent-plane test: 0..MAX_ALT above the deck, lateral offset inside the pad
 *  radius, and slow enough. Allocation-free — runs every frame near a city. */
export function computeLandingEligibility(
  shipPos: THREE.Vector3, shipVel: THREE.Vector3,
  padCenter: THREE.Vector3, padNormal: THREE.Vector3, padRadius: number,
): boolean {
  const rx = shipPos.x - padCenter.x
  const ry = shipPos.y - padCenter.y
  const rz = shipPos.z - padCenter.z
  const alt = rx * padNormal.x + ry * padNormal.y + rz * padNormal.z
  if (alt < 0 || alt > LANDING_MAX_ALT) return false
  const lx = rx - padNormal.x * alt
  const ly = ry - padNormal.y * alt
  const lz = rz - padNormal.z * alt
  if (lx * lx + ly * ly + lz * lz > padRadius * padRadius) return false
  return shipVel.lengthSq() <= LANDING_MAX_SPEED * LANDING_MAX_SPEED
}

export interface LandingReward {
  credits: number
  first: boolean
  /** collection size after this landing (first visit counts itself) */
  count: number
}

/** First visit pays big and grows the collection; revisits pay small (the caller
 *  repairs the hull on revisit). Mutating `visited` stays with the caller. */
export function landingReward(cityName: string, visited: ReadonlySet<string>): LandingReward {
  const first = !visited.has(cityName)
  return { credits: first ? 1500 : 150, first, count: visited.size + (first ? 1 : 0) }
}
