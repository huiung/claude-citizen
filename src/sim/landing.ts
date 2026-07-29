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

/** Gap left between the hull's lowest point and the deck face when parked. Small and non-zero: at
 *  exactly zero the deck and the hull's belly z-fight along whatever face happens to be flattest. */
export const LANDING_DECK_CLEARANCE = 0.06

/** How far the hull's lowest point sits below its own origin, once the landing attitude is applied.
 *
 *  Landing used to park every hull at a fixed 2.2 units above the deck. That number was tuned on the
 *  hauler, whose gear happens to reach about that far below its centre; on the flatter hulls it parks
 *  the ship in mid-air, which a capture of the fighter shows unmistakably — its wingtip is above the
 *  pilot's head and there is clear sky under the fuselage.
 *
 *  `boxMin`/`boxMax` are the hull's bounding box in its OWN frame, and `normalInHull` is the pad
 *  normal rotated into that frame (i.e. `padNormal` under the inverse of the landing attitude). The
 *  answer is the most negative projection of any box corner onto that axis. A box rather than the mesh
 *  is deliberate: the box contains the hull, so the error can only ever park the ship slightly high,
 *  never sunk into the deck.
 */
export function hullDeckOffset(
  boxMin: THREE.Vector3, boxMax: THREE.Vector3, normalInHull: THREE.Vector3,
): number {
  // min over the 8 corners of dot(corner, axis) — separable, so pick the lower term per axis.
  const dot = Math.min(boxMin.x * normalInHull.x, boxMax.x * normalInHull.x)
    + Math.min(boxMin.y * normalInHull.y, boxMax.y * normalInHull.y)
    + Math.min(boxMin.z * normalInHull.z, boxMax.z * normalInHull.z)
  // A hull whose box does not straddle its origin would otherwise be sunk; clamp at "rest on the
  // deck" rather than trusting a degenerate box.
  return Math.max(0, -dot) + LANDING_DECK_CLEARANCE
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
