import * as THREE from 'three'

/** `cockpit` sits at the hull's canopy looking forward — the view that makes flying read as being
 *  inside a ship rather than steering a small object from behind. Cycle order puts it first because
 *  it is the intended default once it is complete; until then `rear` remains the initial mode. */
export type CameraMode = 'cockpit' | 'rear' | 'orbit'

const ORBIT_RADIUS = 8.3
const ORBIT_MIN_RADIUS = 4.5
const ORBIT_MAX_RADIUS = 14
const ORBIT_HEIGHT = 2.8
const ORBIT_SPEED = 0.45
const ORBIT_ZOOM_PER_WHEEL_UNIT = 0.003
const ORBIT_MAX_QUEUED_WHEEL_DELTA = 900
const REAR_RADIUS = 14
const REAR_MIN_RADIUS = 10
const REAR_MAX_RADIUS = 26
const REAR_ZOOM_PER_WHEEL_UNIT = 0.006

// 'cockpit' is deliberately NOT in the cycle yet. main.ts branches on `cameraMode === 'orbit'` and
// otherwise falls through to the rear path, so a reachable 'cockpit' would silently render the rear
// view under a different name. Add it here in the same change that wires updateCamera().
const CAMERA_MODE_CYCLE: readonly CameraMode[] = ['rear', 'orbit']

export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_MODE_CYCLE.indexOf(mode)
  return CAMERA_MODE_CYCLE[(i + 1) % CAMERA_MODE_CYCLE.length]
}

/** Where the eye sits, in hull-local space, given the canopy mesh's local centre and the hull's
 *  bounding box. Pulled slightly back and down from the glass so the canopy frame stays in the
 *  periphery instead of filling the screen, and so the near plane does not clip through it.
 *
 *  Every hull but `miner` carries a canopy/cockpit node by name (`narrow_cyan_predator_canopy`,
 *  `raised_cockpit_pod`, `forward_command_bridge`, `low_cockpit`, `control bridge`), so the anchor
 *  is derived rather than hand-authored per ship. Forward is -Z throughout, matching the GLBs'
 *  `extras: { forward: "-Z" }`.
 */
export function cockpitEyeOffset(canopyLocalCenter: THREE.Vector3, hullLength: number): THREE.Vector3 {
  const setback = THREE.MathUtils.clamp(hullLength * 0.06, 0.12, 0.6)
  return new THREE.Vector3(
    canopyLocalCenter.x,
    canopyLocalCenter.y - setback * 0.35,
    canopyLocalCenter.z + setback, // +Z is aft, so this moves the eye back from the glass
  )
}

/** Name test for the canopy/cockpit node a hull's eye anchor is derived from. */
export function isCanopyNodeName(name: string): boolean {
  return /canop|cockpit|bridge_window|bridge$|deck window/i.test(name)
}

export function rearCameraOffset(boostKick: number, distance = REAR_RADIUS): THREE.Vector3 {
  return new THREE.Vector3(0, 3.6, distance + boostKick * 4)
}

export function defaultRearDistance(): number {
  return REAR_RADIUS
}

export function defaultOrbitDistance(): number {
  return ORBIT_RADIUS
}

export function zoomRearDistance(distance: number, wheelDeltaY: number): number {
  const next = THREE.MathUtils.clamp(
    distance + wheelDeltaY * REAR_ZOOM_PER_WHEEL_UNIT,
    REAR_MIN_RADIUS,
    REAR_MAX_RADIUS,
  )
  return Math.round(next * 100) / 100
}

export function zoomOrbitDistance(distance: number, wheelDeltaY: number): number {
  const next = THREE.MathUtils.clamp(
    distance + wheelDeltaY * ORBIT_ZOOM_PER_WHEEL_UNIT,
    ORBIT_MIN_RADIUS,
    ORBIT_MAX_RADIUS,
  )
  return Math.round(next * 100) / 100
}

export function queueOrbitZoomDelta(pendingDeltaY: number, wheelDeltaY: number): number {
  return THREE.MathUtils.clamp(
    pendingDeltaY + wheelDeltaY,
    -ORBIT_MAX_QUEUED_WHEEL_DELTA,
    ORBIT_MAX_QUEUED_WHEEL_DELTA,
  )
}

export function orbitCameraOffset(elapsedSeconds: number, boostKick: number, distance = ORBIT_RADIUS): THREE.Vector3 {
  const radius = distance + boostKick * 1.4
  const angle = elapsedSeconds * ORBIT_SPEED
  return new THREE.Vector3(Math.sin(angle) * radius, ORBIT_HEIGHT, Math.cos(angle) * radius)
}
