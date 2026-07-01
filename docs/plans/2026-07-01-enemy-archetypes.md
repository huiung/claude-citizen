# Enemy Behavior Archetypes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three enemy behavior archetypes (CHASER / LANCER / SWARM) that map 1:1 to the player fire modes, orthogonal to the existing hull/reward tier system.

**Architecture:** Extend the pure `src/sim/pirates.ts` with an `ARCHETYPE_BEHAVIOR` params table, an `archetype`+`seed` field on `Pirate`, a `stepPirate` that drives off the archetype's params (CHASER stats == today's constants), and pure `weaveOffset`/`pickArchetype` helpers. `src/main.ts` rolls a weighted archetype per wave (SWARM = a small cluster) and gives each archetype a distinct nameplate + color.

**Tech Stack:** TypeScript, Three.js, Vitest. No server/relay changes.

**Spec:** `docs/specs/2026-07-01-enemy-archetypes-design.md`

---

## File Structure

- **Modify** `src/sim/pirates.ts` — types, `ARCHETYPE_BEHAVIOR`, `pickArchetype`, `weaveOffset`, `Pirate.archetype`/`seed`, `spawnPirate` archetype application, `stepPirate` rewrite (optional `nowSec`).
- **Modify** `src/sim/pirates.test.ts` — new tests.
- **Modify** `src/main.ts` — `spawnPirateWave` archetype roll + SWARM cluster + pass archetype/seed; `addPirate` per-archetype color + nameplate; `stepPirate` caller passes `now/1000`.

**Codebase facts:**
- Legacy constants (the CHASER source of truth): `PIRATE_HULL=36`, `PIRATE_SPEED=55`, `PIRATE_ENGAGE_RANGE=320`, `PIRATE_STANDOFF=120`, `PIRATE_FIRE_INTERVAL=1.1`, `PIRATE_DAMAGE=7`, `PIRATE_PROJECTILE_SPEED=300`.
- `spawnPirate(id, position, opts)` → `opts.hullMul/reward/tier/name`. `stepPirate(pirate, targetPos, dt)` currently 3-arg; called at `src/main.ts:4932` as `stepPirate(pirate, ship.position, dt)`.
- `addPirate(pirate, pos)` at `src/main.ts:2090` builds the mesh (`buildCraft('interceptor', color)`), applies `TIER_SCALE`/`TIER_EMISSIVE`, and adds an `enemyplate` label only for elite/named.
- Tests: `src/sim/pirates.test.ts` (Vitest). Existing `stepPirate` tests assert distance inequalities + fire, and `r.fired!.velocity.z < 0` (aim toward target at origin from +z).
- Run one file: `npx vitest run src/sim/pirates.test.ts`. Gate: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

## Task 1: Archetype types, `ARCHETYPE_BEHAVIOR`, `pickArchetype`

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/pirates.test.ts` (add the new imports to the existing top import from `./pirates`):

```ts
import {
  ARCHETYPE_BEHAVIOR, pickArchetype,
  PIRATE_ENGAGE_RANGE, PIRATE_STANDOFF, PIRATE_SPEED, PIRATE_FIRE_INTERVAL, PIRATE_DAMAGE, PIRATE_PROJECTILE_SPEED,
} from './pirates'

describe('ARCHETYPE_BEHAVIOR', () => {
  it('chaser stats equal the legacy pirate constants (no regression)', () => {
    const c = ARCHETYPE_BEHAVIOR.chaser
    expect(c.engageRange).toBe(PIRATE_ENGAGE_RANGE)
    expect(c.standoff).toBe(PIRATE_STANDOFF)
    expect(c.speed).toBe(PIRATE_SPEED)
    expect(c.fireInterval).toBe(PIRATE_FIRE_INTERVAL)
    expect(c.damage).toBe(PIRATE_DAMAGE)
    expect(c.projSpeed).toBe(PIRATE_PROJECTILE_SPEED)
    expect(c.hullMul).toBe(1)
  })
  it('lancer snipes from long range; swarm is fast and fragile', () => {
    expect(ARCHETYPE_BEHAVIOR.lancer.engageRange).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.engageRange)
    expect(ARCHETYPE_BEHAVIOR.lancer.damage).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.damage)
    expect(ARCHETYPE_BEHAVIOR.swarm.speed).toBeGreaterThan(ARCHETYPE_BEHAVIOR.chaser.speed)
  })
  it('hull order: swarm < lancer < chaser', () => {
    expect(ARCHETYPE_BEHAVIOR.swarm.hullMul).toBeLessThan(ARCHETYPE_BEHAVIOR.lancer.hullMul)
    expect(ARCHETYPE_BEHAVIOR.lancer.hullMul).toBeLessThan(ARCHETYPE_BEHAVIOR.chaser.hullMul)
  })
})

