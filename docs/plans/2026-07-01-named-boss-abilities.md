# Named Boss Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two campaign named bosses (Vex Marrow, Raider Captain) distinct ability kits (summon adds / telegraphed volley) plus a shared low-hull enrage, reusing existing systems.

**Architecture:** Extend the pure `src/sim/pirates.ts` with a `BossKit` table + an optional `boss` runtime on `Pirate`; fold the boss logic into `stepPirate` (gated on `pirate.boss`, zero cost otherwise) and return ability events on an extended `PirateStepResult`. `src/main.ts` tags each boss at spawn (base archetype + boss key) and applies the events (push volley, spawn swarm adds, telegraph/enrage cues).

**Tech Stack:** TypeScript, Three.js, Vitest. No server/relay changes.

**Spec:** `docs/specs/2026-07-01-named-boss-abilities-design.md`

---

## File Structure

- **Modify** `src/sim/pirates.ts` — `BossAbility`/`BossKit`/`BossRuntime` types, `BOSS_KITS`, `PirateStepResult` extra fields, `Pirate.boss`, `SpawnPirateOpts.bossKey`, `spawnPirate` attaches the boss runtime, `stepPirate` boss layer. Imports `hullFraction` (combat) + `spreadDirections` (fireModes).
- **Modify** `src/sim/pirates.test.ts` — boss tests.
- **Modify** `src/main.ts` — `maybeSpawnNamedRaider` tags archetype+bossKey; the pirate step-result loop applies volley/summon/telegraph/enrage.

**Codebase facts:**
- `spawnProjectile(origin, dir, faction, speed?, damage?, inheritedVelocity?)` (combat.ts). `spreadDirections(forward, pellets, spreadRad, rng)` (fireModes.ts) — fans `pellets` unit dirs in a cone; pass `() => 0.5` for a deterministic even fan. `hullFraction(health)` (combat.ts) = hull/max.
- `stepPirate(pirate, targetPos, dt, nowSec = 0)` returns `PirateStepResult { fired }`. Consumer loop in main.ts (`for (const pirate of pirates) { const r = stepPirate(pirate, ship.position, dt, now / 1000); if (r.fired) projectiles.push(r.fired) ... }`).
- `maybeSpawnNamedRaider`: `const captain = step.id === 's1-captain'`; spawns `spawnPirate(\`named-${campaign.step}\`, pos, { tier:'named', name, hullMul: captain ? 12 : PIRATE_TIER_HULL_MUL.named, reward: PIRATE_TIER_REWARD.named })`. Bosses bypass the count cap.
- main.ts has in scope: `registerKillBanner(combatFeedback, title, sub, now)`, `audio.blip('nav')`, `spawnPositionAround`, `pirateSpawnCount`, `addPirate`, `PIRATE_REWARD`, `MAX_PIRATES`, `removePirateMesh`.
- Run one file: `npx vitest run src/sim/pirates.test.ts`. Gate: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

## Task 1: Boss types + `BOSS_KITS` + extended `PirateStepResult`

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/pirates.test.ts` (add `BOSS_KITS` to the `./pirates` import):

```ts
import { BOSS_KITS } from './pirates'

