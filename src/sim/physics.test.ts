import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createShipState, resolveSphereCollision, stepShip, TUNING,
  type ControlInput, type ShipTuningOverride,
} from './physics'
import { shipHandling, SHIP_TYPES, type ShipType } from './shipTypes'

describe('resolveSphereCollision', () => {
  const center = () => new Vector3(0, 0, 0)

  it('pushes a ship inside the sphere out to the surface and kills inward velocity', () => {
    const pos = new Vector3(10, 0, 0)        // deep inside a radius-1000 body
    const vel = new Vector3(-100, 0, 0)      // diving toward the center
    const hit = resolveSphereCollision(pos, vel, center(), 1000)
    expect(hit).toBe(true)
    expect(pos.length()).toBeCloseTo(1000 * 1.06 + 30, 3) // clamped to the surface shell
    expect(vel.x).toBeCloseTo(0, 3)                        // inward velocity removed
  })

  it('leaves a ship outside the sphere untouched', () => {
    const pos = new Vector3(5000, 0, 0)
    const vel = new Vector3(-100, 0, 0)
    const hit = resolveSphereCollision(pos, vel, center(), 1000)
    expect(hit).toBe(false)
    expect(pos.x).toBe(5000)
    expect(vel.x).toBe(-100)
  })

  it('keeps tangential velocity while killing the inward component', () => {
    const pos = new Vector3(1000, 0, 0)      // inside the 1090 shell
    const vel = new Vector3(-50, 30, 0)      // -x inward, +y tangential
    resolveSphereCollision(pos, vel, center(), 1000)
    expect(vel.x).toBeCloseTo(0, 3)
    expect(vel.y).toBeCloseTo(30, 3)
  })
})

function idleInput(): ControlInput {
  return {
    thrust: new Vector3(),
    pitch: 0, yaw: 0, roll: 0,
    boost: false, brake: false, assist: true,
  }
}

function run(state: ReturnType<typeof createShipState>, input: ControlInput, seconds: number): void {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) stepShip(state, input, dt)
}

describe('stepShip', () => {
  it('coupled mode converges to commanded speed', () => {
    const state = createShipState()
    const input = idleInput()
    input.thrust.set(0, 0, 1) // full forward
    run(state, input, 10)
    expect(state.velocity.length()).toBeGreaterThan(TUNING.maxSpeed * 0.95)
    expect(state.velocity.length()).toBeLessThanOrEqual(TUNING.maxSpeed * 1.001)
  })

  it('coupled mode bleeds velocity to zero when thrust released', () => {
    const state = createShipState()
    const input = idleInput()
    input.thrust.set(0, 0, 1)
    run(state, input, 5)
    input.thrust.set(0, 0, 0)
    run(state, input, 10)
    expect(state.velocity.length()).toBeLessThan(1)
  })

  it('decoupled mode preserves momentum (Newton)', () => {
    const state = createShipState()
    const input = idleInput()
    input.assist = false
    input.thrust.set(0, 0, 1)
    run(state, input, 2)
    const speedAfterBurn = state.velocity.length()
    input.thrust.set(0, 0, 0)
    run(state, input, 10)
    expect(state.velocity.length()).toBeCloseTo(speedAfterBurn, 5)
  })

  it('brake kills velocity in either mode', () => {
    for (const assist of [true, false]) {
      const state = createShipState()
      const input = idleInput()
      input.assist = assist
      input.thrust.set(0, 0, 1)
      run(state, input, 5)
      input.thrust.set(0, 0, 0)
      input.brake = true
      run(state, input, 6)
      expect(state.velocity.length()).toBeLessThan(0.5)
    }
  })

  it('quaternion stays normalized under sustained rotation', () => {
    const state = createShipState()
    const input = idleInput()
    input.pitch = 1; input.yaw = 0.7; input.roll = -0.5
    run(state, input, 30)
    expect(state.quaternion.length()).toBeCloseTo(1, 6)
  })

  it('forward thrust moves the ship along -Z when unrotated', () => {
    const state = createShipState()
    const input = idleInput()
    input.thrust.set(0, 0, 1)
    run(state, input, 3)
    expect(state.position.z).toBeLessThan(-10)
    expect(Math.abs(state.position.x)).toBeLessThan(1e-6)
  })
})

// --- Angular step response
//
// This block is the only honest verification of handling FEEL that exists. A screenshot cannot show
// whether a ship has weight, and the reviewer of this change is going to fly it rather than read it,
// so what is asserted here is the set of numbers that define the sensation: how long a full stick
// deflection takes to wind up, how long it takes to wind back down, how far the hull carries past the
// release, whether small corrections stayed crisp, and whether hull classes differ in the intended
// direction. Those are the quantities that regress silently if someone re-tunes one constant.

/** Half a display frame, so the measured times are the model's rather than the sampler's. */
const DT = 1 / 120

