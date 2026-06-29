# Pilot Progression Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an active Pilot-Level progression spine (levels 1–5) driven by hunting and a 4-step Sector 1 quest chain, proving the hunt→XP→level→tougher-enemy→loot loop before authoring more content.

**Architecture:** Two new pure, deterministic sim modules (`pilotLevel.ts`, `campaign.ts`) mirror the existing `journey.ts`/`ranks.ts` style and are fully unit-tested. `pirates.ts` gains an enemy tier (grunt/elite/named). `main.ts` wires XP + campaign events into the existing pirate-kill / mining hooks, persists the new state through `currentProgress()`/`refreshWallet()`, and renders a Pilot-Level XP bar + campaign tracker. Career Rank (`ranks.ts`) is untouched and stays as the lifetime-earnings prestige ladder.

**Tech Stack:** TypeScript, Three.js, Vite, Vitest. Spec: `docs/specs/2026-06-29-pilot-progression-vertical-slice-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/sim/pilotLevel.ts` | Pilot Level spine: XP curve, level-ups, unlocks, kill XP, persistence | Create |
| `src/sim/pilotLevel.test.ts` | Unit tests for the spine | Create |
| `src/sim/campaign.ts` | Sector 1 linear quest chain: steps, event recording, sector unlock, persistence | Create |
| `src/sim/campaign.test.ts` | Unit tests for the campaign | Create |
| `src/sim/pirates.ts` | Add `PirateTier` + tier/name fields + opts-based `spawnPirate` | Modify |
| `src/sim/pirates.test.ts` | Update one call to opts form; add tier tests | Modify |
| `src/net/client.ts:21` | Extend `PlayerProgress` with optional `pilot` + `campaign` | Modify |
| `src/main.ts` | Wire XP/campaign into kill + mining hooks; spawn elites/named; persistence; HUD | Modify |
| `index.html:705` | Add Pilot-Level XP bar element to `#wallet` | Modify |

---

## Task 1: Pilot Level pure module

**Files:**
- Create: `src/sim/pilotLevel.ts`
- Test: `src/sim/pilotLevel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/pilotLevel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_LEVEL, addXp, emptyPilot, loadPilot, savePilot, unlocksForLevel, xpForKill, xpForLevel,
} from './pilotLevel'

function memStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

describe('xpForLevel', () => {
  it('rises with level and caps at MAX_LEVEL', () => {
    expect(xpForLevel(2)).toBeGreaterThan(xpForLevel(1))
    expect(xpForLevel(MAX_LEVEL)).toBe(Infinity)
  })
})

describe('addXp', () => {
  it('accumulates XP without leveling when below threshold', () => {
    const r = addXp(emptyPilot(), 10)
    expect(r.progress.level).toBe(1)
    expect(r.progress.xp).toBe(10)
    expect(r.leveledUp).toEqual([])
  })

  it('levels up and carries the remainder', () => {
    const need = xpForLevel(1)
    const r = addXp(emptyPilot(), need + 5)
    expect(r.progress.level).toBe(2)
    expect(r.progress.xp).toBe(5)
    expect(r.leveledUp).toEqual([2])
  })

  it('handles multiple level-ups from one big award', () => {
    const big = xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + 1
    const r = addXp(emptyPilot(), big)
    expect(r.progress.level).toBe(4)
    expect(r.leveledUp).toEqual([2, 3, 4])
  })

  it('never goes negative on a negative award', () => {
    const r = addXp({ level: 1, xp: 5 }, -100)
    expect(r.progress.xp).toBe(5)
  })
})

describe('unlocksForLevel', () => {
  it('opens Sector 2 and a higher upgrade tier at level 5', () => {
    expect(unlocksForLevel(4).unlockSector).toBeNull()
    expect(unlocksForLevel(5).unlockSector).toBe(2)
    expect(unlocksForLevel(5).unlockUpgradeTier).toBe(5)
  })
})

describe('xpForKill', () => {
  it('rewards tougher tiers more', () => {
    expect(xpForKill('named')).toBeGreaterThan(xpForKill('elite'))
    expect(xpForKill('elite')).toBeGreaterThan(xpForKill('grunt'))
  })
})

describe('persistence', () => {
  it('round-trips and clamps bad data', () => {
    const s = memStorage()
    savePilot({ level: 3, xp: 40 }, s)
    expect(loadPilot(s)).toEqual({ level: 3, xp: 40 })
    s.setItem('scc.pilot.v1', '{"level":-2,"xp":-9}')
    expect(loadPilot(s)).toEqual({ level: 1, xp: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/pilotLevel.test.ts`
