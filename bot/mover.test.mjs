import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { stepMover } from './mover.mjs'

describe('stepMover', () => {
  it('moves toward the destination by speed*dt and reports not-arrived when far', () => {
    const r = stepMover(new Vector3(0, 0, 0), new Vector3(1000, 0, 0), 100, 1)
    expect(r.pos.x).toBeCloseTo(100, 3)
    expect(r.arrived).toBe(false)
  })

  it('clamps to the destination (no overshoot) and reports arrived', () => {
    const r = stepMover(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 100, 1)
    expect(r.pos.x).toBeCloseTo(10, 3)
    expect(r.arrived).toBe(true)
  })

  it('faces the travel direction (-Z forward maps to the move direction)', () => {
    const r = stepMover(new Vector3(0, 0, 0), new Vector3(0, 0, -1000), 100, 1)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(r.quat)
    expect(fwd.x).toBeCloseTo(0, 2)
    expect(fwd.z).toBeCloseTo(-1, 2)
  })

  it('does not mutate the input position', () => {
    const pos = new Vector3(5, 5, 5)
    stepMover(pos, new Vector3(100, 5, 5), 10, 1)
    expect(pos).toEqual(new Vector3(5, 5, 5))
  })
})