describe('BOSS_KITS', () => {
  it('vex is a summoner; captain is a telegraphed gunner', () => {
    expect(BOSS_KITS.vex.ability).toBe('summon')
    expect(BOSS_KITS.vex.summonCount).toBeGreaterThan(0)
    expect(BOSS_KITS.captain.ability).toBe('volley')
    expect(BOSS_KITS.captain.telegraphSec).toBeGreaterThan(0)
    expect(BOSS_KITS.captain.volleyBolts).toBeGreaterThan(1)
  })
  it('both enrage below a hull fraction with faster fire + speed', () => {
    for (const k of [BOSS_KITS.vex, BOSS_KITS.captain]) {
      expect(k.enrageAtHullFrac).toBeGreaterThan(0)
      expect(k.enrageAtHullFrac).toBeLessThan(1)
      expect(k.enrageFireMul).toBeLessThan(1) // faster
      expect(k.enrageSpeedMul).toBeGreaterThan(1)
    }
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `BOSS_KITS` not exported.

- [ ] **Step 3: Implement**

In `src/sim/pirates.ts`, add after the `ARCHETYPE_BEHAVIOR`/`pickArchetype` block:

```ts
export type BossAbility = 'summon' | 'volley'

export interface BossKit {
  ability: BossAbility
  abilityIntervalSec: number
  telegraphSec: number
  volleyBolts: number
  volleySpreadRad: number
  summonCount: number
  enrageAtHullFrac: number
  enrageFireMul: number
  enrageSpeedMul: number
}

export const BOSS_KITS: Record<'vex' | 'captain', BossKit> = {
  vex:     { ability: 'summon', abilityIntervalSec: 9,   telegraphSec: 0,   volleyBolts: 0, volleySpreadRad: 0,    summonCount: 3, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
  captain: { ability: 'volley', abilityIntervalSec: 6.5, telegraphSec: 0.8, volleyBolts: 5, volleySpreadRad: 0.16, summonCount: 0, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
}

export interface BossRuntime {
  kit: BossKit
  abilityCd: number
  telegraphCd: number
  enraged: boolean
}
```

Extend `PirateStepResult` (add the optional fields):
```ts
export interface PirateStepResult {
  fired: Projectile | null
  volley?: Projectile[]
  telegraphStart?: boolean
  summon?: number
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): boss ability kits + extended pirate step result (pure)"
```

---

## Task 2: `Pirate.boss` + `spawnPirate` attaches the boss runtime

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/pirates.test.ts`:

```ts
describe('spawnPirate boss', () => {
  it('attaches a boss runtime for a bossKey (kit + timers + not enraged)', () => {
    const p = spawnPirate('b', new Vector3(0, 0, 100), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
    expect(p.boss).toBeDefined()
    expect(p.boss!.kit).toBe(BOSS_KITS.vex)
    expect(p.boss!.abilityCd).toBe(BOSS_KITS.vex.abilityIntervalSec)
    expect(p.boss!.telegraphCd).toBe(0)
    expect(p.boss!.enraged).toBe(false)
  })
  it('is undefined for a normal pirate', () => {
    expect(spawnPirate('n', new Vector3(0, 0, 100)).boss).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `boss`/`bossKey` unsupported.

- [ ] **Step 3: Implement**

In `src/sim/pirates.ts`:

Add to `interface Pirate` (after `seed`):
```ts
  /** Present only for named campaign bosses — drives the ability kit in stepPirate. */
  boss?: BossRuntime
```

Add to `interface SpawnPirateOpts`:
```ts
  bossKey?: 'vex' | 'captain'
```

In `spawnPirate`, before the `return`, build the optional boss runtime and include it:
```ts
  const boss: BossRuntime | undefined = opts.bossKey
    ? { kit: BOSS_KITS[opts.bossKey], abilityCd: BOSS_KITS[opts.bossKey].abilityIntervalSec, telegraphCd: 0, enraged: false }
    : undefined
```
and add `boss,` to the returned object literal.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS. (Existing spawnPirate tests still pass — `boss` is undefined unless `bossKey` is given.)

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): Pirate.boss runtime attached by spawnPirate bossKey"
```

---

## Task 3: `stepPirate` boss layer — enrage + summon + telegraphed volley

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/pirates.test.ts`:

```ts
describe('stepPirate boss abilities', () => {
  const origin = new Vector3(0, 0, 0)
  const summoner = () => spawnPirate('v', new Vector3(0, 0, 200), { tier: 'named', name: 'Vex Marrow', archetype: 'chaser', bossKey: 'vex' })
  const gunner = () => spawnPirate('c', new Vector3(0, 0, 600), { tier: 'named', name: 'Raider Captain', archetype: 'lancer', bossKey: 'captain' })

  it('summoner returns summon count once its interval elapses, not before', () => {
    const v = summoner()
    expect(stepPirate(v, origin, 1.0).summon).toBeUndefined()          // 1s < 9s interval
    v.boss!.abilityCd = 0.001                                          // fast-forward to the trigger
    expect(stepPirate(v, origin, 0.002).summon).toBe(BOSS_KITS.vex.summonCount)
  })
  it('gunner telegraphs first, then fires a volley after the telegraph', () => {
    const c = gunner()
    c.boss!.abilityCd = 0.001
    const t = stepPirate(c, origin, 0.002)                             // ability fires → telegraph starts
    expect(t.telegraphStart).toBe(true)
    expect(t.volley).toBeUndefined()
    // still winding up
    expect(stepPirate(c, origin, 0.1).volley).toBeUndefined()
    // finish the telegraph
    const v = stepPirate(c, origin, BOSS_KITS.captain.telegraphSec)
    expect(v.volley).toHaveLength(BOSS_KITS.captain.volleyBolts)
    expect(v.volley!.every((p) => p.faction === 'pirate')).toBe(true)
    // one volley per windup only
    expect(stepPirate(c, origin, 0.1).volley).toBeUndefined()
  })
  it('enrages below the hull fraction (faster ability interval)', () => {
    const v = summoner()
    v.health.hull = v.health.max * 0.3   // < 0.35
    v.boss!.abilityCd = 0.001
    stepPirate(v, origin, 0.002)          // triggers summon + resets abilityCd
    expect(v.boss!.enraged).toBe(true)
    expect(v.boss!.abilityCd).toBeCloseTo(BOSS_KITS.vex.abilityIntervalSec * BOSS_KITS.vex.enrageFireMul, 3)
  })
  it('a normal pirate never returns boss events', () => {
    const g = spawnPirate('g', new Vector3(0, 0, 100))
    const r = stepPirate(g, origin, 0.5)
    expect(r.summon).toBeUndefined()
    expect(r.volley).toBeUndefined()
    expect(r.telegraphStart).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `stepPirate` doesn't set summon/volley/telegraphStart or touch `boss`.

- [ ] **Step 3: Add imports + rewrite `stepPirate`**

Add to the imports at the top of `src/sim/pirates.ts`:
```ts
import { hullFraction } from './combat'   // extend the existing combat import list
import { spreadDirections } from './fireModes'
```
(Merge `hullFraction` into the existing `from './combat'` import rather than a second line.)

Replace `stepPirate` with the boss-aware version (builds on the archetype version from Combat Depth II):
```ts
export function stepPirate(pirate: Pirate, targetPos: Vector3, dt: number, nowSec = 0): PirateStepResult {
  const b = ARCHETYPE_BEHAVIOR[pirate.archetype]
  pirate.weapon.cooldown = Math.max(0, pirate.weapon.cooldown - dt)

  _toTarget.subVectors(targetPos, pirate.position)
  const dist = _toTarget.length()
  const dir = dist > 1e-6 ? _toTarget.clone().multiplyScalar(1 / dist) : new Vector3(0, 0, -1)

  // Boss enrage modulates speed + fire/ability cadence in the final third of the fight.
  const boss = pirate.boss
  let enrageSpeedMul = 1
  let enrageFireMul = 1
  if (boss) {
    boss.enraged = hullFraction(pirate.health) < boss.kit.enrageAtHullFrac
    if (boss.enraged) { enrageSpeedMul = boss.kit.enrageSpeedMul; enrageFireMul = boss.kit.enrageFireMul }
  }

  let speed: number
  if (dist > b.engageRange) speed = b.speed
  else if (dist < b.standoff) speed = -b.speed * 0.6
  else speed = b.speed * 0.25
  speed *= enrageSpeedMul

  pirate.velocity.copy(dir).multiplyScalar(speed)
  pirate.position.addScaledVector(pirate.velocity, dt)
  if (b.weaveAmp > 0) {
    const w = weaveOffset(nowSec, b.weaveAmp, b.weaveRate, pirate.seed, dir)
    pirate.position.addScaledVector(w, dt)
  }

  const result: PirateStepResult = { fired: null }
  if (dist <= b.engageRange && pirate.weapon.cooldown <= 0) {
    result.fired = spawnProjectile(pirate.position, dir, 'pirate', b.projSpeed, b.damage)
    pirate.weapon.cooldown = pirate.weapon.interval * enrageFireMul
  }

  if (boss) {
    // Fire a pending telegraphed volley when its windup completes (one burst per windup).
    if (boss.telegraphCd > 0) {
      boss.telegraphCd -= dt
      if (boss.telegraphCd <= 0) {
        result.volley = spreadDirections(dir, boss.kit.volleyBolts, boss.kit.volleySpreadRad, () => 0.5)
          .map((d) => spawnProjectile(pirate.position, d, 'pirate', b.projSpeed, b.damage))
      }
    }
    // Ability timer: summon adds, or start a volley windup.
    boss.abilityCd -= dt
    if (boss.abilityCd <= 0) {
      boss.abilityCd = boss.kit.abilityIntervalSec * enrageFireMul
      if (boss.kit.ability === 'summon') result.summon = boss.kit.summonCount
      else { boss.telegraphCd = boss.kit.telegraphSec; result.telegraphStart = true }
    }
  }
  return result
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/sim/pirates.test.ts && npx tsc --noEmit`
Expected: all pirate tests pass (incl. the existing archetype/weave ones — non-boss behavior unchanged); tsc 0.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): stepPirate boss layer — enrage, summon, telegraphed volley"
```

---

## Task 4: `main.ts` — tag bosses + apply ability events

**Files:** Modify `src/main.ts`

- [ ] **Step 1: Tag each boss at spawn**

In `maybeSpawnNamedRaider`, change the `spawnPirate(...)` opts to add the base archetype + boss key:
```ts
  addPirate(spawnPirate(`named-${campaign.step}`, pos, {
    tier: 'named', name,
    archetype: captain ? 'lancer' : 'chaser',
    bossKey: captain ? 'captain' : 'vex',
    hullMul: captain ? 12 : PIRATE_TIER_HULL_MUL.named,
    reward: PIRATE_TIER_REWARD.named,
  }), pos)
```

- [ ] **Step 2: Track enrage announcements**

Near the pirate state (search for `let namedRaiderActive`), add:
```ts
const enragedBosses = new Set<string>() // ids already given the one-time ENRAGED cue
```
In `removePirateMesh` (the despawn/cleanup fn), add `enragedBosses.delete(id)` alongside the other per-id cleanup so a re-fought boss can re-announce.

- [ ] **Step 3: Apply the ability events in the pirate loop (adds buffered, spawned after the loop)**

To avoid mutating `pirates` mid-iteration, declare a buffer just BEFORE the `for (const pirate of pirates)` loop:
```ts
    let bossSummons = 0 // swarm adds requested by bosses this frame, spawned after the loop
```
In the loop, right after `if (r.fired) projectiles.push(r.fired)`, add:
```ts
      if (r.volley) for (const v of r.volley) projectiles.push(v)
      if (r.telegraphStart) {
        registerKillBanner(combatFeedback, '⚠ INCOMING VOLLEY', pirate.name ?? 'RAIDER', now)
        audio.blip('nav')
      }
      if (r.summon) {
        registerKillBanner(combatFeedback, `${(pirate.name ?? 'RAIDER').toUpperCase()} CALLS RAIDERS`, `+${r.summon} swarm`, now)
        audio.blip('nav')
        bossSummons += r.summon
      }
      if (pirate.boss?.enraged && !enragedBosses.has(pirate.id)) {
        enragedBosses.add(pirate.id)
        registerKillBanner(combatFeedback, `${(pirate.name ?? 'RAIDER').toUpperCase()} ENRAGED`, 'pushing hard', now)
        audio.blip('nav')
      }
```
Then AFTER the `for (const pirate of pirates)` loop closes, spawn the buffered adds near the player's spot (bounded so a boss can't flood the field):
```ts
    for (let i = 0; i < bossSummons && pirates.length < MAX_PIRATES + 8; i++) {
      const apos = spawnPositionAround(ship.position, 500, pirateSpawnCount++)
      addPirate(spawnPirate(`add-${pirateSpawnCount}`, apos, { archetype: 'swarm', reward: PIRATE_REWARD }), apos)
    }
```
(Buffering avoids stepping brand-new adds in the same frame and any `for...of` mutation ambiguity. The `pirates.length < MAX_PIRATES + 8` guard bounds runaway adds. `spawnPositionAround(ship.position, 500, ...)` drops the swarm around the player — the boss fight locus — reusing the same spawn helper the wave spawner uses.)

- [ ] **Step 4: tsc + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(combat): named bosses summon adds, telegraph volleys, enrage (wiring)"
```

---

## Task 5: Verification (playtest)

**Files:** none

- [ ] **Step 1: Run locally**

```bash
DEV_SKIP_LAUNCH_GATE=1 npm run server &   # relay :8080
npm run dev &                             # vite
```
Launch (dev bypass). To reach the bosses fast, the campaign must be on a `kill_named` step — either play the campaign to the Vex Marrow step, or temporarily note that bosses spawn via `maybeSpawnNamedRaider` when `currentCampaignStep` is `s1-wanted`/`s1-captain`. (If reaching the step is slow, verify via the unit tests + a temporary console log; do not ship any temporary hook.)

- [ ] **Step 2: Confirm each boss**

- **Vex Marrow:** weaves in (CHASER), periodically flashes "VEX MARROW CALLS RAIDERS" and a SWARM add cluster appears — SCATTER clears them; below ~1/3 hull an "ENRAGED" banner fires and it speeds up.
- **Raider Captain:** holds range (LANCER) with heavy bolts; periodically "⚠ INCOMING VOLLEY" then a 5-bolt fan you can dodge; enrages in the final third.

- [ ] **Step 3: Stop servers**

```bash
kill %1 %2 2>/dev/null || true
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → 0
- [ ] `npx vitest run` → all pass (new boss tests + existing pirate/archetype tests green)
- [ ] `npm run build` → ok
- [ ] Playtest: Vex summons + enrages; Captain telegraph-volleys + enrages; normal pirates unaffected.
