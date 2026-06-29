# Pilot Level Combat Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Pilot Level grant felt combat power — extra hull and weapon damage — so leveling matters and the PILOT leaderboard ranks genuinely stronger pilots; and fix the campaign server-sync bug uncovered alongside it.

**Architecture:** Extend the pure `unlocksForLevel` with a `weaponDamageBonus` (unit-tested), then apply `hullBonus` to the player's effective max hull (a new `effMaxHull()` mirroring `effSpeed()`/`effBoost()`) and `weaponDamageBonus` to PvE projectile damage only (PvP stays balanced). On level-up, raise max hull and heal the delta. Separately, mirror the shipped `pilot` server-merge fix for `campaign` so it round-trips through `sanitizeProgress`.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest (client); Node `.mjs` + Vitest (server). Spec: `docs/specs/2026-06-29-pilot-level-combat-power-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/sim/pilotLevel.ts` | Add `weaponDamageBonus` to `LevelUnlock` + `unlocksForLevel` | Modify |
| `src/sim/pilotLevel.test.ts` | Test `weaponDamageBonus` + `hullBonus` formulas | Modify |
| `src/main.ts` | `effMaxHull()`, apply hull in `setPlayerCraft`, level-up heal, PvE damage bonus | Modify |
| `server/progress.mjs` | `mergeCampaignStats(progress, source)` (mirror `mergePilotStats`) | Modify |
| `server/index.mjs` | Call `mergeCampaignStats` in the save handler | Modify |
| `server/progress.test.mjs` (or sibling) | Test `campaign` round-trips + clamps | Create/Modify |

**Anchor line numbers** reflect HEAD at plan-writing time. If they have drifted, locate by the quoted surrounding code, not the raw line number.

---

## Task 1: Add `weaponDamageBonus` to the pure level-unlock module

**Files:**
- Modify: `src/sim/pilotLevel.ts`
- Test: `src/sim/pilotLevel.test.ts`

- [ ] **Step 1: Update the test (failing)**

In `src/sim/pilotLevel.test.ts`, replace the existing `unlocksForLevel` describe block with this expanded version (keeps the existing sector/upgrade assertions, adds hull + damage):

```ts
describe('unlocksForLevel', () => {
  it('opens Sector 2 and a higher upgrade tier at level 5', () => {
    expect(unlocksForLevel(4).unlockSector).toBeNull()
    expect(unlocksForLevel(5).unlockSector).toBe(2)
    expect(unlocksForLevel(5).unlockUpgradeTier).toBe(5)
  })

  it('grants no combat bonus at level 1 and scales monotonically', () => {
    expect(unlocksForLevel(1).hullBonus).toBe(0)
    expect(unlocksForLevel(1).weaponDamageBonus).toBe(0)
    expect(unlocksForLevel(2).hullBonus).toBeGreaterThan(unlocksForLevel(1).hullBonus)
    expect(unlocksForLevel(2).weaponDamageBonus).toBeGreaterThan(unlocksForLevel(1).weaponDamageBonus)
    expect(unlocksForLevel(5).hullBonus).toBeGreaterThan(unlocksForLevel(4).hullBonus)
    expect(unlocksForLevel(5).weaponDamageBonus).toBeGreaterThan(unlocksForLevel(4).weaponDamageBonus)
  })

  it('matches the combat-bonus formulas at sample levels', () => {
    expect(unlocksForLevel(5).hullBonus).toBe(20)         // (5-1)*5
    expect(unlocksForLevel(5).weaponDamageBonus).toBe(4)  // (5-1)*1
    expect(unlocksForLevel(20).hullBonus).toBe(95)        // (20-1)*5
    expect(unlocksForLevel(20).weaponDamageBonus).toBe(19)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/pilotLevel.test.ts`
Expected: FAIL — `weaponDamageBonus` is missing from the returned `LevelUnlock` (property is `undefined`, assertions throw).

- [ ] **Step 3: Implement**

In `src/sim/pilotLevel.ts`, add `weaponDamageBonus` to the `LevelUnlock` interface and to `unlocksForLevel`. The current code is:

