# Combat Finish — Named Boss Abilities — Design

**Date:** 2026-07-01
**Status:** Design approved (pending written-spec review)
**Context:** The campaign named minibosses (Vex Marrow, then the Raider Captain) are currently just tankier CHASER pirates — no signature behavior, so the fights aren't events. This gives each boss a distinct ability kit (reusing existing systems — no new mechanic) plus a shared low-hull enrage, turning the two miniboss kills into real encounters. Caps the enemy-archetype arc.

---

## 1. Why

Combat Depth I (fire modes) + II (archetypes) made moment-to-moment fights tactical. The campaign bosses are the set-pieces, but today they play like a bigger grunt. A small, telegraphed ability kit — adds, a dodgeable heavy volley, an enrage — makes them memorable without a new mechanic (adds reuse the swarm spawn, volley reuses projectiles, enrage is a stat tweak).

---

## 2. Scope

### In scope
- `src/sim/pirates.ts`: a `BossAbility`/`BossKit` model + `BOSS_KITS`, an optional `boss` runtime on `Pirate`, boss logic folded into `stepPirate` (gated on `pirate.boss`, zero cost for normal pirates), and an extended `PirateStepResult` carrying ability events. Pure + unit-tested.
- `src/main.ts`: `maybeSpawnNamedRaider` tags each boss with its kit + a base archetype; the pirate step-result consumer applies the events (spawn swarm adds, push the volley, telegraph/enrage cue).
- Extend `src/sim/pirates.test.ts`.

### Out of scope
- Only the two campaign named bosses. Elites/grunts unchanged.
- No new mechanic (no shields, no new resource). Adds = existing swarm spawn; volley = existing projectiles; enrage = stat modulation.
- No change to player weapon/economy/gating/networking.

---

## 3. The two bosses

Each boss keeps a **base archetype** (movement, from Combat Depth II) + a **boss kit** (a timed ability + enrage).

| Boss | Campaign step | Base archetype | Signature ability | Enrage (< hull frac) |
|---|---|---|---|---|
| **Vex Marrow** (first, lighter) | `s1-wanted` | CHASER (weaves in) | **Summon** — periodically calls in a small SWARM add cluster | faster fire + speed below 35% |
| **Raider Captain** (second, heavier) | `s1-captain` | LANCER (holds range, heavy bolts) | **Volley** — a brief telegraph, then a fan of heavy bolts | faster fire + speed below 35% |

- Vex-as-CHASER teaches SCATTER (adds) + tracking. Captain-as-LANCER teaches HEAVY / closing + dodging the telegraphed volley. Both compose with the archetype system already shipped.
- Values below are live-tunable starting points.

---

## 4. Module: `src/sim/pirates.ts`

```ts
export type BossAbility = 'summon' | 'volley'

export interface BossKit {
  ability: BossAbility
  abilityIntervalSec: number  // seconds between ability uses
  telegraphSec: number        // volley windup before the burst (0 for summon)
  volleyBolts: number         // fan count for 'volley'
  volleySpreadRad: number     // half-angle of the volley fan
  summonCount: number         // swarm adds for 'summon'
  enrageAtHullFrac: number    // enrage when hullFraction < this
  enrageFireMul: number       // ability-interval + weapon-interval multiplier when enraged (<1 = faster)
  enrageSpeedMul: number      // speed multiplier when enraged (>1 = faster)
}

// Keyed by a boss key set at spawn.
export const BOSS_KITS: Record<'vex' | 'captain', BossKit> = {
  vex:     { ability: 'summon', abilityIntervalSec: 9,  telegraphSec: 0,   volleyBolts: 0, volleySpreadRad: 0,    summonCount: 3, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
  captain: { ability: 'volley', abilityIntervalSec: 6.5, telegraphSec: 0.8, volleyBolts: 5, volleySpreadRad: 0.16, summonCount: 0, enrageAtHullFrac: 0.35, enrageFireMul: 0.6, enrageSpeedMul: 1.3 },
}

export interface BossRuntime {
  kit: BossKit
  abilityCd: number      // seconds until the next ability use (counts down by dt)
  telegraphCd: number    // >0 while a volley windup is in progress; fires the burst when it crosses 0
  enraged: boolean
}
```

