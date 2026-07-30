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

// Tuning constants — the entire game feel lives here. The angular block is the stock hauler's;
// every other hull overrides it from SHIP_STATS (see ShipTuningOverride).
export const TUNING = {
  maxSpeed: 95,          // m/s, coupled mode commanded speed
  boostMultiplier: 3.5,
  accelResponse: 1.6,    // 1/s, how fast velocity converges to command (coupled)
  decoupledThrust: 45,   // m/s², raw acceleration in decoupled mode
  brakeResponse: 2.4,    // 1/s, X key
  maxAngularSpeed: 1.7,  // rad/s pitch/yaw
  maxRollSpeed: 2.0,     // rad/s
  angularAccel: 3.4,     // rad/s², the torque budget the RCS can put on pitch/yaw — see stepShip
}

export interface ShipState {
  position: Vector3
  velocity: Vector3
  quaternion: Quaternion
  angularVelocity: Vector3 // local-space rad/s (x: pitch, y: yaw, z: roll)
  /** Signed share of each axis's thruster authority being spent, in [-1, 1], same axis order as
   *  `angularVelocity`. Written by `stepShip` and by nothing else, so it is only meaningful for a
   *  ship that was stepped this frame — a caller that moves a hull on rails (a scripted landing, an
   *  on-rails autopilot) owns zeroing it, or the feedback layer will show thrusters firing on a hull
   *  that is not being flown. */
  rcsDemand: Vector3
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
    rcsDemand: new Vector3(),
  }
}

const _v1 = new Vector3()
const _v2 = new Vector3()
const _q1 = new Quaternion()

/** Exponential approach factor: stable for any dt. */
function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

/** Optional per-call overrides (e.g. the chosen hull, or ship upgrades). Falls back to TUNING.
 *
 *  The angular three used to be absent and `stepShip` read `TUNING` directly for them, which meant a
 *  45-ton mining rig came about exactly as fast as a pirate interceptor no matter what the catalog
 *  claimed. They are the whole reason hulls can feel different. */
export interface ShipTuningOverride {
  maxSpeed?: number
  boostMultiplier?: number
  maxAngularSpeed?: number
  maxRollSpeed?: number
  angularAccel?: number
}

/** Width of the window over which a rate error is judged "a full-authority manoeuvre", in seconds.
 *  Only affects `rcsDemand`, never the motion. */
const RCS_DEMAND_WINDOW = 0.18

/** Signed share of an axis's thruster authority being spent, in [-1, 1].
 *
 *  Deliberately not the physical torque. That is bang-bang — the full budget whenever the rate error
 *  is non-zero at all — so it would hold every thruster at maximum for the entire manoeuvre including
 *  the last frame of a one-degree trim, and the feedback layer would read as a permanent flare rather
 *  than as effort. Dividing the rate error by what the RCS can erase in `RCS_DEMAND_WINDOW` seconds
 *  saturates during a real slam and fades as the hull settles onto the commanded rate.
 */
function rcsAxisDemand(rateError: number, accel: number): number {
  const d = rateError / Math.max(1e-6, accel * RCS_DEMAND_WINDOW)
  return d > 1 ? 1 : d < -1 ? -1 : d
}

/** Move one axis of angular velocity toward its commanded rate under a fixed angular-acceleration
 *  budget, landing exactly on the target instead of stepping past it on a long frame. */
function stepAngularAxis(current: number, target: number, accel: number, dt: number): number {
  const delta = target - current
  const step = accel * dt
  if (Math.abs(delta) <= step) return target
  return current + Math.sign(delta) * step
}

export function stepShip(
  state: ShipState, input: ControlInput, dt: number, tuning?: ShipTuningOverride,
): void {
  // --- Rotation: torque-limited, not rate-limited (always assisted, SC-style).
  //
  // This was `angularVelocity.lerp(commanded, approach(8, dt))` — a first-order lag with a 0.125 s
  // time constant. What made that read as weightless is NOT that it settled quickly; measured to a 1%
  // threshold it actually took 0.58 s to stop, longer than the stock hull does now. It is that the
  // angular acceleration was unbounded and front-loaded: response × rate error, so 16 rad/s² on the
  // first frame of a full deflection, tailing off from there. Nothing with mass can hit its rate that
  // hard, and the same lag also means the wind-up takes the same 0.29 s whether you nudge the stick or
  // slam it, so the hull has no size either.
  //
  // A fixed angular-acceleration budget instead — 3.4 rad/s² on the stock hull, a fifth of the old
  // opening kick. A small correction is now FASTER than the old lag managed (a tenth of full rate in
  // 0.05 s against 0.29 s, because the cost is proportional to the distance), while a full deflection
  // has to be wound up over ω/α seconds and — the half that actually sells it — wound back down at the
  // same constant rate, carrying the hull ω²/2α radians further round: 24° on the stock hull against
  // the old model's 14°. That coast past the point of release is the weight, which is why one budget
  // governs both directions.
  //
  // Roll gets the budget scaled by its own higher rate ceiling so all three axes reach full deflection
  // together; sharing one budget outright would make the fastest axis the slowest to wind up.
  const maxAngular = tuning?.maxAngularSpeed ?? TUNING.maxAngularSpeed
  const maxRoll = tuning?.maxRollSpeed ?? TUNING.maxRollSpeed
  const angularAccel = tuning?.angularAccel ?? TUNING.angularAccel
  const rollAccel = angularAccel * (maxRoll / Math.max(1e-6, maxAngular))
  _v1.set(
    input.pitch * maxAngular,
    input.yaw * maxAngular,
    input.roll * maxRoll,
  )
  const av = state.angularVelocity
  // Demand is read from the rate error BEFORE the step: the thrusters that fire this frame are the
  // ones fighting the error the pilot has just asked for, and after the step that error can be zero.
  state.rcsDemand.set(
    rcsAxisDemand(_v1.x - av.x, angularAccel),
    rcsAxisDemand(_v1.y - av.y, angularAccel),
    rcsAxisDemand(_v1.z - av.z, rollAccel),
  )
  av.set(
    stepAngularAxis(av.x, _v1.x, angularAccel, dt),
    stepAngularAxis(av.y, _v1.y, angularAccel, dt),
    stepAngularAxis(av.z, _v1.z, rollAccel, dt),
  )

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
