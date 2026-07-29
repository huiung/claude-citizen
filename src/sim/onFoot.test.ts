import { describe, expect, it } from 'vitest'
import {
  BOARD_RANGE,
  clampFootPitch,
  FOOT_PITCH_MAX,
  FOOT_PITCH_MIN,
  pushOutOfKeepOut,
  RUN_SPEED,
  stepVertical,
  strideParams,
  WALK_SPEED,
  WALKER_GRAVITY,
  WALKER_HEIGHT,
  walkVelocity,
} from './onFoot'

describe('walkVelocity', () => {
  it('stands still with no input', () => {
    expect(walkVelocity({ forward: 0, strafe: 0, run: false })).toEqual({ forward: 0, right: 0 })
  })

  it('walks at WALK_SPEED and runs at RUN_SPEED', () => {
    expect(walkVelocity({ forward: 1, strafe: 0, run: false }).forward).toBeCloseTo(WALK_SPEED, 6)
    expect(walkVelocity({ forward: 1, strafe: 0, run: true }).forward).toBeCloseTo(RUN_SPEED, 6)
  })

  it('does not let diagonals outrun walking straight', () => {
    const diagonal = walkVelocity({ forward: 1, strafe: 1, run: false })
    expect(Math.hypot(diagonal.forward, diagonal.right)).toBeCloseTo(WALK_SPEED, 6)
  })

  it('walks backwards more slowly than nothing, and no faster than forwards', () => {
    const back = walkVelocity({ forward: -1, strafe: 0, run: false })
    expect(back.forward).toBeCloseTo(-WALK_SPEED, 6)
  })

  it('scales a partial axis without scaling the speed', () => {
    // A half-deflected axis is still full speed in that direction — these are digital keys, and
    // an analogue stick would arrive already normalised.
    const half = walkVelocity({ forward: 0.5, strafe: 0, run: false })
    expect(half.forward).toBeCloseTo(WALK_SPEED, 6)
  })
})

describe('stepVertical', () => {
  it('snaps to the ground and stays there', () => {
    const first = stepVertical({ radius: 100, velocity: 0, grounded: true }, 100, 1 / 60)
    expect(first.radius).toBe(100)
    expect(first.velocity).toBe(0)
    expect(first.grounded).toBe(true)
  })

  it('accelerates downward off a ledge', () => {
    const dt = 1 / 60
    const airborne = stepVertical({ radius: 100, velocity: 0, grounded: true }, 97, dt)
    expect(airborne.grounded).toBe(false)
    expect(airborne.velocity).toBeCloseTo(-WALKER_GRAVITY * dt, 6)
    expect(airborne.radius).toBeLessThan(100)
  })

  it('lands on the lower surface rather than passing through it', () => {
    // The one drop the slice can produce: the pad deck is 3 units above the city ground sheet.
    // ~0.8s of free fall covers 3 units at 9.81 m/s^2; 120 frames is ample.
    let state = { radius: 100, velocity: 0, grounded: true }
    let airborneFrames = 0
    for (let i = 0; i < 120; i++) {
      state = stepVertical(state, 97, 1 / 60)
      if (!state.grounded) airborneFrames++
    }
    expect(airborneFrames).toBeGreaterThan(5) // it really fell, rather than snapping straight down
    expect(state.radius).toBe(97)
    expect(state.grounded).toBe(true)
    expect(state.velocity).toBe(0)
  })

  it('cannot tunnel through the ground at a low frame rate', () => {
    // 0.05s is the frame loop's dt clamp. A fall that started far above must still be caught.
    let state = { radius: 400, velocity: 0, grounded: false }
    for (let i = 0; i < 400; i++) state = stepVertical(state, 100, 0.05)
    expect(state.radius).toBe(100)
    expect(state.grounded).toBe(true)
  })

  it('rises onto a step without being shoved back down', () => {
    const state = stepVertical({ radius: 100, velocity: 0, grounded: true }, 103, 1 / 60)
    expect(state.radius).toBe(103)
    expect(state.grounded).toBe(true)
  })
})

describe('pushOutOfKeepOut', () => {
  it('leaves a point outside the circle alone', () => {
    expect(pushOutOfKeepOut(5, 0, 4)).toEqual({ x: 5, z: 0 })
  })

  it('pushes a point out along its own bearing', () => {
    const out = pushOutOfKeepOut(1, 1, 4)
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(4, 6)
    expect(out.x).toBeCloseTo(out.z, 6) // bearing preserved
  })

  it('picks a direction rather than dividing by zero at the centre', () => {
    const out = pushOutOfKeepOut(0, 0, 4)
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(4, 6)
  })

  it('is idempotent', () => {
    const once = pushOutOfKeepOut(0.2, -0.1, 4)
    const twice = pushOutOfKeepOut(once.x, once.z, 4)
    expect(twice.x).toBeCloseTo(once.x, 10)
    expect(twice.z).toBeCloseTo(once.z, 10)
  })
})

describe('strideParams', () => {
  it('advances one full cycle per stride length', () => {
    expect(strideParams(0)).toBe(0)
    expect(strideParams(1.55, 1.55)).toBeCloseTo(Math.PI * 2, 6)
  })

  it('is continuous, so the legs never jump', () => {
    expect(strideParams(1.0) - strideParams(0.999)).toBeLessThan(0.01)
  })
})

describe('clampFootPitch', () => {
  it('keeps the boom inside its arc', () => {
    expect(clampFootPitch(-10)).toBe(FOOT_PITCH_MIN)
    expect(clampFootPitch(10)).toBe(FOOT_PITCH_MAX)
    expect(clampFootPitch(0.2)).toBe(0.2)
  })

  it('allows a genuine look up, which is the shot the mode exists for', () => {
    expect(FOOT_PITCH_MIN).toBeLessThan(-0.3)
  })
})

describe('scale', () => {
  it('keeps the pilot human-sized against the hulls', () => {
    // The procedural hauler's cargo block is 2.2 x 1.8 x 4.2 and the GLB hulls run 6-17 units long,
    // so a pilot must be around a third of a small ship's length for the arrival to read.
    expect(WALKER_HEIGHT).toBeGreaterThan(1.5)
    expect(WALKER_HEIGHT).toBeLessThan(2.1)
  })

  it('gives the board prompt a band wide enough not to flicker while walking', () => {
    expect(BOARD_RANGE).toBeGreaterThan(WALK_SPEED * 0.5) // over half a second of walking
  })
})
