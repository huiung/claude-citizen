# Claude Citizen

> An open-source attempt to finish Star Citizen before Star Citizen does. Built with Claude Fable 5.

**They've had 14 years and $800M. We have Claude Fable 5 and weekends.**

![Dock, trade, haul — the full economy loop, all in the browser](./docs/loop.gif)

> ⚠️ **Not affiliated with Cloud Imperium Games or Roberts Space Industries.**
> This is an independent open-source project. "Star Citizen" is referenced purely
> as a comparison target. No assets, names, lore, or code from the original are used —
> everything here is procedurally generated or written from scratch.

## Play now

**▶ Play now: [claudecitizen.com](https://claudecitizen.com)** — no download, no account. Click → fly, in seconds.

Other pilots share your sector in real time (and you can chat). Every feature that breaks
"60 seconds to flight" gets rejected — that's the one rule. Prefer to self-host? See below.

```bash
git clone https://github.com/huiung/claude-citizen
cd claude-citizen
npm install
npm run server &   # multiplayer relay on :8080
npm run dev        # open http://localhost:5173, enter a callsign, LAUNCH
```

Other pilots on the same server show up next to you in real time. That's it. That's the MMO (so far).

## What works today (Day 0)

- 6DOF spaceflight in your browser — coupled (flight assist) and decoupled (full Newton) modes
- A refinery, a mining colony, a planet, an asteroid belt — 100% procedurally generated, zero asset files
- **Mine ORE** from asteroids with a mining laser — free cargo if you're willing to work for it
- **A living economy:** dock to trade ore and alloy; prices react to your trades and drift back over time
- **Upgrade your craft:** cargo hold, top speed, boost — credits well spent
- **Delivery contracts:** accept haul missions, deliver to the destination outpost for the reward
- **Pirates:** hostiles hunt you in the sector — shoot back, watch your hull, collect the bounty
- **An endless procedural galaxy:** fly any direction and planets, moons, stations, and derelicts keep appearing — some planets are vast
- **Quantum travel:** charge the drive and jump across the sector to a distant planet in seconds
- **Ship classes:** buy and switch hulls at a station — hauler, fighter, miner, interceptor, each trading cargo/speed/toughness
- Procedural engine + combat + UI audio — synthesized live, no sound files
- Real-time multiplayer: see other pilots' craft, and chat in-sector (Enter)
- 128 tests, because "built with AI" shouldn't mean "built badly"

## Controls

| Input | Action |
|---|---|
| Mouse | Pitch / yaw |
| W / S | Forward / reverse thrust |
| A / D | Strafe |
| R / F | Vertical thrust |
| Q / E | Roll |
| Shift | Boost |
| X | Brake |
| V | Toggle flight assist (coupled ↔ Newtonian) |
| Left-click (hold) | Fire mining laser at a nearby asteroid |
| Right-click (hold) | Fire weapon at hostiles |
| Space | Dock (when slow + near an outpost) — trade, upgrade, buy ships, take contracts |
| J | Quantum jump to the nearest planet |

## Roadmap

| Phase | What | Status |
|---|---|---|
| 0 | Flyable browser sandbox + multiplayer presence | ✅ shipped (day one) |
| 1 | Docking, two-way cargo loop, credits | ✅ shipped |
| 2 | Mining, dynamic market, craft upgrades, contracts, audio | ✅ shipped |
| 3 | Pirate threats — combat, hull, bounties | ✅ shipped |
| 4 | Endless procedural galaxy, quantum travel, ship classes | ✅ shipped |
| 5 | Persistence — your craft is still yours tomorrow | next |
| 6 | Co-op combat, safe zones, deeper systems | planned |
| 4 | Procedural planetary landings | planned |
| … | … | … |
| 9 | Getting out of bed animation *(took the original 6 years — we'll take a weekend)* | someday |
| 1.0 | **Ship before Star Citizen ships** | the whole point |

## How this is built

Every line of this project is written with **Claude Fable 5** (Anthropic's frontier model)
driving [Claude Code](https://claude.com/claude-code). One human sets direction, reviews,
and tunes the flight feel. The AI does the typing.

The dev log lives in [FABLE.md](./FABLE.md) — what got built, what the human did,
what the model did. Commits carry a `Co-Authored-By: Claude Fable 5` trailer. Receipts, not claims.

## Contributing

If you can code, do procedural art, design missions, or write shaders — open an issue or just send a PR.
The bar for a first contribution is intentionally low; the `good first issue` label is real.

Ambitious, probably stupid, doing it anyway.

## License

[MIT](./LICENSE)
