import { Vector3 } from 'three'
import { createRelayClient } from './relayClient.mjs'
import { LANDMARKS, pickDestination } from './landmarks.mjs'
import { stepMover } from './mover.mjs'
import { buildBrainContext } from './brainContext.mjs'
import { think } from './brain.mjs'

const URL = process.env.RELAY_WS_URL ?? 'ws://localhost:8080'
const API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const MODEL = process.env.BOT_MODEL ?? 'claude-haiku-4-5'
const TICK_MS = 125                                    // ~8 state updates/sec
const BRAIN_MS = Number(process.env.BOT_BRAIN_MS ?? 15000)
const CHAT_COOLDOWN_MS = Number(process.env.BOT_CHAT_COOLDOWN_MS ?? 6000)
const SPEED = 1200                                     // world units/sec
const TOKEN = process.env.BOT_TOKEN ?? `bot-claude-${Math.floor(Date.now() / 86400000)}`
const landmarkIds = new Set(LANDMARKS.map((l) => l.id))

let pos = LANDMARKS[0].position.clone()
let dest = pickDestination(LANDMARKS, LANDMARKS[0].id, Math.random)
let recentChat = []
let lastChatReplyAt = 0
let thinking = false

const relay = createRelayClient({
  url: URL, name: 'CLAUDE', token: TOKEN,
  handlers: {
    onOpen: () => console.log(`[bot] joined ${URL} as CLAUDE`),
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
      destinationName: LANDMARKS.find((l) => l.position.equals(dest))?.name,
      nearbyPilots: [],
      recentChat,
    })
    const action = await think(ctx, landmarkIds, { apiKey: API_KEY, model: MODEL })
    if (action.say) relay.sendChat(action.say)
    if (action.goto) { const l = LANDMARKS.find((x) => x.id === action.goto); if (l) dest = l.position.clone() }
  } finally { thinking = false }
}

relay.connect()
setInterval(() => {
  const r = stepMover(pos, dest, SPEED, TICK_MS / 1000)
  pos = r.pos
  relay.sendState(pos, r.quat)
  if (r.arrived) dest = pickDestination(LANDMARKS, undefined, Math.random).position.clone()
}, TICK_MS)
setInterval(runBrain, BRAIN_MS)
console.log('[bot] CLAUDE pilot starting…')
