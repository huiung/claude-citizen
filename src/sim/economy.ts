// Trade economy — pure logic, no rendering, no DOM. Tested in economy.test.ts.

export type CommodityId = 'ORE' | 'ALLOY'

export interface Commodity {
  id: CommodityId
  name: string
}

export const COMMODITIES: Record<CommodityId, Commodity> = {
  ORE: { id: 'ORE', name: 'Raw Ore' },
  ALLOY: { id: 'ALLOY', name: 'Refined Alloy' },
}

export interface Outpost {
  id: string
  name: string
  /** Per-unit price for each commodity at this outpost. Buy and sell at the same price. */
  prices: Record<CommodityId, number>
}

// Two outposts form a closed two-way loop: nobody flies home empty.
//   ORE:   buy cheap at Colony (40)  → sell dear at Refinery (110)  = +70/unit
//   ALLOY: buy cheap at Refinery (70) → sell dear at Colony (150)   = +80/unit
export const OUTPOSTS: Record<string, Outpost> = {
  colony: { id: 'colony', name: 'Helios Mining Colony', prices: { ORE: 40, ALLOY: 150 } },
  refinery: { id: 'refinery', name: 'Meridian Refinery', prices: { ORE: 110, ALLOY: 70 } },
}

export const STARTING_CREDITS = 500
export const CARGO_CAPACITY = 20

export interface PlayerEconomy {
  credits: number
  cargo: Record<CommodityId, number>
}

export function createEconomy(): PlayerEconomy {
  return { credits: STARTING_CREDITS, cargo: { ORE: 0, ALLOY: 0 } }
}

export function cargoUsed(econ: PlayerEconomy): number {
  return econ.cargo.ORE + econ.cargo.ALLOY
}

export function cargoFree(econ: PlayerEconomy): number {
  return CARGO_CAPACITY - cargoUsed(econ)
}

export type TradeResult =
  | { ok: true }
  | { ok: false; reason: 'no-credits' | 'no-cargo-space' | 'no-stock' | 'bad-qty' }

/** Buy `qty` units of `commodity` at `outpost`. Mutates `econ` only on success. */
export function buy(econ: PlayerEconomy, outpost: Outpost, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'bad-qty' }
  const cost = outpost.prices[commodity] * qty
  if (cost > econ.credits) return { ok: false, reason: 'no-credits' }
  if (qty > cargoFree(econ)) return { ok: false, reason: 'no-cargo-space' }
  econ.credits -= cost
  econ.cargo[commodity] += qty
  return { ok: true }
}

/** Sell `qty` units of `commodity` at `outpost`. Mutates `econ` only on success. */
export function sell(econ: PlayerEconomy, outpost: Outpost, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'bad-qty' }
  if (qty > econ.cargo[commodity]) return { ok: false, reason: 'no-stock' }
  econ.credits += outpost.prices[commodity] * qty
  econ.cargo[commodity] -= qty
  return { ok: true }
}

const STORAGE_KEY = 'scc.economy.v1'

export function loadEconomy(): PlayerEconomy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEconomy()
    const parsed = JSON.parse(raw)
    if (typeof parsed?.credits !== 'number' || typeof parsed?.cargo !== 'object') return createEconomy()
    return {
      credits: parsed.credits,
      cargo: { ORE: parsed.cargo.ORE ?? 0, ALLOY: parsed.cargo.ALLOY ?? 0 },
    }
  } catch {
    return createEconomy()
  }
}

export function saveEconomy(econ: PlayerEconomy): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(econ))
  } catch {
    /* storage unavailable (private mode) — economy is just ephemeral then */
  }
}
