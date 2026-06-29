# Showcase Bot Mine→Sell→Gamble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mine-and-gamble` activity to the showcase bot's rotation: it flies to the belt, mines ORE, hauls to a station, sells, then plays a few narrated roulette spins — then rejoins the rotation. Bot-only (`if (BOT)`), local/ephemeral econ → zero impact on real players or the economy/leaderboards.

**Architecture:** A small sub-state machine in the `main.ts` bot frame loop (mine → haul → dock-sell → gamble → done), reusing existing helpers (`stepMover` to fly, `mineStep` to mine, `sell` to trade, `spinRoulette`/`payoutMultiplier`/`clampBet` to gamble) on the local `econ`. Narrated via `net.sendChat`. Added as one entry in `BOT_STOP_KINDS`.

**Tech Stack:** TypeScript. Spec: `docs/specs/2026-06-30-bot-mine-gamble-design.md`. This is DOM/loop wiring (untested by convention) — verify by tsc + build + a manual `?bot=1` run. Line numbers below are from the codebase map and WILL drift — locate every anchor by the quoted surrounding code.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/main.ts` | `BOT_STOP_KINDS` entry; bot mine-gamble sub-state machine in the `if (BOT)` frame block; routing in `startBotTransit` | Modify |

(No new files; no new game systems — all called functions already exist and are unit-tested.)

---

## Task 1: Bot `mine-and-gamble` sub-state machine

**Files:**
- Modify: `src/main.ts`

No unit test (bot/DOM/loop wiring). Verify: `npx tsc --noEmit` exit 0, `npm run build` succeeds, `npx vitest run` unaffected, and a manual `?bot=1` run (Task 2).

READ FIRST (the map's anchors — confirm against real code):
- `const BOT = URL_PARAMS.get('bot') === '1'` (~main.ts:177).
- Bot state vars: `botPhase: 'transit' | 'perform'`, `botStopKind`, `botActivity`, `botDwellUntil`, `botPerformUntil`, `BOT_STOP_KINDS = ['planet','race','pvp-training','black-hole-dive']`, `BOT_PERFORM_CAP_MS` (~main.ts:2708-2718).
- `startBotTransit()` (~main.ts:1745-1768) — picks a `botStopKind`, sets `customJumpDestination`, calls `toggleQuantumTravel()`, sets `botPhase='transit'`.
- The `if (BOT) { ... }` frame block (~main.ts:4455-4500) — sets `input`/`weaponActive`, runs the transit→perform machine, uses `stepMover(ship.position, cmd.target, cmd.speed, dt)` then writes `ship.position`/`ship.quaternion`/`ship.velocity`.
- Mining: `mineStep(field, ship.position, econ, dt, active, effCargo(), miningYield(upgrades))` (~main.ts:4631); `field`, `rockMeshes`, `cargoUsed(econ)`, `effCargo()`, `miningYield(upgrades)`, `let miningActive` (~main.ts:2257).
- Docking/sell: `dock(id)` (~main.ts:2893), `undock()`, `sell(econ, OUTPOSTS[id], 'ORE', qty)` (sim/economy), `OUTPOSTS`, `dockableTarget(position)` (sim/docking).
- Roulette: `spinRoulette`, `payoutMultiplier`, `clampBet`, `MIN_BET`, `MAX_BET` from `src/sim/roulette.ts`.
- Asteroid field: `field` (createAsteroidField) + its asteroids have `.position` and `.reserves`; find the nearest with reserves (grep how `field`/asteroids are iterated — there may be a `nearestInRange`/field accessor in `sim/mining.ts`).

- [ ] **Step 1: Imports + tuning constants + sub-state**

Ensure `mineStep` and the roulette fns are imported in `main.ts` (grep; `mineStep` is already used; add `spinRoulette, payoutMultiplier, clampBet, MIN_BET` from `./sim/roulette` and `sell`/`OUTPOSTS` from `./sim/economy` if not already imported — verify and add only what's missing without breaking existing imports).

Add tuning constants + the sub-state near the other bot constants (~main.ts:2716):
```ts
// Bot mine→sell→gamble activity tuning (showcase; bot econ is local/ephemeral).
const BOT_MINE_TARGET_ORE = 60       // stop mining at ~this much cargo
const BOT_MINE_CAP_MS = 18_000       // …or after this long
const BOT_HAUL_CAP_MS = 30_000       // safety cap flying to the station
const BOT_GAMBLE_SPINS = 3
const BOT_GAMBLE_FRACTION = 0.2      // stake ~20% of credits per spin
const BOT_GAMBLE_INTERVAL_MS = 1500  // pace spins so chat is readable
type BotMinePhase = 'mine' | 'haul' | 'sell' | 'gamble' | 'done'
let botMinePhase: BotMinePhase | null = null  // non-null only while running the mine-and-gamble activity
let botMineUntil = 0
let botHaulUntil = 0
let botGambleNextAt = 0
let botGambleLeft = 0
let botMineStationId: string | null = null
```

- [ ] **Step 2: Register the activity in the rotation**

Add `'mine-and-gamble'` to `BOT_STOP_KINDS`.
In `startBotTransit()` (or wherever the kind is picked + the jump set up): when the picked kind is `'mine-and-gamble'`, DON'T require a quantum jump to a far landmark — the belt is near spawn. Set it up so that on the next perform tick the sub-machine initializes. Simplest: when `botStopKind === 'mine-and-gamble'`, skip the `customJumpDestination`/`toggleQuantumTravel()` path, set `botPhase = 'perform'`, `botActivity = null`, and initialize the sub-state:
```ts
  botMinePhase = 'mine'
  botMineUntil = performance.now() + BOT_MINE_CAP_MS
  botMineStationId = null
  net.sendChat('Mining run: prospecting the belt, then a spin at the wheel.')
