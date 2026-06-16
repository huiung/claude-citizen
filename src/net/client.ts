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
  /** This Pilot Code signed in elsewhere — the server closed us and we won't reconnect. */
  onKicked?(): void
}

const SEND_HZ = 10

export class NetClient {
  private ws: WebSocket | null = null
  private peers = new Map<string, PeerState>()
  private lastSend = 0
  private online = 1
  private active = false // false = viewer (presence only), true = in-game pilot
  private reconnectDelay = 2000 // backoff between reconnect attempts (ms)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private kicked = false // signed in elsewhere — stop reconnecting

  constructor(private name: string, private token: string, private events: NetEvents) {}

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000) // back off, cap at 30s
  }

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
      this.reconnectDelay = 2000 // connected — reset backoff
      // Viewer presence by default; a full 'join' once the player launches.
      this.ws?.send(JSON.stringify(this.active
        ? { t: 'join', name: this.name, token: this.token }
        : { t: 'hello', token: this.token }))
      this.events.onStatus(true, this.online)
    }
    this.ws.onclose = () => {
      this.peers.forEach((_, id) => this.events.onPeerLeave(id))
      this.peers.clear()
      this.online = 1
      this.events.onStatus(false, 1)
      if (!this.kicked) this.scheduleReconnect() // auto-recover — unless we were signed in elsewhere
    }
    this.ws.onerror = () => this.ws?.close()
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string))
  }

  private handle(msg: any): void {
    switch (msg.t) {
      case 'kicked':
        this.kicked = true // stop auto-reconnect; the code is live on another device
        this.events.onKicked?.()
        this.ws?.close()
        break
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

  /** Update the callsign sent on join (call before connect once the player picks one). */
  setName(name: string): void {
    this.name = name
  }

  /** Promote from viewer (presence) to an active in-game pilot — call on LAUNCH. */
  enterGame(name: string): void {
    this.name = name
    this.active = true
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'join', name, token: this.token }))
    }
    // If the socket isn't open yet, onopen will send 'join' since active is now true.
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
