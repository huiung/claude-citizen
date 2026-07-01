# Combat Depth II — Enemy Behavior Archetypes — Design

**Date:** 2026-07-01
**Status:** Design approved (pending written-spec review)
**Context:** Combat Depth I gave the player three right-click fire modes (RAPID / HEAVY / SCATTER), but every enemy still uses one identical AI (close → standoff → straight fire), differing only in hull/reward by tier. So the fire modes have nothing to respond to. This adds an **enemy behavior axis** — three archetypes that map 1:1 to the fire modes as a rock-paper-scissors — so fights read differently and reward picking the right mode.

---

## 1. Why

The fire-mode variety only matters if enemies demand different responses. Today they don't. Giving pirates distinct *behaviors* (not just more hull) makes each encounter legible and tactical: a swarm wants SCATTER, a long-range lancer wants HEAVY, an agile chaser wants RAPID. It's the enemy-side complement to the player-side depth already shipped.

---

## 2. Scope

### In scope
- `src/sim/pirates.ts`: a `PirateArchetype` type, an `ARCHETYPE_BEHAVIOR` params table, an `archetype` field on `Pirate`, `stepPirate` driving off the archetype's params (CHASER defaults reproduce today's behavior), and a pure weave-offset helper. Unit-tested.
- `src/main.ts` spawn side: `spawnPirateWave` rolls a weighted archetype (orthogonal to the existing grunt/elite tier roll); SWARM spawns a small cluster; per-archetype nameplate label + color for legibility.
- Extend `src/sim/pirates.test.ts`.

### Out of scope
- No new combat mechanic (no shields, no armor facing, no status effects).
- No change to the player weapon / fire modes, economy, gating, or networking.
- The showcase bot doesn't fight PvE pirates — unchanged.
- The campaign named raider keeps its current behavior (CHASER).

---

## 3. The three archetypes

`archetype` governs BEHAVIOR only; `tier` (grunt/elite/named) independently scales hull/reward/scale as today. They are orthogonal — the spawner picks both.