describe('pickArchetype', () => {
  it('maps the weighted bands (chaser 50 / lancer 30 / swarm 20)', () => {
    expect(pickArchetype(() => 0)).toBe('chaser')
    expect(pickArchetype(() => 0.49)).toBe('chaser')
    expect(pickArchetype(() => 0.5)).toBe('lancer')
    expect(pickArchetype(() => 0.79)).toBe('lancer')
    expect(pickArchetype(() => 0.8)).toBe('swarm')
    expect(pickArchetype(() => 0.999)).toBe('swarm')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `ARCHETYPE_BEHAVIOR`/`pickArchetype` not exported.

- [ ] **Step 3: Implement**

In `src/sim/pirates.ts`, after the existing `PIRATE_*` constants and the `PirateTier` block, add:

```ts
export type PirateArchetype = 'chaser' | 'lancer' | 'swarm'

export interface ArchetypeBehavior {
  engageRange: number
  standoff: number
  speed: number
  fireInterval: number
  damage: number
  projSpeed: number
  hullMul: number
  weaveAmp: number
  weaveRate: number
}

// chaser row == the legacy PIRATE_* constants (no-regression). lancer = long-range heavy sniper,
// low hull. swarm = fast, fragile, many. All values are live-tunable starting points.
export const ARCHETYPE_BEHAVIOR: Record<PirateArchetype, ArchetypeBehavior> = {
  chaser: { engageRange: PIRATE_ENGAGE_RANGE, standoff: PIRATE_STANDOFF, speed: PIRATE_SPEED, fireInterval: PIRATE_FIRE_INTERVAL, damage: PIRATE_DAMAGE, projSpeed: PIRATE_PROJECTILE_SPEED, hullMul: 1, weaveAmp: 28, weaveRate: 0.9 },
  lancer: { engageRange: 900, standoff: 700, speed: 40, fireInterval: 2.4, damage: 20, projSpeed: 620, hullMul: 0.6, weaveAmp: 0, weaveRate: 0 },
  swarm:  { engageRange: 260, standoff: 70,  speed: 95, fireInterval: 0.9, damage: 4,  projSpeed: 300, hullMul: 0.35, weaveAmp: 40, weaveRate: 1.6 },
}

// Weighted archetype roll: chaser 50% / lancer 30% / swarm 20%.
export function pickArchetype(rng: () => number): PirateArchetype {
  const r = rng()
  if (r < 0.5) return 'chaser'
  if (r < 0.8) return 'lancer'
  return 'swarm'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): pirate archetype behavior table + weighted picker (pure)"
```

---

## Task 2: `weaveOffset` pure helper

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/pirates.test.ts` (add `weaveOffset` to the `./pirates` import, and `Vector3` is already imported at top — reuse it):

```ts
import { weaveOffset } from './pirates'

describe('weaveOffset', () => {
  const forward = new Vector3(0, 0, -1)
  it('returns zero when amplitude is 0 (lancer flies straight)', () => {
    expect(weaveOffset(1.2, 0, 1, 3).lengthSq()).toBe(0)
  })
  it('is perpendicular to forward and bounded by amplitude', () => {
    for (const t of [0.1, 0.5, 1.0, 2.3]) {
      const off = weaveOffset(t, 40, 1.5, 7, forward)
      expect(Math.abs(off.dot(forward))).toBeLessThan(1e-6) // perpendicular
      expect(off.length()).toBeLessThanOrEqual(40 + 1e-6)   // bounded by amp
    }
  })
  it('oscillates over time (not constant)', () => {
    const a = weaveOffset(0.0, 40, 1.5, 0, forward)
    const b = weaveOffset(0.5, 40, 1.5, 0, forward)
    expect(a.distanceTo(b)).toBeGreaterThan(1e-3)
  })
  it('is deterministic for the same inputs', () => {
    const a = weaveOffset(0.7, 40, 1.5, 2, forward)
    const b = weaveOffset(0.7, 40, 1.5, 2, forward)
    expect(a.equals(b)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `weaveOffset` not exported.

- [ ] **Step 3: Implement**

Add to `src/sim/pirates.ts`:

```ts
const _weavePerp = new Vector3()
const _weaveUp = new Vector3(0, 1, 0)
const _weaveAlt = new Vector3(1, 0, 0)
/** A lateral (perpendicular-to-`forward`) strafe offset that oscillates over time. `seed` shifts the
 *  phase so units don't weave in sync. amp<=0 → zero vector. Pure (deterministic in its inputs). */
export function weaveOffset(nowSec: number, amp: number, rate: number, seed: number, forward: Vector3 = new Vector3(0, 0, -1)): Vector3 {
  if (amp <= 0) return new Vector3()
  // A perpendicular axis: cross(forward, up), or cross(forward, x-axis) if forward is ~parallel to up.
  const f = forward.lengthSq() > 1e-9 ? forward.clone().normalize() : new Vector3(0, 0, -1)
  _weavePerp.crossVectors(f, Math.abs(f.y) < 0.99 ? _weaveUp : _weaveAlt).normalize()
  const s = Math.sin((nowSec * rate + seed) * Math.PI * 2)
  return _weavePerp.multiplyScalar(amp * s)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): weaveOffset strafe helper (pure, tested)"
```

---

## Task 3: `Pirate.archetype`/`seed` + `spawnPirate` applies the behavior

**Files:** Modify `src/sim/pirates.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/pirates.test.ts`:

```ts
describe('spawnPirate archetype', () => {
  it('defaults to chaser with legacy hull + fire interval', () => {
    const p = spawnPirate('c', new Vector3(0, 0, 100))
    expect(p.archetype).toBe('chaser')
    expect(p.weapon.interval).toBe(PIRATE_FIRE_INTERVAL)
    expect(p.health.hull).toBe(PIRATE_HULL) // chaser hullMul 1
  })
  it('applies a lancer: longer fire interval + lower hull', () => {
    const p = spawnPirate('l', new Vector3(0, 0, 100), { archetype: 'lancer' })
    expect(p.archetype).toBe('lancer')
    expect(p.weapon.interval).toBe(ARCHETYPE_BEHAVIOR.lancer.fireInterval)
    expect(p.health.hull).toBe(Math.round(PIRATE_HULL * ARCHETYPE_BEHAVIOR.lancer.hullMul))
  })
  it('combines archetype hullMul with tier hullMul', () => {
    const p = spawnPirate('s', new Vector3(0, 0, 100), { archetype: 'swarm', hullMul: 2 })
    expect(p.health.hull).toBe(Math.round(PIRATE_HULL * ARCHETYPE_BEHAVIOR.swarm.hullMul * 2))
  })
  it('carries the seed it was given', () => {
    expect(spawnPirate('x', new Vector3(0, 0, 100), { seed: 5 }).seed).toBe(5)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — `archetype`/`seed` not on Pirate; `opts.archetype`/`opts.seed` unsupported.

- [ ] **Step 3: Implement**

In `src/sim/pirates.ts`:

Add to `interface Pirate` (after `tier`):
```ts
  /** Behavior archetype — drives the AI in stepPirate (orthogonal to tier). */
  archetype: PirateArchetype
  /** Per-unit weave phase so units don't strafe in sync. */
  seed: number
```

Add to `interface SpawnPirateOpts`:
```ts
  archetype?: PirateArchetype
  seed?: number
```

Rewrite the `spawnPirate` return to apply the archetype:
```ts
export function spawnPirate(id: string, position: Vector3, opts: SpawnPirateOpts = {}): Pirate {
  const tier = opts.tier ?? 'grunt'
  const archetype = opts.archetype ?? 'chaser'
  const behavior = ARCHETYPE_BEHAVIOR[archetype]
  return {
    id,
    position: position.clone(),
    velocity: new Vector3(),
    health: createHealth(Math.round(PIRATE_HULL * behavior.hullMul * (opts.hullMul ?? 1))),
    weapon: createWeapon(behavior.fireInterval),
    reward: opts.reward ?? PIRATE_REWARD,
    tier,
    archetype,
    seed: opts.seed ?? 0,
    name: opts.name,
  }
}
```

- [ ] **Step 4: Run to verify pass (and confirm existing spawnPirate tests still pass)**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: PASS. The existing "starts at full hull" / "defaults to base hull" tests still hold (chaser hullMul 1).

- [ ] **Step 5: Commit**

```bash
git add src/sim/pirates.ts src/sim/pirates.test.ts
git commit -m "feat(combat): Pirate.archetype/seed + spawnPirate applies archetype behavior"
```

---

## Task 4: `stepPirate` drives off the archetype (+ optional `nowSec` weave) + update caller

**Files:** Modify `src/sim/pirates.ts`, `src/main.ts`; Test `src/sim/pirates.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/pirates.test.ts`:

```ts
describe('stepPirate archetype behavior', () => {
  const origin = new Vector3(0, 0, 0)
  it('a lancer fires from long range where a chaser cannot', () => {
    const far = () => new Vector3(0, 0, 600) // 600u: > chaser engage (320), < lancer engage (900)
    const chaser = spawnPirate('c', far(), { archetype: 'chaser' })
    const lancer = spawnPirate('l', far(), { archetype: 'lancer' })
    expect(stepPirate(chaser, origin, 0.016).fired).toBeNull()      // out of chaser range
    expect(stepPirate(lancer, origin, 0.016).fired).not.toBeNull()  // in lancer range
  })
  it('a lancer bolt carries the lancer damage + speed', () => {
    const l = spawnPirate('l', new Vector3(0, 0, 600), { archetype: 'lancer' })
    const r = stepPirate(l, origin, 0.016)
    expect(r.fired!.damage).toBe(ARCHETYPE_BEHAVIOR.lancer.damage)
    expect(r.fired!.velocity.length()).toBeCloseTo(ARCHETYPE_BEHAVIOR.lancer.projSpeed, 3)
  })
  it('a swarm unit closes faster than a chaser over the same step', () => {
    const start = new Vector3(0, 0, 500)
    const chaser = spawnPirate('c', start.clone(), { archetype: 'chaser' })
    const swarm = spawnPirate('s', start.clone(), { archetype: 'swarm' })
    stepPirate(chaser, origin, 0.5, 0)
    stepPirate(swarm, origin, 0.5, 0)
    expect(swarm.position.distanceTo(origin)).toBeLessThan(chaser.position.distanceTo(origin))
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/sim/pirates.test.ts`
Expected: FAIL — chaser still uses shared 320 range so the far chaser would behave per old constants (this test pins the per-archetype engage range and lancer projectile stats, which the old stepPirate doesn't honor).

- [ ] **Step 3: Rewrite `stepPirate`**

Replace the current `stepPirate` in `src/sim/pirates.ts` with (keep the `_toTarget` scratch vec):

```ts
export function stepPirate(pirate: Pirate, targetPos: Vector3, dt: number, nowSec = 0): PirateStepResult {
  const b = ARCHETYPE_BEHAVIOR[pirate.archetype]
  pirate.weapon.cooldown = Math.max(0, pirate.weapon.cooldown - dt)

  _toTarget.subVectors(targetPos, pirate.position)
  const dist = _toTarget.length()
  const dir = dist > 1e-6 ? _toTarget.clone().multiplyScalar(1 / dist) : new Vector3(0, 0, -1)

  let speed: number
  if (dist > b.engageRange) speed = b.speed
  else if (dist < b.standoff) speed = -b.speed * 0.6 // back off
  else speed = b.speed * 0.25 // hold and harass

  // Radial move toward/away from the target, plus a perpendicular weave strafe (chaser/swarm).
  pirate.velocity.copy(dir).multiplyScalar(speed)
  pirate.position.addScaledVector(pirate.velocity, dt)
  if (b.weaveAmp > 0) {
    const w = weaveOffset(nowSec, b.weaveAmp, b.weaveRate, pirate.seed, dir)
    pirate.position.addScaledVector(w, dt)
  }

  let fired: Projectile | null = null
  if (dist <= b.engageRange && pirate.weapon.cooldown <= 0) {
    fired = spawnProjectile(pirate.position, dir, 'pirate', b.projSpeed, b.damage) // aim stays straight at target
    pirate.weapon.cooldown = pirate.weapon.interval
  }
  return { fired }
}
```

- [ ] **Step 4: Update the caller in `src/main.ts`**

At `src/main.ts:4932`, change:
```ts
      const r = stepPirate(pirate, ship.position, dt)
```
to pass the frame time in seconds (there is a `now` in scope — `performance.now()`-based ms):
```ts
      const r = stepPirate(pirate, ship.position, dt, now / 1000)
```

- [ ] **Step 5: Run tests + tsc + build**

Run: `npx vitest run src/sim/pirates.test.ts && npx vitest run && npx tsc --noEmit && npm run build`
Expected: the new archetype tests pass; the EXISTING stepPirate tests (closes-in / backs-off / fires / aim `velocity.z < 0`) still pass (chaser uses legacy stats; weave is perpendicular so radial inequalities hold; aim is still `dir`); full suite green; tsc 0; build ok. If a legacy movement test fails due to weave, reduce `chaser.weaveAmp` until the radial inequality holds (do NOT change the aim logic).

- [ ] **Step 6: Commit**

```bash
git add src/sim/pirates.ts src/main.ts
git commit -m "feat(combat): stepPirate drives off archetype behavior + weave strafe"
```

---

## Task 5: Spawn side — weighted archetype roll + SWARM cluster

**Files:** Modify `src/main.ts` (`spawnPirateWave`)

- [ ] **Step 1: Add the import**

Extend the `./sim/pirates` import in `src/main.ts` to include `pickArchetype` and the type `PirateArchetype` (the import already brings `spawnPirate`, `PIRATE_TIER_*`, etc.):
```ts
import { type Pirate, type PirateArchetype, pickArchetype, PIRATE_REWARD, PIRATE_TIER_HULL_MUL, PIRATE_TIER_REWARD, shouldDespawnPirate, spawnPirate, spawnPositionAround, stepPirate } from './sim/pirates'
```

- [ ] **Step 2: Rewrite the spawn body**

Replace the body of `spawnPirateWave` (from the `const pos = spawnPositionAround(...)` line through the `addPirate(...)` line) with:

```ts
  // Deeper space: tankier pirates worth a bigger bounty. 25% of waves are elites (tier is orthogonal
  // to archetype: tier scales hull/reward, archetype drives behavior).
  const elite = Math.random() < 0.25
  const tier = elite ? ('elite' as const) : ('grunt' as const)
  const archetype = pickArchetype(Math.random)
  const tierHullMul = (elite ? PIRATE_TIER_HULL_MUL.elite : 1) * (1 + depth * 1.6)
  const reward = Math.round((elite ? PIRATE_TIER_REWARD.elite : PIRATE_REWARD) * (1 + depth * 2))
  // SWARM arrives as a cluster of fragile units; everything else is a single ship.
  const count = archetype === 'swarm' ? 4 + Math.round(depth * 2) : 1
  const cap = MAX_PIRATES + Math.round(depth * 2)
  for (let i = 0; i < count && pirates.length < cap; i++) {
    const pos = spawnPositionAround(ship.position, 600, pirateSpawnCount++)
    addPirate(spawnPirate(`pir-${pirateSpawnCount}`, pos, { hullMul: tierHullMul, reward, tier, archetype, seed: pirateSpawnCount * 0.13 }), pos)
  }
  void now
```

(Keep the guards above it — the `pirates.length >= MAX_PIRATES + ...` early-return, safe-zone, influence, `allowsPveHostiles` — unchanged.)

- [ ] **Step 3: tsc + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(combat): spawn a weighted archetype per wave; SWARM as a cluster"
```

---

## Task 6: Legibility — per-archetype nameplate + color in `addPirate`

**Files:** Modify `src/main.ts` (`addPirate`)

- [ ] **Step 1: Add an archetype color/label map**

Near `TIER_SCALE`/`TIER_EMISSIVE` (src/main.ts:2066), add:
```ts
const ARCHETYPE_ACCENT: Record<PirateArchetype, number> = { chaser: 0xff7a1a, lancer: 0x8ad8ff, swarm: 0xff5df0 }
const ARCHETYPE_LABEL: Record<PirateArchetype, string> = { chaser: 'CHASER', lancer: 'LANCER', swarm: 'SWARM' }
```

- [ ] **Step 2: Apply accent + always-on archetype plate in `addPirate`**

In `addPirate`, use the archetype accent for the mesh base color, and give EVERY pirate a nameplate that names its archetype (elites/named still emphasized). Change the mesh color line:
```ts
  const mesh = buildCraft('interceptor', ARCHETYPE_ACCENT[pirate.archetype])
```
And replace the elite/named-only label block with one that always labels the archetype and folds in the tier:
```ts
  // Every pirate gets a small plate naming its archetype so the player can pick the right fire mode;
  // elites/named are emphasized (kept class + boss name).
  const el = document.createElement('div')
  el.className = pirate.tier === 'named' ? 'enemyplate named' : 'enemyplate'
  const tierPrefix = pirate.tier === 'named' ? (pirate.name ?? 'RAIDER').toUpperCase() : pirate.tier === 'elite' ? 'ELITE ' : ''
  enemyLabelParts(el).name.textContent = pirate.tier === 'named' ? tierPrefix : `${tierPrefix}${ARCHETYPE_LABEL[pirate.archetype]}`
  const labelObj = new CSS2DObject(el)
  labelObj.position.copy(pos)
  labelObj.position.y += 3.2 * scale
  scene.add(labelObj)
  pirateLabels.set(pirate.id, labelObj)
```
(Remove the old `if (pirate.tier === 'elite' || pirate.tier === 'named') { ... }` wrapper — the plate is now unconditional. Keep the `loadPirateModel().then(...)` swap below unchanged EXCEPT the tint: keep `if (emissive !== null) tintModel(...)` as-is for tier emissive.)

Note: swarm spawns many labels — that's fine (small plates), but if it reads busy in playtest, a later tweak can suppress plates for `swarm`. Leave as-is for now (legibility first).

**Check the per-frame label sync:** labels are now added for EVERY pirate (previously only elite/named). Find the pirate update loop that syncs `pirateLabels` positions + hull bars each frame and confirm it iterates `pirateLabels` generically (so grunts/swarm now get their plate position + hull bar synced too) — it should already, since it keys off the `pirateLabels` map. If any branch there is gated on `tier === 'elite' || 'named'`, widen it so all labels sync. Also confirm the removal path (`removePirate`/despawn) already deletes from `pirateLabels` for all pirates (it keys off the map, so it does).

- [ ] **Step 3: tsc + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build ok.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(combat): per-archetype nameplate + accent color (legibility)"
```

---

## Task 7: Verification (playtest / headless)

**Files:** none

- [ ] **Step 1: Build + run locally**

```bash
DEV_SKIP_LAUNCH_GATE=1 npm run server &   # relay :8080
npm run dev &                             # vite
```
Open the dev URL, LAUNCH (dev bypass), fly into deep space (away from the safe zone) to trigger `spawnPirateWave`.

- [ ] **Step 2: Confirm the three archetypes**

Over a few waves confirm: CHASER closes and strafes (weaves), LANCER hangs back and lands slow heavy bolts, a SWARM cluster of fast fragile units appears. Each shows its nameplate (CHASER/LANCER/SWARM, with ELITE prefix on elites) and accent color. Verify the fire modes answer them (SCATTER clears a swarm; HEAVY one-shots lancers; RAPID tracks chasers).

- [ ] **Step 3: Stop servers**

```bash
kill %1 %2 2>/dev/null || true
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → 0
- [ ] `npx vitest run` → all pass (incl. new pirate archetype/weave tests; existing stepPirate tests still green)
- [ ] `npm run build` → ok
- [ ] Playtest (Task 7): three distinct behaviors, legible, answered by different fire modes; CHASER stats == legacy (no balance regression).
