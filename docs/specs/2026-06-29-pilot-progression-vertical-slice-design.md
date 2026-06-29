# Pilot Progression — Vertical Slice (Sector 1, Levels 1–5)

**Date:** 2026-06-29
**Status:** Design approved, pending spec review
**Goal of this milestone:** Add a WoW/WoC-style active progression spine to Claude Citizen and
prove the core retention loop is fun *before* authoring 100 hours of content.

---

## 1. Why

Claude Citizen already has the economic and combat plumbing for retention (credits, daily
objectives, a lifetime Career Rank ladder, ship upgrades, crafting gacha, leaderboards, a linear
onboarding journey). What it lacks is the thing that makes WoC playable for ~100 hours: an
**active growth spine** — leveling driven by hunting and quests — plus an **escalating PvE
treadmill** that the spine paces you through.

This milestone does NOT build the whole 100-hour game. It builds a **vertical slice**: one sector,
levels 1–5, the full power loop end to end. If the loop is fun, sectors 2–3 and levels 6–20 are
content replication on the same machinery.

### The loop we are validating

> **Hunt → XP → Level up (unlock) → take on tougher enemies → loot makes you stronger → repeat**,
> with a short quest chain threading it so there is always a clear "next thing."

---

## 2. Scope

### In scope (the slice)
- Pilot Level spine, levels 1–5 (curve extensible to 20).
- Enemy tiering: Grunt (existing) → Elite → Named miniboss, in Sector 1.
- A 4-step Sector 1 campaign quest chain.
- Minimal loot: credits + cores + XP (Named/boss gives guaranteed cores).
- A single locked Sector 2 gate marker ("requires Level 5") to validate gating UX.
- HUD: Pilot Level + XP bar; level-up banner; campaign-step tracker.
- Persistence + server-sync for the new state.
- Unit tests for all new pure modules.

### Out of scope (later milestones — do not build now)
- Levels 6–20, Sector 2/3 *content*.
- Gear-drop itemization (rarity loot items beyond the existing crafting kits).
- Active combat abilities / new ship tech.
- Seasons, weeklies, reputation/faction systems.

### Career Rank relationship (decided)
Keep **both** ladders, roles separated:
- **Pilot Level** — primary active growth axis: big number, drives unlocks and sector access,
  earned via combat + quests.
- **Career Rank** (`src/sim/ranks.ts`, unchanged) — lifetime-earnings prestige: title + the
  existing `rankBonus` credit multiplier, shown secondary.

HUD must make Level the prominent element and Rank the subordinate title, so two bars don't compete.

---

## 3. Components

### 3.1 Pilot Level spine — new pure module `src/sim/pilotLevel.ts`

Mirrors the shape of `journey.ts` / `ranks.ts` (pure, deterministic, unit-testable).

```ts
export interface PilotProgress { level: number; xp: number } // xp is xp-into-current-level

export const MAX_SLICE_LEVEL = 5            // curve defined to 20, slice gates content at 5

export function xpForLevel(level: number): number   // XP required to go level → level+1
export function emptyPilot(): PilotProgress          // { level: 1, xp: 0 }

export interface XpResult { progress: PilotProgress; leveledUp: number[] } // levels gained, in order
export function addXp(p: PilotProgress, amount: number): XpResult           // handles multi-level-ups

// What a level grants. Slice keeps unlocks simple; structure supports richer unlocks later.
export interface LevelUnlock { hullBonus?: number; unlockSector?: number; unlockUpgradeTier?: number }
export function unlocksForLevel(level: number): LevelUnlock
```

**XP sources** (amounts are starting values, tuned live):
- Pirate kill: `xpForKill(tier)` → grunt 10 / elite 35 / named 200.
- Campaign step complete: `xpForCampaignStep(step)` → ~150–600 scaling.
- First-time milestones (folded in from the journey funnel): one-off bonuses.

**Curve (slice):** tuned so levels 1–5 take a focused session of hunting + the quest chain
(target ~30–60 min to hit 5), not a grind. Exact thresholds set in `xpForLevel` and tuned against
the kill/quest XP above.

**Unlocks (slice):**
- Each level: small `hullBonus` (felt-but-minor power bump).
- Level 5: `unlockSector: 2` + `unlockUpgradeTier` raising the purchasable upgrade ceiling — gives a
  reason to level *before* spending, and a payoff at the cap.

### 3.2 Enemy tiering — extend `src/sim/pirates.ts`

Today `spawnPirate(id, pos, hullMul, reward)` already depth-scales hull/reward and `stepPirate`
runs the AI; kills are handled at `main.ts:~4488` (`gainCredits` + `recordDailyEvent('kill_pirates')`
+ `spawnLoot`).

Add a tier to the Pirate model:

```ts
export type PirateTier = 'grunt' | 'elite' | 'named'
// Pirate gains: tier: PirateTier; name?: string  (named only)
export function spawnPirate(id, pos, opts?: { hullMul?; reward?; tier?: PirateTier; name?: string }): Pirate
```

- **Grunt** — current behavior.
- **Elite** — higher hull/reward, +XP, a distinct visual tint/scale so players read the threat.
- **Named** — one per sector, rare/fixed spawn, miniboss hull, big XP, **guaranteed cores + large
  credits** on death. Drives campaign step 3/4.

