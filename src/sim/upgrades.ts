// Ship upgrades — pure logic, no rendering, no DOM. Tested in upgrades.test.ts.
// Credit sinks that improve the ship across discrete tiers. Tier 0 == today's
// stock ship: base values mirror CARGO_CAPACITY (economy) and TUNING (physics).

import { CARGO_CAPACITY, type PlayerEconomy } from './economy'
import { MINING_YIELD } from './mining'
import { TUNING } from './physics'

export type UpgradeTrack = 'cargo' | 'speed' | 'boost' | 'mining'

/** Per-track upgrade definition. `values[i]` is the stat at tier `i`; `prices[i]`
 *  is the credit cost to advance FROM tier `i` TO tier `i+1`. */
interface TrackDef {
  /** Stat value at each tier; index 0 is the stock value. */
  values: number[]
  /** Cost to advance from tier i to i+1; length is values.length - 1. */
  prices: number[]
}

// Tier 0 of every track matches the live game constants so an un-upgraded ship
// behaves exactly as it does today. Prices scale up super-linearly per tier.
export const UPGRADE_TRACKS: Record<UpgradeTrack, TrackDef> = {
  cargo: {
    values: [CARGO_CAPACITY, 35, 50, 75, 105, 150],
    prices: [600, 1500, 3500, 7000, 14000],
  },
  speed: {
    values: [TUNING.maxSpeed, 115, 140, 175, 215, 265],
    prices: [800, 2000, 4500, 9000, 18000],
  },
  boost: {
    values: [TUNING.boostMultiplier, 4.5, 5.5, 7, 9, 12],
    prices: [1000, 2500, 5000, 10000, 20000],
  },
  mining: {
    values: [MINING_YIELD, 3, 4.5, 6, 8, 10],
    prices: [500, 1200, 3000, 6500, 13000],
  },
}

export interface ShipUpgrades {
  /** Current tier per track. Tier 0 is stock. */
  tiers: Record<UpgradeTrack, number>
}

export function createUpgrades(): ShipUpgrades {
  return { tiers: { cargo: 0, speed: 0, boost: 0, mining: 0 } }
}

/** Highest tier index reachable on a track (length - 1). */
export function maxTier(track: UpgradeTrack): number {
  return UPGRADE_TRACKS[track].values.length - 1
}

function trackValue(u: ShipUpgrades, track: UpgradeTrack): number {
  return UPGRADE_TRACKS[track].values[u.tiers[track]]
}

/** Effective cargo capacity (units) for the current cargo tier. */
export function cargoCapacity(u: ShipUpgrades): number {
  return trackValue(u, 'cargo')
}

/** Effective coupled-mode top speed (m/s) for the current speed tier. */
export function topSpeed(u: ShipUpgrades): number {
  return trackValue(u, 'speed')
}

/** Effective boost multiplier for the current boost tier. */
export function boostMultiplier(u: ShipUpgrades): number {
  return trackValue(u, 'boost')
}

/** Effective mining yield (ORE/sec) for the current mining tier. */
export function miningYield(u: ShipUpgrades): number {
  return trackValue(u, 'mining')
}

/** Credits to advance `track` one tier, or null if already maxed. */
export function nextPrice(u: ShipUpgrades, track: UpgradeTrack): number | null {
  const tier = u.tiers[track]
  const prices = UPGRADE_TRACKS[track].prices
  if (tier >= prices.length) return null
  return prices[tier]
}

export type PurchaseResult =
  | { ok: true; track: UpgradeTrack; tier: number; spent: number }
  | { ok: false; reason: 'maxed' | 'no-credits' }

/** Buy the next tier on `track`. Mutates `u` and `econ` only on success. */
export function purchase(u: ShipUpgrades, econ: PlayerEconomy, track: UpgradeTrack): PurchaseResult {
  const price = nextPrice(u, track)
  if (price === null) return { ok: false, reason: 'maxed' }
  if (price > econ.credits) return { ok: false, reason: 'no-credits' }
  econ.credits -= price
  u.tiers[track] += 1
  return { ok: true, track, tier: u.tiers[track], spent: price }
}

const STORAGE_KEY = 'scc.upgrades.v1'

export function loadUpgrades(): ShipUpgrades {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createUpgrades()
    const parsed = JSON.parse(raw)
    const t = parsed?.tiers
    if (typeof t !== 'object' || t === null) return createUpgrades()
    const clamp = (track: UpgradeTrack): number => {
      const v = t[track]
      if (typeof v !== 'number' || !Number.isInteger(v)) return 0
      return Math.max(0, Math.min(maxTier(track), v))
    }
    return { tiers: { cargo: clamp('cargo'), speed: clamp('speed'), boost: clamp('boost'), mining: clamp('mining') } }
  } catch {
    return createUpgrades()
  }
}

export function saveUpgrades(u: ShipUpgrades): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
  } catch {
    /* storage unavailable (private mode) — upgrades are just ephemeral then */
  }
}
