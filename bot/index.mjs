import { createRelayClient } from './relayClient.mjs'
import { LANDMARKS, BOT_WORLD } from './landmarks.mjs'
import { stepMover } from './mover.mjs'
import { buildBrainContext } from './brainContext.mjs'
import { think } from './brain.mjs'
import { buildActivity, pickActivity, stepActivity } from './activities.mjs'

const URL = process.env.RELAY_WS_URL ?? 'ws://localhost:8080'
const API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const MODEL = process.env.BOT_MODEL ?? 'claude-haiku-4-5'
const TICK_MS = 125                                    // ~8 state updates/sec
const CHAT_COOLDOWN_MS = Number(process.env.BOT_CHAT_COOLDOWN_MS ?? 6000)
// Unique per process by default: two bot instances sharing one token would kick each other off the
// relay in a reconnect war (the bot saves no progress, so a stable identity isn't needed). Pin via
// BOT_TOKEN only if you deliberately want a fixed identity and run exactly one instance.
const TOKEN = process.env.BOT_TOKEN ?? `bot-claude-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const SHIP = 'interceptor'
const VISUAL = 'void-interceptor' // T3 holder hull skin (relay grants the cosmetic tier via BOT_COSMETIC_SECRET)
const COSMETICS = 'comet-wake-kit:legendary,nebula-hull-kit:legendary,void-runner-kit:legendary'
const BOT_COSMETIC_SECRET = process.env.BOT_COSMETIC_SECRET ?? ''

// Start at the loiter area (refinery) so the camera drone, which spawns at the player start, is
// within CLAUDE's AOI from the first frame.
let pos = (LANDMARKS.find((l) => l.id === 'refinery') ?? LANDMARKS[0]).position.clone()
let activity = buildActivity(pickActivity(null, Math.random), pos, Math.random, Date.now(), BOT_WORLD)
let recentChat = []
let lastChatReplyAt = 0
let thinking = false

const relay = createRelayClient({
  url: URL, name: 'CLAUDE', token: TOKEN,
  ship: SHIP, visual: VISUAL, cosmetics: COSMETICS, botSecret: BOT_COSMETIC_SECRET,
  handlers: {
    onOpen: () => { console.log(`[bot] joined ${URL} as CLAUDE`); relay.sendChat(activity.intro) },
    onChat: (name, text) => {
      if (name === 'CLAUDE') return // ignore our own echoed lines
      recentChat.push({ name, text })
      recentChat = recentChat.slice(-12)
      const now = Date.now()
      if (now - lastChatReplyAt > CHAT_COOLDOWN_MS) { lastChatReplyAt = now; void runBrain() }
    },
  },
})

function nearestLandmarkName(p) {
  let best = LANDMARKS[0], bd = Infinity
  for (const l of LANDMARKS) { const d = l.position.distanceToSquared(p); if (d < bd) { bd = d; best = l } }
  return Math.sqrt(bd) < 6000 ? `near ${best.name}` : 'deep space'
}

async function runBrain() {
  if (thinking || !API_KEY) return
  thinking = true
  try {
    const ctx = buildBrainContext({
      location: nearestLandmarkName(pos),
      currentActivity: `${activity.kind}${activity.name ? ' -> ' + activity.name : ''}`,
      recentChat,
    })
    const action = await think(ctx, { apiKey: API_KEY, model: MODEL })
    if (action.say) relay.sendChat(action.say)
  } finally { thinking = false }
}

relay.connect()
setInterval(() => {
  const now = Date.now()
  const cmd = stepActivity(activity, pos, TICK_MS / 1000, now, BOT_WORLD)
  const r = stepMover(pos, cmd.target, cmd.speed, TICK_MS / 1000)
  pos = r.pos
  relay.sendState(pos, r.quat)
  if (cmd.done) {
    activity = buildActivity(pickActivity(activity.kind, Math.random), pos, Math.random, now, BOT_WORLD)
    relay.sendChat(activity.intro)
  }
}, TICK_MS)
// No periodic self-chatter: CLAUDE only speaks in reply to other pilots' chat (see onChat). It flies
// continuously via the activity system above, announcing transitions.
console.log('[bot] CLAUDE pilot starting…')
