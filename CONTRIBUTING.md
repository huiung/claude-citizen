# Contributing

Welcome aboard. The bar for a first contribution is intentionally low — grab anything
labeled `good first issue`, or open an issue if you have a better idea.

## Setup

```bash
npm install
npm run server &   # multiplayer relay on :8080
npm run dev        # http://localhost:5173
npm test           # physics unit tests
```

## The one rule

**Click to flight in 60 seconds.** Any feature that adds a download, a required account,
a forced tutorial, or a long load gets rejected — no matter how cool it is.

## Code map

| Path | What | Rule |
|---|---|---|
| `src/sim/` | Flight physics & game state | Pure logic. No three.js rendering, no network. Changes need tests. |
| `src/render/` | Three.js rendering, procedural generation | Reads sim state, never mutates it. **No asset files** — everything is generated. |
| `src/net/` | WebSocket client protocol | Position snapshots + interpolation. |
| `server/` | Relay server | Dumb mirror for now, on purpose. |

## PRs

- Keep them small and focused.
- `npm test && npm run build` must pass (CI checks both).
- Game-feel changes (anything touching `TUNING`): include a short clip or describe what changed in the hands.

This project is built with Claude Fable 5 / Claude Code — using AI for your contribution
is welcome and normal here. Receipts in commit messages are appreciated, not required.