interface YawStepResponse {
  /** Seconds from a full deflection until the yaw rate first reaches 90% of the commanded rate. */
  riseTo90: number
  /** Highest yaw rate reached while the stick was held, rad/s. */
  peakRate: number
  /** Seconds from release until the yaw rate is back under 1% of the commanded rate. */
  settle: number
  /** Radians the hull keeps turning after the stick is released. */
  swingAfterRelease: number
}

/** Slam full yaw, hold until the rate ceiling, then release, measuring both halves.
 *
 *  The swing is integrated from `angularVelocity` rather than read off the quaternion because this
 *  manoeuvre is a pure rotation about one local axis, which makes the integral exactly the swept
 *  angle and avoids turning a handling assertion into a quaternion-decomposition assertion.
 */
function yawStepResponse(tuning: ShipTuningOverride): YawStepResponse {
  const commanded = tuning.maxAngularSpeed ?? TUNING.maxAngularSpeed
  const state = createShipState()
  const input = idleInput()
  input.yaw = 1
  let riseTo90 = Infinity
  let peakRate = 0
  for (let t = 0; t < 5; t += DT) {
    stepShip(state, input, DT, tuning)
    peakRate = Math.max(peakRate, state.angularVelocity.y)
    if (riseTo90 === Infinity && state.angularVelocity.y >= commanded * 0.9) riseTo90 = t + DT
  }
  input.yaw = 0
  let settle = Infinity
  let swingAfterRelease = 0
  for (let t = 0; t < 5; t += DT) {
    stepShip(state, input, DT, tuning)
    swingAfterRelease += state.angularVelocity.y * DT
    if (settle === Infinity && Math.abs(state.angularVelocity.y) <= commanded * 0.01) settle = t + DT
  }
  return { riseTo90, peakRate, settle, swingAfterRelease }
}

/** Seconds until yaw rate reaches 90% of what a partial deflection commands. */
function partialRiseTo90(tuning: ShipTuningOverride, deflection: number): number {
  const target = (tuning.maxAngularSpeed ?? TUNING.maxAngularSpeed) * deflection
  const state = createShipState()
  const input = idleInput()
  input.yaw = deflection
  for (let t = 0; t < 5; t += DT) {
    stepShip(state, input, DT, tuning)
    if (state.angularVelocity.y >= target * 0.9) return t + DT
  }
  return Infinity
}

const DEG = 180 / Math.PI

