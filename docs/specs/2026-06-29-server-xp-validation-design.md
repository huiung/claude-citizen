# Server-Side XP Validation — Design

**Date:** 2026-06-29
**Status:** Design approved (pending written-spec review)
**Builds on:** the Pilot Level spine, the PILOT leaderboard, and the level→combat-power change. With level now granting hull + PvE damage AND ranking on a leaderboard, the client-reported `pilot.{level,xp}` is a cheat surface.

---

## 1. Why

`pilot.level` / `pilot.xp` are computed on the client and sent to the server via the ordinary
`'save'` message. The server's `mergePilotStats` reattaches the reported value with lower-bound clamps
only — it does **not** check the value is plausible. `Career`'s `earned` is bounded by
`guardEconomyGrowth` (server-authoritative rate cap); pilot level/XP has no equivalent. A tampered
client can claim `level: 20` instantly, which now (a) tops the PILOT leaderboard and (b) self-buffs
hull + PvE damage. This adds a server-side growth guard mirroring `guardEconomyGrowth`.

**Constraint that shapes the design:** the server does **not** observe PvE pirate kills (only PvP
kills flow through the relay), so true server-authoritative XP derivation from observed combat is not
feasible here. The proportionate guard — chosen in brainstorming — is a **rate cap**: bound how fast
the player's monotonic total XP can rise per server-measured second, exactly like the economy guard.

---

## 2. Scope

### In scope
- A pure `guardPilotGrowth(pilot, prev, nowMs)` in `server/progress.mjs` (beside `guardEconomyGrowth`)
  that bounds the per-save rise of the player's **cumulative XP** against a server-time budget, converts
  the accepted total back to `{level, xp}`, and caps `level` at `MAX_PILOT_LEVEL`.
- A small server-side port of the XP curve (`xpForLevel`, `cumulativeXp`, `levelForTotal`) plus
  `MAX_PILOT_LEVEL`, with a unit test pinning sample values to catch drift from the TS source
  (`src/sim/pilotLevel.ts`).
- Wire `guardPilotGrowth` into the save handler beside the existing guards; persist a `_pilotAt`
  timestamp on the stored row (like `_careerAt`).
- Unit tests for the curve port and the guard.

### Out of scope (deferred)
- A boot-time scrub of pre-guard pilot rows (the `scrubCareerOutliers` analog). The PILOT leaderboard
  just launched with few rows; revisit only if pre-guard outliers appear.
- Any change to client XP logic, the leaderboard, or the level→power wiring (all unchanged).
- Server observation/validation of individual PvE kills (infeasible without server-side combat sim).
- XP-based tiebreak hardening beyond what the level cap already implies (xp grants no power; at
  `MAX_PILOT_LEVEL` xp is 0, so top-of-board ties are unaffected).

---

## 3. Components

### 3.1 Server XP curve port — `server/progress.mjs`

The server cannot import the TS module, so port the minimal curve. These MUST stay in lockstep with
`src/sim/pilotLevel.ts` — a unit test pins sample values so a TS-side change that isn't mirrored fails
the server test.

```js
// Mirror of src/sim/pilotLevel.ts — keep in lockstep (a drift test pins these values).
export const MAX_PILOT_LEVEL = 20
function xpForLevel(level) { return 60 * level + 20 * level * level } // 1→2:80, 2→3:200, 3→4:360, 4→5:560

// Cumulative XP to be AT (level, xp): sum of all prior level costs + xp into the current level.
export function cumulativeXp(level, xp) {
  const lvl = Math.min(MAX_PILOT_LEVEL, Math.max(1, Math.floor(Number(level) || 1)))
  let total = Math.max(0, Math.floor(Number(xp) || 0))
  for (let i = 1; i < lvl; i++) total += xpForLevel(i)
  return total
}

// Inverse: highest level whose cumulative cost <= total, with the remainder as xp-into-level.
// At MAX_PILOT_LEVEL, xp is pinned to 0 (matches client addXp zeroing at the cap).
export function levelForTotal(total) {
  let t = Math.max(0, Math.floor(Number(total) || 0))
  let level = 1
  while (level < MAX_PILOT_LEVEL && t >= xpForLevel(level)) { t -= xpForLevel(level); level += 1 }
  if (level >= MAX_PILOT_LEVEL) return { level: MAX_PILOT_LEVEL, xp: 0 }
  return { level, xp: t }
}
```

`cumulativeXp(MAX_PILOT_LEVEL, *)` is the ceiling total; beyond it `levelForTotal` returns
`{20, 0}`. Round-trip property (tested): `levelForTotal(cumulativeXp(L, x)) === {L, x}` for any valid
in-range `(L, x)` with `x < xpForLevel(L)`.

### 3.2 The guard — `server/progress.mjs`

```js
export const MAX_XP_RATE = 100        // XP/sec accepted increase (starting value, tuned live)
export const MAX_XP_WINDOW_SEC = 60   // elapsed cap → at most +6000 XP accepted per save

/**
 * Bound the per-save rise of cumulative pilot XP against a server-measured time budget, mirroring
 * guardEconomyGrowth. `prev` is the previously stored row (or null on first save); `nowMs` is the
 * server clock. Missing/legacy `_pilotAt` grants one full window of budget. Returns the bounded
 * { level, xp } and the refreshed `_pilotAt`. Pure — no I/O, no clock reads. Returns null pilot
 * untouched (no pilot reported → nothing to guard).
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
  // Monotonic: never below prev; rise bounded by the time budget.
  const acceptedTotal = Math.min(Math.max(claimedTotal, prevTotal), prevTotal + budget)
  return { pilot: levelForTotal(acceptedTotal), pilotAt: nowMs }
}
```

