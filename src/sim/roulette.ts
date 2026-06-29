// Station casino roulette — pure + deterministic (RNG injected), mirrors src/sim/crafting.ts.
// Credits-only wager; the green 0 gives the house its edge. Winnings touch `credits` only — the
// caller must NOT route payouts through gainCredits (that would inflate `earned`/Career).
export type RouletteColor = 'red' | 'black' | 'green'
export interface SpinResult { number: number; color: RouletteColor } // 0..36; 0 is green

export type BetType = 'red' | 'black' | 'even' | 'odd' | 'low' | 'high'

export const WHEEL_SIZE = 37        // single zero: 0..36
export const MIN_BET = 100
export const MAX_BET = 10_000       // starting value (tuned live); a 2x win nets +stake ≤ MAX_BET,
                                    // under the server guardEconomyGrowth per-save rise cap.

// Standard European red numbers; everything else in 1..36 is black, 0 is green.
export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export function colorOf(n: number): RouletteColor {
  return n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black'
}

/** Spin the wheel. `rng` returns [0,1); injected for tests. */
export function spinRoulette(rng: () => number = Math.random): SpinResult {
  const n = Math.min(WHEEL_SIZE - 1, Math.max(0, Math.floor(rng() * WHEEL_SIZE)))
  return { number: n, color: colorOf(n) }
}

/** Payout MULTIPLIER on the stake. 0 = lose, 2 = even-money win (stake back + equal).
 *  All bets are even-money; the green 0 loses them all (the house edge). */
export function payoutMultiplier(bet: BetType, r: SpinResult): number {
  if (r.number === 0) return 0
  const win =
    bet === 'red' ? r.color === 'red'
    : bet === 'black' ? r.color === 'black'
    : bet === 'even' ? r.number % 2 === 0
    : bet === 'odd' ? r.number % 2 === 1
    : bet === 'low' ? r.number >= 1 && r.number <= 18
    : r.number >= 19 && r.number <= 36 // high
  return win ? 2 : 0
}

/** Clamp/validate a stake to [MIN_BET, MAX_BET] and the balance. Returns 0 if credits < MIN_BET. */
export function clampBet(amount: number, credits: number): number {
  const a = Math.floor(Number(amount) || 0)
  if (credits < MIN_BET) return 0
  return Math.max(MIN_BET, Math.min(MAX_BET, Math.min(a, credits)))
}
