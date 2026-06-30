# Showcase Bot — Mine → Sell → Gamble Activity — Design

**Date:** 2026-06-30
**Status:** Design approved (pending written-spec review)
**Context:** Extend the operator showcase BOT (`?bot=1`) autopilot with a new rotation activity: fly to the asteroid belt, **mine ORE**, haul it to a station, **sell it**, then **play roulette** with the credits. Pure showcase flavor — the bot's economy is local/ephemeral (never persisted; relay gate-exempt via botSecret), so there is no leaderboard/anti-cheat impact.

---

## 1. Why

The bot currently showcases flight, racing, black-hole dives, and planet visits. A "mine → sell → gamble" loop showcases the **core economic gameplay** (mining, trading) AND the new **casino** in one narrated sequence — great for stream/footage and for exercising the casino visibly. Added as ONE activity in the existing rotation (mixes with the other showcase stops), per the chosen structure.

---

## 2. Scope

### In scope
- A new bot rotation activity `mine-and-gamble` (added to `BOT_STOP_KINDS`).
- A bot sub-state machine driven in the `main.ts` bot loop (where `econ`, `field`, `dock`, `sell`, `spinRoulette` all live): **mine → haul → dock+sell → gamble → undock → done**.
- Narration via the existing `net.sendChat(...)` so the showcase reads the play-by-play.
- Reuses existing helpers: `stepMover` (fly), `mineStep` (mine), `sell` (trade), `spinRoulette`/`payoutMultiplier`/`clampBet` (gamble). No new game systems.

### Out of scope
- No change to real-player mining/selling/casino.
- No server persistence (bot econ stays local — unchanged).
- No new economy rules; the bot uses the same functions a player would.
- Not the bot's primary loop — it's one of several rotation activities.

---

## 3. The activity state machine (in `main.ts` bot loop)

When the rotation picks `mine-and-gamble`, the bot runs these phases (a small `botMineState` sub-machine; the heavy side-effects live in `main.ts` because they touch `econ`/`field`/`dock`/`stationMenu`). Each phase steers with `stepMover(ship.position, target, speed, dt)` (same as the existing bot maneuvers) and advances on a condition or a safety timeout.

| Phase | Steer to | Side-effect each frame | Advance when |
|---|---|---|---|
| `mine` | nearest asteroid with reserves (from `field`) | `mineStep(field, ship.position, econ, dt, true, effCargo(), miningYield(upgrades))` once within mining range | `cargoUsed(econ) ≥ MINE_TARGET` (e.g. ~60 ORE) **or** `now ≥ mineUntil` (~18s cap) **or** no asteroid left |
| `haul` | nearest dockable station (`OUTPOSTS` position) | — | within docking range → call `dock(stationId)` |
| `dock-sell` | (docked) | `sell(econ, OUTPOSTS[stationId], 'ORE', econ.cargo.ORE)` (one-shot), narrate proceeds | sale done → go to `gamble` |
| `gamble` | (docked) | run up to `GAMBLE_SPINS` (~3) roulette spins (see §4), narrate each; stop early if `credits < MIN_BET` | spins done → `undock()` → activity `done` |

- **Find the asteroid:** pick the nearest asteroid in `field` with `reserves > 0` (the field + reserves are already in `main.ts`); steer to it; `mineStep` auto-targets the nearest in range (≤60u) once close. If none with reserves, skip mining → haul whatever cargo (or end early).
- **Station choice:** the nearest dockable outpost (reuse the existing docking/`dockableTarget` machinery or the nearest `OUTPOSTS` entry). Haul there and `dock()`.
- **Safety timeouts:** each phase has a cap (mine ~18s, haul ~30s, gamble settles within a few seconds) so the bot never stalls; on cap, advance/abort gracefully to `done` → `startBotTransit()` (back to the rotation).
- On `done`: `undock()` (if docked) and return to the normal bot transit/rotation.

While in `mine`, set `miningActive = true` only when the bot is the active driver (BOT) and in this phase; clear it otherwise (the bot loop already overrides `input`/`weaponActive` each frame — do the same for `miningActive`).

---

## 4. Gambling step (credits-only, like the casino)

