# Claude Citizen

> An open-source attempt to finish Star Citizen before Star Citizen does. Built with Claude.

**They've had 14 years and $800M. We have Claude and weekends.**

![Mine, trade, fight pirates, jump across the galaxy, and chat — multiplayer, in your browser](./docs/loop.gif)

▶ **Full 1080p showcase** — mining → trading → combat → quantum travel, end to end:

https://github.com/huiung/claude-citizen/releases/download/v0.7-cinematic/claude-citizen-showcase-1080p.mp4

> ⚠️ **Not affiliated with Cloud Imperium Games or Roberts Space Industries.**
> This is an independent open-source project. "Star Citizen" is referenced purely
> as a comparison target. No assets, names, lore, or code from the original are used —
> everything here is procedurally generated, hand-made, or CC0-licensed.

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

## What works today

- 6DOF spaceflight in your browser — coupled (flight assist) and decoupled (full Newton) modes
- A refinery, a mining colony, planets, an asteroid belt — the world is procedurally generated (ships & sound effects are hand-made or CC0)
- **Mine ORE** from asteroids with a mining laser — ore veins deplete and fresh ones respawn around you, so you prospect and move on instead of parking on one rock forever
- **A living economy:** dock to trade ore and alloy; prices react to your trades and drift back over time
- **Upgrade your craft:** cargo hold, top speed, boost, and mining yield — five tiers each, a credit sink that scales with your rank
- **Delivery contracts:** accept haul missions, deliver to the destination outpost for the reward
- **Pirates:** hostiles hunt you in the sector — shoot back, watch your hull, collect the bounty
- **An endless procedural galaxy:** fly any direction and planets, moons, stations, and derelicts keep appearing — some planets are vast
- **Deep space:** the farther you fly from the core, the more rare gold ore veins (credit jackpots) and tougher, higher-bounty pirates appear — a HUD gauge tracks how deep (and dangerous) you are. Risk and reward scale together
- **A named solar system:** Sun + Mercury through Saturn at a compressed scale, each with a procedurally textured surface (oceans/continents, gas bands, ice caps) — and they're solid, so you fly *around* them, not through
- **Drop to the surface:** approach an earth-type world and it resolves into continents, rivers, forests, deserts and snow-capped peaks (procedural, higher-detail up close); the sky fills in with day/night atmosphere, an altimeter kicks in, and collision follows the *real terrain* — so you can skim low over its hills and valleys instead of bouncing off a sphere
- **Quantum travel:** pick a destination with `[N]` or open the **Solar Atlas** with `[M]` and click a planet, charge the drive, and jump to any planet in the system — warp streaks, a wide-FOV cruise, and a named arrival
- **A cinematic sky:** bloom glow, sunlit planet atmospheres (bright day limb, a warm sunset terminator, dark night side), a procedural nebula backdrop, slowly rotating worlds, and parallax dust that streams past for a sense of speed
- **Ship classes:** buy and switch hulls at a station — hauler, fighter, miner, interceptor (detailed 3D models), each trading cargo/speed/toughness, unlocked as you climb the ranks
- **A capital ship:** a procedural dreadnought ~120× your fighter, its hull aglow with hundreds of windows — fly its length for the scale
- **Game feel:** a chase camera that carries G-force weight, a boost ignition punch (FOV kick + exhaust flare + whoosh), and an air-rush layer that swells with speed
- **Combat HUD:** target brackets + range, off-screen threat arrows (know where you're being shot from), and a lead indicator so you can actually land hits on pirates
- **A leaderboard:** top pilots by *lifetime* credits earned — on the landing screen and in-game (`[L]`)
- **Pilot ranks:** six tiers (Cadet → Admiral) earned by *lifetime* credits, so spending never demotes you — each rank brings a growing **earnings bonus** (+0% → +50% on every payout) and **unlocks new ships**, so there's always a reason to keep flying. HUD progress track, promotion banner, and rank tags on the leaderboard
- Hybrid audio: procedural engine/mining/quantum beds + CC0 sci-fi event SFX
- Real-time multiplayer: see other pilots' craft, and chat in-sector (Enter)
- **Progress saves automatically** — anonymous token, no account; come back later and your credits, cargo, upgrades, and ship are still yours. Grab a **Pilot Code** to restore your pilot on another device (one live session per code)
- 147 tests, because "built with AI" shouldn't mean "built badly"

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
| M | Open the Solar Atlas (system map) — click a planet to set your quantum destination |
| N | Cycle the quantum destination (Mercury → Saturn) |
| J | Quantum jump to the selected planet |
| L | Toggle the leaderboard |

## Roadmap

| Phase | What | Status |
|---|---|---|
| 0 | Flyable browser sandbox + multiplayer presence | ✅ shipped (day one) |
| 1 | Docking, two-way cargo loop, credits | ✅ shipped |
| 2 | Mining, dynamic market, craft upgrades, contracts, audio | ✅ shipped |
| 3 | Pirate threats — combat, hull, bounties, safe zones | ✅ shipped |
| 4 | Endless procedural galaxy, quantum travel, ship classes | ✅ shipped |
| 5 | Persistence (anonymous token) + in-sector chat | ✅ shipped |
| 6 | Hosted, playable at [claudecitizen.com](https://claudecitizen.com) | ✅ shipped |
| 7 | Low-poly planet surfaces + cinematic sky (bloom, atmospheres, nebula, warp) | ✅ shipped |
| 8 | Game feel + 3D ship models + capital ship + combat HUD + leaderboard | ✅ shipped |
| 9 | Detailed earth-type surfaces, day/night atmosphere, low-altitude terrain-following flight | ✅ shipped |
| 10 | Co-op combat — fight pirates together | next |
| 11 | Full planetary landings — touch down, walk the surface, take off | planned |
| … | … | … |
| 42 | Getting out of bed animation *(took the original 6 years — we'll take a weekend)* | someday |
| 1.0 | **Ship before Star Citizen ships** | the whole point |

## How this is built

Every line of this project is written with **Claude** (Anthropic's frontier model)
driving [Claude Code](https://claude.com/claude-code). One human sets direction, reviews,
and tunes the flight feel. The AI does the typing.

The dev log lives in [FABLE.md](./FABLE.md) — what got built, what the human did,
what the model did. Receipts, not claims.

## Contributing

If you can code, do procedural art, design missions, or write shaders — open an issue or just send a PR.
The bar for a first contribution is intentionally low; the `good first issue` label is real.

Ambitious, probably stupid, doing it anyway.

## Token

$Citizen Token

**CA:** `6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump`

## License

[MIT](./LICENSE)
