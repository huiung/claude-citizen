import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  BLACK_HOLE_CENTER, HORIZON_RADIUS, INFLUENCE_RADIUS,
  gravityAccel, distanceToCenter, isPastHorizon, withinInfluence,
} from './blackHole'

describe('black hole model', () => {
  it('distance + horizon + influence predicates', () => {
    expect(distanceToCenter(BLACK_HOLE_CENTER.clone())).toBe(0)
    expect(isPastHorizon(BLACK_HOLE_CENTER.clone())).toBe(true)
    const edge = BLACK_HOLE_CENTER.clone().add(new Vector3(INFLUENCE_RADIUS + 10, 0, 0))
    expect(withinInfluence(edge)).toBe(false)
    expect(isPastHorizon(edge)).toBe(false)
  })

  it('gravity points toward center, grows as you approach, and is zero beyond influence', () => {
    const near = BLACK_HOLE_CENTER.clone().add(new Vector3(HORIZON_RADIUS * 2, 0, 0))
    const far = BLACK_HOLE_CENTER.clone().add(new Vector3(INFLUENCE_RADIUS * 0.9, 0, 0))
    const gNear = gravityAccel(near)
    const gFar = gravityAccel(far)
    expect(gNear.x).toBeLessThan(0)
    expect(gNear.length()).toBeGreaterThan(gFar.length())
    expect(gravityAccel(BLACK_HOLE_CENTER.clone().add(new Vector3(INFLUENCE_RADIUS + 1, 0, 0))).length()).toBe(0)
  })
})