- `Pirate` gains `boss?: BossRuntime` (only named bosses have it). `SpawnPirateOpts` gains `bossKey?: 'vex' | 'captain'`; when set, `spawnPirate` attaches `{ kit: BOSS_KITS[bossKey], abilityCd: kit.abilityIntervalSec, telegraphCd: 0, enraged: false }`.
- **Extended result:**
```ts
export interface PirateStepResult {
  fired: Projectile | null
  volley?: Projectile[]     // a boss volley burst emitted this step
  telegraphStart?: boolean  // a volley windup began this step (one-shot cue)
  summon?: number           // spawn this many swarm adds around the boss this step
}
```
- **`stepPirate` boss layer** (runs only when `pirate.boss` is set, after the normal move/fire):
  - **Enrage:** `enraged = hullFraction(health) < kit.enrageAtHullFrac`. When enraged, the boss's effective speed is `× enrageSpeedMul` and its weapon/ability intervals are `× enrageFireMul` (faster). Set `boss.enraged` (main.ts reads it for a one-time banner + tint).
  - **Ability timer:** `boss.abilityCd -= dt`. When `<= 0`:
    - `summon`: return `summon: kit.summonCount`; reset `abilityCd = kit.abilityIntervalSec × (enraged ? enrageFireMul : 1)`.
    - `volley`: begin the windup — set `boss.telegraphCd = kit.telegraphSec`, return `telegraphStart: true`; reset `abilityCd` as above.
  - **Volley fire:** if `boss.telegraphCd > 0`, decrement by dt; when it crosses `<= 0`, emit `volley`: `kit.volleyBolts` projectiles fanned within `kit.volleySpreadRad` of the aim direction (reuse `spreadDirections` + `spawnProjectile` at the archetype's projSpeed/damage). Only one volley per windup.
  - The normal per-frame `fired` single shot still happens (bosses also plink between abilities).
- Non-boss pirates: `pirate.boss` undefined → the boss block is skipped entirely (no result fields set) — zero behavior change for grunts/elites/archetypes.

---

## 5. `src/main.ts`

- **`maybeSpawnNamedRaider`:** pass a base archetype + boss key:
  - Vex Marrow (`step.id === 's1-wanted'` / not captain): `{ tier:'named', name, archetype:'chaser', bossKey:'vex', hullMul, reward }`.
  - Raider Captain (`s1-captain`): `{ tier:'named', name, archetype:'lancer', bossKey:'captain', hullMul, reward }`.
- **Step-result consumer** (the `for (const pirate of pirates)` loop that already does `if (r.fired) projectiles.push(r.fired)`):
  - `if (r.volley) projectiles.push(...r.volley)`.
  - `if (r.telegraphStart) { registerKillBanner(combatFeedback, '⚠ INCOMING VOLLEY', pirate.name ?? 'RAIDER', now); audio.blip('nav') }` — a brief warning cue so the player can dodge.
  - `if (r.summon) { spawn r.summon swarm adds near the boss — reuse spawnPirate('swarm') + addPirate, positioned around pirate.position; respect the pirate cap with headroom like the swarm wave; a one-time banner 'Vex Marrow calls in raiders' + audio.blip }`.
  - Enrage cue: when a boss's `boss.enraged` flips true (track a per-boss `enragedAnnounced` or read a transition), fire a one-time `registerKillBanner(..., 'ENRAGED', name, now)` + optional emissive/tint bump on the mesh. (Simple one-shot; no per-frame spam.)
- Adds spawned by summon are normal swarm pirates (die, count toward kills/reward as usual). They must be cleaned up on the boss's death only if desired — simplest: they persist as independent pirates and despawn via the normal leash/kill paths (no special coupling).

---

## 6. Balance / feel

- Enrage at 35% hull ratchets the final third of the fight. `enrageFireMul 0.6` (fires ~1.7× as often) + `enrageSpeedMul 1.3`.
- Vex's summon (3 adds / 9s) keeps pressure and rewards SCATTER; the adds are fragile swarm units, not tank walls.
- Captain's volley (5-bolt fan after a 0.8s telegraph) is a dodge check; the telegraph + banner make it fair. Captain-as-LANCER already fires heavy single bolts between volleys.
- All numbers tunable. Bosses still bypass the pirate count cap (as today); summon adds use the swarm-style cap headroom so they actually appear.

---

## 7. Testing

- `src/sim/pirates.test.ts`:
  - `BOSS_KITS`: vex = summon, captain = volley with telegraph > 0 and volleyBolts > 1.
  - `spawnPirate` with `bossKey` attaches a `boss` runtime (kit, abilityCd initialized, enraged false); without it, `boss` is undefined.
  - `stepPirate` summoner: after `abilityIntervalSec` of stepping, one step returns `summon === kit.summonCount`, then the timer resets (next summon only after another interval).
  - `stepPirate` gunner: after the interval a step returns `telegraphStart === true` and no volley yet; after a further `telegraphSec`, a step returns `volley` with `volleyBolts` projectiles (each `faction 'pirate'`, damage/speed from the lancer archetype), and only once per windup.
  - Enrage: below `enrageAtHullFrac` the boss's ability interval shortens (e.g. two summons happen faster than at full hull) and `boss.enraged` is true; at full hull it is false.
  - No-regression: a non-boss pirate's `stepPirate` result has no `volley`/`summon`/`telegraphStart` and behaves exactly as before (existing tests hold).
- main.ts wiring (spawn tagging, add-spawn, banners/audio, enrage tint) is loop/DOM — verified by playtest: fight Vex (adds appear, SCATTER clears them, enrage at low hull) and the Captain (telegraph → dodge the fan, HEAVY trades). `tsc` + full `vitest` + `build` green.

---

## 8. Success criteria

The two campaign bosses fight distinctly: Vex Marrow weaves and summons swarm adds; the Raider Captain snipes and unleashes a telegraphed heavy volley; both enrage in their final third. Each uses only existing systems (swarm spawn, projectiles, stat modulation) and composes with the archetype + fire-mode layers. Normal pirates are unaffected; no new mechanic or player/economy/gating change.
