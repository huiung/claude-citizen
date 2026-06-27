import { describe, expect, it } from 'vitest'
import {
  buy, CARGO_CAPACITY, cargoFree, cargoUsed, createEconomy, gainCredits, OUTPOSTS, sell, STARTING_CREDITS,
} from './economy'

describe('economy', () => {
  it('starts with the configured credits and empty cargo', () => {
    const econ = createEconomy()
    expect(econ.credits).toBe(STARTING_CREDITS)
    expect(cargoUsed(econ)).toBe(0)
    expect(cargoFree(econ)).toBe(CARGO_CAPACITY)
  })

  it('buying deducts credits and fills cargo', () => {
    const econ = createEconomy()
    const r = buy(econ, OUTPOSTS.colony, 'ORE', 5)
    expect(r.ok).toBe(true)
    expect(econ.credits).toBe(STARTING_CREDITS - 5 * OUTPOSTS.colony.prices.ORE)
    expect(econ.cargo.ORE).toBe(5)
  })

  it('a full ORE round-trip turns a profit', () => {
    const econ = createEconomy()
    buy(econ, OUTPOSTS.colony, 'ORE', 10)   // 10 * 40 = 400
    sell(econ, OUTPOSTS.refinery, 'ORE', 10) // 10 * 110 = 1100
    expect(econ.credits).toBe(STARTING_CREDITS - 400 + 1100)
    expect(econ.cargo.ORE).toBe(0)
  })

  it('the return ALLOY leg is also profitable (two-way loop)', () => {
    const econ = createEconomy()
    econ.credits = 2000
    buy(econ, OUTPOSTS.refinery, 'ALLOY', 5)  // 5 * 70 = 350
    const before = econ.credits
    sell(econ, OUTPOSTS.colony, 'ALLOY', 5)   // 5 * 150 = 750
    expect(econ.credits - before).toBe(750)
  })

  it('rejects buying past cargo capacity', () => {
    const econ = createEconomy()
    econ.credits = 100000
    const r = buy(econ, OUTPOSTS.colony, 'ORE', CARGO_CAPACITY + 1)
    expect(r).toEqual({ ok: false, reason: 'no-cargo-space' })
    expect(econ.cargo.ORE).toBe(0)
    expect(econ.credits).toBe(100000)
  })

  it('rejects buying without enough credits', () => {
    const econ = createEconomy()
    econ.credits = 50
    const r = buy(econ, OUTPOSTS.colony, 'ORE', 2) // needs 80
    expect(r).toEqual({ ok: false, reason: 'no-credits' })
    expect(econ.cargo.ORE).toBe(0)
  })

  it('rejects selling stock you do not have', () => {
    const econ = createEconomy()
    const r = sell(econ, OUTPOSTS.refinery, 'ORE', 1)
    expect(r).toEqual({ ok: false, reason: 'no-stock' })
    expect(econ.credits).toBe(STARTING_CREDITS)
  })

  it('rejects non-positive and non-integer quantities', () => {
    const econ = createEconomy()
    expect(buy(econ, OUTPOSTS.colony, 'ORE', 0).ok).toBe(false)
    expect(buy(econ, OUTPOSTS.colony, 'ORE', -3).ok).toBe(false)
    expect(buy(econ, OUTPOSTS.colony, 'ORE', 1.5).ok).toBe(false)
  })

  it('cargo capacity counts all commodities together', () => {
    const econ = createEconomy()
    econ.credits = 100000
    buy(econ, OUTPOSTS.colony, 'ORE', 12)
    expect(cargoFree(econ)).toBe(CARGO_CAPACITY - 12)
    const r = buy(econ, OUTPOSTS.refinery, 'ALLOY', 12) // only 8 free
    expect(r.ok).toBe(false)
  })
})

describe('planet outposts', () => {
  const PLANET_IDS = ['planet-mercury', 'planet-venus', 'planet-earth', 'planet-mars', 'planet-jupiter', 'planet-saturn']

  it('registers a trade outpost for every named planet', () => {
    for (const id of PLANET_IDS) {
      expect(OUTPOSTS[id]).toBeDefined()
      expect(OUTPOSTS[id].id).toBe(id)
      expect(OUTPOSTS[id].prices.ORE).toBeGreaterThan(0)
      expect(OUTPOSTS[id].prices.ALLOY).toBeGreaterThan(0)
    }
  })

  it('keeps the two start-area outposts', () => {
    expect(OUTPOSTS.colony).toBeDefined()
    expect(OUTPOSTS.refinery).toBeDefined()
  })
})

describe('gainCredits + lifetime earned', () => {
  it('credits a payout to both balance and lifetime earned', () => {
    const econ = createEconomy()
    gainCredits(econ, 100)
    expect(econ.credits).toBe(STARTING_CREDITS + 100)
    expect(econ.earned).toBe(100)
  })

  it('spending lowers balance but never lifetime earned (rank stays)', () => {
    const econ = createEconomy()
    gainCredits(econ, 1000)
    econ.credits -= 800 // e.g. buy an upgrade
    expect(econ.credits).toBe(STARTING_CREDITS + 1000 - 800)
    expect(econ.earned).toBe(1000)
  })

  it('scales a payout by the current rank bonus', () => {
    const econ = createEconomy()
    econ.earned = 5_000 // Pilot, +16%
    gainCredits(econ, 1000)
    expect(econ.earned).toBe(5_000 + 1160) // round(1000 * 1.16)
    expect(econ.credits).toBe(STARTING_CREDITS + 1160)
  })
})