`stepPirate` AI is reused as-is for all tiers in the slice (tuning hull/damage/reward per tier).
Tier selection at spawn time lives in `main.ts` spawn logic, not in the pure module.

### 3.3 Campaign quest chain — new pure module `src/sim/campaign.ts`

Same pattern as `journey.ts` (linear `next…` selector) + `daily.ts` (event recording).

```ts
export interface CampaignState { step: number; counters: Record<string, number> }
export interface CampaignStep { id: string; label: string; progress?: string; xpReward: number; creditReward: number }

export function emptyCampaign(): CampaignState
export function currentCampaignStep(s: CampaignState): CampaignStep | null   // null when chain complete
export function recordCampaignEvent(s: CampaignState, kind: string, amount: number): CampaignAdvance
// CampaignAdvance: { advanced: boolean; completedStep?: CampaignStep }  → caller grants XP/credits + sector unlock
```

**Sector 1 chain (4 steps):**
1. *Patrol the Refinery Belt* — destroy 5 raiders (counter: `kill_pirates`).
2. *Cut their supply* — mine/deliver 200 ORE (reuse existing mining/contract events).
3. *Wanted: the Named raider* — destroy the Named miniboss (counter: `kill_named`).
4. *Break the raider captain* (boss) — destroy the captain → reward: XP + credits + **unlock Sector 2**.

Quest XP routes through `pilotLevel.addXp`. Events are recorded from the same `main.ts` hooks that
already fire `recordDailyEvent` (kills, mining, docking) — one extra `recordCampaignEvent` call beside each.

### 3.4 Loot / rewards (minimal)

- Grunt: existing credit reward only.
- Elite: existing credits + XP + small credit bonus.
- Named/boss: existing credits + **guaranteed cores** (via crafting state) + large XP.
- No new rarity-gear items in the slice (deferred). Reuse `gainCredits`, crafting `cores`, and the
  new `addXp`.

### 3.5 Sector gating (teaser only)

Add one Sector 2 destination marker (rides the existing destination/flight-plan machinery) shown as
**locked until Pilot Level 5 / campaign step 4 complete**. No Sector 2 content is built; this exists
solely to validate that level-gated access reads correctly and feels motivating.

---

## 4. Data flow & integration points

All new state is pure-module-owned and threaded through the existing `main.ts` frame loop and the
`currentProgress()` snapshot that already syncs to the server.

| New state | Module | localStorage key | Synced via |
|---|---|---|---|
| `PilotProgress` | `pilotLevel.ts` | `scc.pilot.v1` | add to `currentProgress()` / `PlayerProgress` |
| `CampaignState` | `campaign.ts` | `scc.campaign.v1` | add to `currentProgress()` / `PlayerProgress` |

**Kill hook (`main.ts:~4488`)** — beside the existing `gainCredits` / `recordDailyEvent`:
```
const xp = addXp(pilot, xpForKill(p.tier));           // level spine
recordCampaignEvent(campaign, p.tier === 'named' ? 'kill_named' : 'kill_pirates', 1);
if (xp.leveledUp.length) showPromotion(`Pilot Level ${pilot.level}`);  // reuse banner
// named/boss: grant cores + advance campaign → on final step, set sector-2 unlock
```
**Mining/docking hooks** — add `recordCampaignEvent(campaign, 'mine_ore'|'dock', n)` beside existing daily calls.

**Server sync:** extend `PlayerProgress` and `applyServerProgress` to carry `pilot` and `campaign`
(same treatment as `daily`).

---

## 5. UI / HUD

- **Pilot Level + XP bar:** new prominent element near the Career Rank HUD (`main.ts:~2223`). Level
  is the big number; Rank becomes the secondary "Career {name} +x%" title beneath/beside it.
- **Level-up:** reuse `showPromotion(...)` banner (`main.ts:216`).
- **Campaign tracker:** render `currentCampaignStep` in the existing journey/objective HUD (and/or
  the G panel), replacing the journey funnel once onboarding milestones are absorbed into the chain.

No new input modes; the G panel already exists for objectives.

---

## 6. Testing

Pure modules → Vitest unit tests (matching existing `*.test.ts` style):
- `pilotLevel.test.ts`: `xpForLevel` monotonic; `addXp` single and **multi-level-up** in one call;
  `unlocksForLevel(5)` returns sector-2 + upgrade-tier unlock; XP never goes negative.
- `campaign.test.ts`: linear advance through all 4 steps; `recordCampaignEvent` only advances on the
  active step's counter; `currentCampaignStep` returns null when complete; rewards reported once.
- `pirates.test.ts`: `spawnPirate` tier defaults to grunt; elite/named carry higher hull/reward; named
  carries a name.

Manual verification (stream/play): level 1→5 reachable via the chain; Sector 2 gate flips at level 5;
no double-grant of rewards; persistence survives reload.

---

## 7. Success criteria

The slice succeeds if a fresh human player can, in one session: hunt raiders → see XP fill and level
up with a felt power bump → be pulled through the 4-step chain → kill the Named captain → unlock the
Sector 2 gate — and *want* to continue. If that loop is fun, we replicate it for sectors 2–3 and
levels 6–20.