Expected: FAIL — `Failed to resolve import "./pilotLevel"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/pilotLevel.ts`:

```ts
// Pilot Level — the active progression spine: hunting and quests earn XP; levels grant power and
// access. Pure + deterministic (mirrors ranks.ts / journey.ts). Career Rank (ranks.ts) is a SEPARATE
// ladder — lifetime-earnings prestige + the credit bonus. This is the combat/quest growth axis.
import type { PirateTier } from './pirates'

export interface PilotProgress {
  level: number // 1-based
  xp: number    // XP into the CURRENT level (the remainder carries on level-up)
}

export const MAX_LEVEL = 20        // spine defined to 20; this slice only authors content to 5
export const SLICE_LEVEL_CAP = 5   // the vertical slice's content ceiling

export function emptyPilot(): PilotProgress {
  return { level: 1, xp: 0 }
}

/** XP needed to advance FROM `level` to `level + 1`. Gentle curve so 1→5 is one focused session. */
export function xpForLevel(level: number): number {
  if (level >= MAX_LEVEL) return Infinity
  return 60 * level + 20 * level * level // 1→2:80, 2→3:200, 3→4:360, 4→5:560
}

export interface XpResult {
  progress: PilotProgress
  leveledUp: number[] // the new level numbers reached, in order (empty if none)
}

export function addXp(p: PilotProgress, amount: number): XpResult {
  let level = p.level
  let xp = p.xp + Math.max(0, amount)
  const leveledUp: number[] = []
  while (level < MAX_LEVEL && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level)
    level += 1
    leveledUp.push(level)
  }
  if (level >= MAX_LEVEL) xp = 0
  return { progress: { level, xp }, leveledUp }
}

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

export function xpForKill(tier: PirateTier): number {
  return tier === 'named' ? 200 : tier === 'elite' ? 35 : 10
}

const STORAGE_KEY = 'scc.pilot.v1'

export function loadPilot(storage: Storage): PilotProgress {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyPilot()
    const p = JSON.parse(raw)
    if (typeof p?.level !== 'number' || typeof p?.xp !== 'number') return emptyPilot()
    return { level: Math.min(MAX_LEVEL, Math.max(1, Math.floor(p.level))), xp: Math.max(0, p.xp) }
  } catch {
    return emptyPilot()
  }
}

export function savePilot(p: PilotProgress, storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode) — progression is ephemeral then */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/pilotLevel.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/pilotLevel.ts src/sim/pilotLevel.test.ts
git commit -m "feat(progression): pilot-level spine (xp curve, level-ups, unlocks)"
```

---

## Task 2: Campaign quest chain pure module

**Files:**
- Create: `src/sim/campaign.ts`
- Test: `src/sim/campaign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/campaign.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SECTOR1_CAMPAIGN, currentCampaignStep, emptyCampaign, loadCampaign, recordCampaignEvent, saveCampaign,
} from './campaign'

function memStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

describe('campaign chain', () => {
  it('starts on the first step', () => {
    expect(currentCampaignStep(emptyCampaign())?.id).toBe(SECTOR1_CAMPAIGN[0].id)
  })

  it('only the active step’s counter advances it', () => {
    const s = emptyCampaign() // step 0 wants kill_pirates
    expect(recordCampaignEvent(s, 'mine_ore', 999).advanced).toBe(false)
    expect(s.step).toBe(0)
  })

  it('advances when the target is met and reports the completed step', () => {
    const s = emptyCampaign()
    const step0 = SECTOR1_CAMPAIGN[0]
    for (let i = 0; i < step0.target - 1; i++) expect(recordCampaignEvent(s, 'kill_pirates', 1).advanced).toBe(false)
    const r = recordCampaignEvent(s, 'kill_pirates', 1)
    expect(r.advanced).toBe(true)
    expect(r.completed?.id).toBe(step0.id)
    expect(s.step).toBe(1)
    expect(s.progress).toBe(0)
  })

  it('runs all the way through and unlocks Sector 2 on the final step', () => {
    const s = emptyCampaign()
    recordCampaignEvent(s, 'kill_pirates', SECTOR1_CAMPAIGN[0].target) // step 0 → 1
    recordCampaignEvent(s, 'mine_ore', SECTOR1_CAMPAIGN[1].target)     // step 1 → 2
    recordCampaignEvent(s, 'kill_named', SECTOR1_CAMPAIGN[2].target)   // step 2 → 3
    const last = recordCampaignEvent(s, 'kill_named', SECTOR1_CAMPAIGN[3].target) // step 3 → done
    expect(last.completed?.unlockSector).toBe(2)
    expect(s.sectorUnlocked).toBe(2)
    expect(currentCampaignStep(s)).toBeNull()
  })

  it('persists and clamps bad data', () => {
    const storage = memStorage()
    const s = emptyCampaign()
    recordCampaignEvent(s, 'kill_pirates', 2)
    saveCampaign(s, storage)
    expect(loadCampaign(storage)).toEqual(s)
    storage.setItem('scc.campaign.v1', '{"step":-1}')
    expect(loadCampaign(storage).step).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/campaign.test.ts`