```
(Adapt to the real control flow of `startBotTransit` — if it always toggles quantum travel, branch BEFORE that for this kind. Confirm `botPhase='perform'` + `idle` is the state the frame loop expects to run a non-transit activity. Read the real function and match its conventions.)

- [ ] **Step 3: Drive the sub-machine in the bot frame block**

In the `if (BOT)` frame block, BEFORE/within the existing perform handling, add a branch that runs when `botMinePhase !== null` (this activity is active) and short-circuits the normal `botActivity` handling for this leg. Each frame, override `input` (no manual thrust — we steer via stepMover) and set `weaponActive = false`. Implement the phases:

```ts
    if (botMinePhase && quantum.phase === 'idle') {
      const speed = 600 // cruise-ish; match the SPEEDS the other bot maneuvers use
      if (botMinePhase === 'mine') {
        miningActive = false
        const ast = nearestAsteroidWithReserves(ship.position) // helper: nearest field asteroid with reserves>0
        if (!ast || cargoUsed(econ) >= BOT_MINE_TARGET_ORE || now >= botMineUntil) {
          miningActive = false
          net.sendChat(`Hold's loaded — ${Math.floor(econ.cargo.ORE)} ORE. Hauling to sell.`)
          botMinePhase = 'haul'; botHaulUntil = now + BOT_HAUL_CAP_MS
        } else {
          // fly to the asteroid; mine once within range
          const r = stepMover(ship.position, ast.position, speed, dt)
          applyBotMove(r, dt) // mirror the existing pos/quat/velocity write the bot loop already does
          miningActive = ship.position.distanceTo(ast.position) < 120
          if (miningActive) mineStep(field, ship.position, econ, dt, true, effCargo(), miningYield(upgrades))
        }
      } else if (botMinePhase === 'haul') {
        const stationPos = nearestStationPosition(ship.position) // OUTPOSTS / dockable
        const dockId = dockableTarget(ship.position)
        if (dockId) { botMineStationId = dockId; dock(dockId); botMinePhase = 'sell' }
        else if (now >= botHaulUntil) { botMinePhase = 'gamble'; /* fall through; sell may be skipped if not docked */ botGambleLeft = 0 }
        else { const r = stepMover(ship.position, stationPos, speed, dt); applyBotMove(r, dt) }
      } else if (botMinePhase === 'sell') {
        if (botMineStationId && econ.cargo.ORE > 0) {
          const ore = Math.floor(econ.cargo.ORE)
          const before = econ.credits
          sell(econ, OUTPOSTS[botMineStationId], 'ORE', ore)
          net.sendChat(`Sold ${ore} ORE for +${Math.round(econ.credits - before)} cr.`)
        }
        botMinePhase = 'gamble'; botGambleLeft = BOT_GAMBLE_SPINS; botGambleNextAt = now
      } else if (botMinePhase === 'gamble') {
        if (botGambleLeft <= 0 || econ.credits < MIN_BET) {
          if (docked) undock()
          botMinePhase = 'done'
        } else if (now >= botGambleNextAt) {
          const stake = clampBet(Math.round(econ.credits * BOT_GAMBLE_FRACTION), econ.credits)
          if (stake <= 0) { botGambleLeft = 0 }
          else {
            const bet = Math.random() < 0.5 ? 'red' : 'black'
            const result = spinRoulette()
            const mult = payoutMultiplier(bet, result)
            econ.credits -= stake
            if (mult > 0) econ.credits += stake * mult   // DIRECT — never gainCredits (credits-only, like the casino)
            net.sendChat(`Roulette — ${stake} on ${bet.toUpperCase()}: ${result.number} ${result.color} → ${mult > 0 ? 'WIN' : 'LOSE'}`)
            updateWalletHUD()
            botGambleLeft -= 1
            botGambleNextAt = now + BOT_GAMBLE_INTERVAL_MS
          }
        }
      } else { // 'done'
        botMinePhase = null
        startBotTransit() // back to the normal rotation
      }
      return // this leg fully owns the frame; skip the normal botActivity handling below
    }
