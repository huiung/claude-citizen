import { describe, expect, it } from 'vitest'
import { OUTPOSTS } from './economy'
import {
  createMarket, currentPrice, MARKET_TUNING, recordTrade, step,
} from './market'

describe('market', () => {
  it('seeds prices from the economy OUTPOSTS base prices', () => {
    const m = createMarket()
    expect(currentPrice(m, 'colony', 'ORE')).toBe(OUTPOSTS.colony.prices.ORE)
    expect(currentPrice(m, 'refinery', 'ALLOY')).toBe(OUTPOSTS.refinery.prices.ALLOY)
  })

  it('buying raises the price', () => {
    const m = createMarket()
    const before = currentPrice(m, 'colony', 'ORE')
    recordTrade(m, 'colony', 'ORE', 10, 'buy')
    expect(currentPrice(m, 'colony', 'ORE')).toBeGreaterThan(before)
  })

  it('selling lowers the price', () => {
    const m = createMarket()
    const before = currentPrice(m, 'refinery', 'ORE')
    recordTrade(m, 'refinery', 'ORE', 10, 'sell')
    expect(currentPrice(m, 'refinery', 'ORE')).toBeLessThan(before)
  })

  it('mean-reverts toward base over time after a trade', () => {
    const m = createMarket()
    const base = OUTPOSTS.colony.prices.ORE
    recordTrade(m, 'colony', 'ORE', 10, 'buy')
    const spiked = currentPrice(m, 'colony', 'ORE')
    expect(spiked).toBeGreaterThan(base)
    // Many seconds of decay should pull it back toward base.
    for (let i = 0; i < 200; i++) step(m, 1)
    const settled = currentPrice(m, 'colony', 'ORE')
    expect(settled).toBeLessThan(spiked)
    expect(settled).toBe(base)
  })

  it('reversion is monotonic toward base, never overshooting', () => {
    const m = createMarket()
    const base = OUTPOSTS.refinery.prices.ORE
    recordTrade(m, 'refinery', 'ORE', 10, 'sell') // below base
    let prev = currentPrice(m, 'refinery', 'ORE')
    expect(prev).toBeLessThan(base)
    for (let i = 0; i < 100; i++) {
      step(m, 0.5)
      const next = currentPrice(m, 'refinery', 'ORE')
      expect(next).toBeGreaterThanOrEqual(prev) // never dips further, never overshoots above base
      expect(next).toBeLessThanOrEqual(base)
      prev = next
    }
    expect(prev).toBe(base)
  })

  it('respects the sane price band under relentless one-sided trading', () => {
    const m = createMarket()
    const base = OUTPOSTS.colony.prices.ORE
    for (let i = 0; i < 1000; i++) recordTrade(m, 'colony', 'ORE', 99, 'buy')
    const ceil = currentPrice(m, 'colony', 'ORE')
    expect(ceil).toBeLessThanOrEqual(Math.round(base * MARKET_TUNING.ceilFactor))

    for (let i = 0; i < 5000; i++) recordTrade(m, 'colony', 'ORE', 99, 'sell')
    const floor = currentPrice(m, 'colony', 'ORE')
    expect(floor).toBeGreaterThanOrEqual(Math.round(base * MARKET_TUNING.floorFactor))
  })

  it('is deterministic — identical call sequences yield identical prices', () => {
    const seq = (m: ReturnType<typeof createMarket>) => {
      recordTrade(m, 'colony', 'ORE', 7, 'buy')
      step(m, 1.5)
      recordTrade(m, 'refinery', 'ALLOY', 3, 'sell')
      step(m, 0.25)
      recordTrade(m, 'colony', 'ORE', 2, 'sell')
    }
    const a = createMarket()
    const b = createMarket()
    seq(a)
    seq(b)
    for (const id of ['colony', 'refinery'] as const) {
      for (const c of ['ORE', 'ALLOY'] as const) {
        expect(currentPrice(a, id, c)).toBe(currentPrice(b, id, c))
      }
    }
  })

  it('keeps the Colony<->Refinery two-way loop profitable at base prices', () => {
    const m = createMarket()
    // ORE leg: buy colony, sell refinery
    expect(currentPrice(m, 'refinery', 'ORE')).toBeGreaterThan(currentPrice(m, 'colony', 'ORE'))
    // ALLOY leg: buy refinery, sell colony
    expect(currentPrice(m, 'colony', 'ALLOY')).toBeGreaterThan(currentPrice(m, 'refinery', 'ALLOY'))
  })

  it('stays profitable on average even at the worst trade-driven extremes', () => {
    const m = createMarket()
    // Push every price to its worst-case extreme against the trader.
    for (let i = 0; i < 1000; i++) {
      recordTrade(m, 'colony', 'ORE', 99, 'buy')    // buy ORE expensive
      recordTrade(m, 'refinery', 'ORE', 99, 'sell') // sell ORE cheap
      recordTrade(m, 'refinery', 'ALLOY', 99, 'buy')// buy ALLOY expensive
      recordTrade(m, 'colony', 'ALLOY', 99, 'sell') // sell ALLOY cheap
    }
    const oreProfit = currentPrice(m, 'refinery', 'ORE') - currentPrice(m, 'colony', 'ORE')
    const alloyProfit = currentPrice(m, 'colony', 'ALLOY') - currentPrice(m, 'refinery', 'ALLOY')
    // Each leg stays individually profitable even at the worst-case extremes.
    expect(oreProfit).toBeGreaterThan(0)
    expect(alloyProfit).toBeGreaterThan(0)
  })

  it('ignores bad quantities and unknown keys without throwing', () => {
    const m = createMarket()
    const base = currentPrice(m, 'colony', 'ORE')
    recordTrade(m, 'colony', 'ORE', 0, 'buy')
    recordTrade(m, 'colony', 'ORE', -5, 'buy')
    recordTrade(m, 'nowhere', 'ORE', 5, 'buy')
    expect(currentPrice(m, 'colony', 'ORE')).toBe(base)
    expect(currentPrice(m, 'nowhere', 'ORE')).toBe(0)
  })
})