Expected: FAIL — `Failed to resolve import "./campaign"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/campaign.ts`:

```ts
// Sector 1 story campaign — a linear quest chain that paces a player through the level-1→5 loop.
// Pure + deterministic (mirrors journey.ts / daily.ts). The active step advances when its counter
// hits the target; the caller applies the XP + credit rewards and reacts to sector unlocks.

export type CampaignCounter = 'kill_pirates' | 'mine_ore' | 'kill_named'

export interface CampaignStepDef {
  id: string
  label: string
  counter: CampaignCounter
  target: number
  xpReward: number
  creditReward: number
  unlockSector?: number
}

// Steps 3 and 4 both use 'kill_named' — main.ts spawns the matching named enemy for the active step
// (Vex Marrow, then the heavier Raider Captain), so each named kill advances exactly one step.
export const SECTOR1_CAMPAIGN: readonly CampaignStepDef[] = [
  { id: 's1-patrol', label: 'Patrol the Refinery Belt — destroy 5 raiders', counter: 'kill_pirates', target: 5, xpReward: 150, creditReward: 800 },
  { id: 's1-supply', label: 'Cut their supply — mine 200 ORE', counter: 'mine_ore', target: 200, xpReward: 200, creditReward: 1200 },
  { id: 's1-wanted', label: 'Wanted — hunt the raider Vex Marrow', counter: 'kill_named', target: 1, xpReward: 300, creditReward: 2500 },
  { id: 's1-captain', label: 'Break the raider captain', counter: 'kill_named', target: 1, xpReward: 500, creditReward: 5000, unlockSector: 2 },
]

export interface CampaignState {
  step: number          // index into SECTOR1_CAMPAIGN; === length when complete
  progress: number      // progress into the active step's counter
  sectorUnlocked: number // highest sector index the player may enter (starts at 1)
}

export function emptyCampaign(): CampaignState {
  return { step: 0, progress: 0, sectorUnlocked: 1 }
}

export function currentCampaignStep(s: CampaignState): CampaignStepDef | null {
  return s.step >= 0 && s.step < SECTOR1_CAMPAIGN.length ? SECTOR1_CAMPAIGN[s.step] : null
}

export interface CampaignAdvance {
  advanced: boolean
  completed: CampaignStepDef | null // the step just finished (caller grants its rewards), or null
}

export function recordCampaignEvent(s: CampaignState, counter: CampaignCounter, amount: number): CampaignAdvance {
  const step = currentCampaignStep(s)
  if (!step || step.counter !== counter) return { advanced: false, completed: null }
  s.progress += Math.max(0, amount)
  if (s.progress < step.target) return { advanced: false, completed: null }
  s.step += 1
  s.progress = 0
  if (step.unlockSector) s.sectorUnlocked = Math.max(s.sectorUnlocked, step.unlockSector)
  return { advanced: true, completed: step }
}

const STORAGE_KEY = 'scc.campaign.v1'

export function loadCampaign(storage: Storage): CampaignState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptyCampaign()
    const p = JSON.parse(raw)
    if (typeof p?.step !== 'number') return emptyCampaign()
    return {
      step: Math.max(0, Math.floor(p.step)),
      progress: Math.max(0, p.progress ?? 0),
      sectorUnlocked: Math.max(1, p.sectorUnlocked ?? 1),
    }
  } catch {
    return emptyCampaign()
  }
}

export function saveCampaign(s: CampaignState, storage: Storage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable — campaign is ephemeral then */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/campaign.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/campaign.ts src/sim/campaign.test.ts
git commit -m "feat(progression): sector 1 campaign quest chain"
```