When `phase === 'gamble'` and docked, run up to `GAMBLE_SPINS` spins:
```
if (econ.credits < MIN_BET) → stop
const stake = clampBet(Math.round(econ.credits * GAMBLE_FRACTION), econ.credits) // ~20% of credits
const bet = pickBet()            // e.g. random of red/black (showcase flavor)
const result = spinRoulette()
const mult = payoutMultiplier(bet, result)
econ.credits -= stake            // spend
if (mult > 0) econ.credits += stake * mult   // DIRECT — never gainCredits (mirrors the casino; keeps it credits-only)
net.sendChat(`Roulette — ${stake} on ${bet.toUpperCase()}: ${result.number} ${result.color} → ${mult>0?'WIN':'LOSE'}`)
```
- Pace the spins (one per ~1.5s, via the existing bot dwell/timer pattern) so the chat narration is readable, not instant.
- Starting values (tuned live): `GAMBLE_FRACTION = 0.2`, `GAMBLE_SPINS = 3`, bet = random red/black. Same `MIN_BET`/`MAX_BET`/`clampBet` as the casino.
- **No `gainCredits` for winnings** (consistent with the casino: credits-only, no `earned`). Selling DOES use `sell()` (which uses `gainCredits`) — that's the normal trade path and correct (the bot's `earned` is ephemeral/unpersisted anyway).

---

## 5. Narration (showcase)

Use `net.sendChat` (the bot already chats activity intros) for a readable play-by-play:
- intro: `"Mining run: prospecting the belt, then a spin at the wheel."`
- on mining done: `"Hold's loaded — N ORE. Hauling to <station>."`
- on sell: `"Sold N ORE for +M cr."`
- per spin: the line in §4.
- (Keep it light — a few lines, not spam.)

---

## 6. Integration points (from the codebase map)

- `BOT_STOP_KINDS` (`src/main.ts`) — add `'mine-and-gamble'`.
- `startBotTransit()` / the rotation picker — route `mine-and-gamble` to start near the belt/spawn (it doesn't need a quantum jump if the belt is near spawn; otherwise pick a destination then run the sub-machine on arrival). Keep it consistent with how other kinds set up.
- The `if (BOT)` block in the frame loop (`src/main.ts`) — add the `mine-and-gamble` sub-machine branch (mine/haul/dock-sell/gamble) using `stepMover`, `mineStep`, `dock`/`undock`, `sell`, `spinRoulette`/`payoutMultiplier`/`clampBet`.
- Reuse: `stepMover` (bot/mover), `mineStep` (sim/mining), `sell` (sim/economy), `OUTPOSTS`, `field`, `effCargo`/`miningYield`/`cargoUsed`, `dock`/`undock`, roulette pure fns.
- Turn-on for testing: `http://localhost:5173/?bot=1` (the dev gate bypass + bot path already let it fly).

---

## 7. Risks / decisions

- **Bot econ is local/ephemeral** → no leaderboard/anti-cheat/token impact. The `guardEconomyGrowth` cap is irrelevant (bot doesn't persist).
- **Don't reuse the casino UI** — the bot gambles via the pure roulette functions directly on `econ` (no `StationMenu.spin()`), so it works whether or not the station menu is rendered. (The bot may dock for the sell; the casino visuals aren't required for the bot's gamble.)
- **No stalls:** every phase has a timeout → falls through to `done` → rotation. If mining finds no asteroid or selling/gambling can't proceed, abort gracefully.
- **Player unaffected:** all of this is gated behind `if (BOT)`; real players' mining/selling/casino are untouched.

---

## 8. Testing

- The bot loop is DOM/loop wiring (untested by convention) — verify by `?bot=1` manual run: the bot flies to the belt, mines (cargo climbs), hauls to a station, sells (credits jump), then narrates a few roulette spins (credits move), then returns to the rotation. tsc + build + the full existing suite stay green.
- If any small pure helper is extracted (e.g. `pickBet`, or a phase-advance predicate), unit-test it. The roulette/mining/economy functions it calls are already unit-tested.

---

## 9. Success criteria

With `?bot=1`, the showcase bot occasionally runs a mine→sell→gamble leg: it visibly mines the belt, hauls to a station, sells the ore for credits, and plays a few narrated roulette spins — then rejoins its normal showcase rotation. No stalls, no effect on real players or the economy/leaderboards.
