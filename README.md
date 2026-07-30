# Claude Citizen

> An open-source attempt to finish Star Citizen before Star Citizen does. Built with Claude.

**They've had 14 years and $800M. We have Claude and weekends.**

![Mine, trade, fight pirates, jump across the galaxy, and chat — multiplayer, in your browser](./docs/loop.gif)

▶ **Full 1080p showcase** — mining → trading → combat → quantum travel, end to end:

https://github.com/huiung/claude-citizen/releases/download/v0.7-cinematic/claude-citizen-showcase-1080p.mp4

> ⚠️ **Not affiliated with Cloud Imperium Games or Roberts Space Industries.**
> This is an independent open-source project. "Star Citizen" is referenced purely
> as a comparison target. No assets, names, lore, or code from the original are used —
> everything here is procedurally generated, hand-made, or openly licensed (CC0/CC-BY).

## Play now

**▶ Play now: [claudecitizen.com](https://claudecitizen.com)** — no download, no account. Click → fly, in seconds.

Flying is free and needs no wallet. Connect one only if you want holder cosmetics or Ranked PvP.

Every feature that breaks "60 seconds to flight" gets rejected — that's the one rule.
Prefer to self-host? See below.

```bash
git clone https://github.com/huiung/claude-citizen
cd claude-citizen
npm install
npm run server &   # multiplayer relay on :8080
npm run dev        # open http://localhost:5173, enter a callsign, LAUNCH
```

Other pilots on the same server show up next to you in real time. That's it. That's the MMO (so far).

## What works today

- **CLAUDE flies with you:** a standalone AI pilot (real Claude API calls, openly an AI) joins the multiplayer relay as pilot CLAUDE, flies a loop between named landmarks so it's actually around to meet, and replies to your in-sector chat. Runs as its own service (`npm run bot`) — see [`bot/README.md`](./bot/README.md)
- **6DOF spaceflight in your browser** — coupled (flight assist) and decoupled (full Newton) modes, a chase camera that carries G-force weight, a boost ignition punch, and an air-rush layer that swells with speed
- **Mine, trade, upgrade:** pull ORE from asteroids with a mining laser (veins deplete and fresh ones respawn, so you prospect and move on), dock to sell into a market whose prices react to your trades and drift back, then sink the credits into cargo hold, top speed, boost, and mining yield — five tiers each
- **Contracts and pirates:** accept haul missions for a delivery reward, and fight off hostiles that come in tiers — grunt, elite, and named miniboss. Target brackets with range, off-screen threat arrows, and a lead indicator so you can actually land hits
- **An endless procedural galaxy:** fly any direction and planets, moons, stations, and derelicts keep appearing. The farther you get from the core, the more rare gold ore veins and tougher, higher-bounty pirates you find — a HUD gauge tracks how deep and dangerous you are
- **A named solar system:** Sun + Mercury through Saturn at a compressed scale, each procedurally textured and *solid*, so you fly around them rather than through. Pick one with `[N]` or click it in the **Solar Atlas** (`[M]`), charge the drive, and quantum-jump — warp streaks, a wide-FOV cruise, and a named arrival
- **Drop to the surface:** approach an earth-type world and it resolves into continents, rivers, forests, deserts and snow-capped peaks, with day/night atmosphere, an altimeter, and collision that follows the *real terrain* — so you skim its hills instead of bouncing off a sphere. Dive in hot and re-entry heat kicks in: a plasma sheath, screen shake, and a whiteout crossing the cloud layer. Touch down on a named Earth megacity's skypad for credits and a hull repair
- **A cinematic sky:** bloom glow, sunlit planet atmospheres (bright day limb, warm sunset terminator, dark night side), a procedural nebula backdrop, and parallax dust streaming past for a sense of speed. Out in it: a procedural dreadnought ~120× your fighter, hull aglow with hundreds of windows — fly its length for the scale
- **Ship classes:** buy and switch between four hulls at a station — hauler, fighter, miner, interceptor — each trading cargo, speed and toughness against the others, unlocked as you climb the ranks. Press `C` for an orbit camera and inspect whatever you're flying
- **Two progression spines:** Career Rank climbs on *lifetime* credits (Cadet through Warlord, so spending never demotes you), each rank adding an earnings bonus that tops out at +50% and unlocking new ships. Pilot Level is the active one — hunt raiders and run the Sector 1 quest chain for XP. Campaign is a vertical slice: Sector 1, levels 1–5
- **PvP arenas:** cycle to the deep-space Practice or Ranked beacon with `[N]`, jump out past the named system, and enter the arena marker to enable pilot-vs-pilot fire — server-authoritative hull damage, peer health bars, kill feed, and a small credit bounty. Practice is open to anyone; Ranked requires a verified 1,000+ token balance and keeps its own leaderboard
- **Crafting, cosmetics, and a marketplace:** refine credits into Craft Cores at the station Forge, then spend cores and credits on cosmetic kits (trail, hull, aura) with a pity-ramped rarity roll that guarantees epic-or-better by the 20th craft. List what you forge for credits or for real $CITIZEN with on-chain settlement (seller gets 95%, treasury takes 5%). Verified token holders also get tiered nameplate colors and holder-only hangar hulls — cosmetic only, no stat advantage
- **Reasons to log in:** three deterministic daily objectives (`G`) paying Craft Cores with a set-completion and login-streak bonus, credits-only roulette at the Forge, a golden-ring race circuit around the Season Hub, and a real black hole out past the named system — a steepening gravity well with tidal-shear damage and instant death past the horizon. Race times and closest-survived approaches are both server-persisted leaderboards
- **Leaderboards:** Career ranks the top 100 pilots by lifetime credits earned; Ranked PvP tracks arena kills. Page through both on the landing screen and in-game (`[L]`)
- **Real-time multiplayer and persistence:** see other pilots' craft and chat in-sector (Enter), over hybrid audio (procedural engine/mining/quantum beds + CC0 sci-fi SFX). Progress saves automatically to an anonymous token — no account — and a **Pilot Code** restores your pilot on another device. Link a wallet to claim that progress to a verified identity
- **Mobile companion mode:** a scoped-down flight mode for phones — virtual stick plus Thrust/Boost/Brake/Mine/Dock/Jump/Nav/Cam. Flight assist is forced on; no roll, strafe, or vertical thrust. Mining, docking, trading, upgrades, wallet, quantum travel and leaderboards all work, but **combat is off**. It's a companion mode, not the full cockpit
- **800+ tests across the sim, server, and UI logic**, because "built with AI" shouldn't mean "built badly"

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
| N | Cycle the quantum destination (Mercury → Saturn, then Practice Arena and Ranked Arena) |
| J | Quantum jump to the selected destination |
| L | Toggle the leaderboard |
| C | Toggle orbit camera |
| Mouse wheel | Zoom orbit camera (while orbit camera is active) |
| G | Toggle the daily objectives panel |

## Roadmap

| Phase | What | Status |
|---|---|---|
| 0–9 | Flyable sandbox, multiplayer, docking + economy, mining, combat, endless galaxy, quantum travel, ship classes, persistence, hosting, planet surfaces, cinematic sky | ✅ shipped |
| 10 | PvP combat — practice/ranked arenas, 1,000+ token Ranked gate, peer hull bars, kill feed, Ranked PvP leaderboard | phase 1 shipped |
| 11 | Pilot progression — active Pilot Level spine, Sector 1 campaign quest chain, enemy tiers (grunt/elite/named) | slice shipped (Lv 1–5) |
| 12 | Ship-based touchdown/liftoff on Earth skypads, credits + hull repair | ✅ shipped |
| 12.1 | On-foot landings — walk the surface | not started |
| 12.2 | Skypad landings on planets beyond Earth | not started |
| … | … | … |
| 42 | Getting out of bed animation *(took the original 6 years — we'll take a weekend)* | someday |
| 1.0 | **Ship before Star Citizen ships** | the whole point |

## How this is built

Every line of this project is written with **Claude** (Anthropic's frontier model)
driving [Claude Code](https://claude.com/claude-code). One human sets direction, reviews,
and tunes the flight feel. The AI does the typing.

The full dev log is the [commit history](https://github.com/huiung/claude-citizen/commits/main) —
every change, dated, with the reasoning in the message. Receipts, not claims.

## Contributing

If you can code, do procedural art, design missions, or write shaders — open an issue or just send a PR.
The bar for a first contribution is intentionally low; the `good first issue` label is real.

Ambitious, probably stupid, doing it anyway.

## Token

$Citizen Token

**CA:** `6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump`

## Credits

Named-planet imagery: NASA/USGS (public domain) — MESSENGER (Mercury, + USGS DEM relief),
Magellan (Venus), Blue Marble (Earth, orbit view), Viking (Mars, + MOLA relief), Cassini (Jupiter).

Holder-tier **hero hulls** — the *Archimedes*, *Zebra* and *Rainmaker* ship models — by
**[Viktor Hahn](https://codeberg.org/naev/naev-artwork-production)**, from the
[Naev](https://naev.org) project's `gfx/ship3d` artwork, licensed
**[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)**. Source:
[naev/naev-artwork-production](https://github.com/naev/naev-artwork-production) — see that repo's
`gfx/ARTWORK_LICENSE.yaml`, which lists these three under a `Viktor Hahn:` block declaring
`license: CC-by 4.0`. Changes we made: converted glTF → GLB, rotated 180° to this project's
-Z-forward convention, merged each ship's `base` and `engine` scenes into one mesh tree, dropped
Naev's weapon-mount and engine-trail marker nodes, and re-encoded the textures from lossless to
lossy WebP. Every other ship, station and landmark in the game is generated by a script in
`scripts/`.

## License

[MIT](./LICENSE)
