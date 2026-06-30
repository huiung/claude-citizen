# Weapon Fire Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three switchable, DPS-equal right-click fire modes (RAPID / HEAVY / SCATTER) selectable with number keys 1/2/3, applied in both PvE and PvP, with a HUD indicator and persistence.

**Architecture:** A new pure module `src/sim/fireModes.ts` holds the mode profiles and pure helpers (`cycleMode`, `modeById`, `resolveShot`, `spreadDirections`) — fully unit-tested. `src/main.ts` wires it in: mode state persisted to localStorage, a Digit1/2/3 keydown branch, the firing block resolving the active mode against whichever base weapon applies (PvE flat / PvP per-ship), a HUD element in `index.html` updated on change, and (optional, separable) the showcase bot rotating modes during PvP training.

**Tech Stack:** TypeScript, Three.js (`THREE.Vector3`), Vite, Vitest. Server/relay untouched.

**Spec:** `docs/specs/2026-06-30-weapon-fire-modes-design.md`

---

## File Structure

- **Create** `src/sim/fireModes.ts` — pure mode profiles + helpers. One responsibility: turn a base weapon + a mode id into a resolved shot and the spread directions for it. No DOM, no game state.
- **Create** `src/sim/fireModes.test.ts` — unit tests for the module.
- **Modify** `src/main.ts` — import the module; add `fireModeId` state + `setFireMode`; add the Digit1/2/3 keydown branch; replace the single-projectile firing block with a mode-resolved multi-pellet block; grab + update the HUD element. (Optional Task 5: bot mode rotation.)
- **Modify** `index.html` — add the `#fire-mode` HUD element inside `#hud` and its CSS; add a help-line entry.

**Conventions observed in this codebase (follow them):**
- Tests use Vitest with `import { describe, it, expect } from 'vitest'`. Run a single file with `npx vitest run src/sim/fireModes.test.ts`.
- `main.ts` keyboard handling uses `e.code` (e.g. `'Digit1'`, `'KeyV'`), not `e.key`.
- HUD elements live in `index.html` under `#hud` (hidden until launch) and are grabbed in `main.ts` via `document.getElementById('id')!`.
- The full suite must stay green: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

## Task 1: Pure fire-modes module — profiles, `modeById`, `cycleMode`, `resolveShot`

**Files:**
- Create: `src/sim/fireModes.ts`
- Test: `src/sim/fireModes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sim/fireModes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FIRE_MODES, modeById, cycleMode, resolveShot, type FireModeId } from './fireModes'

describe('FIRE_MODES', () => {
  it('has exactly rapid, heavy, scatter in order', () => {
    expect(FIRE_MODES.map((m) => m.id)).toEqual(['rapid', 'heavy', 'scatter'])
  })

  it('every mode has equal nominal DPS (pellets * damageMul / intervalMul ≈ 1)', () => {
    for (const m of FIRE_MODES) {
      const dps = (m.pellets * m.damageMul) / m.intervalMul
      expect(dps).toBeCloseTo(1, 5)
    }
  })

  it('rapid is the identity profile', () => {
    const r = modeById('rapid')
    expect(r).toMatchObject({ intervalMul: 1, damageMul: 1, pellets: 1, spreadRad: 0, speedMul: 1 })
  })

  it('scatter fires multiple pellets in a cone; heavy is a single un-spread bolt', () => {
    expect(modeById('scatter').pellets).toBeGreaterThan(1)
    expect(modeById('scatter').spreadRad).toBeGreaterThan(0)
    expect(modeById('heavy').pellets).toBe(1)
    expect(modeById('heavy').spreadRad).toBe(0)
  })
})

describe('modeById', () => {
  it('returns the matching mode', () => {
    expect(modeById('heavy').id).toBe('heavy')
  })
  it('falls back to rapid for an unknown id', () => {
    expect(modeById('nonsense' as FireModeId).id).toBe('rapid')
  })
})

describe('cycleMode', () => {
  it('cycles forward with wrap', () => {
    expect(cycleMode('rapid', 1)).toBe('heavy')
    expect(cycleMode('heavy', 1)).toBe('scatter')
    expect(cycleMode('scatter', 1)).toBe('rapid')
  })
  it('cycles backward with wrap', () => {
    expect(cycleMode('rapid', -1)).toBe('scatter')
    expect(cycleMode('scatter', -1)).toBe('heavy')
  })
})

describe('resolveShot', () => {
  const base = { interval: 0.16, damage: 12, speed: 1400 }
  it('scales interval, damage, speed by the mode and carries pellets/spread', () => {
    const heavy = resolveShot(base, modeById('heavy'))
    expect(heavy.interval).toBeCloseTo(0.16 * 2.2, 6)
    expect(heavy.damage).toBeCloseTo(12 * 2.2, 6)
    expect(heavy.speed).toBeCloseTo(1400 * 1.25, 6)
    expect(heavy.pellets).toBe(1)
    expect(heavy.spreadRad).toBe(0)
  })
  it('rapid resolves to the base weapon unchanged', () => {
    const r = resolveShot(base, modeById('rapid'))
    expect(r).toEqual({ interval: 0.16, damage: 12, speed: 1400, pellets: 1, spreadRad: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/fireModes.test.ts`
