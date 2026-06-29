# Station Credit-Roulette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A station CASINO tab where a docked player wagers in-game **credits** on a single-zero roulette wheel (house edge = credit sink), with winnings touching `credits` only (never `earned`/Career, never the token).

**Architecture:** A pure, unit-tested `src/sim/roulette.ts` (wheel + bet resolution, RNG injected) plus a CASINO tab in `src/ui/stationMenu.ts` that mirrors the existing crafting-gacha flow (validate → spend → client RNG → animated reveal → `onChange()` persist). Credits are client-authoritative and bounded by the server `guardEconomyGrowth` rise cap; `MAX_BET` is sized so a win never clamps.

**Tech Stack:** TypeScript, Vitest. Spec: `docs/specs/2026-06-29-credit-roulette-design.md`. Mirrors `src/sim/crafting.ts` (pure roll) + `src/ui/stationMenu.ts` `craft()` (UI flow).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/sim/roulette.ts` | Pure wheel + bet resolution + bet clamp | Create |
| `src/sim/roulette.test.ts` | Unit tests | Create |
| `src/ui/stationMenu.ts` | `casino` tab: type, STATION_TABS, renderCasino, spin/bet/payout | Modify |
| `index.html` | CSS for the casino panel (if needed) | Modify |

**Anchor line numbers** reflect HEAD at plan-writing time; locate by quoted code if they drift.

---

## Task 1: Pure roulette module

**Files:**
- Create: `src/sim/roulette.ts`
- Test: `src/sim/roulette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/roulette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampBet, colorOf, MAX_BET, MIN_BET, payoutMultiplier, spinRoulette, WHEEL_SIZE } from './roulette'

describe('colorOf', () => {
  it('0 is green, known reds are red, the rest are black', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(3)).toBe('red')
    expect(colorOf(2)).toBe('black')
    expect(colorOf(4)).toBe('black')
  })
})

describe('spinRoulette', () => {
  it('maps rng [0,1) into 0..36 with matching color', () => {
    expect(spinRoulette(() => 0)).toEqual({ number: 0, color: 'green' })
    expect(spinRoulette(() => 0.999999).number).toBe(WHEEL_SIZE - 1) // 36
    const r = spinRoulette(() => 0.5)
    expect(r.number).toBeGreaterThanOrEqual(0)
    expect(r.number).toBeLessThanOrEqual(36)
    expect(r.color).toBe(colorOf(r.number))
  })
})

describe('payoutMultiplier', () => {
  it('even-money bets pay 2x on a win, 0 on a loss', () => {
    expect(payoutMultiplier('red', { number: 1, color: 'red' })).toBe(2)
    expect(payoutMultiplier('red', { number: 2, color: 'black' })).toBe(0)
    expect(payoutMultiplier('black', { number: 2, color: 'black' })).toBe(2)
    expect(payoutMultiplier('even', { number: 4, color: 'black' })).toBe(2)
    expect(payoutMultiplier('odd', { number: 4, color: 'black' })).toBe(0)
    expect(payoutMultiplier('low', { number: 5, color: 'red' })).toBe(2)
    expect(payoutMultiplier('high', { number: 5, color: 'red' })).toBe(0)
    expect(payoutMultiplier('high', { number: 36, color: 'red' })).toBe(2)
  })
  it('the green 0 loses ALL bet types (the house edge)', () => {
    const zero = { number: 0, color: 'green' as const }
    for (const bet of ['red', 'black', 'even', 'odd', 'low', 'high'] as const) {
      expect(payoutMultiplier(bet, zero)).toBe(0)
    }
  })
})