| Archetype | Behavior | Per-unit hull | Counter mode |
|---|---|---|---|
| **CHASER** (default; absorbs today's straight-in pirate) | Closes aggressively; weaves laterally while harassing; short standoff | standard | RAPID (track it) / SCATTER up close |
| **LANCER** | Holds long range (large engage + standoff); slow, accurate, high-damage, fast bolts; low hull | low | HEAVY (long-range chunk) / close the gap fast |
| **SWARM** | Fast, low-hull units that buzz in a cluster; each trivial, dangerous in numbers | very low | SCATTER (cone hits several) |

Threat is roughly tier-equivalent across archetypes — archetype changes *how* they threaten, not raw power (mirrors the fire-mode equal-DPS philosophy). All numbers below are live-tunable starting values.

---

## 4. Module: `src/sim/pirates.ts`

```ts
export type PirateArchetype = 'chaser' | 'lancer' | 'swarm'

export interface ArchetypeBehavior {
  engageRange: number   // start shooting within this distance
  standoff: number      // try to hold this distance; back off if closer
  speed: number         // cruise speed
  fireInterval: number  // seconds between shots
  damage: number        // per-shot damage
  projSpeed: number     // projectile speed
  hullMul: number       // per-unit hull multiplier vs PIRATE_HULL (before tier hullMul)
  weaveAmp: number      // lateral weave amplitude (0 = none)
  weaveRate: number     // weave oscillations/sec
}

// CHASER == today's constants so existing behavior is unchanged when unspecified.
export const ARCHETYPE_BEHAVIOR: Record<PirateArchetype, ArchetypeBehavior> = {
  chaser: { engageRange: 320, standoff: 120, speed: 55,  fireInterval: 1.1, damage: 7,  projSpeed: 300, hullMul: 1,    weaveAmp: 28, weaveRate: 0.9 },
  lancer: { engageRange: 900, standoff: 700, speed: 40,  fireInterval: 2.4, damage: 20, projSpeed: 620, hullMul: 0.6,  weaveAmp: 0,  weaveRate: 0   },
  swarm:  { engageRange: 260, standoff: 70,  speed: 95,  fireInterval: 0.9, damage: 4,  projSpeed: 300, hullMul: 0.35, weaveAmp: 40, weaveRate: 1.6 },
}
```

- `Pirate` gains `archetype: PirateArchetype` and `seed: number` (a per-unit weave phase so units don't strafe in sync — derive it from the spawn index passed to `spawnPirate`). `spawnPirate` accepts `opts.archetype` (default `'chaser'`) and applies `ARCHETYPE_BEHAVIOR[archetype]`: sets `weapon = createWeapon(behavior.fireInterval)` and folds `behavior.hullMul` into the health max (alongside the existing tier `hullMul`).
- **`stepPirate`** reads the pirate's archetype behavior instead of the module-level `PIRATE_*` constants:
  - `engageRange`/`standoff`/`speed`/`projSpeed`/`damage`/interval all come from the behavior.
  - The close/standoff/back-off logic is unchanged in shape; only the thresholds/values are per-archetype.
  - **Weave (CHASER/SWARM):** when `weaveAmp > 0`, add a **perpendicular** (tangential) offset to the movement via a pure helper `weaveOffset(nowSec, amp, rate, seed)`, so the unit strafes instead of flying a straight line. The weave perturbs MOVEMENT only — the unit still AIMS its bolt straight at the target (so firing/aim is unchanged). LANCER (`weaveAmp 0`) flies straight. CHASER gains a modest weave vs today's straight-in grunt — an intentional motion upgrade; the no-regression guard covers the STAT params (engage/standoff/speed/fire/damage/proj/hull), not the new weave. `stepPirate` needs an elapsed/`nowSec` input for the weave phase — add a `nowSec` parameter (pirates carry a per-unit phase `seed` so they don't all weave in sync).
  - **LANCER holds range:** with large `engageRange`/`standoff`, it fires from far and backs off when the player closes — naturally the "sniper" feel. Low hull means closing or a HEAVY bolt kills it fast.
- Keep the existing `PIRATE_*` constants as the CHASER source of truth (referenced by the `chaser` row) so nothing else that imports them breaks.
- `stepPirate` signature grows an **optional** `nowSec = 0` arg (the game caller passes `now/1000`; the default keeps existing 3-arg calls/tests compiling — weave just sits at phase 0). Pure weave helper `weaveOffset(...)` is unit-tested.

---

## 5. Spawn side: `src/main.ts`

- In `spawnPirateWave`, after the existing tier roll, roll a **weighted archetype**: CHASER 50% / LANCER 30% / SWARM 20% (tunable). A small pure helper `pickArchetype(rng)` (in pirates.ts) keeps it testable.
- **SWARM = cluster:** when the roll is `swarm`, spawn N units (e.g. 4 + up to 2 by depth) around the spawn point (reuse `spawnPositionAround` with successive indices), each `archetype:'swarm'`. Non-swarm rolls spawn a single unit as today. Respect the existing `MAX_PIRATES` cap (count the cluster against it; trim N to fit).
- Pass `archetype` into `spawnPirate` alongside the existing `hullMul`/`reward`/`tier`.
- The campaign `maybeSpawnNamedRaider` passes `archetype:'chaser'` (unchanged behavior).

### Legibility (nameplate + color)
The player must identify the archetype at a glance to pick the right mode. In the pirate mesh/label builder (`addPirate` and the enemyplate code):
- Give each archetype a distinct **bolt/mesh accent color** (e.g. CHASER orange as today, LANCER cyan-white, SWARM magenta) layered on top of the tier emissive.
- The nameplate shows the archetype: e.g. `CHASER` / `LANCER` / `SWARM` (elites still read `ELITE`, named still shows the boss name — combine as `ELITE LANCER` where both apply, or keep tier label primary + archetype as the accent color if the plate is tight). Exact label format decided in the plan; the requirement is the archetype is visually distinguishable.

---

## 6. Balance

- Per-tier threat stays roughly comparable; archetype shifts the threat *shape*. LANCER: high per-hit + range, low hull (rewards HEAVY / closing). SWARM: low per-unit but many + fast (rewards SCATTER). CHASER: balanced baseline (rewards RAPID).
- SWARM cluster total hull ≈ a single grunt so it isn't a bullet sponge; the danger is spread fire, not tankiness.
- All values in `ARCHETYPE_BEHAVIOR` + the spawn weights are starting points for live tuning.

---

## 7. Testing

- `src/sim/pirates.test.ts`:
  - `ARCHETYPE_BEHAVIOR`: CHASER row equals the legacy `PIRATE_*` constants (no-regression guard); LANCER engageRange > CHASER; SWARM speed > CHASER; hull order swarm < lancer < chaser.
  - `spawnPirate` applies the archetype (weapon interval, hull) and defaults to chaser.
  - `stepPirate` per archetype: LANCER fires while still far (at a distance where a chaser wouldn't yet be in range) and holds range; CHASER/SWARM close faster; a fired projectile carries the archetype's damage/speed. Existing straight-in expectations hold for CHASER (with the new `nowSec` arg passed).
  - `weaveOffset`: perpendicular to forward, bounded by `amp`, oscillates with `rate`, deterministic per `seed`; amp 0 → zero offset.
  - `pickArchetype(rng)`: weight boundaries map to the expected archetype; returns a valid archetype for rng in [0,1).
- Spawn/cluster/nameplate wiring is loop/DOM — verified by real playtest (or headless): CHASER weaves, LANCER snipes from range, a SWARM cluster appears and SCATTER clears it. `tsc` + full `vitest` + `build` stay green.

---

## 8. Success criteria

Pirate encounters vary by archetype: chasers weave in close, lancers snipe from range with heavy bolts, swarms arrive as fast clusters — each visually identifiable (color + nameplate) and each best answered by a different fire mode. Tiers still scale toughness/reward orthogonally. No new mechanic, no change to the player weapon/economy/gating, CHASER reproduces today's pirate so nothing regresses.