---

## Task 3: Pirate enemy tiers

**Files:**
- Modify: `src/sim/pirates.ts`
- Test: `src/sim/pirates.test.ts`

- [ ] **Step 1: Update the existing test + add tier tests (failing)**

In `src/sim/pirates.test.ts`, replace the `scales hull and reward for deep-space spawns` test (lines 23–27) with the opts form and add tier coverage:

```ts
  it('scales hull and reward for deep-space spawns', () => {
    const deep = spawnPirate('p2', new Vector3(), { hullMul: 2, reward: 600 })
    expect(deep.health.hull).toBe(Math.round(PIRATE_HULL * 2))
    expect(deep.reward).toBe(600)
  })

  it('defaults to the grunt tier with no name', () => {
    const p = spawnPirate('p1', new Vector3())
    expect(p.tier).toBe('grunt')
    expect(p.name).toBeUndefined()
  })

  it('carries an explicit tier and name', () => {
    const named = spawnPirate('boss', new Vector3(), { tier: 'named', name: 'Vex Marrow', hullMul: 8, reward: 4000 })
    expect(named.tier).toBe('named')
    expect(named.name).toBe('Vex Marrow')
    expect(named.health.hull).toBe(Math.round(PIRATE_HULL * 8))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `spawnPirate` does not accept an options object / `tier` missing on `Pirate`.

- [ ] **Step 3: Implement the tier change**

In `src/sim/pirates.ts`, add tier constants after `PIRATE_LEASH_RANGE` (line 21):

```ts
export type PirateTier = 'grunt' | 'elite' | 'named'

// Per-tier toughness + payout (starting values, tuned live). Named is a sector miniboss.
export const PIRATE_TIER_HULL_MUL: Record<PirateTier, number> = { grunt: 1, elite: 2.5, named: 8 }
export const PIRATE_TIER_REWARD: Record<PirateTier, number> = { grunt: PIRATE_REWARD, elite: 700, named: 4000 }
```

Add the fields to the `Pirate` interface (after `reward: number` at line 30):

```ts
  /** Threat tier: grunt (default), elite, or a named sector miniboss. */
  tier: PirateTier
  /** Display name — set only for named minibosses. */
  name?: string
```

Replace `spawnPirate` (lines 33–43) with the opts form:

```ts
export interface SpawnPirateOpts {
  hullMul?: number
  reward?: number
  tier?: PirateTier
  name?: string
}

/** Spawn a pirate. `opts.hullMul` toughens it, `opts.reward` overrides payout, `opts.tier`/`opts.name`
 *  mark elites and named minibosses. Defaults reproduce the original base grunt. */
