# Server-Side XP Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fabricated pilot level/XP by bounding the per-save rise of cumulative pilot XP against a server-measured time budget — mirroring the existing `guardEconomyGrowth` economy anti-cheat.

**Architecture:** Port the tiny XP curve to the server (`xpForLevel`/`cumulativeXp`/`levelForTotal` + `MAX_PILOT_LEVEL`), pinned to the TS source by a drift test. Add a pure `guardPilotGrowth(pilot, prev, nowMs)` in `server/progress.mjs` that clamps accepted cumulative XP to `[prevTotal, prevTotal + rate*elapsed]`, converts back to `{level, xp}`, caps level, and stamps `_pilotAt`. Wire it into the save handler beside `guardEconomyGrowth`.

**Tech Stack:** Node ESM (`.mjs`), Vitest. Spec: `docs/specs/2026-06-29-server-xp-validation-design.md`. The XP curve mirrors `src/sim/pilotLevel.ts`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `server/progress.mjs` | XP curve port + `guardPilotGrowth` (beside `guardEconomyGrowth`) | Modify |
| `server/progress.test.mjs` | Curve-pin tests + guard tests | Create/Modify |
| `server/index.mjs` | Apply `guardPilotGrowth` in the save handler; import it | Modify |

**Anchor line numbers** reflect HEAD at plan-writing time. If drifted, locate by the quoted code.

---

## Task 1: Server XP curve port (pinned to the client curve)

**Files:**
- Modify: `server/progress.mjs`
- Test: `server/progress.test.mjs`

- [ ] **Step 1: Write the failing test**

If `server/progress.test.mjs` does not exist, create it. Add (import `sanitizeProgress` style from the real module; these new exports are added in Step 3):

```js
import { describe, it, expect } from 'vitest'
import { MAX_PILOT_LEVEL, cumulativeXp, levelForTotal } from './progress.mjs'

describe('server XP curve (mirror of src/sim/pilotLevel.ts)', () => {
  it('matches the client cumulative-XP totals', () => {
    expect(cumulativeXp(1, 0)).toBe(0)
    expect(cumulativeXp(2, 0)).toBe(80)              // xpForLevel(1)
    expect(cumulativeXp(5, 0)).toBe(1200)            // 80+200+360+560
    expect(cumulativeXp(3, 40)).toBe(80 + 200 + 40)  // prior costs + xp-into-level
  })

  it('round-trips level/xp through cumulative + inverse', () => {
    for (const [lvl, xp] of [[1, 0], [3, 40], [5, 0], [10, 15], [19, 100]]) {
      expect(levelForTotal(cumulativeXp(lvl, xp))).toEqual({ level: lvl, xp })
    }
  })

  it('caps at MAX_PILOT_LEVEL with xp pinned to 0', () => {
    expect(MAX_PILOT_LEVEL).toBe(20)
    expect(levelForTotal(cumulativeXp(20, 0))).toEqual({ level: 20, xp: 0 })
    expect(levelForTotal(99_999_999)).toEqual({ level: 20, xp: 0 })
  })

  it('clamps bad input', () => {
    expect(cumulativeXp(-5, -9)).toBe(0)       // level floored to 1, xp floored to 0
    expect(levelForTotal(-100)).toEqual({ level: 1, xp: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/progress.test.mjs`
Expected: FAIL — `MAX_PILOT_LEVEL`/`cumulativeXp`/`levelForTotal` are not exported.

- [ ] **Step 3: Implement the curve port**

In `server/progress.mjs`, add near the top (after the existing imports / header), with a comment marking it as a mirror:

```js
// --- Pilot XP curve (server mirror of src/sim/pilotLevel.ts) -----------------
// Keep in lockstep with the client. The drift test in progress.test.mjs pins these sample values,
// so a TS-side curve change that isn't mirrored here fails CI.
export const MAX_PILOT_LEVEL = 20
function xpForLevel(level) { return 60 * level + 20 * level * level } // 1→2:80, 2→3:200, 3→4:360, 4→5:560

// Cumulative XP to be AT (level, xp): sum of all prior level costs + xp into the current level.
export function cumulativeXp(level, xp) {
  const lvl = Math.min(MAX_PILOT_LEVEL, Math.max(1, Math.floor(Number(level) || 1)))
  let total = Math.max(0, Math.floor(Number(xp) || 0))
  for (let i = 1; i < lvl; i++) total += xpForLevel(i)
  return total
}

// Inverse: highest level whose cumulative cost <= total, remainder as xp-into-level.
// At MAX_PILOT_LEVEL, xp is pinned to 0 (matches client addXp zeroing at the cap).
export function levelForTotal(total) {
  let t = Math.max(0, Math.floor(Number(total) || 0))
  let level = 1
  while (level < MAX_PILOT_LEVEL && t >= xpForLevel(level)) { t -= xpForLevel(level); level += 1 }
  if (level >= MAX_PILOT_LEVEL) return { level: MAX_PILOT_LEVEL, xp: 0 }
  return { level, xp: t }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/progress.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/progress.mjs server/progress.test.mjs
git commit -m "feat(progression): server-side XP curve port (pinned to client curve)"
```

