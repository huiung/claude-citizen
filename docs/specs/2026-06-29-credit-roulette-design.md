# Station Casino — Credit Roulette — Design

**Date:** 2026-06-29
**Status:** Design approved (pending written-spec review)
**Context:** A casino mini-game for the station, teased in the relaunch announcement. Players **wager in-game credits** (NOT the $CITIZEN token) on a single-zero roulette wheel. Credits-only keeps it a pure game mechanic — **not** real-money gambling — so there is no token/regulatory exposure. The house edge makes it a **credit sink**, which is healthy for the economy.

---

## 1. Why

Credits need engaging sinks, and a casino is a high-dopamine retention loop that fits a crypto-native audience. Wagering **credits** (not the token) sidesteps gambling regulation entirely while delivering the risk/reward thrill. The single-zero house edge means the game drains credits on average — a sink, not a faucet.

**Hard boundaries (decided):**
- Wager is **credits only**. Never the token. (Token gambling = regulated; rejected.)
- Payouts adjust **`credits` only** — never `earned`. `earned` is the Career-leaderboard score and must stay clean; roulette is zero-sum thrill, not earned income. So winnings use a **direct `econ.credits += …`**, NOT `gainCredits()` (which would inflate `earned` + apply the rank bonus).

---

## 2. Scope

### In scope
- A pure, deterministic, unit-tested `src/sim/roulette.ts`: a single-zero wheel + bet resolution (RNG injected).
- A **CASINO** station tab (dock-only) that bets/spins/animates/pays out, mirroring the existing crafting-gacha authority pattern (validate → spend → client RNG → reveal → persist).
- Bet types: RED / BLACK / EVEN / ODD / LOW (1–18) / HIGH (19–36), all even-money (2× return). The green **0** loses all of them → the house edge (≈2.7%).
- Bet limits `MIN_BET` / `MAX_BET`, sized so a win never exceeds the server credit-rise cap (see §5).
- Unit tests for the pure module.

### Out of scope (later / rejected)
- Token wagering (rejected — regulatory).
- Touching `earned` / leaderboards (winnings are credits-only).
- High-variance bets (single-number 35×, dozens 3×) — the module is structured to add them later, but v1 ships even-money bets only (low variance keeps wins under the rise cap).
- A daily cap — unnecessary for v1: it's a credit sink, self-limited by the player's balance. Revisit if needed.
- Server-authoritative spin RNG — credits are already client-authoritative and bounded by `guardEconomyGrowth` (see §5); the spin follows the existing client-RNG gacha pattern.

---

## 3. Pure module — `src/sim/roulette.ts`

Mirrors the shape/style of `src/sim/crafting.ts`'s `rollCraftingRarity` (pure, RNG injected, deterministic, unit-testable).

```ts
export type RouletteColor = 'red' | 'black' | 'green'
export interface SpinResult { number: number; color: RouletteColor } // number 0..36; 0 is green

export type BetType = 'red' | 'black' | 'even' | 'odd' | 'low' | 'high'

export const WHEEL_SIZE = 37 // single zero: 0..36
export const MIN_BET = 100
export const MAX_BET = 10_000 // starting value (tuned live); see §5 — keeps a 2× win under the per-save rise cap

// Standard European red numbers; everything else 1..36 is black, 0 is green.
export const RED_NUMBERS: ReadonlySet<number> = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])

export function colorOf(n: number): RouletteColor { return n === 0 ? 'green' : (RED_NUMBERS.has(n) ? 'red' : 'black') }

/** Spin the wheel. `rng` returns [0,1); injected for tests. */
export function spinRoulette(rng = Math.random): SpinResult {
  const n = Math.min(WHEEL_SIZE - 1, Math.max(0, Math.floor(rng() * WHEEL_SIZE)))
  return { number: n, color: colorOf(n) }
}

/** Payout MULTIPLIER on the stake for `bet` given `result`. 0 = lose, 2 = even-money win (stake back + equal).
 *  All bets here are even-money; the green 0 loses them all (the house edge). */
export function payoutMultiplier(bet: BetType, r: SpinResult): number {
  if (r.number === 0) return 0 // green zero: even-money bets all lose
  const win =
    bet === 'red' ? r.color === 'red' :
    bet === 'black' ? r.color === 'black' :
    bet === 'even' ? r.number % 2 === 0 :
    bet === 'odd' ? r.number % 2 === 1 :
    bet === 'low' ? r.number >= 1 && r.number <= 18 :
    /* high */ r.number >= 19 && r.number <= 36
  return win ? 2 : 0
}

/** Clamp/validate a bet amount to [MIN_BET, MAX_BET] and the player's balance. Returns the accepted
 *  stake, or 0 if the player can't cover MIN_BET. */
export function clampBet(amount: number, credits: number): number {
  const a = Math.floor(Number(amount) || 0)
  if (credits < MIN_BET) return 0
  return Math.max(MIN_BET, Math.min(MAX_BET, Math.min(a, credits)))
}
```