describe('clampBet', () => {
  it('clamps to [MIN_BET, MAX_BET], caps at balance, 0 when below MIN_BET', () => {
    expect(clampBet(50, 100_000)).toBe(MIN_BET)
    expect(clampBet(999_999, 100_000)).toBe(MAX_BET)
    expect(clampBet(5000, 3000)).toBe(3000) // capped at balance
    expect(clampBet(5000, 50)).toBe(0)       // can't cover MIN_BET
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/roulette.test.ts`
Expected: FAIL — `Failed to resolve import "./roulette"`.

- [ ] **Step 3: Write the implementation**

Create `src/sim/roulette.ts` exactly as specified in the design doc §3:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/roulette.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/roulette.ts src/sim/roulette.test.ts
git commit -m "feat(casino): pure single-zero roulette module (wheel, bet resolution, clamp)"
```

---

## Task 2: CASINO station tab

**Files:**
- Modify: `src/ui/stationMenu.ts`
- Modify: `index.html` (CSS only, if the panel needs styles)

No new unit test (UI wiring; the logic is unit-tested in Task 1). Verify by typecheck + build + the full suite + manual. READ `src/ui/stationMenu.ts` first — especially the `Tab` type (~line 33), `STATION_TABS` (~44-52), `render()` (~290-304), and `craft()` (~326-372) which is the flow to mirror (validate → `onChange()` → `startForge` animation). The casino has `this.ctx.econ` (the player economy) and `this.onChange()` (→ `refreshWallet` → persist + HUD).

- [ ] **Step 1: Add the `casino` tab type + entry**

In `src/ui/stationMenu.ts`, add `'casino'` to the `Tab` union (~line 33):
```ts
type Tab = 'trade' | 'upgrades' | 'contracts' | 'shipyard' | 'hangar' | 'crafting' | 'market' | 'casino'
```
Add to `STATION_TABS` (~44-52), e.g. after `'market'`:
```ts
  { id: 'casino', label: 'CASINO' },
```

- [ ] **Step 2: Route the tab in `render()`**

In `render()` (~290-304), add a branch alongside the others:
```ts
    else if (this.tab === 'casino') this.renderCasino()
```

- [ ] **Step 3: Implement `renderCasino()` + spin logic**

Add imports at the top of `stationMenu.ts`:
```ts
import { type BetType, clampBet, MAX_BET, MIN_BET, payoutMultiplier, spinRoulette, colorOf } from '../sim/roulette'
```

Add casino state fields to the class (near other transient UI state like `forging`): a current bet type, current stake, last result, and a spinning guard:
```ts
  private casinoBet: BetType = 'red'
  private casinoStake = MIN_BET
  private casinoSpinning = false
  private casinoLast: { text: string; win: boolean } | null = null
```

Implement `renderCasino()` (mirror the structure of `renderCrafting`): render into `#station-body` (the body element the other tabs render into — confirm the real method/element used to set the panel HTML). Build:
- A balance line (`this.ctx.econ.credits`).
- A stake control: an input or +/- buttons clamped to `[MIN_BET, min(MAX_BET, credits)]`; reflect `this.casinoStake`.
- Six bet-type buttons (RED/BLACK/EVEN/ODD/LOW/HIGH) — highlight the selected `this.casinoBet`.
- A SPIN button (disabled while `casinoSpinning` or `credits < MIN_BET`).
- A result area: shows `this.casinoLast` (win/loss + the number/color) or, while spinning, a brief animation (reuse the `startForge`/`setTimeout`-staged pattern — a short ~2s spin then reveal).
Wire the buttons:
- bet-type buttons set `this.casinoBet` + `this.render()`.
- stake buttons/input set `this.casinoStake = clampBet(value, this.ctx.econ.credits)` + `this.render()`.
- SPIN button → `this.spin()`.

Implement `spin()` (mirror `craft()`):
```ts
  private spin(): void {
    if (this.casinoSpinning) return
    const stake = clampBet(this.casinoStake, this.ctx.econ.credits)
    if (stake <= 0) { /* hint: not enough credits */ this.render(); return }
    this.ctx.econ.credits -= stake                      // spend first (like craft)
    const result = spinRoulette()                       // client RNG (like the gacha)
    const mult = payoutMultiplier(this.casinoBet, result)
    if (mult > 0) this.ctx.econ.credits += stake * mult // DIRECT credit add — NOT gainCredits (keeps earned/Career clean)
    this.casinoLast = {
      win: mult > 0,
      text: `${result.number} ${result.color.toUpperCase()} — ${mult > 0 ? `WIN +${stake}` : `LOSE -${stake}`}`,
    }
    this.ctx.audio.blip(mult > 0 ? 'forge' : 'error') // reuse existing sfx ids (confirm real blip names)
    this.onChange()                                     // persist spend+payout + refresh wallet HUD (commit before the reveal, like craft)
    // brief spin animation then reveal, mirroring startForge's staged setTimeout/render
    this.casinoSpinning = true
    this.render()
    setTimeout(() => { this.casinoSpinning = false; this.render() }, 1800)
  }
```
ADAPT to the real `stationMenu` conventions: the exact method that sets the panel HTML, the real `audio.blip` sound ids (grep `audio.blip(` in stationMenu — use existing ids; if no fitting id, omit the blip), the `onChange` signature, and how `renderCrafting` structures its markup/classes. Reuse the forge animation timing constants if present. Ensure SPIN can't drive credits negative (clampBet caps at balance; spend only the clamped stake).

CRITICAL invariants:
- Winnings use `this.ctx.econ.credits += stake * mult` directly — DO NOT call `gainCredits` (would inflate `earned`/Career + apply rank bonus).
- Spend the clamped stake BEFORE the spin; never bet more than the balance.
- `onChange()` is called after spend+payout are applied (so an interrupted reveal can't desync persisted state — same as `craft()`).

- [ ] **Step 4: CSS (if needed)**

If the casino panel needs styling beyond the existing station classes, add minimal rules in `index.html` near the station/crafting styles (match their look). Reuse existing station button/panel classes where possible; only add what's necessary (e.g., a red/black bet-button tint, a result line color for win/loss).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run` → all pass (Task 1 tests + everything else).
Run: `npm run build` → succeeds.
Static reasoning (report): CASINO tab appears in the station; betting spends the clamped stake; a win adds `stake×2` to credits (net +stake) via direct mutation (NOT gainCredits); the green 0 loses; balance never goes negative; `onChange` persists; `earned`/rank unaffected by wins.

- [ ] **Step 6: Commit**

```bash
git add src/ui/stationMenu.ts index.html
git commit -m "feat(casino): station roulette tab — bet credits, spin, payout (credits-only)"
```

---

## Task 3: Manual verification

Run `npm run dev`, fly to a station, dock, open the **CASINO** tab:
- [ ] Pick RED, bet within limits, SPIN — the wheel reveals a number+color; a red result pays 2× (net +stake), a black/green result loses the stake.
- [ ] The green 0 loses every bet type.
- [ ] Credits update in the HUD; balance can't go below 0; you can't bet more than you hold or above MAX_BET / below MIN_BET.
- [ ] Career rank / `earned` do NOT change on a win (only `credits`).
- [ ] Reload → credits persisted (the spend/payout was saved via `onChange`/refreshWallet).
- [ ] Over many spins, credits trend down (house edge).

No commit (verification only).

---

## Self-Review Notes (coverage map)

- Spec §3 (pure module) → Task 1 (verbatim from the spec; unit-tested incl. the green-0-loses-all house-edge case).
- Spec §4 (economy flow: validate→spend→spin→pay→animate→onChange) → Task 2 Step 3 (mirrors `craft()`).
- Spec §1/§2 (credits-only, NOT gainCredits, no earned/Career, no token) → Task 2 Step 3 invariants + Task 3 manual check.
- Spec §5 (guardEconomyGrowth: MAX_BET sizing so a win nets ≤ +stake) → encoded in `MAX_BET` (Task 1) + the even-money 2× payout.
- Spec §6 (CASINO station tab, dock-only) → Task 2 Steps 1–4.
- Spec §7 (tests) → Task 1 unit tests; Task 2/3 typecheck/build/manual.
- Out of scope (token, daily cap, high-variance bets, server RNG) → no task implements them. Deliberate.
- Type/name consistency: `BetType`, `SpinResult`, `spinRoulette`, `payoutMultiplier`, `clampBet`, `MIN_BET`, `MAX_BET`, `colorOf` used identically across Tasks 1–2.
