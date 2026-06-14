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

    if (msg.t === 'join' && !clients.has(ws)) {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null
      const client = {
        id: Math.random().toString(36).slice(2, 10),
        name: String(msg.name ?? 'PILOT').slice(0, 16),
        color: nextColor++,
        p: [0, 0, 0],
        q: [0, 0, 0, 1],
        token,
      }
      clients.set(ws, client)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers: [...clients.values()].filter((c) => c !== client).map(({ token: _t, ...rest }) => rest) }))
      // Hand back saved progress for this token, if any.
      if (token && store[token]) ws.send(JSON.stringify({ t: 'progress', data: store[token] }))
      broadcast(ws, { t: 'peer-join', id: client.id, name: client.name, color: client.color, p: client.p, q: client.q })
      console.log(`[join] ${client.name} (${client.id})${token ? ' +token' : ''} — ${clients.size} online`)
      return
    }

    const client = clients.get(ws)
    if (!client) return

    if (msg.t === 'state' && Array.isArray(msg.p) && Array.isArray(msg.q)) {
      client.p = msg.p.slice(0, 3).map(Number)
      client.q = msg.q.slice(0, 4).map(Number)
      broadcast(ws, { t: 'peer-state', id: client.id, p: client.p, q: client.q })
      return
    }

    if (msg.t === 'save' && client.token) {
      const clean = sanitizeProgress(msg.progress)
      if (clean) { store[client.token] = clean; flush() }
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