(House edge with even-money bets on a single-zero wheel = 1/37 ≈ 2.70% — expected return 0.973× per spin.)

---

## 4. Economy integration (station CASINO tab)

Mirror the crafting flow (`src/ui/stationMenu.ts` `craft()` → validate → spend → roll → reveal → `onChange()`):

1. Player picks a bet type + amount in the CASINO tab.
2. `stake = clampBet(amount, econ.credits)`; if 0 → hint "not enough credits" and stop.
3. **Spend immediately:** `econ.credits -= stake` (before the spin, like crafting spends before the roll).
4. **Spin:** `const result = spinRoulette()` (client `Math.random`, as the gacha does).
5. **Resolve + pay:** `const mult = payoutMultiplier(bet, result); if (mult > 0) econ.credits += stake * mult`. **Direct mutation — NOT `gainCredits()`** (so `earned`/Career is untouched).
6. **Animate** the wheel/result (~2.5s, reusing the crafting forge-stage timing pattern), reveal the number+color, show win/loss + new balance.
7. **`onChange()`** → `refreshWallet()` (persists econ + syncs to the relay), after spend+payout are committed (so an interrupted reveal can't desync — same as crafting committing before the forge animation).
8. `updateWalletHUD()` reflects the new `credits` (driven by `refreshWallet`).

---

## 5. Integrity — reconciling with `guardEconomyGrowth`

`server/progress.mjs` `guardEconomyGrowth` bounds the per-save **rise** of `credits` to `prevCredits + MAX_EARN_RATE(10_000/s) × elapsedSec` (windowed at 60s → max +600k/save); **spending (credits going down) is free**. Implications:

- Roulette is **net-negative** (house edge), so over time credits **fall** — the rise cap rarely bites.
- A **win** is a credit rise; if a single win exceeds the budget accrued since the last save, the server would clamp it (player would lose part of a legit win). To prevent this: **`MAX_BET` is sized so a max win (2× = stake + stake) stays comfortably under a realistic per-spin budget.** With a ~2.5s spin + save cadence, budget ≈ 25k; `MAX_BET = 10_000` → max win +10k on top of the returned stake, well under budget. (If higher-variance bets are added later, cap `MAX_BET × maxMultiplier` to the same budget, or batch saves.)
- This is the existing trust model: client computes credits, server bounds the rise. Credits feed only in-game purchases (upgrades/ships/credit-market) — never the token, never `earned`/Career — so a client that cheats the spin can at most inflate spendable credits within the server cap. Acceptable, same as crafting.

---

## 6. UI

- New tab in `STATION_TABS` (`src/ui/stationMenu.ts`): `{ id: 'casino', label: 'CASINO' }`; a `renderCasino()` branch in `render()`; only reachable while docked (the station menu closes on undock).
- Layout: a bet-amount input (with quick-set buttons or a slider, MIN..MAX clamped), six bet-type buttons (RED/BLACK/EVEN/ODD/LOW/HIGH), a SPIN button, the wheel/result display + a short spin animation, and a win/loss + payout line. Credits shown update via the existing wallet HUD.
- Match the station menu's existing markup/classes; render into `#station-body`.

---

## 7. Testing

- `src/sim/roulette.test.ts`:
  - `colorOf`: 0→green; a known red (e.g. 1, 3)→red; a known black (e.g. 2, 4)→black.
  - `spinRoulette` with a stubbed rng: rng→0 gives number 0 (green); rng→just-under-1 gives 36; values map into [0,36].
  - `payoutMultiplier`: red bet wins on a red number (2×), loses on black (0); even/odd/low/high each win+lose correctly; **the green 0 returns 0 for ALL bet types** (encodes the house edge).
  - `clampBet`: clamps to [MIN_BET, MAX_BET], caps at the player's balance, returns 0 when credits < MIN_BET.
- Station casino UI: typecheck + build + manual (bet → spend → spin → payout → HUD updates; 0 spins lose; balance can't go negative; winnings don't change rank/earned).

---

## 8. Success criteria

A docked player opens CASINO, bets credits on red/black/etc., spins, and sees credits move with a satisfying reveal — winning pays 2× (stake back + equal), the green 0 takes the house edge, and over many spins the player trends down (a sink). Winnings never touch `earned`/Career, never involve the token, and a max-size win is never clamped by the server rise cap.