```ts
export interface LevelUnlock {
  hullBonus: number            // flat hull added at this level (felt-but-minor power bump)
  unlockSector: number | null  // sector index opened at this level, or null
  unlockUpgradeTier: number | null // raises the purchasable upgrade ceiling, or null
}

export function unlocksForLevel(level: number): LevelUnlock {
  return {
    hullBonus: (level - 1) * 5,
    unlockSector: level >= 5 ? 2 : null,
    unlockUpgradeTier: level >= 5 ? 5 : null,
  }
}
```

Change it to:

```ts
export interface LevelUnlock {
  hullBonus: number            // flat hull added at this level (felt-but-minor power bump)
  weaponDamageBonus: number    // flat projectile damage added at this level (PvE only — see main.ts)
  unlockSector: number | null  // sector index opened at this level, or null
  unlockUpgradeTier: number | null // raises the purchasable upgrade ceiling, or null
}

export function unlocksForLevel(level: number): LevelUnlock {
  return {
    hullBonus: (level - 1) * 5,
    weaponDamageBonus: (level - 1) * 1, // starting value, tuned live; base PROJECTILE_DAMAGE is 12
    unlockSector: level >= 5 ? 2 : null,
    unlockUpgradeTier: level >= 5 ? 5 : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/pilotLevel.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/pilotLevel.ts src/sim/pilotLevel.test.ts
git commit -m "feat(progression): add per-level weapon damage bonus to unlocksForLevel"
```

---

## Task 2: Apply hull bonus + level-up heal in main.ts

**Files:**
- Modify: `src/main.ts`

No new unit tests (DOM/loop wiring; untested in this codebase by convention). Verify by typecheck + build + the full suite.

- [ ] **Step 1: Confirm `unlocksForLevel` is imported**

The pilotLevel import currently reads (around `src/main.ts:93`):
```ts
import { addXp, loadPilot, MAX_LEVEL, savePilot, xpForKill, xpForLevel } from './sim/pilotLevel'
```
Add `unlocksForLevel` to it (keep all existing names; `MAX_LEVEL` was added during the leaderboard work — preserve it if present):
```ts
import { addXp, loadPilot, MAX_LEVEL, savePilot, unlocksForLevel, xpForKill, xpForLevel } from './sim/pilotLevel'
```
(Verify the actual current set of imported names first and preserve every one of them; only add `unlocksForLevel`.)

- [ ] **Step 2: Add an `effMaxHull()` helper**

Find the existing effective-stat helpers (around `src/main.ts:2158`):
```ts
function effSpeed(): number { return SHIP_STATS[selectedShipType].topSpeed + (topSpeed(upgrades) - baseSpeed) }
function effBoost(): number { return SHIP_STATS[selectedShipType].boostMultiplier + (boostMultiplier(upgrades) - baseBoost) }
```
Immediately after `effBoost()` (and before the effective-cargo function), add:
```ts
function effMaxHull(): number { return SHIP_STATS[selectedShipType].hull + unlocksForLevel(pilot.level).hullBonus }
```

- [ ] **Step 3: Use `effMaxHull()` in `setPlayerCraft`**

Find `setPlayerCraft` (around `src/main.ts:2164`). It currently sets:
```ts
  playerHealth.max = SHIP_STATS[type].hull
  playerHealth.hull = playerHealth.max
```
Replace the max assignment with the level-aware value (keep the heal-to-full line):
```ts
  playerHealth.max = SHIP_STATS[type].hull + unlocksForLevel(pilot.level).hullBonus
  playerHealth.hull = playerHealth.max
```
(Use the explicit expression here rather than `effMaxHull()` because `setPlayerCraft(type)` is parameterized by `type`, which may differ from `selectedShipType` mid-call. `effMaxHull()` is for the currently-selected craft; this line must honor the `type` argument.)

- [ ] **Step 4: Add a level-up heal helper and call it on level-up**

Find the pilot/campaign state init and the `awardPilotXp` helper added in the prior slice (near `const pilot = loadPilot(localStorage)`). Immediately after `awardPilotXp`, add a companion helper:
```ts
// Raise the hull cap to the current level's bonus and heal exactly the gained amount, so a level-up
// is felt immediately. Safe to call when nothing changed (delta 0 → no heal).
function applyLevelHull(): void {
  const prevMax = playerHealth.max
  playerHealth.max = effMaxHull()
  if (playerHealth.max > prevMax) playerHealth.hull += playerHealth.max - prevMax
}
```