- **Monotonic:** total XP never decreases (like `earned`). A client reporting a lower total than
  stored is floored to the stored total (no downgrade, no exploit).
- **First save:** no `_pilotAt` → one window of budget (6000 XP) — enough to reach ~level 8 on a fresh
  pilot in a single first save (cumulative to level 9 is 6240), generous against a legit burst while
  still blocking an instant level 20.
- **Cap:** `levelForTotal` caps at `MAX_PILOT_LEVEL`.

### 3.3 Wiring — `server/index.mjs` save handler

After `mergePilotStats` reattaches the client pilot, apply the guard against `prev` and stamp the row.
The current chain (post-leaderboard / campaign work):

```js
const merged = mergeCampaignStats(mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress), msg.progress)
store[key] = guardEconomyGrowth(merged, prev, Date.now())
```

becomes (compute `now` once; guard pilot, then fold the bounded pilot + `_pilotAt` into the row that
also goes through the economy guard):

```js
const now = Date.now()
const merged = mergeCampaignStats(mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress), msg.progress)
const guardedPilot = guardPilotGrowth(merged.pilot, prev, now)
const guarded = guardEconomyGrowth(merged, prev, now)
store[key] = { ...guarded, pilot: guardedPilot.pilot, _pilotAt: guardedPilot.pilotAt }
```

(Adapt to the real variable names; preserve the existing guard call. `guardEconomyGrowth` already
returns `{ ...clean, ... }` so it carries `pilot` through — we overwrite it with the *bounded* pilot and
add `_pilotAt`. If `merged.pilot` is undefined, `guardPilotGrowth` returns it untouched so the spread
is a no-op for pilot.)

Add `guardPilotGrowth` (and the curve helpers if needed elsewhere) to the existing `from './progress.mjs'`
import in `server/index.mjs`.

---

## 4. Data flow

```
client 'save' → sanitizeProgress (strips pilot/campaign)
             → mergePilotStats reattaches client-reported pilot (lower-bound clamp)
             → guardPilotGrowth(merged.pilot, prev, now):
                  prevTotal = cumulativeXp(prev.pilot)
                  claimedTotal = cumulativeXp(merged.pilot)
                  acceptedTotal = clamp(claimedTotal, [prevTotal, prevTotal + rate*elapsed])
                  → levelForTotal(acceptedTotal) + _pilotAt
             → stored row carries the BOUNDED pilot + _pilotAt
PILOT leaderboard reads the stored (bounded) pilot → ranks only legitimately-earned levels.
```

The leaderboard, level→power wiring, and client are untouched; they simply now read a server-bounded
pilot value.

---

## 5. Risks / decisions

- **Curve duplication:** the server re-implements a 1-line formula + cumulative/inverse helpers. Risk:
  drift if the TS curve changes. Mitigation: a server unit test pins the same sample values the client
  test uses; changing the TS curve without updating the server breaks CI. Accepted as the cost of the
  server being unable to import TS.
- **Rate tuning:** `MAX_XP_RATE = 100/s` (`+6000`/save) is a starting value. Legit early bursts and
  campaign step rewards (≤500 each) pass; reaching level 20 (cumulative tens of thousands of XP) cannot
  be claimed in one save and a max-rate climb is detectable. Tunable live; revisit after playtest.
- **No PvE kill observation:** acknowledged — this is a rate cap, not full authority. It closes the
  instant-to-max hole and makes sustained cheating slow + conspicuous, matching the economy guard's
  posture.
- **Pre-guard rows:** not scrubbed (deferred, §2). Few rows exist; a future `scrubPilotOutliers` mirrors
  `scrubCareerOutliers` if needed.

---

## 6. Testing

- **Curve port** (`server/progress.test.mjs` or sibling): `cumulativeXp(5, 0) === 1200`;
  `cumulativeXp(1, 0) === 0`; round-trip `levelForTotal(cumulativeXp(L, x)) === {L, x}` for samples
  (e.g. (3,40), (5,0), (10,15)); `levelForTotal(huge) === {20, 0}`. These pin the curve against
  `src/sim/pilotLevel.ts`.
- **Guard** (`guardPilotGrowth`):
  - first save (no prev/`_pilotAt`): a fresh pilot claiming a modest level is accepted up to the
    one-window budget; claiming level 20 is bounded down.
  - rise is capped: with a small elapsed window, a large claimed total is clamped to `prevTotal + budget`.
  - monotonic: a claimed total below `prevTotal` is floored to `prevTotal`.
  - `_pilotAt` is stamped to `nowMs`.
  - null pilot passes through untouched.
- **No client regression:** `npx vitest run` (full suite) + `npx tsc --noEmit` green; the client and
  leaderboard tests still pass unchanged.

---

## 7. Success criteria

A save claiming an implausible level/XP jump is silently bounded to what the player's server-measured
playtime budget allows (mirroring how `earned` is bounded); a legitimate hunting/quest session is
unaffected; the PILOT leaderboard and the level→power buffs reflect only server-accepted levels; and
the server curve is provably in lockstep with the client via a pinning test.
