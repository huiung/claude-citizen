// Relay + progress server. Position relay is a dumb mirror; persistence is keyed
// by an anonymous client token (no accounts, no passwords) and flushed to a JSON
// file. Swap STORE_FILE for a volume/DB when hosting for real durability.
import { readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT ?? 8080
const STORE_FILE = process.env.STORE_FILE ?? './progress.json'

let nextColor = 0
const clients = new Map() // ws -> { id, name, color, p, q, token }

// HTTP server: a /stats endpoint for the landing page + the WebSocket upgrade.
const httpServer = createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ online: clients.size, registered: Object.keys(store).length }))
    return
  }
  if (req.url === '/leaderboard') {
    // Top pilots by credits — every activity (mining, bounties, contracts) settles into credits.
    const top = Object.values(store)
      .filter((e) => e && typeof e.credits === 'number')
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 10)
      .map((e) => ({ name: e.name ?? 'PILOT', credits: e.credits }))
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(top))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('star-citizen-caliber relay')
})
const wss = new WebSocketServer({ server: httpServer })

// --- Token-keyed progress store (anonymous, no accounts)
let store = {}
try { store = JSON.parse(readFileSync(STORE_FILE, 'utf8')) } catch { store = {} }
let flushTimer = null
function flush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try { writeFileSync(STORE_FILE, JSON.stringify(store)) } catch { /* disk unavailable */ }
  }, 2000)
}

/** Accept only the small, known progress shape — never trust the client blindly. */
function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null
  return {
    credits: Number(p.credits) || 0,
    cargo: { ORE: Number(p.cargo?.ORE) || 0, ALLOY: Number(p.cargo?.ALLOY) || 0 },
    upgrades: {
      cargo: Number(p.upgrades?.cargo) || 0,
      speed: Number(p.upgrades?.speed) || 0,
      boost: Number(p.upgrades?.boost) || 0,
    },
    hangar: {
      selected: String(p.hangar?.selected ?? 'hauler').slice(0, 16),
      owned: Array.isArray(p.hangar?.owned) ? p.hangar.owned.slice(0, 16).map((t) => String(t).slice(0, 16)) : ['hauler'],
    },
  }
}

function broadcast(from, msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients.keys()) {
    if (ws !== from && ws.readyState === ws.OPEN) ws.send(data)
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    // Viewer presence — someone on the landing page. Counts toward "online" but is NOT
    // a peer (no ship, never broadcast). Promoted to an active pilot on 'join' (LAUNCH).
    if (msg.t === 'hello' && !clients.has(ws)) {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null
      clients.set(ws, {
        id: Math.random().toString(36).slice(2, 10),
        name: null, color: -1, p: [0, 0, 0], q: [0, 0, 0, 1], token, active: false,
      })
      if (token && !(token in store)) { store[token] = null; flush() } // seen → counts as registered
      console.log(`[hello] viewer — ${clients.size} online`)
      return
    }

    if (msg.t === 'join') {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null
      let client = clients.get(ws)
      if (client) {
        // Promote an existing viewer into an active pilot.
        client.active = true
        client.name = String(msg.name ?? 'PILOT').slice(0, 16)
        client.color = nextColor++
        if (token) client.token = token
      } else {
        client = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(msg.name ?? 'PILOT').slice(0, 16),
          color: nextColor++, p: [0, 0, 0], q: [0, 0, 0, 1], token, active: true,
        }
        clients.set(ws, client)
      }
      // Only active pilots are peers (have ships).
      const peers = [...clients.values()].filter((c) => c.active && c !== client).map(({ token: _t, active: _a, ...rest }) => rest)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers }))
      if (client.token) {
        if (store[client.token]) ws.send(JSON.stringify({ t: 'progress', data: store[client.token] }))
        else if (!(client.token in store)) { store[client.token] = null; flush() }
      }
      broadcast(ws, { t: 'peer-join', id: client.id, name: client.name, color: client.color, p: client.p, q: client.q })
      console.log(`[join] ${client.name} (${client.id})${client.token ? ' +token' : ''} — ${clients.size} online`)
      return
    }

    const client = clients.get(ws)
    if (!client) return

    if (msg.t === 'state' && client.active && Array.isArray(msg.p) && Array.isArray(msg.q)) {
      client.p = msg.p.slice(0, 3).map(Number)
      client.q = msg.q.slice(0, 4).map(Number)
      broadcast(ws, { t: 'peer-state', id: client.id, p: client.p, q: client.q })
      return
    }

    if (msg.t === 'save' && client.token) {
      const clean = sanitizeProgress(msg.progress)
      if (clean) { clean.name = client.name; store[client.token] = clean; flush() } // stamp callsign for the leaderboard
      return
    }

    if (msg.t === 'chat' && typeof msg.text === 'string') {
      const now = Date.now()
      if (now - (client.lastChat ?? 0) < 700) return // rate limit
      client.lastChat = now
      const text = msg.text.slice(0, 160).trim()
      if (text) {
        const out = { t: 'chat', name: client.name, text }
        broadcast(ws, out)
        ws.send(JSON.stringify(out)) // echo to sender so they see their own line
      }
      return
    }
  })

  ws.on('close', () => {
    const client = clients.get(ws)
    if (!client) return
    clients.delete(ws)
    broadcast(ws, { t: 'peer-leave', id: client.id })
    console.log(`[leave] ${client.name} — ${clients.size} online`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`star-citizen-caliber relay listening on :${PORT} (store: ${STORE_FILE})`)
})
