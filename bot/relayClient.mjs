import WebSocket from 'ws'

/**
 * Minimal relay pilot client. `handlers` may include onChat(name,text), onPeerState(id,p),
 * onPeerLeave(id), onOpen(). Auto-reconnects with backoff. The token is a stable anonymous id.
 */
export function createRelayClient({ url, name, token, handlers = {} }) {
  let ws = null
  let reconnectMs = 1000
  const peers = new Map() // id -> last position [x,y,z]

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  function connect() {
    ws = new WebSocket(url)
    ws.on('open', () => {
      reconnectMs = 1000
      send({ t: 'join', name, token, ship: 'fighter', visual: 'standard', cosmetics: {} })
      handlers.onOpen?.()
    })
    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      if (msg.t === 'chat' && typeof msg.text === 'string') handlers.onChat?.(String(msg.name ?? '?'), msg.text)
      else if (msg.t === 'peer-state' && Array.isArray(msg.p)) { peers.set(msg.id, msg.p); handlers.onPeerState?.(msg.id, msg.p) }
      else if (msg.t === 'peer-join') peers.set(msg.id, msg.p ?? [0, 0, 0])
      else if (msg.t === 'peer-leave') { peers.delete(msg.id); handlers.onPeerLeave?.(msg.id) }
    })
    const retry = () => { ws = null; setTimeout(connect, reconnectMs); reconnectMs = Math.min(reconnectMs * 2, 30000) }
    ws.on('close', retry)
    ws.on('error', () => { try { ws.close() } catch { /* already closing */ } })
  }

  return {
    connect,
    peers,
    sendState: (pos, quat) => send({ t: 'state', p: [pos.x, pos.y, pos.z], q: [quat.x, quat.y, quat.z, quat.w], ship: 'fighter', visual: 'standard', cosmetics: {} }),
    sendChat: (text) => send({ t: 'chat', text: String(text).slice(0, 240) }),
  }
}
