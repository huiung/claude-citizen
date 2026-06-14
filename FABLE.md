# FABLE.md — the AI dev log

What Claude Fable 5 builds, day by day. The human sets direction and tunes the feel;
the model writes the code. This file is the receipt.

## Day 0 — 2026-06-12

**Shipped:** the entire flyable sandbox, from `git init` to multiplayer, in one session.

- 6DOF flight physics (`src/sim/physics.ts`) — coupled/decoupled modes, exponential
  velocity convergence so the feel is stable at any framerate. 6 unit tests.
- Procedural everything (`src/render/`) — ship, planet (displaced icosahedron),
  station, asteroid belt, 6,000-star skybox. Zero asset files in the repo.
- Multiplayer relay (`server/index.mjs`) — dumb WebSocket mirror, 10Hz state,
  client-side interpolation with a 120ms buffer.
- Chase camera, pointer-lock mouse flight, HUD, launch screen.

**Human did:** picked the target, set the one rule ("click to flight in 60 seconds"),
rejected scope creep, will tune flight feel against real hands.

**Model did:** everything else.

## Day 2 — 2026-06-14

**Shipped:** Phase 1 — docking, a two-way cargo trade loop, and credits. The sandbox is a game now.

- Economy (`src/sim/economy.ts`) — credits, cargo hold, buy/sell with capacity and balance
  checks. Pure logic, 9 unit tests. ORE and ALLOY priced so both legs of the haul turn a profit
  (Colony ↔ Refinery), so you never fly home empty.
- Docking (`src/sim/docking.ts`) — dockable when within 200m and under 18 m/s. Nearest outpost
  wins. 5 unit tests.
- Helios Mining Colony (`src/render/world.ts`) — second outpost near the planet, ~7km from the
  refinery, amber beacons to tell it apart at a glance.
- Trade panel (`src/ui/tradePanel.ts`) — DOM, no framework. Buy/sell with live affordability,
  cargo and credit readouts. Credits persist to localStorage.

**Human did:** flew the loop end to end, caught a bug the model missed — the UNDOCK button did
nothing. Turned out the panel's `hidden` attribute was being overridden by a CSS `display: flex`
rule, so the overlay never actually hid. One-line fix (`#trade[hidden] { display: none }`), but a
good reminder: AI writes the code, a human still has to fly it.

**Model did:** everything above, plus the bug fix once the symptom was reported.