describe('angular step response', () => {
  it('the stock hull takes about half a second to wind up and the same to wind down', () => {
    const r = yawStepResponse({})
    // α = 3.4 rad/s², ω = 1.7 rad/s → 0.9ω/α = 0.45 s up, (ω − 0.01ω)/α = 0.50 s down.
    expect(r.riseTo90).toBeGreaterThan(0.40)
    expect(r.riseTo90).toBeLessThan(0.52)
    expect(r.settle).toBeGreaterThan(0.42)
    expect(r.settle).toBeLessThan(0.58)
  })

  it('releasing the stick at full rate carries the hull more than 20 degrees further round', () => {
    // ω²/2α = 0.425 rad ≈ 24°. The first-order lag this replaced coasted ω·τ = 0.25 rad ≈ 14°.
    const r = yawStepResponse({})
    expect(r.swingAfterRelease * DEG).toBeGreaterThan(20)
    expect(r.swingAfterRelease * DEG).toBeLessThan(30)
  })

  it('bounds angular acceleration — the actual mechanism, not the settle time', () => {
    // The single number that separates a hull with mass from one without. The old first-order lag
    // opened a full deflection at response × rate = 8 × 2.0 = 16 rad/s² and eased off from there; its
    // 1%-settle time was 0.58 s, LONGER than the stock hull's is now, which is why settle time alone
    // was never the tell. What the pilot feels is this opening kick, and it is now the hull's own
    // budget and nothing more, in both directions.
    for (const type of SHIP_TYPES) {
      const handling = shipHandling(type)
      const state = createShipState()
      const input = idleInput()
      input.yaw = 1
      let peakAccel = 0
      for (let phase = 0; phase < 2; phase++) {
        input.yaw = phase === 0 ? 1 : 0
        for (let t = 0; t < 2; t += DT) {
          const before = state.angularVelocity.y
          stepShip(state, input, DT, handling)
          peakAccel = Math.max(peakAccel, Math.abs(state.angularVelocity.y - before) / DT)
        }
      }
      expect(peakAccel).toBeLessThanOrEqual(handling.angularAccel * (1 + 1e-9))
      expect(peakAccel).toBeCloseTo(handling.angularAccel, 6)
      expect(peakAccel).toBeLessThan(16) // the old shared opening kick, on every hull including the interceptor
    }
  })

  it('never lets the rate overshoot what the stick commanded, on any hull', () => {
    for (const type of SHIP_TYPES) {
      const handling = shipHandling(type)
      const r = yawStepResponse(handling)
      expect(r.peakRate).toBeLessThanOrEqual(handling.maxAngularSpeed * (1 + 1e-9))
      expect(r.peakRate).toBeCloseTo(handling.maxAngularSpeed, 6)
    }
  })

  it('keeps small corrections immediate — weight must not become input lag', () => {
    // A torque budget is proportional-time, so a tenth of a deflection costs a tenth of the wind-up.
    // This is the guard against "we made it heavy" turning into "we made it unresponsive".
    for (const type of SHIP_TYPES) {
      expect(partialRiseTo90(shipHandling(type), 0.1)).toBeLessThan(0.09)
    }
  })

  it('orders the hulls by mass: interceptor sharpest, miner most ponderous', () => {
    const order: ShipType[] = ['interceptor', 'fighter', 'hauler', 'miner']
    const rise = order.map((t) => yawStepResponse(shipHandling(t)).riseTo90)
    const settle = order.map((t) => yawStepResponse(shipHandling(t)).settle)
    for (let i = 1; i < order.length; i++) {
      expect(rise[i]).toBeGreaterThan(rise[i - 1])   // slower to start
      expect(settle[i]).toBeGreaterThan(settle[i - 1]) // and slower to stop
    }
    // A hauler is not marginally heavier than an interceptor, it is half again as slow both ways.
    expect(rise[3] / rise[0]).toBeGreaterThan(2)
    expect(settle[3] / settle[0]).toBeGreaterThan(2)
  })

  it('reads every angular field off the override instead of the shared TUNING block', () => {
    // Regression guard. stepShip used to read TUNING.maxAngularSpeed / maxRollSpeed / angularResponse
    // directly and ignore the override entirely, so a hauler came about exactly like an interceptor
    // no matter what the catalog said. Each field is varied on its own so that plumbing one and
    // forgetting another cannot pass.
    const rate = (tuning: ShipTuningOverride, hold: number): Vector3 => {
      const state = createShipState()
      const input = idleInput()
      input.yaw = 1; input.roll = 1
      for (let t = 0; t < hold; t += DT) stepShip(state, input, DT, tuning)
      return state.angularVelocity.clone()
    }
    expect(rate({ maxAngularSpeed: 4 }, 3).y).toBeCloseTo(4, 5)
    expect(rate({ maxRollSpeed: 5 }, 3).z).toBeCloseTo(5, 5)
    // A bigger budget is further along at a fixed instant, with the ceiling held constant.
    expect(rate({ angularAccel: 12 }, 0.2).y).toBeGreaterThan(rate({ angularAccel: 2 }, 0.2).y)
  })

  it('reaches the roll ceiling in step with the pitch ceiling despite the higher rate', () => {
    // Roll's budget is scaled by its rate ceiling on purpose; a shared budget would make the fastest
    // axis the slowest to wind up, which reads as the roll axis being broken rather than heavy.
    for (const type of SHIP_TYPES) {
      const handling = shipHandling(type)
      const state = createShipState()
      const input = idleInput()
      input.pitch = 1; input.roll = 1
      let pitchDone = Infinity
      let rollDone = Infinity
      for (let t = 0; t < 5; t += DT) {
        stepShip(state, input, DT, handling)
        if (pitchDone === Infinity && state.angularVelocity.x >= handling.maxAngularSpeed - 1e-9) pitchDone = t
        if (rollDone === Infinity && state.angularVelocity.z >= handling.maxRollSpeed - 1e-9) rollDone = t
      }
      expect(rollDone).toBeCloseTo(pitchDone, 2)
    }
  })
})

describe('rcsDemand', () => {
  it('saturates on a fresh slam and fades as the hull settles onto the rate', () => {
    const state = createShipState()
    const input = idleInput()
    input.yaw = 1
    stepShip(state, input, DT, {})
    expect(state.rcsDemand.y).toBeCloseTo(1, 6) // full authority, first frame
    run(state, input, 3)
    expect(Math.abs(state.rcsDemand.y)).toBeLessThan(0.05) // steady rate needs no torque at all
  })

  it('flips sign on release — the counter-burn is the thing the pilot needs to see', () => {
    const state = createShipState()
    const input = idleInput()
    input.yaw = 1
    run(state, input, 3)
    input.yaw = 0
    stepShip(state, input, DT, {})
    expect(state.rcsDemand.y).toBeCloseTo(-1, 6)
  })

  it('is zero on a ship nobody is steering', () => {
    const state = createShipState()
    run(state, idleInput(), 1)
    expect(state.rcsDemand.length()).toBeCloseTo(0, 9)
  })

  it('scales with how hard the correction is, not just whether there is one', () => {
    const light = createShipState()
    const heavy = createShipState()
    const gentle = idleInput(); gentle.yaw = 0.08
    const slam = idleInput(); slam.yaw = 1
    stepShip(light, gentle, DT, {})
    stepShip(heavy, slam, DT, {})
    expect(yawDemand(light)).toBeLessThan(yawDemand(heavy))
    expect(yawDemand(light)).toBeGreaterThan(0)
  })
})

function yawDemand(state: ReturnType<typeof createShipState>): number {
  return Math.abs(state.rcsDemand.y)
}
