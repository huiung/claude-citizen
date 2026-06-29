import { describe, expect, it } from 'vitest'
import { ACTIVITY_WEIGHTS, SPEEDS, pickActivity, buildActivity } from './activities.mjs'
import { BOT_WORLD } from './landmarks.mjs'
import { Vector3 } from 'three'


function sequence(values) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

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
  it('black-hole-dive skips shallow passes and can roll a fatal horizon dive', () => {
    const standard = buildActivity('black-hole-dive', here, sequence([0.9, 0.2, 0.2, 0.2, 0.15, 0.2, 0.15, 0.2]), 0, BOT_WORLD)
    const fatal = buildActivity('black-hole-dive', here, sequence([0.02, 0.4, 0.8, 0.6, 0.85, 0.8, 0.85, 0.8]), 0, BOT_WORLD)

    expect(standard.phase).toBe('approach')
    expect(standard.diveProfile).toBe('standard')
    expect(standard.diveDistance).toBeGreaterThanOrEqual(6400)
    expect(standard.diveDistance).toBeLessThanOrEqual(9500)
    expect(fatal.diveProfile).toBe('fatal')
    expect(fatal.diveDistance).toBeGreaterThanOrEqual(3600)
    expect(fatal.diveDistance).toBeLessThanOrEqual(4600)
    expect(fatal.target.distanceTo(new Vector3(118000, 9000, 118000))).toBeCloseTo(fatal.diveDistance, -1)
    expect(fatal.skimMs).not.toBe(standard.skimMs)
    expect(fatal.escapeDir.angleTo(standard.escapeDir)).toBeGreaterThan(0.01)
    expect(fatal.intro).not.toBe(standard.intro)
  })

  it('adds small personality jitter to repeated non-black-hole activities', () => {
    const cruiseA = buildActivity('cruise', here, sequence([0.1, 0.1]), 1000, BOT_WORLD)
    const cruiseB = buildActivity('cruise', here, sequence([0.1, 0.9]), 1000, BOT_WORLD)
    const raceA = buildActivity('race', here, sequence([0.1]), 0, BOT_WORLD)
    const raceB = buildActivity('race', here, sequence([0.9]), 0, BOT_WORLD)
    const hubA = buildActivity('hub-visit', here, sequence([0.2, 0.1, 0.1]), 0, BOT_WORLD)
    const hubB = buildActivity('hub-visit', here, sequence([0.2, 0.9, 0.9]), 0, BOT_WORLD)
    const pvpA = buildActivity('pvp-training', here, sequence([0.1, 0.1]), 0, BOT_WORLD)
    const pvpB = buildActivity('pvp-training', here, sequence([0.9, 0.9]), 0, BOT_WORLD)

    expect(cruiseA.boostWindowMs).not.toBe(cruiseB.boostWindowMs)
    expect(raceA.gateTimeoutMs).not.toBe(raceB.gateTimeoutMs)
    expect(hubA.orbitRadius).not.toBe(hubB.orbitRadius)
    expect(hubA.loiterMs).not.toBe(hubB.loiterMs)
    expect(pvpA.sparMs).not.toBe(pvpB.sparMs)
    expect(pvpA.weaveRadius).not.toBe(pvpB.weaveRadius)
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

  it('hub-visit approaches then loiters for its rolled dwell time', () => {
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

  it('race skips a gate it can never reach (stall guard) so it never freezes mid-run', () => {
    const a = buildActivity('race', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    const stuck = new Vector3(-1e9, 0, 0) // never within GATE_HIT of any gate (simulates the hub-collider shove)
    let ms = 0
    let r
    for (let i = 0; i < a.waypoints.length; i++) { ms += 3501; r = stepActivity(a, stuck, 0.125, ms, BOT_WORLD) }
    expect(r.done).toBe(true) // every gate timed out and was skipped → race completed instead of stalling
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

  it('pvp-training approaches then spars for its rolled dwell time', () => {
    const a = buildActivity('pvp-training', new Vector3(0, 0, 0), () => 0, 0, BOT_WORLD)
    stepActivity(a, a.center.clone(), 0.125, 1000, BOT_WORLD)
    expect(a.phase).toBe('spar')
    expect(stepActivity(a, a.center.clone(), 0.125, a.sparUntil + 1, BOT_WORLD).done).toBe(true)
  })

  it('wander loiters locally (no intro) then finishes after its timer', () => {
    const spot = new Vector3(1000, 0, 1000)
    const a = buildActivity('wander', spot, () => 0, 0, BOT_WORLD)
    expect(a.kind).toBe('wander')
    expect(a.intro).toBeNull()
    const mid = stepActivity(a, spot.clone(), 1 / 60, 1000, BOT_WORLD)
    expect(mid.done).toBe(false)
    expect(mid.target.distanceTo(spot)).toBeLessThan(2000) // stays in the neighborhood, not a cross-system jaunt
    expect(stepActivity(a, spot.clone(), 1 / 60, a.wanderUntil + 1, BOT_WORLD).done).toBe(true)
  })
})

// The deep dive (target 9000, inside the 18000 tidal zone) only works if the unattended bot survives it.
// Simulate the real flight loop — stepActivity → stepMover → tidal HP bleed — and prove the bot lives,
// goes deep enough to qualify for the board, and finishes within the perform cap.
import { stepMover } from './mover.mjs'
import {
  tidalDamageRate, TIDAL_RADIUS, BLACK_HOLE_CENTER, BLACK_HOLE_APPROACH_DESTINATION, isPastHorizon,
} from '../src/sim/blackHole.ts'

function simulateDive(hullMax, rng = () => 0) {
  const dt = 1 / 60
  let pos = BLACK_HOLE_APPROACH_DESTINATION.position.clone() // where the bot drops out of its transit jump
  let hp = hullMax
  let minDist = Infinity
  let minHp = hullMax
  let t = 0
  let nowMs = 0
  let completed = false
  const a = buildActivity('black-hole-dive', pos, rng, 0, BOT_WORLD)
  while (t < 60) {
    const cmd = stepActivity(a, pos, dt, nowMs, BOT_WORLD)
    if (cmd.done) { completed = true; break }
    pos = stepMover(pos, cmd.target, cmd.speed, dt).pos
    hp -= tidalDamageRate(pos) * dt // tidal bleed mirrors the main loop (only nonzero inside TIDAL_RADIUS)
    if (isPastHorizon(pos)) hp = 0
    minDist = Math.min(minDist, pos.distanceTo(BLACK_HOLE_CENTER))
    minHp = Math.min(minHp, hp)
    t += dt
    nowMs += dt * 1000
  }
  return { minDist, minHp, durationS: t, completed }
}

describe('black-hole-dive survival (varied profiles)', () => {
  it('a hauler (hull 100) can run the standard dive, qualify, survive, and finish inside the perform cap', () => {
    const r = simulateDive(100, sequence([0.9, 0.4, 0.4, 0.4, 0]))
    expect(r.completed).toBe(true)              // escapes influence on its own
    expect(r.durationS).toBeLessThan(45)        // within BOT_PERFORM_CAP_MS
    expect(r.minDist).toBeLessThan(TIDAL_RADIUS) // reaches the tidal zone → qualifies for the board
    expect(r.minDist).toBeLessThan(12500)        // genuinely deep, not a timid skim
    expect(r.minHp).toBeGreaterThan(0)           // standard runs still survive
  })

  it('keeps the nonfatal profile survivable on the frailest hull', () => {
    expect(simulateDive(60, sequence([0.9, 0.4, 0.4, 0.4, 0])).minHp).toBeGreaterThan(0)
  })

  it('lets the fatal profile cross the horizon and die for a dramatic stream moment', () => {
    const r = simulateDive(60, sequence([0.02, 0.4, 0.4, 0.4, 0]))
    expect(r.minDist).toBeLessThanOrEqual(5600)
    expect(r.minHp).toBeLessThanOrEqual(0)
  })
})
