import { describe, expect, it } from 'vitest'
import { ACTIVITY_WEIGHTS, SPEEDS, pickActivity } from './activities.mjs'

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