Expected: FAIL — `Cannot find module './fireModes'` / exports undefined.

- [ ] **Step 3: Implement the module (no spread helper yet — Task 2 adds it)**

Create `src/sim/fireModes.ts`:

```ts
// Pure right-click fire-mode profiles. A mode is a multiplier set applied to a base weapon
// {interval, damage, speed}; the three modes are tuned to EQUAL nominal DPS
// (pellets * damageMul / intervalMul ≈ 1) so variety is situational, not power creep.
import { Vector3 } from 'three'

export type FireModeId = 'rapid' | 'heavy' | 'scatter'

export interface FireMode {
  id: FireModeId
  label: string
  intervalMul: number
  damageMul: number
  pellets: number
  spreadRad: number // half-angle of the cone; 0 = no spread
  speedMul: number
}

export interface BaseWeapon { interval: number; damage: number; speed: number }
export interface ResolvedShot { interval: number; damage: number; pellets: number; spreadRad: number; speed: number }

// Starting values for live tuning. DPS check: rapid 1*1/1=1, heavy 1*2.2/2.2=1, scatter 4*0.25/1=1.
export const FIRE_MODES: FireMode[] = [
  { id: 'rapid',   label: 'RAPID',   intervalMul: 1,   damageMul: 1,    pellets: 1, spreadRad: 0,    speedMul: 1 },
  { id: 'heavy',   label: 'HEAVY',   intervalMul: 2.2, damageMul: 2.2,  pellets: 1, spreadRad: 0,    speedMul: 1.25 },
  { id: 'scatter', label: 'SCATTER', intervalMul: 1,   damageMul: 0.25, pellets: 4, spreadRad: 0.07, speedMul: 0.9 },
]

export function modeById(id: FireModeId): FireMode {
  return FIRE_MODES.find((m) => m.id === id) ?? FIRE_MODES[0]
}

export function cycleMode(id: FireModeId, dir: 1 | -1): FireModeId {
  const i = FIRE_MODES.findIndex((m) => m.id === id)
  const base = i < 0 ? 0 : i
  const n = FIRE_MODES.length
  return FIRE_MODES[(base + dir + n) % n].id
}

export function resolveShot(base: BaseWeapon, mode: FireMode): ResolvedShot {
  return {
    interval: base.interval * mode.intervalMul,
    damage: base.damage * mode.damageMul,
    speed: base.speed * mode.speedMul,
    pellets: mode.pellets,
    spreadRad: mode.spreadRad,
  }
}

// spreadDirections is added in the next task.
export function spreadDirections(_forward: Vector3, _pellets: number, _spreadRad: number, _rng: () => number): Vector3[] {
  return [_forward.clone().normalize()]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/fireModes.test.ts`
