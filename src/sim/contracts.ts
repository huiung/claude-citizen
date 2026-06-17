// Delivery contracts — pure logic, no rendering, no DOM. Tested in contracts.test.ts.
// Haul missions: deliver N units of a commodity from one outpost to another for credits.

import { COMMODITIES, type CommodityId, gainCredits, type Outpost, type PlayerEconomy } from './economy'

export type ContractStatus = 'offered' | 'accepted' | 'completed' | 'abandoned'

export interface Contract {
  id: string
  commodity: CommodityId
  qty: number
  /** Outpost id the goods originate from (informational — pickup is not enforced). */
  fromId: string
  /** Outpost id the goods must be delivered to for completion. */
  toId: string
  reward: number
  status: ContractStatus
}

/** Deterministic PRNG. Returns a function yielding floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick an integer in [min, max] inclusive from the PRNG. */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

const COMMODITY_IDS = Object.keys(COMMODITIES) as CommodityId[]
const CONTRACTS_PER_SEED = 3
const MIN_QTY = 3
const MAX_QTY = 10
/** Reward per unit, scaled by a small random multiplier for variety. */
const BASE_REWARD_PER_UNIT = 60

/**
 * Generate a deterministic batch of delivery contracts for a given integer `seed`.
 * The same seed and outpost set always yield identical contracts (ids, qty, reward, route).
 */
export function generateContracts(seed: number, outposts: Record<string, Outpost>): Contract[] {
  const rng = mulberry32(seed)
  const ids = Object.keys(outposts)
  const contracts: Contract[] = []
  if (ids.length < 2) return contracts

  for (let i = 0; i < CONTRACTS_PER_SEED; i++) {
    const commodity = COMMODITY_IDS[randInt(rng, 0, COMMODITY_IDS.length - 1)]
    const qty = randInt(rng, MIN_QTY, MAX_QTY)
    const fromIdx = randInt(rng, 0, ids.length - 1)
    // Pick a distinct destination by offsetting within the ring.
    const toIdx = (fromIdx + 1 + randInt(rng, 0, ids.length - 2)) % ids.length
    const rewardMul = 1 + rng() // [1, 2)
    const reward = Math.round(qty * BASE_REWARD_PER_UNIT * rewardMul)
    contracts.push({
      id: `contract-${seed}-${i}`,
      commodity,
      qty,
      fromId: ids[fromIdx],
      toId: ids[toIdx],
      reward,
      status: 'offered',
    })
  }
  return contracts
}

export type AcceptResult =
  | { ok: true }
  | { ok: false; reason: 'not-offered' }

/** Accept an offered contract. Mutates `contract` only on success. */
export function accept(contract: Contract): AcceptResult {
  if (contract.status !== 'offered') return { ok: false, reason: 'not-offered' }
  contract.status = 'accepted'
  return { ok: true }
}

export type AbandonResult =
  | { ok: true }
  | { ok: false; reason: 'not-accepted' }

/** Abandon an accepted contract. Mutates `contract` only on success. */
export function abandon(contract: Contract): AbandonResult {
  if (contract.status !== 'accepted') return { ok: false, reason: 'not-accepted' }
  contract.status = 'abandoned'
  return { ok: true }
}

export type CompleteResult =
  | { ok: true; reward: number }
  | { ok: false; reason: 'not-accepted' | 'wrong-outpost' | 'insufficient-cargo' }

/**
 * Complete a delivery: succeeds only when `atOutpostId === contract.toId` and the player
 * carries at least `contract.qty` of the commodity. On success removes the goods, pays the
 * reward into `econ.credits`, and flips the contract to 'completed'. Mutates only on success.
 */
export function completeContract(
  contract: Contract,
  econ: PlayerEconomy,
  atOutpostId: string,
): CompleteResult {
  if (contract.status !== 'accepted') return { ok: false, reason: 'not-accepted' }
  if (atOutpostId !== contract.toId) return { ok: false, reason: 'wrong-outpost' }
  if (econ.cargo[contract.commodity] < contract.qty) {
    return { ok: false, reason: 'insufficient-cargo' }
  }
  econ.cargo[contract.commodity] -= contract.qty
  gainCredits(econ, contract.reward)
  contract.status = 'completed'
  return { ok: true, reward: contract.reward }
}