---

## Task 2: `guardPilotGrowth` rate cap

**Files:**
- Modify: `server/progress.mjs`
- Test: `server/progress.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `server/progress.test.mjs`:

Add these imports at the TOP of the file (alongside the Task 1 imports) and the guard describe block:

```js
import { guardPilotGrowth, MAX_XP_RATE, MAX_XP_WINDOW_SEC } from './progress.mjs'

const NOW = 1_000_000_000_000 // fixed server clock for deterministic tests

describe('guardPilotGrowth', () => {
  it('passes a null pilot through untouched', () => {
    const r = guardPilotGrowth(undefined, null, NOW)
    expect(r.pilot).toBeUndefined()
    expect(r.pilotAt).toBe(NOW)
  })

  it('first save grants one window of budget and caps an instant level-20 claim', () => {
    // No prev / no _pilotAt → budget = MAX_XP_RATE * MAX_XP_WINDOW_SEC = 6000 XP.
    // 6000 XP cannot reach level 20 (cumulative to 20 is tens of thousands), so it is bounded down.
    const r = guardPilotGrowth({ level: 20, xp: 0 }, null, NOW)
    expect(r.pilot.level).toBeLessThan(20)
    expect(r.pilotAt).toBe(NOW)
  })

  it('accepts a legitimate small claim within budget', () => {
    // Fresh pilot claiming level 5 (cumulative 1200 XP) well under the 6000 first-save budget.
    const r = guardPilotGrowth({ level: 5, xp: 0 }, null, NOW)
    expect(r.pilot).toEqual({ level: 5, xp: 0 })
  })

  it('bounds the per-save rise against elapsed time', () => {
    // prev at level 5 (1200 total), stamped 10s ago → budget = MAX_XP_RATE*10 = 1000 XP.
    // acceptedTotal = 1200 + 1000 = 2200; cumulative to level 6 is 2000, to level 7 is 3080,
    // so 2200 → { level: 6, xp: 200 }.
    const prev = { pilot: { level: 5, xp: 0 }, _pilotAt: NOW - 10_000 }
    const r = guardPilotGrowth({ level: 20, xp: 0 }, prev, NOW)
    expect(r.pilot).toEqual({ level: 6, xp: 200 })
  })

  it('never lets total XP fall below the stored value (monotonic)', () => {
    const prev = { pilot: { level: 8, xp: 100 }, _pilotAt: NOW - 1000 }
    const r = guardPilotGrowth({ level: 2, xp: 0 }, prev, NOW) // client claims LOWER
    expect(r.pilot).toEqual({ level: 8, xp: 100 }) // floored to the stored total
  })
})
```

(These assertions depend on `MAX_XP_RATE = 100` / `MAX_XP_WINDOW_SEC = 60` from Task 2 Step 3. The "bounds the rise" and "monotonic" cases use exact expected `{level, xp}` derived from the curve — no in-test recomputation, no `require`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/progress.test.mjs`
Expected: FAIL — `guardPilotGrowth`/`MAX_XP_RATE`/`MAX_XP_WINDOW_SEC` not exported.

- [ ] **Step 3: Implement the guard**