```
ADAPT to the REAL bot loop:
- `applyBotMove(r, dt)` is shorthand for the EXACT 3 lines the existing bot loop uses after `stepMover` (`_botPrevPos.copy(ship.position); ship.position.copy(r.pos); ship.quaternion.copy(r.quat); ship.velocity = (pos-prev)/dt`). Inline those (don't invent a helper unless it's clean).
- `nearestAsteroidWithReserves(pos)` and `nearestStationPosition(pos)`: implement inline using the real `field` asteroid list (filter `reserves > 0`, min distance) and the real station set (`OUTPOSTS`/the dockable list). If `sim/mining.ts` exposes a nearest-asteroid accessor, reuse it; else iterate `field`'s asteroids.
- Confirm `dock(id)` is safe to call from the bot (it opens the station menu UI — that's fine; the bot can dock visually). `dockableTarget(position)` returns the dockable outpost id or null. `undock()` closes it.
- `now` is the frame timestamp the bot block already uses; `dt` likewise. `docked` is the module flag.
- Ensure this branch runs in the same place/conditions the existing perform logic runs (after the transit→perform transition, when `quantum.phase === 'idle'`). The `return` prevents the normal activity code from also running this frame.
- When `botMinePhase` is null, the existing bot logic runs unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → exit 0 (fix any missing import / type).
Run: `npx vitest run` → all pass (no test touches the bot; nothing should regress).
Run: `npm run build` → succeeds.
Report exactly how you adapted Steps 2-3 to the real `startBotTransit` + bot frame block (the move-write lines, the asteroid/station accessors, where the branch sits, how routing avoids the quantum jump for this kind).

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(bot): mine→sell→gamble showcase activity (rotation)"
```

---

## Task 2: Manual verification (`?bot=1`)

The dev relay (DEV_SKIP_LAUNCH_GATE) + `npm run dev` are/were running; open `http://localhost:5173/?bot=1`.
- [ ] The bot eventually picks the `mine-and-gamble` leg (it's one of several rotation kinds — may take a few transitions; to force it sooner, temporarily bias the picker or just wait).
- [ ] It flies to an asteroid, mines (cargo/ORE climbs — watch the wallet/chat), within ~18s or ~60 ORE it stops.
- [ ] It hauls to a station and docks; ORE is sold (credits jump; chat "Sold N ORE +M cr").
- [ ] It plays ~3 roulette spins, ~1.5s apart, each narrated in chat ("Roulette — … WIN/LOSE"); credits move; the HUD updates.
- [ ] It undocks and returns to the normal rotation (no stall). If mining finds no asteroid / can't dock, it still falls through to `done` and rejoins the rotation (timeouts).
- [ ] Real-player paths unaffected (open a normal tab without `?bot=1` — mining/selling/casino behave as before).

No commit (verification only).

---

## Self-Review Notes (coverage map)

- Spec §3 (phase machine mine→haul→dock-sell→gamble→done + timeouts) → Task 1 Step 3.
- Spec §4 (gamble: clampBet ~20%, random red/black, spin, DIRECT credit payout — never gainCredits, paced) → Task 1 Step 3 `gamble` phase.
- Spec §5 (narration via sendChat) → the sendChat lines in Steps 2-3.
- Spec §6 (BOT_STOP_KINDS entry + routing + reuse stepMover/mineStep/sell/roulette) → Task 1 Steps 1-3.
- Spec §7 (no stalls via timeouts; bot econ local; player unaffected; gated behind BOT) → timeouts in each phase; whole branch under `if (BOT)`.
- Spec §8 (manual ?bot=1 verify) → Task 2.
- Out of scope (real-player changes, persistence, primary-loop) → none touched.
- Note: gamble winnings use DIRECT `econ.credits +=` (no gainCredits, credits-only, like the casino); SELL uses `sell()` (gainCredits — normal trade; bot earned is ephemeral). Consistent with the spec's stated distinction.
