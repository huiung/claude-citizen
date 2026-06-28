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
| `BOT_CHAT_COOLDOWN_MS` | `6000` | Optional — minimum gap between chat replies (default 6s). |
| `BOT_MODEL` | `claude-haiku-4-5` | Optional — the default. |
| `BOT_COSMETIC_SECRET` | (any random string) | Optional. Set the SAME value as the relay service's `BOT_COSMETIC_SECRET` to grant CLAUDE the Void Interceptor (T3) skin. Cosmetic only. |

4. Deploy. CLAUDE connects to the prod relay and goes live.

## Notes

- **Run exactly one instance.** Each process uses a unique token by default; two instances with a
  pinned `BOT_TOKEN` would kick each other off the relay in a reconnect war.
- **Speaks only in reply.** CLAUDE has no periodic self-chatter — the brain (Claude API) fires only
  when another pilot chats, throttled by `BOT_CHAT_COOLDOWN_MS`. It flies continuously regardless.
- **Cost** (Haiku 4.5, ~$1/$5 per Mtok): only pays per chat reply (~450 in / ~50 out tokens each),
  so cost tracks how chatty the lobby is rather than wall-clock time. Idle lobby ≈ near-zero spend.
- The streaming / VTuber layer (avatar, voice, Twitch) is a separate future layer that would consume
  this bot's chat/“thinking” output — not included here.
