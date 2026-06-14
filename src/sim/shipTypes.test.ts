import { describe, expect, it } from 'vitest'
import { CARGO_CAPACITY } from './economy'
import { TUNING } from './physics'
import { SHIP_STATS, SHIP_TYPES, shipStats, type ShipType } from './shipTypes'

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
})
