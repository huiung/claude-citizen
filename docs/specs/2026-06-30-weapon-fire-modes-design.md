# Weapon Fire Modes — Right-Click Combat Revamp — Design

**Date:** 2026-06-30
**Status:** Design approved (pending written-spec review)
**Context:** The right-click weapon is a single mode — hold to spray forward bolts. It feels monotonous. Add depth via three switchable **fire modes** (RAPID / HEAVY / SCATTER) selectable with the number keys, applied in both PvE and PvP. The three modes have **equal nominal DPS** — the variety is situational (hit profile, per-hit chunk, area), not power creep.

---

## 1. Why

Combat is one-note: every engagement is the same held-right-click bolt stream. Fire modes give the player a fast, readable choice that changes how an engagement plays without adding a new resource system to balance or a new input device. It also reads well on footage (visibly different projectile patterns) and gives the showcase bot something to vary.

---

## 2. Scope

### In scope
- A pure `src/sim/fireModes.ts` module: the three mode profiles + pure helpers (`cycleMode`, `modeById`, `resolveShot`, `spreadDirections`), unit-tested.
- `main.ts` integration: mode state (persisted), input handlers (Digit1/2/3 select, KeyQ cycle), the firing block applying the active mode to whichever base weapon is active (PvE or PvP), and a small HUD indicator.
- `index.html`: a compact HUD element + CSS for the mode indicator.
- (Optional, separable task) the `?bot=1` showcase bot varies its fire mode during `pvp-training` for footage.

### Out of scope
- No new resource (heat/energy), cooldown ability, or loadout/shipyard system.
- No change to the left-click mining laser.
- No change to the projectile/hit-resolution system itself (only the number of projectiles per volley grows for SCATTER).
- No change to per-ship PvP balance values (`pvpWeaponForShip`) — modes are multipliers layered on top, DPS-neutral.
- No scroll-wheel binding (the wheel already drives camera zoom — see §5).

---

## 3. The three modes

A `FireMode` is a multiplier profile applied to a **base weapon** `{ interval, damage, speed }`. Equal nominal DPS = `pellets × damageMul ÷ intervalMul` ≈ 1.0 for all three (all pellets assumed to hit).

