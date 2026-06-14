// Dynamic market — pure logic, no rendering, no DOM. Tested in market.test.ts.
//
// Prices live on top of economy.ts base prices. They drift in response to trades
// (buying pushes a price up, selling pushes it down) and mean-revert toward base
// over time. Everything here is DETERMINISTIC: no Math.random anywhere — the same
// sequence of step()/recordTrade() calls always yields the same prices.

import { COMMODITIES, type CommodityId, OUTPOSTS } from './economy'

export type TradeSide = 'buy' | 'sell'

/** Tuning for price dynamics — all the market feel lives here. */
export const MARKET_TUNING = {
  /** Mean-reversion rate (1/s). Higher = prices snap back to base faster. */
  reversionRate: 0.15,
  /** Fraction of base price each traded unit nudges the live price. */
  impactPerUnit: 0.01,
  /**
   * Live price is clamped to base * [floorFactor, ceilFactor]. The band is
   * deliberately narrow enough that BOTH the ORE and ALLOY legs of the
   * Colony<->Refinery loop stay profitable even at simultaneous worst-case
   * extremes (sell-side floored, buy-side ceiled):
   *   ORE:   sell 110*0.7=77 > buy 40*1.3=52
   *   ALLOY: sell 150*0.7=105 > buy 70*1.3=91
   */
  floorFactor: 0.7,
  ceilFactor: 1.3,
}

/**
 * A single tradable line at one outpost. `base` is immutable (seeded from
 * OUTPOSTS); `impulse` is the accumulated, signed displacement from base that
 * trades have pushed in. The displayed price is base + impulse, clamped.
 */
export interface MarketEntry {
  base: number
  /** Signed offset from base, in credits. Positive = price above base. */
  impulse: number
}

/** Live market state, keyed `${outpostId}:${commodity}`. Caller owns the object. */
export interface MarketState {
  entries: Record<string, MarketEntry>
}

const ALL_COMMODITIES = Object.keys(COMMODITIES) as CommodityId[]

function key(outpostId: string, commodity: CommodityId): string {
  return `${outpostId}:${commodity}`
}

/** Build a fresh market seeded from the economy's OUTPOSTS base prices. */
export function createMarket(): MarketState {
  const entries: Record<string, MarketEntry> = {}
  for (const outpost of Object.values(OUTPOSTS)) {
    for (const commodity of ALL_COMMODITIES) {
      entries[key(outpost.id, commodity)] = { base: outpost.prices[commodity], impulse: 0 }
    }
  }
  return { entries }
}

function clampImpulse(entry: MarketEntry, impulse: number): number {
  const min = entry.base * MARKET_TUNING.floorFactor - entry.base
  const max = entry.base * MARKET_TUNING.ceilFactor - entry.base
  return Math.min(max, Math.max(min, impulse))
}

/**
 * Advance the market by `dt` seconds. Every entry's impulse decays toward 0
 * (i.e. price mean-reverts toward base) at an exponential, dt-stable rate.
 */
export function step(market: MarketState, dt: number): void {
  if (dt <= 0) return
  const decay = Math.exp(-MARKET_TUNING.reversionRate * dt)
  for (const entry of Object.values(market.entries)) {
    entry.impulse *= decay
  }
}

/**
 * Record that `qty` units of `commodity` were traded at `outpost`. Buying nudges
 * the price up, selling nudges it down. Impulse stays within sane bounds so a
 * price can never run away. No-op for unknown outpost/commodity or bad qty.
 */
export function recordTrade(
  market: MarketState,
  outpostId: string,
  commodity: CommodityId,
  qty: number,
  side: TradeSide,
): void {
  if (!Number.isFinite(qty) || qty <= 0) return
  const entry = market.entries[key(outpostId, commodity)]
  if (!entry) return
  const direction = side === 'buy' ? 1 : -1
  const nudge = direction * qty * entry.base * MARKET_TUNING.impactPerUnit
  entry.impulse = clampImpulse(entry, entry.impulse + nudge)
}

/**
 * Current per-unit price for `commodity` at `outpost`, rounded to a whole credit
 * and clamped to the sane band. Falls back to the economy base price if the
 * entry is unknown (so callers degrade gracefully).
 */
export function currentPrice(market: MarketState, outpostId: string, commodity: CommodityId): number {
  const entry = market.entries[key(outpostId, commodity)]
  if (!entry) return OUTPOSTS[outpostId]?.prices[commodity] ?? 0
  const raw = entry.base + clampImpulse(entry, entry.impulse)
  return Math.round(raw)
}