Then, in the kill hook, the prior slice's `awardPilotXp` fires `showPromotion` on level-up. Locate `function awardPilotXp(amount: number)` and add the hull bump whenever a level was gained. The current helper is:
```ts
function awardPilotXp(amount: number): void {
  const r = addXp(pilot, amount)
  pilot.level = r.progress.level
  pilot.xp = r.progress.xp
  if (r.leveledUp.length) showPromotion(`Pilot Level ${pilot.level}`)
}
```
Change the body to also apply the hull on a level-up:
```ts
function awardPilotXp(amount: number): void {
  const r = addXp(pilot, amount)
  pilot.level = r.progress.level
  pilot.xp = r.progress.xp
  if (r.leveledUp.length) {
    showPromotion(`Pilot Level ${pilot.level}`)
    applyLevelHull()
  }
}
```
(`applyLevelHull` is a hoisted `function` declaration, so it resolves even though it is defined just above/below `awardPilotXp`. If the codebase places these as `const` arrow functions instead, define `applyLevelHull` BEFORE `awardPilotXp` to satisfy the temporal-dead-zone — match the existing style of these two helpers.)

- [ ] **Step 5: Ensure server restore recomputes hull after pilot state is applied**

Find `applyServerProgress` (around `src/main.ts:2347`) — it sets `pilot.level`/`pilot.xp` from the server. Confirm that after `applyServerProgress` runs, `setPlayerCraft(selectedShipType)` is called (the launch/restore flow calls it around `src/main.ts:3254` / `3845`). If `setPlayerCraft` is called BEFORE pilot state is applied in any restore path, the hull bonus would be stale. Verify the ordering by reading the restore flow; if pilot is applied after the `setPlayerCraft` call, add a `playerHealth.max = effMaxHull()` recompute (and clamp `playerHealth.hull` to it) immediately after the pilot fields are set in `applyServerProgress`. If the ordering already applies pilot first, no change is needed — note which is the case.

- [ ] **Step 6: Verify typecheck + build + tests**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run`
Expected: all pass.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(progression): apply per-level hull bonus and heal on level-up"
```

---

## Task 3: Apply weapon damage bonus to PvE fire

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Change the PvE branch of the player fire call**

Find the player fire call (around `src/main.ts:4475`):
```ts
      projectiles.push(spawnProjectile(
        ship.position,
        _fwd,
        'player',
        PROJECTILE_SPEED,
        combatWeaponActive ? pvpWeapon.damage : undefined,
        ship.velocity,
      ))
```
Replace ONLY the damage argument line:
```ts
        combatWeaponActive ? pvpWeapon.damage : PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus,
```
This leaves the PvP/training path (`combatWeaponActive` → `pvpWeapon.damage`) unchanged so ranked PvP stays balanced; only PvE shots scale with level.

VERIFY: `PROJECTILE_DAMAGE` must be imported in `src/main.ts`. Check the combat import (around `src/main.ts:63`); if `PROJECTILE_DAMAGE` is not already imported, add it to that import from `./sim/combat`. (`PROJECTILE_SPEED` is already imported there — add `PROJECTILE_DAMAGE` alongside it.)

- [ ] **Step 2: Verify typecheck + build + tests**

Run: `npx tsc --noEmit`
Expected: exit 0 (fails if `PROJECTILE_DAMAGE` is not imported — fix the import if so).

