import * as THREE from 'three'

export type CameraMode = 'rear' | 'orbit'

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

export function nextCameraMode(mode: CameraMode): CameraMode {
  return mode === 'rear' ? 'orbit' : 'rear'
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