| Mode | `intervalMul` | `damageMul` | `pellets` | `spreadRad` | `speedMul` | Nominal DPS | Character |
|---|---|---|---|---|---|---|---|
| **RAPID** (default) | 1.0 | 1.0 | 1 | 0 | 1.0 | 1.0 | All-purpose bolt stream (today's weapon) |
| **HEAVY** | 2.2 | 2.2 | 1 | 0 | 1.25 | 1.0 | Slow, heavy single bolt; faster projectile → easier long-range / high-hull hits. Missing hurts. |
| **SCATTER** | 1.0 | 0.25 | 4 | ~0.07 (≈4°) | 0.9 | 1.0 | 4-pellet cone; close-range / swarms. At range some pellets miss → lower effective DPS. |

- DPS parity check: RAPID `1×1.0/1.0 = 1.0`; HEAVY `1×2.2/2.2 = 1.0`; SCATTER `4×0.25/1.0 = 1.0`. ✓
- These numbers are **starting values for live tuning**, not final balance.
- SCATTER's niche is area/forgiveness (hits multiple swarming targets, easier partial hits on a juking target) — against a single distant target it is intentionally weaker than RAPID.
- HEAVY's niche is the big per-hit chunk + flatter long-range aim (higher projectile speed); its low fire rate punishes misses.

---

## 4. Module: `src/sim/fireModes.ts` (pure, unit-tested)

```ts
export type FireModeId = 'rapid' | 'heavy' | 'scatter'

export interface FireMode {
  id: FireModeId
  label: string          // 'RAPID' | 'HEAVY' | 'SCATTER' (HUD)
  intervalMul: number
  damageMul: number
  pellets: number
  spreadRad: number      // half-angle of the cone; 0 = no spread
  speedMul: number
}

export interface BaseWeapon { interval: number; damage: number; speed: number }
export interface ResolvedShot { interval: number; damage: number; pellets: number; spreadRad: number; speed: number }

export const FIRE_MODES: FireMode[]            // ordered [rapid, heavy, scatter]
export function modeById(id: FireModeId): FireMode
export function cycleMode(id: FireModeId, dir: 1 | -1): FireModeId   // wraps
export function resolveShot(base: BaseWeapon, mode: FireMode): ResolvedShot
//   interval = base.interval * mode.intervalMul
//   damage   = base.damage   * mode.damageMul
//   speed    = base.speed    * mode.speedMul
//   pellets, spreadRad = mode.pellets, mode.spreadRad
export function spreadDirections(forward: THREE.Vector3, pellets: number, spreadRad: number, rng: () => number): THREE.Vector3[]
//   pellets === 1 → [forward.normalized]; otherwise pellets unit vectors fanned within spreadRad of forward
//   (even fan around the forward axis + small per-pellet jitter from rng), each normalized.
```

`resolveShot` and the profiles are framework-free numbers; `spreadDirections` uses `THREE.Vector3` (already a project dep) and an injected `rng` so it is deterministic under test.

---

## 5. `main.ts` integration

**State:**
- `let fireModeId: FireModeId` initialized from `localStorage.getItem('scc.fireMode')` (validated against `FIRE_MODES`; fallback `'rapid'`).
- A `setFireMode(id)` helper that updates state, persists to localStorage, refreshes the HUD, and `audio.blip('nav')`.

**Input** (in the existing `keydown` handler at ~3209, after the menu/chat guards, gated on `running && !docked && !spectating`, and skipped when `chatOpen` / map / panels are open — the handler already early-returns for those):
- `e.code === 'Digit1' | 'Digit2' | 'Digit3'` → `setFireMode('rapid' | 'heavy' | 'scatter')`.
- `e.code === 'KeyQ'` → `setFireMode(cycleMode(fireModeId, 1))`.
- The scroll wheel is **not** used (the `wheel` listener at ~3311 already drives camera zoom; adding mode-cycling there would conflict).

**Firing** (replace the single-projectile block at ~4814):
```ts
const mode = modeById(fireModeId)
const base = combatWeaponActive
  ? { interval: pvpWeapon.interval, damage: pvpWeapon.damage, speed: PROJECTILE_SPEED }
  : { interval: 0.16, damage: PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus, speed: PROJECTILE_SPEED }
const shot = resolveShot(base, mode)
playerWeapon.interval = shot.interval
stepWeapon(playerWeapon, dt)
if (weaponActive && canFire(playerWeapon)) {
  _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
  for (const dir of spreadDirections(_fwd, shot.pellets, shot.spreadRad, Math.random)) {
    projectiles.push(spawnProjectile(ship.position, dir, 'player', shot.speed, shot.damage, ship.velocity))
  }
  fireWeapon(playerWeapon)
  audio.blip('fire')
}
```
- The PvE base preserves today's behavior exactly when mode = RAPID (interval 0.16, damage `12 + levelBonus`, 1 bolt). The pilot weapon-damage bonus is added to `base.damage` **before** the mode multiplier, so HEAVY/SCATTER scale the bonus too.
- The bot's mining/`weaponActive` overrides are unchanged; the bot fires through this same block, so it inherits whatever `fireModeId` is set (default RAPID unless the optional showcase task sets it).

**HUD:** a compact indicator near the crosshair/existing HUD: `1 RAPID · 2 HEAVY · 3 SCATTER` with the active mode highlighted. New element + CSS in `index.html`, styled to match existing HUD tone; updated by `setFireMode` and on launch. Hidden on the landing / while docked like other flight HUD chrome.

---

## 6. Showcase bot (optional, separable task)

During a `pvp-training` leg the bot picks a fire mode (e.g. SCATTER against the drone cluster, or rotate per leg) so footage shows the modes in action. Keep it light — a single `setFireMode(...)` when the spar phase begins, optionally a one-line chat. Implemented as its own task so it can be dropped without affecting the player feature. The bot's economy/gating is unchanged.

---

## 7. Balance & risk

- **No power creep:** modes are DPS-neutral multipliers on the existing base (PvE or per-ship PvP), so no ship becomes stronger — only the hit-distribution changes. Counterplay (dodge HEAVY's slow cadence; stay at range vs SCATTER) emerges naturally.
- **PvP:** `pvpWeaponForShip` values are untouched; HEAVY's 2.2× per-hit chunk is the main thing to watch in duels (burst feel) — conservative starting mults, tune live.
- **Projectile count:** SCATTER quadruples projectiles per volley for the player only; negligible against existing projectile budgets (pirates already spawn many). No change to `stepProjectiles`/`resolveHits`.

---

## 8. Testing

- `src/sim/fireModes.test.ts`:
  - DPS parity: `pellets × damageMul / intervalMul` ≈ 1.0 for every mode (tolerance).
  - `cycleMode` wraps both directions and never returns a non-existent id.
  - `resolveShot` scales interval/damage/speed by the mode and copies pellets/spread.
  - `spreadDirections`: returns exactly `pellets` unit vectors; all within `spreadRad` of forward; `pellets === 1` returns forward exactly; deterministic under a fixed `rng`.
- `main.ts` integration (input/HUD/firing) is DOM/loop wiring — verified manually + via the `?bot=1` headless harness (confirm the bot still fires and switching a mode changes projectile count/cadence). `tsc` + full `vitest` + `build` stay green.

---

## 9. Success criteria

In flight, pressing 1/2/3 (or Q to cycle) switches fire mode, the HUD reflects it, and the choice persists across sessions. RAPID is the current weapon unchanged. HEAVY fires slow heavy bolts; SCATTER fires a 4-pellet cone. Modes work in PvE and PvP with no ship gaining raw power. The change is isolated behind a pure, tested module; the projectile/hit systems are untouched.