Run: `npx vitest run`
Expected: all pass.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(progression): scale PvE projectile damage with pilot level"
```

---

## Task 4: Fix campaign server-sync (mirror the pilot merge)

**Files:**
- Modify: `server/progress.mjs`
- Modify: `server/index.mjs`
- Test: `server/progress.test.mjs` (or wherever server progress/save tests live)

The leaderboard work added a `mergePilotStats(progress, source)` to reattach the client-reported `pilot` that `sanitizeProgress` strips. `campaign` has the identical problem and no merge yet, so it does not round-trip through the server. Mirror the pilot fix.

- [ ] **Step 1: Read the existing pilot merge to mirror it**

In `server/progress.mjs`, read `mergePilotStats` and `sanitizeProgress` end-to-end. Confirm:
- `sanitizeProgress` returns a new object WITHOUT `campaign`.
- `mergePilotStats(progress, source)` reads `source.pilot` (the raw client save), clamps it, and attaches it to `progress`.
- How `loadCampaign` (client `src/sim/campaign.ts`) clamps — `step` in `[0, SECTOR1_CAMPAIGN.length]`, `progress >= 0`, `sectorUnlocked >= 1`. The server cannot import the client TS module; hard-code the campaign length used for the clamp as a named constant with a comment pointing at `src/sim/campaign.ts` (it is 4 steps), OR clamp `step` to `>= 0` only and document that the upper bound is enforced client-side by `loadCampaign`. Prefer clamping `step >= 0`, `progress >= 0`, `sectorUnlocked >= 1` (lower bounds only) to avoid duplicating the step-count constant server-side — matching the minimal trust the server applies to other client-reported blocks.

- [ ] **Step 2: Write the failing test**

In the server progress/save test file (mirror the file that tests `mergePilotStats`; if none exists, create `server/progress.test.mjs`), add:

```js
import { describe, it, expect } from 'vitest'
import { sanitizeProgress, mergeCampaignStats } from './progress.mjs'

describe('mergeCampaignStats', () => {
  it('reattaches client-reported campaign that sanitizeProgress drops', () => {
    const raw = { credits: 0, earned: 0, campaign: { step: 2, progress: 40, sectorUnlocked: 2 } }
    const clean = sanitizeProgress(raw)
    expect(clean.campaign).toBeUndefined() // sanitize strips it
    const merged = mergeCampaignStats(clean, raw)
    expect(merged.campaign).toEqual({ step: 2, progress: 40, sectorUnlocked: 2 })
  })

  it('clamps bad campaign data', () => {
    const merged = mergeCampaignStats({}, { campaign: { step: -3, progress: -9, sectorUnlocked: 0 } })
    expect(merged.campaign.step).toBe(0)
    expect(merged.campaign.progress).toBe(0)
    expect(merged.campaign.sectorUnlocked).toBe(1)
  })

  it('omits campaign when the source has none', () => {
    const merged = mergeCampaignStats({ credits: 5 }, { credits: 5 })
    expect(merged.campaign).toBeUndefined()
  })
})
```

(If `mergePilotStats` lives in a different module than `sanitizeProgress`, import each from its real location — match the existing pilot test's imports.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/progress.test.mjs`
Expected: FAIL — `mergeCampaignStats` is not exported / not defined.

- [ ] **Step 4: Implement `mergeCampaignStats`**

In `server/progress.mjs`, add (mirroring `mergePilotStats` exactly in shape and export style):

```js
// Reattach the client-reported campaign that sanitizeProgress strips. Like pilot, campaign is
// client-reported (not server-owned), so it is read from the raw save `source`, not from `prev`.
// Lower-bound clamps only; the upper bound on `step` is enforced client-side by loadCampaign
// (src/sim/campaign.ts). NOTE: client-reported and not yet server-validated — a follow-up may guard it.
export function mergeCampaignStats(progress, source) {
  const c = source?.campaign
  if (!c || typeof c.step !== 'number') return progress
  progress.campaign = {
    step: Math.max(0, Math.floor(c.step)),
    progress: Math.max(0, Math.floor(c.progress ?? 0)),
    sectorUnlocked: Math.max(1, Math.floor(c.sectorUnlocked ?? 1)),
  }
  return progress
}
```
(Match the real `mergePilotStats` for null-handling and return-value conventions — if it returns a fresh object instead of mutating, do the same here.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/progress.test.mjs`
Expected: PASS.

- [ ] **Step 6: Wire it into the save handler**

In `server/index.mjs`, find the save handler line that merges the client blocks. After the leaderboard work it reads roughly:
```js
const merged = mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress)
```
Wrap it with `mergeCampaignStats` reading from the raw save (`msg.progress`), same as `mergePilotStats`:
```js
const merged = mergeCampaignStats(mergePilotStats(mergeBlackHoleStats(mergeRaceStats(mergePvpStats(clean, prev), prev), prev), msg.progress), msg.progress)
```
Add the `mergeCampaignStats` import to the existing `from './progress.mjs'` import in `server/index.mjs`. (Verify the real current shape of that merge chain and the import; adapt to it — preserve every existing merge call.)

- [ ] **Step 7: Verify**

Run: `npx vitest run`
Expected: all pass (client + server).

Run: `npx tsc --noEmit`
Expected: exit 0 (server `.mjs` is untyped, but confirm no client regressions).

- [ ] **Step 8: Commit**

```bash
git add server/progress.mjs server/index.mjs server/progress.test.mjs
git commit -m "fix(progression): persist campaign through server save (mirror pilot merge)"
```

---

## Task 5: HUD — show the level's combat bonuses (optional, light)

**Files:**
- Modify: `index.html` (one element near `#pilot-line`)
- Modify: `src/main.ts` (one ref + one render line in `updateWalletHUD`)

