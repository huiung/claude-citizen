import { describe, expect, it } from 'vitest'
import { mobileFlightInput } from './mobileFlight'

describe('mobile flight controls', () => {
  it('maps the touch stick and held buttons into civilian flight input', () => {
    const input = mobileFlightInput({
      stickX: 0.5,
      stickY: -0.25,
      thrustHeld: true,
      boostHeld: true,
      brakeHeld: false,
    })

    expect(input.yaw).toBeCloseTo(0.5)
    expect(input.pitch).toBeCloseTo(0.25)
    expect(input.thrust.z).toBe(1)
    expect(input.boost).toBe(true)
    expect(input.brake).toBe(false)
    expect(input.assist).toBe(true)
  })

  it('lets braking override boost and forward thrust', () => {
    const input = mobileFlightInput({
      stickX: 2,
      stickY: -2,
      thrustHeld: true,
      boostHeld: true,
      brakeHeld: true,
    })

    expect(input.yaw).toBe(1)
    expect(input.pitch).toBe(1)
    expect(input.thrust.z).toBe(0)
    expect(input.boost).toBe(false)
    expect(input.brake).toBe(true)
  })
})
