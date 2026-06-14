// WebSocket relay client: position relay + token-keyed progress sync.

export interface PeerState {
  id: string
  name: string
  color: number
  p: [number, number, number]
  q: [number, number, number, number]
  receivedAt: number
  prev?: { p: [number, number, number]; q: [number, number, number, number]; receivedAt: number }
}

/** The small progress blob the server persists per anonymous token. */
export interface PlayerProgress {
  credits: number
  cargo: { ORE: number; ALLOY: number }
  upgrades: { cargo: number; speed: number; boost: number }
  hangar: { selected: string; owned: string[] }
}

export interface NetEvents {
  onPeerJoin(peer: PeerState): void
  onPeerState(peer: PeerState): void
  onPeerLeave(id: string): void
  onStatus(connected: boolean, online: number): void
  /** Server returned saved progress for our token (server is the source of truth). */
  onProgress(progress: PlayerProgress): void
  /** A chat line arrived (including our own, echoed by the server). */
  onChat(name: string, text: string): void
}

const SEND_HZ = 10

export class NetClient {
  private ws: WebSocket | null = null
  private peers = new Map<string, PeerState>()
  private lastSend = 0
  private online = 1

  constructor(private name: string, private token: string, private events: NetEvents) {}

  connect(): void {
    const url = import.meta.env.VITE_WS_URL
      ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`
    try {
      this.ws = new WebSocket(url)
    } catch {
      this.events.onStatus(false, 1)
      return
    }
    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ t: 'join', name: this.name, token: this.token }))
      this.events.onStatus(true, this.online)
    }
    this.ws.onclose = () => {
      this.peers.forEach((_, id) => this.events.onPeerLeave(id))
      this.peers.clear()
      this.events.onStatus(false, 1)
    }
    this.ws.onerror = () => this.ws?.close()
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string))
  }

  private handle(msg: any): void {
    switch (msg.t) {
      case 'welcome':
        for (const peer of msg.peers) this.addPeer(peer)
        this.online = msg.peers.length + 1
        this.events.onStatus(true, this.online)
        break
      case 'peer-join':
        this.addPeer(msg)
        this.online++
        this.events.onStatus(true, this.online)
        break
      case 'peer-state': {
        const peer = this.peers.get(msg.id)
        if (!peer) return
        peer.prev = { p: peer.p, q: peer.q, receivedAt: peer.receivedAt }
        peer.p = msg.p; peer.q = msg.q; peer.receivedAt = performance.now()
        this.events.onPeerState(peer)
        break
      }
      case 'peer-leave':
        if (this.peers.delete(msg.id)) {
          this.online = Math.max(1, this.online - 1)
          this.events.onPeerLeave(msg.id)
          this.events.onStatus(true, this.online)
        }
        break
      case 'progress':
        if (msg.data) this.events.onProgress(msg.data as PlayerProgress)
        break
      case 'chat':
        if (typeof msg.text === 'string') this.events.onChat(String(msg.name ?? '?'), msg.text)
        break
    }
  }

  private addPeer(raw: any): void {
    const peer: PeerState = {
      id: raw.id, name: raw.name, color: raw.color,
      p: raw.p ?? [0, 0, 0], q: raw.q ?? [0, 0, 0, 1],
      receivedAt: performance.now(),
    }
    this.peers.set(peer.id, peer)
    this.events.onPeerJoin(peer)
  }

  sendState(p: [number, number, number], q: [number, number, number, number], now: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (now - this.lastSend < 1000 / SEND_HZ) return
    this.lastSend = now
    this.ws.send(JSON.stringify({ t: 'state', p, q }))
  }

  /** Persist progress under our token (no-op if disconnected). */
  saveProgress(progress: PlayerProgress): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ t: 'save', progress }))
  }

  /** Returns true if a chat line was sent (false when offline). */
  sendChat(text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'chat', text }))
    return true
  }

  getPeers(): ReadonlyMap<string, PeerState> {
    return this.peers
  }
}