- [ ] **Step 1: Add the HUD element**

In `index.html`, inside `#pilot-line` (after the `#pilot-track` span, before the line's closing `</div>`), add:
```html
      <span id="pilot-bonus"></span>
```
Add CSS next to the other `#pilot-*` rules:
```css
    #pilot-bonus { color: #9fb4bf; font-size: 10px; margin-left: 6px; }
```

- [ ] **Step 2: Add the ref**

Next to `pilotLevelEl` / `pilotXpBarEl` (around `src/main.ts:215`), add:
```ts
const pilotBonusEl = document.getElementById('pilot-bonus')!
```

- [ ] **Step 3: Render it**

In `updateWalletHUD()`, immediately after the existing pilot level/XP-bar lines, add:
```ts
  const u = unlocksForLevel(pilot.level)
  pilotBonusEl.textContent = pilot.level > 1 ? `+${u.hullBonus} HULL · +${u.weaponDamageBonus} DMG` : ''
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Static verification**

Confirm the `pilot-bonus` id in `index.html` matches the `getElementById('pilot-bonus')` in `src/main.ts`, and that the new label sits inside `#pilot-line`. (No browser run here.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(progression): show level hull/damage bonuses on the HUD"
```

---

## Task 6: Manual verification (whole feature)

Run `npm run dev`, open the game (not `?bot=1`):

- [ ] At level 1, no combat bonus shown; destroy raiders and watch the XP bar fill.
- [ ] On a level-up: the banner fires, the hull bar's max grows, and current hull tops up by the gained amount immediately. The HUD shows `+5 HULL · +1 DMG` (level 2).
- [ ] PvE shots kill grunts in fewer hits at a higher level than at level 1 (damage scales).
- [ ] Enter a Practice/Ranked arena: PvP weapon damage is unchanged by level (still `pvpWeapon.damage`).
- [ ] Reload the page (same device): level, XP, campaign step, and the hull bonus all persist.
- [ ] (If a second device / server is available) progress saved on one device restores the campaign step on another — confirming the campaign server-sync fix.

No commit (verification only).

---

## Self-Review Notes (coverage map)

- Spec §3.1 (`weaponDamageBonus` in pure module) → Task 1.
- Spec §3.2 (hull via `effMaxHull` + `setPlayerCraft`) → Task 2 Steps 2–3.
- Spec §3.2 (server-restore ordering) → Task 2 Step 5.
- Spec §3.3 (level-up heal) → Task 2 Step 4.
- Spec §3.4 (PvE damage, PvP unchanged) → Task 3.
- Spec §3.5 (campaign server-sync fix) → Task 4.
- Spec §5 (HUD bonus label) → Task 5.
- Spec §7 (testing) → Task 1 unit tests, Task 4 server tests, Tasks 2–3/5 typecheck+build, Task 6 manual.
- Spec §6 risks (PvP balance, no server validation) → encoded as the deliberate PvP-unchanged branch (Task 3) and the in-code comment in Task 4 Step 4; no validation built (out of scope).
- `unlockUpgradeTier` still NOT applied (spec §2 out of scope) — no task touches the station upgrade ceiling. Deliberate.
- Right-click weapon variety (monotony) — NOT in this plan (spec §1/§2 out of scope). Deliberate; tracked for a later milestone.
