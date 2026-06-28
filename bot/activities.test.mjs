import { describe, expect, it } from 'vitest'
import { ACTIVITY_WEIGHTS, SPEEDS, pickActivity, buildActivity } from './activities.mjs'
import { BOT_WORLD } from './landmarks.mjs'
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
    const a = buildActivity('cruise', here, rng, 1000, BOT_WORLD)
    expect(a.kind).toBe('cruise')
    expect(a.intro).toMatch(/course for .+\./)
    expect(a.target).toBeInstanceOf(Vector3)
  })
  it('quantum-jump starts in the spool phase with a hold timer', () => {
    const a = buildActivity('quantum-jump', here, rng, 1000, BOT_WORLD)
    expect(a.phase).toBe('spool')
    expect(a.phaseUntil).toBe(2200) // nowMs 1000 + 1200 spool
    expect(a.intro).toMatch(/Quantum jump/)
  })
  it('race carries the 10 gates and starts at index 0', () => {
    const a = buildActivity('race', here, rng, 0, BOT_WORLD)
    expect(a.waypoints).toHaveLength(10)
    expect(a.index).toBe(0)
  })
  it('black-hole-dive aims ~20000 units from the center', () => {
    const a = buildActivity('black-hole-dive', here, rng, 0, BOT_WORLD)
    expect(a.phase).toBe('approach')
    expect(a.target.distanceTo(new Vector3(118000, 9000, 118000))).toBeCloseTo(20000, -1)
  })
  it('falls back to a cruise for an unknown kind (never throws)', () => {
    const a = buildActivity('nonsense', here, rng, 0, BOT_WORLD)
    expect(a.kind).toBe('cruise')
  })
})

import { stepActivity } from './activities.mjs'

describe('stepActivity', () => {
  const center = new Vector3(118000, 9000, 118000)

  it('cruise is done on arrival and alternates boost/cruise speed', () => {
    const a = buildActivity('cruise', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    const far = stepActivity(a, new Vector3(0, 0, 0), 0.125, 1000, BOT_WORLD) // 1s into the 5s cycle → boost
    expect(far.speed).toBe(SPEEDS.BOOST)
    expect(far.done).toBe(false)
    const slow = stepActivity(a, new Vector3(0, 0, 0), 0.125, 4000, BOT_WORLD) // 4s into cycle → cruise
    expect(slow.speed).toBe(SPEEDS.CRUISE_BASE)
    const atTarget = stepActivity(a, a.target.clone(), 0.125, 1000, BOT_WORLD)
    expect(atTarget.done).toBe(true)
  })

  it('quantum-jump holds during spool then warps', () => {
    const a = buildActivity('quantum-jump', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    const spool = stepActivity(a, new Vector3(0, 0, 0), 0.125, 500, BOT_WORLD) // before phaseUntil 1200
    expect(spool.speed).toBe(0)
    const warp = stepActivity(a, new Vector3(0, 0, 0), 0.125, 1300, BOT_WORLD) // past spool
    expect(a.phase).toBe('warp')
    expect(warp.speed).toBe(SPEEDS.WARP)
  })

  it('hub-visit approaches then loiters for ~20s', () => {
    const a = buildActivity('hub-visit', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    stepActivity(a, a.center.clone(), 0.125, 1000, BOT_WORLD) // arrive → enter loiter
    expect(a.phase).toBe('loiter')
    const mid = stepActivity(a, a.center.clone(), 0.125, 5000, BOT_WORLD)
    expect(mid.done).toBe(false)
    const end = stepActivity(a, a.center.clone(), 0.125, a.loiterUntil + 1, BOT_WORLD)
    expect(end.done).toBe(true)
  })

  it('race advances through gates and finishes after the last', () => {
    const a = buildActivity('race', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    for (let i = 0; i < a.waypoints.length; i++) {
      const r = stepActivity(a, a.waypoints[i].clone(), 0.125, 0, BOT_WORLD)
      if (i < a.waypoints.length - 1) expect(r.done).toBe(false)
    }
    expect(stepActivity(a, a.waypoints[a.waypoints.length - 1].clone(), 0.125, 0, BOT_WORLD).done).toBe(true)
  })

  it('black-hole-dive approaches, skims, then escapes influence', () => {
    const a = buildActivity('black-hole-dive', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    stepActivity(a, a.target.clone(), 0.125, 1000, BOT_WORLD) // reach approach point → skim
    expect(a.phase).toBe('skim')
    stepActivity(a, a.target.clone(), 0.125, a.skimUntil + 1, BOT_WORLD) // skim done → escape
    expect(a.phase).toBe('escape')
    const out = stepActivity(a, center.clone().add(new Vector3(60000, 0, 0)), 0.125, 0, BOT_WORLD)
    expect(out.done).toBe(true) // beyond INFLUENCE (50000)
  })

  it('pvp-training approaches then spars for ~20s', () => {
    const a = buildActivity('pvp-training', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    stepActivity(a, a.center.clone(), 0.125, 1000, BOT_WORLD)
    expect(a.phase).toBe('spar')
    expect(stepActivity(a, a.center.clone(), 0.125, a.sparUntil + 1, BOT_WORLD).done).toBe(true)
  })
})
