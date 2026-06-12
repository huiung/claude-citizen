import { Quaternion, Vector3 } from 'three'

// Tuning constants — the entire game feel lives here.
export const TUNING = {
  maxSpeed: 80,          // m/s, coupled mode commanded speed
  boostMultiplier: 3.5,
  accelResponse: 1.6,    // 1/s, how fast velocity converges to command (coupled)
  decoupledThrust: 45,   // m/s², raw acceleration in decoupled mode
  brakeResponse: 2.4,    // 1/s, X key
  maxAngularSpeed: 1.6,  // rad/s pitch/yaw
  maxRollSpeed: 2.2,     // rad/s
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

export function stepShip(state: ShipState, input: ControlInput, dt: number): void {
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
  const speedCap = TUNING.maxSpeed * (input.boost ? TUNING.boostMultiplier : 1)
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