export function spawnPirate(id: string, position: Vector3, opts: SpawnPirateOpts = {}): Pirate {
  const tier = opts.tier ?? 'grunt'
  return {
    id,
    position: position.clone(),
    velocity: new Vector3(),
    health: createHealth(Math.round(PIRATE_HULL * (opts.hullMul ?? 1))),
    weapon: createWeapon(PIRATE_FIRE_INTERVAL),
    reward: opts.reward ?? PIRATE_REWARD,
    tier,
    name: opts.name,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(progression): pirate enemy tiers (grunt/elite/named)"
```

---

## Task 4: Wire XP + campaign into main.ts (kill/mining hooks, spawns, persistence)

**Files:**
- Modify: `src/net/client.ts:21` (extend `PlayerProgress`)
- Modify: `src/main.ts` (imports, state init, spawns, kill hook, mining hook, persistence, sync)

No new unit tests (this is DOM/loop wiring, untested in this codebase). Verify by typecheck + build + manual play.

- [ ] **Step 1: Extend `PlayerProgress`**

In `src/net/client.ts`, inside `interface PlayerProgress` (after `daily?: DailyState` at line 41), add:

```ts
  pilot?: { level: number; xp: number }
  campaign?: { step: number; progress: number; sectorUnlocked: number }
```

- [ ] **Step 2: Add imports in main.ts**

After the pirates import (`src/main.ts:92`), add (import only what Task 4 uses — `xpForLevel` is added in Task 5; `noUnusedLocals` is on, so an unused import fails the build):

```ts
import { addXp, loadPilot, savePilot, xpForKill } from './sim/pilotLevel'
import { currentCampaignStep, loadCampaign, recordCampaignEvent, saveCampaign } from './sim/campaign'
```

Also update the pirates import on line 92 to include the new tier helpers:

```ts
import { type Pirate, PIRATE_REWARD, PIRATE_TIER_HULL_MUL, PIRATE_TIER_REWARD, shouldDespawnPirate, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
```

- [ ] **Step 3: Initialize the new state**

Immediately after `const blackHoleRun = createBlackHoleRun()` (`src/main.ts:1425`), add:

```ts
const pilot = loadPilot(localStorage)
const campaign = loadCampaign(localStorage)
let namedRaiderActive = false // guards against double-spawning the campaign's named miniboss
```

- [ ] **Step 4: Extract a shared pirate-registration helper + roll elites**

The wave spawner builds the pirate mesh inline (`src/main.ts:1943–1960`). Extract that into a helper so the named-raider spawner can reuse it. Replace the body of `spawnPirateWave` from line 1940 (`const pos = …`) through line 1961 (`void now`) with:

```ts
  const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
  // Deeper space: tankier pirates worth a bigger bounty. 25% of waves are elites.
  const elite = Math.random() < 0.25
  const tier = elite ? ('elite' as const) : ('grunt' as const)
  const hullMul = (elite ? PIRATE_TIER_HULL_MUL.elite : 1) * (1 + depth * 1.6)
  const reward = Math.round((elite ? PIRATE_TIER_REWARD.elite : PIRATE_REWARD) * (1 + depth * 2))
  addPirate(spawnPirate(`pir-${pirateSpawnCount}`, pos, { hullMul, reward, tier }), pos)
  void now
```

Add the extracted helper immediately ABOVE `function spawnPirateWave` (before line 1934):

```ts
// Register a freshly-spawned pirate: track it, add its placeholder mesh, then swap in the GLB model.
// Shared by the wave spawner and the campaign's named-raider spawner. (Mesh code lifted verbatim from
// the old spawnPirateWave body, with tier-based color/scale so elites and minibosses read distinct.)
function addPirate(pirate: Pirate, pos: THREE.Vector3): void {
  pirates.push(pirate)
  const mesh = buildCraft('interceptor', pirate.tier === 'grunt' ? 0xc0392b : 0xff7a1a)
  if (pirate.tier === 'named') mesh.scale.multiplyScalar(1.8) // minibosses read bigger
  mesh.position.copy(pos)
  scene.add(mesh)
  pirateMeshes.set(pirate.id, mesh)
  loadPirateModel().then((model) => {
    if (!model) return
    if (pirateMeshes.get(pirate.id) !== mesh) { disposeObject(model); return }
    model.position.copy(mesh.position)
    model.quaternion.copy(mesh.quaternion)
    if (pirate.tier === 'named') model.scale.multiplyScalar(1.8)
    scene.remove(mesh)
    disposeObject(mesh)
    scene.add(model)
    pirateMeshes.set(pirate.id, model)
  })
}
```

> All referenced symbols (`buildCraft`, `loadPirateModel`, `disposeObject`, `scene`, `pirateMeshes`, `THREE`) are already imported/defined in main.ts — confirm by leaving them unchanged.

- [ ] **Step 5: Spawn the campaign's named miniboss on demand**

Add this function just below `spawnPirateWave` (after its closing brace, ~`src/main.ts:1962`):

```ts
// Spawn the named raider for the active campaign step (Vex Marrow, then the heavier Raider Captain),
// once at a time. Killing it advances the chain (kill_named) and clears namedRaiderActive.
function maybeSpawnNamedRaider(now: number): void {
  if (namedRaiderActive) return
  const step = currentCampaignStep(campaign)
  if (!step || step.counter !== 'kill_named') return
  const captain = step.id === 's1-captain'
  const name = captain ? 'Raider Captain' : 'Vex Marrow'
  const pos = spawnPositionAround(ship.position, 700, pirateSpawnCount++)
  addPirate(spawnPirate(`named-${campaign.step}`, pos, {
    tier: 'named', name,
    hullMul: captain ? 12 : PIRATE_TIER_HULL_MUL.named,
    reward: PIRATE_TIER_REWARD.named,
  }), pos)
  namedRaiderActive = true
  registerKillBanner(combatFeedback, `INCOMING: ${name.toUpperCase()}`, 'named raider', now)
}
```

Call it once per frame right after the `spawnPirateWave(now)` call (`src/main.ts:4426`):

```ts
      maybeSpawnNamedRaider(now)
```

- [ ] **Step 6: Award XP + advance the campaign in the kill hook**

In the pirate-death block (`src/main.ts:4487–4499`), insert the progression awards. Replace lines 4493–4496:

```ts
        gainCredits(econ, p.reward)
        recordDailyEvent('kill_pirates', 1, now)
        finishOnboarding() // graduates the onboarding objective
        refreshWallet()
```

with:

```ts
        gainCredits(econ, p.reward)
        recordDailyEvent('kill_pirates', 1, now)
        // Pilot Level XP for the kill (tier-scaled), then campaign progress.
        const killXp = addXp(pilot, xpForKill(p.tier))
        pilot.level = killXp.progress.level
        pilot.xp = killXp.progress.xp
        if (killXp.leveledUp.length) showPromotion(`Pilot Level ${pilot.level}`)
        if (p.tier === 'named') {
          namedRaiderActive = false
          crafting.cores += 1 // named minibosses guarantee a core
        }
        const camp = recordCampaignEvent(campaign, p.tier === 'named' ? 'kill_named' : 'kill_pirates', 1)
        if (camp.completed) {
          const stepXp = addXp(pilot, camp.completed.xpReward)
          pilot.level = stepXp.progress.level
          pilot.xp = stepXp.progress.xp
          gainCredits(econ, camp.completed.creditReward)
          if (stepXp.leveledUp.length) showPromotion(`Pilot Level ${pilot.level}`)
          if (camp.completed.unlockSector) {
            registerKillBanner(combatFeedback, `SECTOR ${camp.completed.unlockSector} UNLOCKED`, 'new space charted', now)
          }
        }
        finishOnboarding() // graduates the onboarding objective
        refreshWallet()
```

- [ ] **Step 7: Feed mining into the campaign**

The mining tick records the daily at `src/main.ts:4326`: `recordDailyEvent('mine_ore', mineResult.mined, now)`. Add the campaign mirror immediately after it, using the same `mineResult.mined` amount:

```ts
      recordCampaignEvent(campaign, 'mine_ore', mineResult.mined)
```

- [ ] **Step 8: Persist + sync the new state**

In `currentProgress()` (`src/main.ts:2232`), add two properties to the returned object (after `daily: dailyState,` at line 2240):

```ts
    pilot: { level: pilot.level, xp: pilot.xp },
    campaign: { step: campaign.step, progress: campaign.progress, sectorUnlocked: campaign.sectorUnlocked },
```

In `applyServerProgress(p)` (`src/main.ts:2299`), add after the crafting block:

```ts
  if (p.pilot) { pilot.level = p.pilot.level; pilot.xp = p.pilot.xp }
  if (p.campaign) { campaign.step = p.campaign.step; campaign.progress = p.campaign.progress; campaign.sectorUnlocked = p.campaign.sectorUnlocked }
```

In `refreshWallet()` (`src/main.ts:2327`), add before `net.saveProgress(currentProgress())` (line 2332):

```ts
  savePilot(pilot, localStorage)
  saveCampaign(campaign, localStorage)
```

- [ ] **Step 9: Verify typecheck + build + tests**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

Run: `npx vitest run`
Expected: all test files pass (including Tasks 1–3).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/net/client.ts src/main.ts
git commit -m "feat(progression): wire pilot XP + campaign into combat, spawns, and persistence"
```

---

## Task 5: HUD — Pilot Level + XP bar + campaign tracker

**Files:**
- Modify: `index.html:705` (`#wallet` block) + CSS near `index.html:97`
- Modify: `src/main.ts` (element refs, `updateWalletHUD`, `currentObjective`)

- [ ] **Step 1: Add the HUD element**

In `index.html`, inside `#wallet` (after the `#rank-line` div, before `</div>` at line 713), add:

```html
    <div id="pilot-line">
      <span id="pilot-level">Lv 1</span>
      <span id="pilot-track"><i id="pilot-xp-bar"></i></span>
    </div>
```

Add CSS next to the rank styles (after `index.html:99`):

```css
    #pilot-level { color: #ffd24d; font-weight: 700; letter-spacing: .5px; }
    #pilot-track { display: inline-block; width: 90px; height: 6px; background: #14303a; border-radius: 3px; overflow: hidden; vertical-align: middle; margin-left: 6px; }
    #pilot-xp-bar { display: block; height: 100%; width: 0%; background: #ffd24d; transition: width .3s ease-out; }
```

- [ ] **Step 2: Add element refs in main.ts**

Next to the rank element refs (`src/main.ts:210–212`), add:

```ts
const pilotLevelEl = document.getElementById('pilot-level')!
const pilotXpBarEl = document.getElementById('pilot-xp-bar')!
```

- [ ] **Step 3: Render the Pilot Level bar**

First add `xpForLevel` to the pilotLevel import created in Task 4 Step 2 (now that it is used here):

```ts
import { addXp, loadPilot, savePilot, xpForKill, xpForLevel } from './sim/pilotLevel'
```

In `updateWalletHUD()`, after the rank block (after `src/main.ts:2229`, before the closing brace at 2230), add:

```ts
  pilotLevelEl.textContent = `Lv ${pilot.level}`
  const need = xpForLevel(pilot.level)
  pilotXpBarEl.style.width = `${need === Infinity ? 100 : Math.round((pilot.xp / need) * 100)}%`
```

- [ ] **Step 4: Show the campaign step as the active objective**

In `currentObjective()` (`src/main.ts:268`), make the campaign step take priority over the journey goal. Insert right after the flight-plan check (after line 269, before the `nextJourneyGoal` block):

```ts
  const camp = currentCampaignStep(campaign)
  if (camp) return `${camp.label} — ${campaign.progress}/${camp.target}`
```

- [ ] **Step 5: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open the game (not `?bot=1`), then:
- Confirm the wallet shows `Lv 1` with a gold XP bar beside the Career Rank.
- Destroy raiders → XP bar fills; the objective line reads `Patrol the Refinery Belt — destroy 5 raiders — N/5`.
- After 5 kills → objective switches to the mining step; mine ORE → progress climbs.
- Reach the wanted step → a named raider spawns (banner) → killing it advances; the captain then spawns.
- Killing the captain → `SECTOR 2 UNLOCKED` banner; objective falls back to the journey/none.
- Reload the page → Pilot Level, XP, and campaign step persist.

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(progression): pilot level + xp bar HUD and campaign objective tracker"
```

---

## Self-Review Notes (coverage map)

- Spec §3.1 Pilot Level spine → Task 1.
- Spec §3.2 Enemy tiering → Task 3 (model) + Task 4 Steps 4–5 (spawning).
- Spec §3.3 Campaign chain → Task 2 (logic) + Task 4 Steps 6–7 (wiring).
- Spec §3.4 Loot (cores on named) → Task 4 Step 6.
- Spec §3.5 Sector gate teaser → `sectorUnlocked` + unlock banner (Task 4 Step 6) + objective fallback (Task 5 Step 4). A flyable Sector 2 nav point is intentionally deferred to the content milestone.
- Spec §4 Persistence/sync → Task 4 Steps 1, 8.
- Spec §5 HUD → Task 5.
- Spec §6 Testing → Tasks 1–3 unit tests; Tasks 4–5 typecheck/build/manual.
- Career Rank untouched (decided): no task modifies `ranks.ts`.
- `unlocksForLevel` (hull bonus / upgrade-tier ceiling) is defined + unit-tested in Task 1 but intentionally NOT yet applied to ship stats or the station menu in this slice — only `unlockSector` is consumed (via the campaign). Applying `hullBonus`/`unlockUpgradeTier` to live ship stats is deferred to the next milestone. This is a deliberate scope boundary, not a gap.

**Anchor line numbers** reflect the repo at plan-writing time (HEAD `252edf9`). If they have drifted, locate by the quoted surrounding code rather than the raw line number.
