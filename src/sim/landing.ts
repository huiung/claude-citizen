import type * as THREE from 'three'

/** Ceiling above the deck face where the LAND prompt appears (world units). */
export const LANDING_MAX_ALT = 40
/** Speed gate — hovering, not strafing past (units/s). */
export const LANDING_MAX_SPEED = 30

/** How far above the deck face a hovering hull is held when it settles onto the pad under its own
 *  thrust (see the deck floor in main).
 *
 *  Non-zero for the same class of reason as LANDING_DECK_CLEARANCE, but a different one: parked
 *  EXACTLY on the plane, the `alt < 0` test below decides on float noise. Measured: a hull driven
 *  into the deck came to rest at alt = -1e-13 and the envelope read `below-deck`, so a pilot who did
 *  the obvious thing — descend until you stop — was told to climb, forever. */
export const PAD_FLOOR_CLEARANCE = 0.5

/** Why the LAND prompt is not showing — or `ready` when it is. Ordered the way an approach is
 *  actually flown: get over the deck, come down onto it, then stop moving. */
export type LandingBlocker = 'ready' | 'lateral' | 'below-deck' | 'altitude' | 'speed'

/** The pad-relative geometry of an approach, in the units a pilot is shown. */
export interface LandingApproach {
  blocker: LandingBlocker
  /** offset from the pad's axis measured IN the deck plane (m) — not straight-line distance */
  lateral: number
  /** height above the deck face (m); negative means sunk below it */
  alt: number
  speed: number
}

/** Pad tangent-plane test: 0..MAX_ALT above the deck, lateral offset inside the pad radius, and
 *  slow enough. Writes into a caller-owned `out` so it can run every frame near a city without
 *  allocating — the single place these four numbers are derived, so the LAND prompt and the cue
 *  that explains its absence can never disagree about why. */
export function landingApproach(
  shipPos: THREE.Vector3, shipVel: THREE.Vector3,
  padCenter: THREE.Vector3, padNormal: THREE.Vector3, padRadius: number,
  out: LandingApproach,
): LandingApproach {
  const rx = shipPos.x - padCenter.x
  const ry = shipPos.y - padCenter.y
  const rz = shipPos.z - padCenter.z
  const alt = rx * padNormal.x + ry * padNormal.y + rz * padNormal.z
  const lx = rx - padNormal.x * alt
  const ly = ry - padNormal.y * alt
  const lz = rz - padNormal.z * alt
  out.alt = alt
  out.lateral = Math.sqrt(lx * lx + ly * ly + lz * lz)
  out.speed = shipVel.length()
  out.blocker = out.lateral > padRadius ? 'lateral'
    : alt < 0 ? 'below-deck'
    : alt > LANDING_MAX_ALT ? 'altitude'
    : out.speed > LANDING_MAX_SPEED ? 'speed'
    : 'ready'
  return out
}

/** Module scratch: computeLandingEligibility is a predicate, so its caller has nowhere to put the
 *  numbers, but it still must not allocate per frame. */
const _eligibilityScratch: LandingApproach = { blocker: 'ready', lateral: 0, alt: 0, speed: 0 }

/** Predicate form of `landingApproach` — true exactly when the LAND prompt should show. */
export function computeLandingEligibility(
  shipPos: THREE.Vector3, shipVel: THREE.Vector3,
  padCenter: THREE.Vector3, padNormal: THREE.Vector3, padRadius: number,
): boolean {
  return landingApproach(shipPos, shipVel, padCenter, padNormal, padRadius, _eligibilityScratch).blocker === 'ready'
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
