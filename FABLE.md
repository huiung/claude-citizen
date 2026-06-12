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
