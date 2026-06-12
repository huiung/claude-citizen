// Day 0 relay server: a dumb mirror. No auth, no persistence, no validation
// beyond message shape — there is nothing to cheat at yet.
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT ?? 8080
const wss = new WebSocketServer({ port: PORT })

let nextColor = 0
const clients = new Map() // ws -> { id, name, color, p, q }

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
      const client = {
        id: Math.random().toString(36).slice(2, 10),
        name: String(msg.name ?? 'PILOT').slice(0, 16),
        color: nextColor++,
        p: [0, 0, 0],
        q: [0, 0, 0, 1],
      }
      clients.set(ws, client)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers: [...clients.values()].filter((c) => c !== client) }))
      broadcast(ws, { t: 'peer-join', ...client })
      console.log(`[join] ${client.name} (${client.id}) — ${clients.size} online`)
      return
    }

    const client = clients.get(ws)
    if (!client) return
    if (msg.t === 'state' && Array.isArray(msg.p) && Array.isArray(msg.q)) {
      client.p = msg.p.slice(0, 3).map(Number)
      client.q = msg.q.slice(0, 4).map(Number)
      broadcast(ws, { t: 'peer-state', id: client.id, p: client.p, q: client.q })
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

console.log(`star-citizen-caliber relay listening on :${PORT}`)
