import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createShipState, stepShip, TUNING, type ControlInput } from './physics'

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
