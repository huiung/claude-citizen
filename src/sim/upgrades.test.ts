import { describe, expect, it } from 'vitest'
import { CARGO_CAPACITY, createEconomy } from './economy'
import { TUNING } from './physics'
import {
  boostMultiplier, cargoCapacity, createUpgrades, maxTier, nextPrice, purchase, topSpeed,
  UPGRADE_TRACKS, type UpgradeTrack,
} from './upgrades'

const TRACKS: UpgradeTrack[] = ['cargo', 'speed', 'boost']

describe('upgrades', () => {
  it('tier 0 matches the live game constants (stock ship)', () => {
    const u = createUpgrades()
    expect(u.tiers).toEqual({ cargo: 0, speed: 0, boost: 0 })
    expect(cargoCapacity(u)).toBe(CARGO_CAPACITY)
    expect(topSpeed(u)).toBe(TUNING.maxSpeed)
    expect(boostMultiplier(u)).toBe(TUNING.boostMultiplier)
  })

  it('purchase success deducts credits and advances the tier', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 10000
    const price = nextPrice(u, 'cargo')!
    const r = purchase(u, econ, 'cargo')
    expect(r).toEqual({ ok: true, track: 'cargo', tier: 1, spent: price })
    expect(econ.credits).toBe(10000 - price)
    expect(u.tiers.cargo).toBe(1)
  })

  it('getters reflect the current tier after purchase', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 100000
    purchase(u, econ, 'speed')
    expect(topSpeed(u)).toBe(UPGRADE_TRACKS.speed.values[1])
    purchase(u, econ, 'boost')
    expect(boostMultiplier(u)).toBe(UPGRADE_TRACKS.boost.values[1])
    purchase(u, econ, 'cargo')
    expect(cargoCapacity(u)).toBe(UPGRADE_TRACKS.cargo.values[1])
  })

  it('fails (and mutates nothing) when too poor', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 1 // far below any tier-0 price
    const r = purchase(u, econ, 'speed')
    expect(r).toEqual({ ok: false, reason: 'no-credits' })
    expect(econ.credits).toBe(1)
    expect(u.tiers.speed).toBe(0)
  })

  it('fails when already maxed, and nextPrice is null at max', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 1_000_000
    // Buy every tier on the boost track up to the cap.
    while (nextPrice(u, 'boost') !== null) {
      expect(purchase(u, econ, 'boost').ok).toBe(true)
    }
    expect(u.tiers.boost).toBe(maxTier('boost'))
    expect(nextPrice(u, 'boost')).toBeNull()
    const credits = econ.credits
    const r = purchase(u, econ, 'boost')
    expect(r).toEqual({ ok: false, reason: 'maxed' })
    expect(econ.credits).toBe(credits)
    expect(u.tiers.boost).toBe(maxTier('boost'))
  })

  it('prices scale up strictly each tier on every track', () => {
    for (const track of TRACKS) {
      const prices = UPGRADE_TRACKS[track].prices
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1])
      }
    }
  })

  it('stat values increase strictly each tier on every track', () => {
    for (const track of TRACKS) {
      const values = UPGRADE_TRACKS[track].values
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1])
      }
    }
  })

  it('nextPrice returns the cost of the upcoming tier as you climb', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 1_000_000
    const prices = UPGRADE_TRACKS.cargo.prices
    for (let i = 0; i < prices.length; i++) {
      expect(nextPrice(u, 'cargo')).toBe(prices[i])
      purchase(u, econ, 'cargo')
    }
    expect(nextPrice(u, 'cargo')).toBeNull()
  })

  it('purchases on different tracks are independent', () => {
    const u = createUpgrades()
    const econ = createEconomy()
    econ.credits = 100000
    purchase(u, econ, 'cargo')
    expect(u.tiers).toEqual({ cargo: 1, speed: 0, boost: 0 })
    expect(topSpeed(u)).toBe(TUNING.maxSpeed)
    expect(boostMultiplier(u)).toBe(TUNING.boostMultiplier)
  })
})
