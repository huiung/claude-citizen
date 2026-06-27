import { Quaternion, Vector3 } from 'three'

const _sphereNormal = new Vector3()
/**
 * Clamp `position` outside a solid sphere and kill inward velocity so the ship slides along the
 * surface instead of passing through. Mutates `position`/`velocity`; returns true if it collided.
 * This is the fast spherical clamp (no terrain follow) used for the sun, gas giants, and the
 * procedural galaxy's planets/moons. `minDist = radius * 1.06 + 30` matches the existing clamp.
 */
export function resolveSphereCollision(position: Vector3, velocity: Vector3, center: Vector3, radius: number): boolean {
  _sphereNormal.subVectors(position, center)
  const dist = _sphereNormal.length()
  if (dist <= 1e-3) return false
  const minDist = radius * 1.06 + 30
  if (dist >= minDist) return false
  _sphereNormal.multiplyScalar(1 / dist)
  position.copy(center).addScaledVector(_sphereNormal, minDist)
  const vn = velocity.dot(_sphereNormal)
  if (vn < 0) velocity.addScaledVector(_sphereNormal, -vn)
  return true
}

// Tuning constants — the entire game feel lives here.
export const TUNING = {
  maxSpeed: 95,          // m/s, coupled mode commanded speed
  boostMultiplier: 3.5,
  accelResponse: 1.6,    // 1/s, how fast velocity converges to command (coupled)
  decoupledThrust: 45,   // m/s², raw acceleration in decoupled mode
  brakeResponse: 2.4,    // 1/s, X key
  maxAngularSpeed: 2.0,  // rad/s pitch/yaw
  maxRollSpeed: 2.4,     // rad/s
  angularResponse: 8,    // 1/s, how fast angular velocity converges
}

export interface ShipState {
  position: Vector3
  velocity: Vector3
  quaternion: Quaternion
  angularVelocity: Vector3 // local-space rad/s (x: pitch, y: yaw, z: roll)
}

export interface ControlInput {
  thrust: Vector3      // local, each axis in [-1, 1] (z: forward = -1 convention handled here)
  pitch: number        // [-1, 1]
  yaw: number          // [-1, 1]
  roll: number         // [-1, 1]
  boost: boolean
  brake: boolean
  assist: boolean      // coupled (true) / decoupled (false)
}

export function createShipState(position = new Vector3()): ShipState {
  return {
    position: position.clone(),
    velocity: new Vector3(),
    quaternion: new Quaternion(),
    angularVelocity: new Vector3(),
  }
}

const _v1 = new Vector3()
const _v2 = new Vector3()
const _q1 = new Quaternion()

/** Exponential approach factor: stable for any dt. */
function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

/** Optional per-call overrides (e.g. from ship upgrades). Falls back to TUNING. */
export interface ShipTuningOverride {
  maxSpeed?: number
  boostMultiplier?: number
}

export function stepShip(
  state: ShipState, input: ControlInput, dt: number, tuning?: ShipTuningOverride,
): void {
  // --- Rotation: angular velocity converges to commanded rates (always assisted, SC-style)
  _v1.set(
    input.pitch * TUNING.maxAngularSpeed,
    input.yaw * TUNING.maxAngularSpeed,
    input.roll * TUNING.maxRollSpeed,
  )
  state.angularVelocity.lerp(_v1, approach(TUNING.angularResponse, dt))

  const av = state.angularVelocity
  if (av.lengthSq() > 1e-10) {
    _q1.set(av.x * dt * 0.5, av.y * dt * 0.5, av.z * dt * 0.5, 1).normalize()
    state.quaternion.multiply(_q1).normalize()
  }

  // --- Translation
  const maxSpeed = tuning?.maxSpeed ?? TUNING.maxSpeed
  const boostMult = tuning?.boostMultiplier ?? TUNING.boostMultiplier
  const speedCap = maxSpeed * (input.boost ? boostMult : 1)
  // local thrust → world space; forward is -Z in three.js convention
  _v1.set(input.thrust.x, input.thrust.y, -input.thrust.z).applyQuaternion(state.quaternion)

  if (input.brake) {
    state.velocity.lerp(_v2.set(0, 0, 0), approach(TUNING.brakeResponse, dt))
  } else if (input.assist) {
    // Coupled: velocity converges to commanded vector
    _v1.multiplyScalar(speedCap)
    state.velocity.lerp(_v1, approach(TUNING.accelResponse * (input.boost ? 1.8 : 1), dt))
  } else {
    // Decoupled: pure Newton. Thrust adds, nothing damps.
    state.velocity.addScaledVector(_v1, TUNING.decoupledThrust * (input.boost ? 2 : 1) * dt)
  }

  state.position.addScaledVector(state.velocity, dt)
}
