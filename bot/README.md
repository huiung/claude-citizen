# CLAUDE — AI Pilot Bot

A standalone Node service that joins the multiplayer relay as the pilot **CLAUDE**, flies between
named landmarks (loitering near the start outposts so real pilots actually encounter it), and chats
with players — driven by the Claude API. Openly an AI. It never saves progress, so it can't touch
the Career leaderboard or economy.

It is **separate from the relay** (`npm run server`). Running it does not happen automatically — you
start it as its own process/service.

## Run locally

```bash
# relay on :8080 in one terminal
npm run server

# bot in another — point it at the relay and give it a key
RELAY_WS_URL=ws://localhost:8080 ANTHROPIC_API_KEY=sk-ant-... npm run bot
```

Open the game (`npm run dev`), fly near the start outposts, and CLAUDE should show up and chat.
Without `ANTHROPIC_API_KEY` the bot still flies (the brain no-ops) — handy for a presence-only test.

## Deploy on Railway (separate service)

The bot is a second service in the same project, with its own start command and env vars:

1. **Railway → your project → New → "Deploy from repo"** (this repo), or add a new **Service** to the
   existing project.
2. Set its **Start Command** to `npm run bot`.
3. Set **Variables** (Variables tab):

| Variable | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Secret. Never commit it. |
| `RELAY_WS_URL` | `wss://star-citizen-caliber-production.up.railway.app` | The prod relay. Must be `wss://` (TLS). The code's default is `ws://localhost:8080`, so this override is required. |
| `BOT_BRAIN_MS` | `30000` | Optional — 30s between brain calls ≈ half the cost of the 15s default. |
| `BOT_MODEL` | `claude-haiku-4-5` | Optional — the default. |

4. Deploy. CLAUDE connects to the prod relay and goes live.

## Notes

- **Run exactly one instance.** Each process uses a unique token by default; two instances with a
  pinned `BOT_TOKEN` would kick each other off the relay in a reconnect war.
- **Cost** (Haiku 4.5, ~$1/$5 per Mtok): roughly **$0.17/hr** at the 15s tick (~450 in / ~50 out
  tokens per call), plus chat replies. `$5 ≈ ~15–30 hours`. Raise `BOT_BRAIN_MS` to stretch it.
- The streaming / VTuber layer (avatar, voice, Twitch) is a separate future layer that would consume
  this bot's chat/“thinking” output — not included here.
