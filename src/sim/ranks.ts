// Pilot ranks — a progression layer over accumulated credits. Pure + deterministic
// so the HUD, leaderboard, and tests all agree. No DOM, no three.js.

export interface Rank {
  index: number
  name: string
  /** Minimum lifetime credits to hold this rank. */
  min: number
  /** Earnings bonus at this rank: every payout is scaled by (1 + bonus). */
  bonus: number
}

export const RANKS: readonly Rank[] = [
  { index: 0, name: 'Cadet', min: 0, bonus: 0 },
  { index: 1, name: 'Ensign', min: 1_000, bonus: 0.08 },
  { index: 2, name: 'Pilot', min: 5_000, bonus: 0.16 },
  { index: 3, name: 'Ace', min: 20_000, bonus: 0.25 },
  { index: 4, name: 'Commander', min: 80_000, bonus: 0.35 },
  { index: 5, name: 'Admiral', min: 250_000, bonus: 0.5 },
  { index: 6, name: 'Vanguard', min: 700_000, bonus: 0.5 },
  { index: 7, name: 'Warlord', min: 2_000_000, bonus: 0.5 },
]

/** Highest rank whose threshold the credits meet. Never null — Cadet is the floor. */
export function rankForCredits(credits: number): Rank {
  let rank = RANKS[0]
  for (const r of RANKS) if (credits >= r.min) rank = r
  return rank
}

/** Earnings bonus (0..0.5) for the rank held at `credits` lifetime earned. */
export function rankBonus(credits: number): number {
  return rankForCredits(credits).bonus
}

/** The rank above this one, or null if already at the top (Warlord). */
export function nextRank(rank: Rank): Rank | null {
  return RANKS[rank.index + 1] ?? null
}

/** 0..1 progress from the current rank's threshold toward the next (1 if maxed). */
export function rankProgress(credits: number): number {
  const r = rankForCredits(credits)
  const n = nextRank(r)
  if (!n) return 1
  return Math.min(1, Math.max(0, (credits - r.min) / (n.min - r.min)))
}