In `server/progress.mjs`, after the curve port, add (mirror `guardEconomyGrowth`'s doc style):

```js
export const MAX_XP_RATE = 100        // XP/sec accepted increase (starting value, tuned live)
export const MAX_XP_WINDOW_SEC = 60   // elapsed cap → at most +6000 XP accepted per save

/**
 * Bound the per-save rise of cumulative pilot XP against a server-measured time budget, mirroring
 * guardEconomyGrowth. `prev` is the previously stored row (or null on first save); `nowMs` is the
 * server clock. Missing/legacy `_pilotAt` grants one full window of budget. Returns the bounded
 * { level, xp } pilot and the refreshed `pilotAt`. A null/absent pilot is returned untouched. Pure.
 */
export function guardPilotGrowth(pilot, prev, nowMs) {
  if (!pilot) return { pilot, pilotAt: Number(prev?._pilotAt) || nowMs }
  const prevPilot = prev?.pilot
  const prevTotal = prevPilot ? cumulativeXp(prevPilot.level, prevPilot.xp) : 0
  const prevAt = Number(prev?._pilotAt)
  const lastAt = Number.isFinite(prevAt) ? prevAt : nowMs - MAX_XP_WINDOW_SEC * 1000
  const elapsedSec = Math.min(MAX_XP_WINDOW_SEC, Math.max(0, (nowMs - lastAt) / 1000))
  const budget = MAX_XP_RATE * elapsedSec
  const claimedTotal = cumulativeXp(pilot.level, pilot.xp)
  const acceptedTotal = Math.min(Math.max(claimedTotal, prevTotal), prevTotal + budget)
  return { pilot: levelForTotal(acceptedTotal), pilotAt: nowMs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/progress.test.mjs`
Expected: PASS (all curve + guard cases).

- [ ] **Step 5: Commit**

```bash
git add server/progress.mjs server/progress.test.mjs
git commit -m "feat(progression): guardPilotGrowth — server rate-cap on pilot XP growth"
```

---

## Task 3: Wire `guardPilotGrowth` into the save handler

**Files:**
- Modify: `server/index.mjs`

No new unit test (integration wiring; the guard itself is unit-tested in Task 2). Verify the full suite + that the server module loads.

- [ ] **Step 1: Import the guard**

In `server/index.mjs`, the progress import (line ~19) is:
```js
import { guardEconomyGrowth, sanitizeProgress, scrubCareerOutliers } from './progress.mjs'
```
Add `guardPilotGrowth` (preserve existing names):
```js
import { guardEconomyGrowth, guardPilotGrowth, sanitizeProgress, scrubCareerOutliers } from './progress.mjs'
```

- [ ] **Step 2: Apply the guard in the save handler**

The save handler (around lines 589–595) currently reads:
```js
        const prev = store[key]
        // pilot level/XP and campaign are client-reported on the save itself (sanitizeProgress
        // drops them), so merge them from the raw msg.progress — not from prev like the
        // server-owned stat blocks.
        const merged = mergeCampaignStats(mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress), msg.progress)
        // Server owns earned/credits growth — reject implausible per-save jumps (Career + wallet anti-cheat).
        store[key] = guardEconomyGrowth(merged, prev, Date.now())
```
Replace from `const merged = ...` through the `store[key] = ...` line with (compute `now` once; bound pilot, then fold the bounded pilot + `_pilotAt` into the economy-guarded row):
```js
        const merged = mergeCampaignStats(mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress), msg.progress)
        const now = Date.now()
        // Server owns earned/credits growth — reject implausible per-save jumps (Career + wallet anti-cheat).
        const guarded = guardEconomyGrowth(merged, prev, now)
        // Server also bounds pilot XP growth (rate cap, mirrors the economy guard) — fabricated
        // level/XP can't inflate the PILOT board or self-buff combat power.
        const guardedPilot = guardPilotGrowth(merged.pilot, prev, now)
        store[key] = { ...guarded, pilot: guardedPilot.pilot, _pilotAt: guardedPilot.pilotAt }
```
NOTE: `guardEconomyGrowth` returns `{ ...clean, ... }` which carries `merged.pilot` through; we overwrite it with the BOUNDED pilot and add `_pilotAt`. If `merged.pilot` is undefined (no pilot reported), `guardPilotGrowth` returns `{ pilot: undefined, pilotAt }` and the spread sets `pilot: undefined` — harmless and consistent with the row not having pilot. (Confirm `guardEconomyGrowth` does NOT itself read/require `pilot`; it only touches earned/credits — so overwriting pilot afterward is safe.)

- [ ] **Step 3: Verify**

Run: `npx vitest run`
Expected: all pass (client + server).

Run: `node --check server/index.mjs`
Expected: no syntax error (the server is plain ESM; this confirms the edit parses).

Run: `npx tsc --noEmit`
Expected: exit 0 (server `.mjs` is untyped; confirms no client regression).

- [ ] **Step 4: Commit**

```bash
git add server/index.mjs
git commit -m "feat(progression): apply server XP guard in the save handler"
```

---

## Task 4: Verification (whole feature)

- [ ] Confirm a save claiming `{ level: 20, xp: 0 }` from a fresh/low-playtime pilot is stored at a bounded level (inspect by a focused unit assertion in Task 2, already covered) — no live server needed.
- [ ] Confirm the PILOT leaderboard reads the stored (bounded) pilot: since the board reads `store[key].pilot` and the save handler now writes the bounded pilot, no board change is needed — note this is satisfied by Task 3.
- [ ] Full suite green (`npx vitest run`), `node --check server/index.mjs`, `npx tsc --noEmit`.

No commit (verification only).

---

## Self-Review Notes (coverage map)

- Spec §3.1 (curve port + pin test) → Task 1.
- Spec §3.2 (`guardPilotGrowth` rate cap) → Task 2.
- Spec §3.3 (save-handler wiring + `_pilotAt`) → Task 3.
- Spec §6 (testing: curve pin, guard bounds, monotonic, cap, null passthrough, no client regression) → Tasks 1–2 unit tests + Task 3/4 suite.
- Spec §2 deferred (`scrubPilotOutliers` boot scrub; client/leaderboard/power unchanged) → no task touches them. Deliberate.
- Type/name consistency: `cumulativeXp`, `levelForTotal`, `MAX_PILOT_LEVEL`, `guardPilotGrowth`, `MAX_XP_RATE`, `MAX_XP_WINDOW_SEC`, and the `{ pilot, pilotAt }` return shape are used identically across Tasks 1–3.
