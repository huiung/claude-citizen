import { describe, expect, it } from 'vitest'
import { CARGO_CAPACITY } from './economy'
import { TUNING } from './physics'
import {
  SHIP_RANK_REQ, SHIP_STATS, SHIP_TYPES, shipHandling, shipStats, turnRateDegPerSec, type ShipType,
} from './shipTypes'

describe('shipTypes catalog', () => {
  it('lists all four hull types in catalog order', () => {
    expect(SHIP_TYPES).toEqual(['hauler', 'fighter', 'miner', 'interceptor'])
  })

  it('has a stat block for every listed type', () => {
    for (const t of SHIP_TYPES) {
      expect(SHIP_STATS[t]).toBeDefined()
    }
    expect(Object.keys(SHIP_STATS).sort()).toEqual([...SHIP_TYPES].sort())
  })

  it('shipStats returns the same block as the table', () => {
    for (const t of SHIP_TYPES) {
      expect(shipStats(t)).toBe(SHIP_STATS[t])
    }
  })

  it('hauler matches the live base scale exactly', () => {
    const h = SHIP_STATS.hauler
    expect(h.cargo).toBe(CARGO_CAPACITY)
    expect(h.topSpeed).toBe(TUNING.maxSpeed)
    expect(h.boostMultiplier).toBe(TUNING.boostMultiplier)
    expect(h.maxAngularSpeed).toBe(TUNING.maxAngularSpeed)
    expect(h.maxRollSpeed).toBe(TUNING.maxRollSpeed)
    expect(h.angularAccel).toBe(TUNING.angularAccel)
    expect(h.hull).toBe(100)
  })

  it('gives every hull a distinct role label', () => {
    const roles = SHIP_TYPES.map((t) => SHIP_STATS[t].role)
    expect(new Set(roles).size).toBe(roles.length)
  })

  it('gives every hull a distinct tint', () => {
    const tints = SHIP_TYPES.map((t) => SHIP_STATS[t].tint)
    expect(new Set(tints).size).toBe(tints.length)
  })

  it('all stats are positive and finite', () => {
    for (const t of SHIP_TYPES) {
      const s = SHIP_STATS[t]
      for (const v of [s.cargo, s.topSpeed, s.boostMultiplier, s.hull]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
    }
  })

  it('fighter is fast and agile but light on cargo and hull vs hauler', () => {
    const f = SHIP_STATS.fighter
    const h = SHIP_STATS.hauler
    expect(f.topSpeed).toBeGreaterThan(h.topSpeed)
    expect(f.boostMultiplier).toBeGreaterThan(h.boostMultiplier)
    expect(f.cargo).toBeLessThan(h.cargo)
    expect(f.hull).toBeLessThan(h.hull)
  })

  it('miner has the biggest hold and toughest hull but is the slowest', () => {
    const cargos = SHIP_TYPES.map((t) => SHIP_STATS[t].cargo)
    const hulls = SHIP_TYPES.map((t) => SHIP_STATS[t].hull)
    const speeds = SHIP_TYPES.map((t) => SHIP_STATS[t].topSpeed)
    expect(SHIP_STATS.miner.cargo).toBe(Math.max(...cargos))
    expect(SHIP_STATS.miner.hull).toBe(Math.max(...hulls))
    expect(SHIP_STATS.miner.topSpeed).toBe(Math.min(...speeds))
  })

  it('interceptor is the aggressive top-speed pirate with the least cargo', () => {
    const speeds = SHIP_TYPES.map((t) => SHIP_STATS[t].topSpeed)
    const boosts = SHIP_TYPES.map((t) => SHIP_STATS[t].boostMultiplier)
    const cargos = SHIP_TYPES.map((t) => SHIP_STATS[t].cargo)
    expect(SHIP_STATS.interceptor.topSpeed).toBe(Math.max(...speeds))
    expect(SHIP_STATS.interceptor.boostMultiplier).toBe(Math.max(...boosts))
    expect(SHIP_STATS.interceptor.cargo).toBe(Math.min(...cargos))
    expect(SHIP_STATS.interceptor.role.toLowerCase()).toContain('pirate')
  })

  it('every hull is meaningfully distinct from every other', () => {
    const key = (t: ShipType): string => {
      const s = SHIP_STATS[t]
      return `${s.cargo}|${s.topSpeed}|${s.boostMultiplier}|${s.hull}`
    }
    const keys = SHIP_TYPES.map(key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('makes every hull handle differently, ordered by the class fantasy', () => {
    const accels = SHIP_TYPES.map((t) => SHIP_STATS[t].angularAccel)
    const rates = SHIP_TYPES.map((t) => SHIP_STATS[t].maxAngularSpeed)
    // The pirate interceptor is the sharpest thing in the sky and the mining rig the most ponderous;
    // the whole point of plumbing handling per hull is that these two cannot feel the same.
    expect(SHIP_STATS.interceptor.angularAccel).toBe(Math.max(...accels))
    expect(SHIP_STATS.interceptor.maxAngularSpeed).toBe(Math.max(...rates))
    expect(SHIP_STATS.miner.angularAccel).toBe(Math.min(...accels))
    expect(SHIP_STATS.miner.maxAngularSpeed).toBe(Math.min(...rates))
    expect(new Set(accels).size).toBe(accels.length)
  })

  it('lets every hull roll faster than it pitches', () => {
    // Roll is the low-inertia axis on a hull that is longer than it is wide; a ship that rolls slower
    // than it pitches reads as broken rather than as heavy.
    for (const t of SHIP_TYPES) {
      expect(SHIP_STATS[t].maxRollSpeed).toBeGreaterThan(SHIP_STATS[t].maxAngularSpeed)
    }
  })

  it('all angular stats are positive and finite', () => {
    for (const t of SHIP_TYPES) {
      const s = SHIP_STATS[t]
      for (const v of [s.maxAngularSpeed, s.maxRollSpeed, s.angularAccel]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
    }
  })

  it('shipHandling hands the physics override all three angular fields', () => {
    // Guards the failure this whole plumbing exists to prevent: a partial override silently falls
    // back to the stock hauler's mass, which is indistinguishable from the bug it replaced.
    for (const t of SHIP_TYPES) {
      const h = shipHandling(t)
      expect(Object.keys(h).sort()).toEqual(['angularAccel', 'maxAngularSpeed', 'maxRollSpeed'])
      expect(h.maxAngularSpeed).toBe(SHIP_STATS[t].maxAngularSpeed)
      expect(h.maxRollSpeed).toBe(SHIP_STATS[t].maxRollSpeed)
      expect(h.angularAccel).toBe(SHIP_STATS[t].angularAccel)
    }
  })

  it('reports turn rate in whole degrees per second for the shipyard row', () => {
    expect(turnRateDegPerSec('hauler')).toBe(Math.round((SHIP_STATS.hauler.maxAngularSpeed * 180) / Math.PI))
    for (const t of SHIP_TYPES) expect(Number.isInteger(turnRateDegPerSec(t))).toBe(true)
    expect(turnRateDegPerSec('interceptor')).toBeGreaterThan(turnRateDegPerSec('miner'))
  })

  it('has a rank requirement for every hull, with hauler unlocked at the start', () => {
    for (const t of SHIP_TYPES) {
      expect(Number.isInteger(SHIP_RANK_REQ[t])).toBe(true)
      expect(SHIP_RANK_REQ[t]).toBeGreaterThanOrEqual(0)
    }
    expect(SHIP_RANK_REQ.hauler).toBe(0) // stock ship, no gate
  })

  it('gates higher-tier hulls behind higher ranks', () => {
    expect(SHIP_RANK_REQ.fighter).toBeGreaterThan(SHIP_RANK_REQ.hauler)
    expect(SHIP_RANK_REQ.miner).toBeGreaterThan(SHIP_RANK_REQ.fighter)
    expect(SHIP_RANK_REQ.interceptor).toBeGreaterThan(SHIP_RANK_REQ.miner)
  })
})
