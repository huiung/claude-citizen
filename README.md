# STAR CITIZEN CALIBER

> An open-source attempt to finish Star Citizen before Star Citizen does.

**They've had 14 years and $800M. We have Claude Fable 5 and weekends.**

![Day 0 flight — procedural everything, real-time multiplayer, in the browser](./docs/flight.gif)

> ⚠️ **Not affiliated with Cloud Imperium Games or Roberts Space Industries.**
> This is an independent open-source project. "Star Citizen" is referenced purely
> as a comparison target. No assets, names, lore, or code from the original are used —
> everything here is procedurally generated or written from scratch.

## Play now

Runs in your browser. No account. No 30,000-word backstory. **Clone → fly in under 60 seconds.**
That's the one rule of this project: every feature that breaks "60 seconds to flight" gets rejected.
(Hosted instance — click-to-fly, zero install — coming this week.)

```bash
git clone https://github.com/huiung/star-citizen-caliber
cd star-citizen-caliber
npm install
npm run server &   # multiplayer relay on :8080
npm run dev        # open http://localhost:5173, enter a callsign, LAUNCH
```

Other pilots on the same server show up next to you in real time. That's it. That's the MMO (so far).

## What works today (Day 0)

- 6DOF spaceflight in your browser — coupled (flight assist) and decoupled (full Newton) modes
- A space station, a planet, an asteroid belt — 100% procedurally generated, zero asset files
- Real-time multiplayer: see other pilots' ships and callsigns
- Physics covered by tests, because "built with AI" shouldn't mean "built badly"

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

## Roadmap

| Phase | What | Status |
|---|---|---|
| 0 | Flyable browser sandbox + multiplayer presence | ✅ shipped (day one) |
| 1 | Docking, one cargo-hauling loop, credits | next |
| 2 | Persistence — your ship is still yours tomorrow | planned |
| 3 | More ships, mining, simple PvP | planned |
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
