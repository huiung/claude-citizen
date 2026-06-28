import { describe, expect, it } from 'vitest'
import { ACTIVITY_WEIGHTS, SPEEDS, pickActivity, buildActivity } from './activities.mjs'
import { Vector3 } from 'three'

describe('pickActivity', () => {
  const kinds = Object.keys(ACTIVITY_WEIGHTS)
  it('returns a known activity kind', () => {
    expect(kinds).toContain(pickActivity(null, () => 0))
  })
  it('never repeats the previous kind', () => {
    for (const prev of kinds) {
      // sweep the rng across [0,1) — none should ever yield prev
      for (let r = 0; r < 1; r += 0.05) expect(pickActivity(prev, () => r)).not.toBe(prev)
    }
  })
  it('honors weights (rng=0 picks the first non-prev kind)', () => {
    expect(pickActivity(null, () => 0)).toBe(kinds[0])
  })
})

describe('SPEEDS', () => {
  it('defines a boost faster than cruise and a very fast warp', () => {
    expect(SPEEDS.BOOST).toBeGreaterThan(SPEEDS.CRUISE_BASE)
    expect(SPEEDS.WARP).toBeGreaterThan(SPEEDS.BOOST)
  })
})

describe('buildActivity', () => {
  const here = new Vector3(120, 30, -350) // refinery-ish start
  const rng = () => 0

  it('cruise picks a far landmark and announces it', () => {
    const a = buildActivity('cruise', here, rng, 1000)
    expect(a.kind).toBe('cruise')
    expect(a.intro).toMatch(/course for .+\./)
    expect(a.target).toBeInstanceOf(Vector3)
  })
  it('quantum-jump starts in the spool phase with a hold timer', () => {
    const a = buildActivity('quantum-jump', here, rng, 1000)
    expect(a.phase).toBe('spool')
    expect(a.phaseUntil).toBe(2200) // nowMs 1000 + 1200 spool
    expect(a.intro).toMatch(/Quantum jump/)
  })
  it('race carries the 10 gates and starts at index 0', () => {
    const a = buildActivity('race', here, rng, 0)
    expect(a.waypoints).toHaveLength(10)
    expect(a.index).toBe(0)
  })
  it('black-hole-dive aims ~20000 units from the center', () => {
    const a = buildActivity('black-hole-dive', here, rng, 0)
    expect(a.phase).toBe('approach')
    expect(a.target.distanceTo(new Vector3(118000, 9000, 118000))).toBeCloseTo(20000, -1)
  })
  it('falls back to a cruise for an unknown kind (never throws)', () => {
    const a = buildActivity('nonsense', here, rng, 0)
    expect(a.kind).toBe('cruise')
  })
})