Expected: PASS (all of Task 1's tests). `spreadDirections` is a stub here and is properly built + tested in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/sim/fireModes.ts src/sim/fireModes.test.ts
git commit -m "feat(combat): fire-mode profiles + resolveShot/cycleMode (pure)"
```

---

## Task 2: `spreadDirections` — cone fan for SCATTER

**Files:**
- Modify: `src/sim/fireModes.ts`
- Test: `src/sim/fireModes.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/sim/fireModes.test.ts`:

```ts
import { Vector3 } from 'three'
import { spreadDirections } from './fireModes'

describe('spreadDirections', () => {
  const fwd = new Vector3(0, 0, -1)
  const rng = () => 0.5 // deterministic

  it('single pellet returns the normalized forward exactly', () => {
    const dirs = spreadDirections(fwd, 1, 0.07, rng)
    expect(dirs).toHaveLength(1)
    expect(dirs[0].x).toBeCloseTo(0, 6)
    expect(dirs[0].y).toBeCloseTo(0, 6)
    expect(dirs[0].z).toBeCloseTo(-1, 6)
  })

  it('returns exactly `pellets` unit vectors', () => {
    const dirs = spreadDirections(fwd, 4, 0.07, rng)
    expect(dirs).toHaveLength(4)
    for (const d of dirs) expect(d.length()).toBeCloseTo(1, 5)
  })

  it('every pellet lies within spreadRad of forward', () => {
    const spreadRad = 0.07
    const dirs = spreadDirections(fwd, 4, spreadRad, rng)
    for (const d of dirs) {
      const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(fwd))))
      expect(angle).toBeLessThanOrEqual(spreadRad + 1e-6)
    }
  })

  it('is deterministic for a fixed rng', () => {
    const a = spreadDirections(fwd, 4, 0.07, () => 0.3)
    const b = spreadDirections(fwd, 4, 0.07, () => 0.3)
    expect(a.map((v) => [v.x, v.y, v.z])).toEqual(b.map((v) => [v.x, v.y, v.z]))
  })

  it('works for a non-axis-aligned forward (still unit, still within cone)', () => {
    const f = new Vector3(1, 2, -3).normalize()
    const dirs = spreadDirections(f, 4, 0.07, rng)
    for (const d of dirs) {
      expect(d.length()).toBeCloseTo(1, 5)
      const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(f))))
      expect(angle).toBeLessThanOrEqual(0.07 + 1e-6)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/fireModes.test.ts`
Expected: FAIL — the stub returns 1 vector regardless of `pellets`, so "returns exactly 4" and the cone tests fail.

- [ ] **Step 3: Implement `spreadDirections`**

Replace the stub `spreadDirections` in `src/sim/fireModes.ts` with:

```ts
// Fan `pellets` unit vectors around `forward`, each tilted up to `spreadRad` off-axis, evenly
// distributed in azimuth around the forward axis (Vogel-ish) with a small rng jitter on the tilt so
// volleys aren't a frozen pattern. pellets <= 1 (or spreadRad 0) returns forward alone.
export function spreadDirections(forward: Vector3, pellets: number, spreadRad: number, rng: () => number): Vector3[] {
  const fwd = forward.clone().normalize()
  if (pellets <= 1 || spreadRad <= 0) return [fwd]
  // Build an orthonormal basis (u, v) perpendicular to fwd.
  const ref = Math.abs(fwd.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const u = new Vector3().crossVectors(fwd, ref).normalize()
  const v = new Vector3().crossVectors(fwd, u).normalize()
  const out: Vector3[] = []
  for (let i = 0; i < pellets; i++) {
    const az = (i / pellets) * Math.PI * 2
    const tilt = spreadRad * (0.5 + 0.5 * rng()) // 50–100% of the cone, jittered
    const dir = fwd.clone().multiplyScalar(Math.cos(tilt))
    dir.addScaledVector(u, Math.sin(tilt) * Math.cos(az))
    dir.addScaledVector(v, Math.sin(tilt) * Math.sin(az))
    out.push(dir.normalize())
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/fireModes.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Run the full suite + typecheck to confirm no regressions**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/sim/fireModes.ts src/sim/fireModes.test.ts
git commit -m "feat(combat): spreadDirections cone fan for SCATTER (pure, tested)"
```

---

## Task 3: Wire fire modes into the firing block (PvE + PvP) — no input/HUD yet

**Files:**
- Modify: `src/main.ts` (imports ~64–66; firing block ~4812–4828)

This task makes the active mode actually change the shot, defaulting to `'rapid'` (which reproduces today's behavior exactly). Input + HUD come in Task 4, so verify here via a temporary default and the test suite/build.

- [ ] **Step 1: Add the import**

In `src/main.ts`, near the other `./sim/combat` import group (the block importing `createWeapon`, `spawnProjectile`, etc. at ~64–66), add a new import line below it:

```ts
import { modeById, resolveShot, spreadDirections, type FireModeId } from './sim/fireModes'
```

- [ ] **Step 2: Add the mode state**

Find the weapon state declarations (search for `const playerWeapon = createWeapon(0.16)` at ~1567). Immediately after `let weaponActive = false` (~1597), add:

```ts
let fireModeId: FireModeId = 'rapid' // right-click fire mode; persisted + switched in Task 4
```

- [ ] **Step 3: Replace the firing block with a mode-resolved version**

Find this exact block (~4812–4828):

```ts
    const pvpWeapon = pvpWeaponForShip(selectedShipType)
    const combatWeaponActive = pvpActive || dronesActive || pvpCombatTagged
    playerWeapon.interval = combatWeaponActive ? pvpWeapon.interval : 0.16
    stepWeapon(playerWeapon, dt)
    if (weaponActive && canFire(playerWeapon)) {
      _fwd.set(0, 0, -1).applyQuaternion(ship.quaternion)
      projectiles.push(spawnProjectile(
        ship.position,
        _fwd,
        'player',
        PROJECTILE_SPEED,
        combatWeaponActive ? pvpWeapon.damage : PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus,
        ship.velocity,
      ))
      fireWeapon(playerWeapon)
      audio.blip('fire')
    }
```

Replace it with:

```ts
    const pvpWeapon = pvpWeaponForShip(selectedShipType)
    const combatWeaponActive = pvpActive || dronesActive || pvpCombatTagged
    // Base weapon (per-ship in combat, flat + pilot bonus in PvE), then the active fire mode layered on
    // top as DPS-neutral multipliers. The pilot weapon-damage bonus is added BEFORE the mode multiplier.
    const weaponBase = {
      interval: combatWeaponActive ? pvpWeapon.interval : 0.16,
      damage: combatWeaponActive ? pvpWeapon.damage : PROJECTILE_DAMAGE + unlocksForLevel(pilot.level).weaponDamageBonus,
      speed: PROJECTILE_SPEED,
    }
    const shot = resolveShot(weaponBase, modeById(fireModeId))
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

- [ ] **Step 4: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build succeeds. With `fireModeId` defaulting to `'rapid'`, `resolveShot` returns `{interval:0.16 or pvp, damage: base, speed:1400, pellets:1, spreadRad:0}` and `spreadDirections(..,1,0,..)` returns `[forward]`, so firing is byte-for-byte the old single-bolt behavior.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(combat): apply fire mode to the firing block (default rapid = no behavior change)"
```

---

## Task 4: Input (Digit1/2/3) + HUD indicator + persistence

**Files:**
- Modify: `index.html` (HUD element ~966–975; CSS in the `<style>` block; help text ~1023)
- Modify: `src/main.ts` (grab HUD el ~211; `setFireMode` helper; keydown branch ~3255; init on launch)

- [ ] **Step 1: Add the HUD element + CSS in `index.html`**

Inside `<div id="hud" hidden>` (~966), after the `#ship-identity` block and before the closing `</div>` of `#hud` (~974), add:

```html
    <div id="fire-mode" aria-label="weapon fire mode">
      <span class="fm" data-mode="rapid">1 RAPID</span>
      <span class="fm" data-mode="heavy">2 HEAVY</span>
      <span class="fm" data-mode="scatter">3 SCATTER</span>
    </div>
```

In the `<style>` block (near the other `#hud` rules around line 66–70), add:

```css
    #fire-mode { margin-top: 6px; letter-spacing: 1px; font-size: 12px; opacity: .85; }
    #fire-mode .fm { color: #5b6b7a; margin-right: 10px; }
    #fire-mode .fm.active { color: #7fd4ff; text-shadow: 0 0 8px rgba(127, 212, 255, .6); }
```

Update the help line (~1023) from:

```
    LEFT-CLICK mine · RIGHT-CLICK fire · SPACE dock · B/N pick destination · J quantum-jump<br />
```

to:

```
    LEFT-CLICK mine · RIGHT-CLICK fire · 1/2/3 fire mode · SPACE dock · B/N pick destination · J quantum-jump<br />
```

- [ ] **Step 2: Grab the element + write `setFireMode` in `src/main.ts`**

Near the other `getElementById` HUD grabs (e.g. `const assistEl = document.getElementById('assist')!` at ~211), add:

```ts
const fireModeEl = document.getElementById('fire-mode')!
```

Then, just after the `let fireModeId` declaration from Task 3 (~1597), replace that line with the persisted initializer and add the helper + import usage:

```ts
let fireModeId: FireModeId = readStoredFireMode()
function readStoredFireMode(): FireModeId {
  const v = localStorage.getItem('scc.fireMode')
  return FIRE_MODES.some((m) => m.id === v) ? (v as FireModeId) : 'rapid'
}
function setFireMode(id: FireModeId): void {
  fireModeId = id
  try { localStorage.setItem('scc.fireMode', id) } catch { /* storage blocked */ }
  for (const el of fireModeEl.querySelectorAll<HTMLElement>('.fm')) {
    el.classList.toggle('active', el.dataset.mode === id)
  }
}
```

Add `FIRE_MODES` to the Task 3 import so `readStoredFireMode` can validate:

```ts
import { FIRE_MODES, modeById, resolveShot, spreadDirections, type FireModeId } from './sim/fireModes'
```

- [ ] **Step 3: Add the keydown branch**

In the `keydown` handler (after `keys.add(e.code)` at ~3255, alongside the other `if (e.code === 'KeyV')` style branches, gated like its neighbors), add:

```ts
  if ((e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') && running && !docked && !spectating) {
    setFireMode(e.code === 'Digit1' ? 'rapid' : e.code === 'Digit2' ? 'heavy' : 'scatter')
    audio.blip('nav')
  }
```

(The handler already early-returns when chat is open, the solar map is open, or the inventory/settings panels are open — see the guards at the top of the handler ~3210–3225 — so number keys won't switch modes while typing or in menus.)

- [ ] **Step 4: Initialize the HUD highlight once**

Right after the `setFireMode` definition (the helper added in Step 2), add a single top-level call so the HUD highlight reflects the stored/default mode from the start. `fireModeEl` was grabbed at module top-level (Step 2) and the `#hud` element exists even while `hidden`, so `classList.toggle` applies fine before launch:

```ts
setFireMode(fireModeId) // reflect the stored/default mode in the HUD highlight up front
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build succeeds.

- [ ] **Step 6: Manual verification (record the result in the task notes)**

Start dev (`npm run dev`) and a relay (`DEV_SKIP_LAUNCH_GATE=1 npm run server` if not already up), open `http://localhost:5173/`, launch, then:
- Press 2 → HUD highlights HEAVY; hold right-click → noticeably slower, heavier single bolts.
- Press 3 → HUD highlights SCATTER; hold right-click → a 4-pellet cone.
- Press 1 → back to the original rapid stream.
- Reload the page → the last selected mode is still highlighted (persistence).
- Open chat (Enter) and press 1/2/3 → mode does NOT change (typing is captured).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts index.html
git commit -m "feat(combat): 1/2/3 fire-mode select, HUD indicator, persistence"
```

---

## Task 5 (optional, separable): Showcase bot rotates fire modes during PvP training

**Files:**
- Modify: `src/main.ts` (bot PvP-training spar branch ~4585–4593)

This is footage polish; it can be skipped without affecting the player feature. It uses the already-exported `cycleMode`.

- [ ] **Step 1: Import `cycleMode`**

Extend the Task 3/4 import:

```ts
import { FIRE_MODES, cycleMode, modeById, resolveShot, spreadDirections, type FireModeId } from './sim/fireModes'
```

- [ ] **Step 2: Pick a mode when a PvP-training spar begins**

In the bot frame block, find the spar branch (~4585):

```ts
            if (botActivity.kind === 'pvp-training' && botActivity.phase === 'spar') {
              const targetDrone = trainingDrones
                .filter((drone) => !isDead(drone.health))
                .sort((a, b) => ship.position.distanceToSquared(a.position) - ship.position.distanceToSquared(b.position))[0]
              if (targetDrone) {
                cmd.target = targetDrone.position
                cmd.speed = Math.max(cmd.speed, 520)
                weaponActive = true
              }
            }
```

Add a one-time mode pick when the spar starts firing. Introduce a guard flag near the bot state declarations (search for `let botMinePhase` ~2742 and add beside it):

```ts
let botSparModePicked = false
```

Then inside the `if (targetDrone) { ... }` block, before `weaponActive = true`, add:

```ts
                if (!botSparModePicked) {
                  setFireMode(cycleMode(fireModeId, 1)) // rotate modes leg-to-leg for footage variety
                  botSparModePicked = true
                }
```

And reset the flag when the spar ends — in the activity-done branch (~4582, where `startBotTransit()` / the wander handoff happens), set `botSparModePicked = false`. Concretely, in the `if (cmd.done || now >= botPerformUntil)` block add `botSparModePicked = false` as its first line so the next pvp-training leg re-picks.

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; all tests pass; build succeeds.

- [ ] **Step 4: Manual verification with the bot**

Open `http://localhost:5173/?bot=1`, wait for a `pvp-training` leg (chat: an arena/spar intro), and confirm the HUD mode indicator changes for that leg and the bot fires that mode (e.g. a SCATTER cone at the drones). Across several pvp-training legs the mode rotates.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(bot): rotate weapon fire mode during pvp-training showcase"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npx vitest run` → all pass (includes the new `fireModes.test.ts`)
- [ ] `npm run build` → succeeds
- [ ] Manual: 1/2/3 switch + HUD + persistence (Task 4 Step 6); bot rotation if Task 5 included.
- [ ] Confirm RAPID is byte-for-byte the old weapon (no power/feel change when never switching).
