// WebSocket relay client: position relay + token-keyed progress sync.

export interface PeerState {
  id: string
  name: string
  color: number
  p: [number, number, number]
  q: [number, number, number, number]
  ship?: string
  visual?: string
  hull?: number
  maxHull?: number
  receivedAt: number
  prev?: { p: [number, number, number]; q: [number, number, number, number]; receivedAt: number }
  tier?: number // token-holder cosmetic tier: 0 none · 1 gold · 2 cyan · 3 whale
}

/** The small progress blob the server persists per anonymous token. */
export interface PlayerProgress {
  credits: number
  earned: number
  cargo: { ORE: number; ALLOY: number }
  upgrades: { cargo: number; speed: number; boost: number; mining: number }
  hangar: { selected: string; owned: string[] }
  crafting?: {
    cores?: number
    items?: {
      id: string
      recipeId: string
      rarity: string
      variant: string
      createdAt: number
      tradable: boolean
    }[]
    cosmetics?: string[]
  }
}

export interface MarketListingItem {
  id: string
  recipeId: string
  rarity: string
  variant: string
  createdAt: number
  tradable: boolean
}

export interface MarketListing {
  id: string
  sellerKey?: string
  sellerName: string
  sellerShort?: string
  item: MarketListingItem
  price: number
  currency: 'credits' | 'token'
  status: 'active' | 'sold' | 'cancelled'
  createdAt: number
  updatedAt: number
  owned?: boolean
}

export interface MarketActionResult {
  ok: boolean
  action: 'create' | 'buy' | 'cancel' | 'sold'
  reason?: string
  listing?: MarketListing
  progress?: PlayerProgress
}

export interface MarketIntentResult {
  ok: boolean
  reason?: string
  listingId: string
  txBase64?: string
}

export interface NetEvents {
  onPeerJoin(peer: PeerState): void
  onPeerState(peer: PeerState): void
  onPeerLeave(id: string): void
  onStatus(connected: boolean, online: number): void
  /** Server returned saved progress for our token (server is the source of truth). */
  onProgress(progress: PlayerProgress): void
  /** A chat line arrived (including our own, echoed by the server). */
  onChat(name: string, text: string, tier: number): void
  /** This Pilot Code signed in elsewhere — the server closed us and we won't reconnect. */
  onKicked?(): void
  /** Server issued a nonce message to sign. */
  onChallenge?(message: string): void
  /** Auth verified — store pubkey + sessionId. The server also echoes the locked callsign. */
  onAuthOk?(pubkey: string, sessionId: string, name?: string): void
  /** Auth failed or was rejected — stay anonymous. */
  onAuthError?(): void
  /** Our own token-holder status resolved. Tier drives cosmetics; balance drives holder-gated ranked PvP. */
  onHolder?(tier: number, balance: number): void
  /** A peer's holder tier arrived/updated after they joined. */
  onPeerHolder?(id: string, tier: number): void
  onPvpHealth?(id: string, hull: number, maxHull: number, self: boolean): void
  onPvpHit?(targetId: string, hull: number, maxHull: number, damage: number, killed: boolean): void
  onPvpDamage?(attackerName: string, hull: number, maxHull: number, damage: number, killed: boolean): void
  onPvpKill?(killerName: string, victimName: string, reward: number, killerIsSelf: boolean, victimIsSelf: boolean): void
  onPvpReward?(credits: number, victimName: string): void
  onRaceRecorded?(timeMs: number): void
  onMarketList?(rows: MarketListing[]): void
  onMarketAction?(result: MarketActionResult): void
  onMarketIntent?(result: MarketIntentResult): void
  /** Server confirmed/synced the wallet-locked callsign for this session. */
  onCallsign?(name: string): void
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

  private id: string | null = null
  private activeShip: string | undefined
  private activeVisual: string | undefined
  private sessionId: string | null = null

  constructor(private name: string, private token: string, private events: NetEvents) {}

  /** Set before connect/reconnect so hello/join can restore a verified identity. */
  setSession(sessionId: string | null): void {
    this.sessionId = sessionId
  }

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
        ? { t: 'join', name: this.name, token: this.token, sessionId: this.sessionId, ship: this.activeShip, visual: this.activeVisual }
        : { t: 'hello', token: this.token, sessionId: this.sessionId }))
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

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.kicked = true
    this.ws?.close()
    this.ws = null
  }

  private handle(msg: any): void {
    switch (msg.t) {
      case 'kicked':
        this.kicked = true // stop auto-reconnect; the code is live on another device
        this.events.onKicked?.()
        this.ws?.close()
        break
      case 'welcome':
        this.id = typeof msg.id === 'string' ? msg.id : this.id
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
        peer.ship = typeof msg.ship === 'string' ? msg.ship : peer.ship
        peer.visual = typeof msg.visual === 'string' ? msg.visual : peer.visual
        peer.hull = Number.isFinite(Number(msg.hull)) ? Number(msg.hull) : peer.hull
        peer.maxHull = Number.isFinite(Number(msg.maxHull)) ? Number(msg.maxHull) : peer.maxHull
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
        if (typeof msg.text === 'string') this.events.onChat(String(msg.name ?? '?'), msg.text, Number(msg.tier) || 0)
        break
      case 'holder':
        this.events.onHolder?.(Number(msg.tier) || 0, Number(msg.balance) || 0)
        break
      case 'peer-holder': {
        const tier = Number(msg.tier) || 0
        const peer = this.peers.get(msg.id)
        if (peer) peer.tier = tier
        this.events.onPeerHolder?.(String(msg.id), tier)
        break
      }
      case 'pvp-health': {
        const id = String(msg.id ?? '')
        const hull = Number(msg.hull)
        const maxHull = Number(msg.maxHull)
        if (!id || !Number.isFinite(hull) || !Number.isFinite(maxHull)) return
        const peer = this.peers.get(id)
        if (peer) { peer.hull = hull; peer.maxHull = maxHull }
        this.events.onPvpHealth?.(id, hull, maxHull, id === this.id)
        break
      }
      case 'pvp-hit':
        this.events.onPvpHit?.(String(msg.targetId ?? ''), Number(msg.hull) || 0, Number(msg.maxHull) || 1, Number(msg.damage) || 0, Boolean(msg.killed))
        break
      case 'pvp-damage':
        this.events.onPvpDamage?.(String(msg.attackerName ?? 'PILOT'), Number(msg.hull) || 0, Number(msg.maxHull) || 1, Number(msg.damage) || 0, Boolean(msg.killed))
        break
      case 'pvp-kill':
        this.events.onPvpKill?.(
          String(msg.killerName ?? 'PILOT'),
          String(msg.victimName ?? 'PILOT'),
          Number(msg.reward) || 0,
          String(msg.killerId ?? '') === this.id,
          String(msg.victimId ?? '') === this.id,
        )
        break
      case 'pvp-reward':
        this.events.onPvpReward?.(Number(msg.credits) || 0, String(msg.victimName ?? 'PILOT'))
        break
      case 'race-recorded':
        this.events.onRaceRecorded?.(Math.max(0, Math.floor(Number(msg.timeMs) || 0)))
        break
      case 'market-list':
        this.events.onMarketList?.(Array.isArray(msg.rows) ? msg.rows as MarketListing[] : [])
        break
      case 'market-action': {
        const { t: _t, ...result } = msg
        this.events.onMarketAction?.(result as MarketActionResult)
        break
      }
      case 'market-intent-result': {
        const { t: _t, ...result } = msg
        this.events.onMarketIntent?.(result as MarketIntentResult)
        break
      }
      case 'challenge':
        if (typeof msg.message === 'string') this.events.onChallenge?.(msg.message)
        break
      case 'auth-ok':
        if (typeof msg.pubkey === 'string' && typeof msg.sessionId === 'string') {
          this.sessionId = msg.sessionId
          this.events.onAuthOk?.(msg.pubkey, msg.sessionId, typeof msg.name === 'string' ? msg.name : undefined)
        }
        break
      case 'auth-error':
        this.events.onAuthError?.()
        break
      case 'callsign':
        if (typeof msg.name === 'string') this.events.onCallsign?.(msg.name)
        break
    }
  }

  private addPeer(raw: any): void {
    const peer: PeerState = {
      id: raw.id, name: raw.name, color: raw.color,
      p: raw.p ?? [0, 0, 0], q: raw.q ?? [0, 0, 0, 1],
      ship: typeof raw.ship === 'string' ? raw.ship : undefined,
      visual: typeof raw.visual === 'string' ? raw.visual : undefined,
      hull: Number.isFinite(Number(raw.hull)) ? Number(raw.hull) : undefined,
      maxHull: Number.isFinite(Number(raw.maxHull)) ? Number(raw.maxHull) : undefined,
      receivedAt: performance.now(),
      tier: Number(raw.tier) || 0,
    }
    this.peers.set(peer.id, peer)
    this.events.onPeerJoin(peer)
  }

  sendState(p: [number, number, number], q: [number, number, number, number], now: number, ship?: string, visual?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    if (now - this.lastSend < 1000 / SEND_HZ) return
    this.lastSend = now
    if (ship) this.activeShip = ship
    if (visual) this.activeVisual = visual
    this.ws.send(JSON.stringify({ t: 'state', p, q, ship: this.activeShip, visual: this.activeVisual }))
  }

  /** Update the callsign sent on join (call before connect once the player picks one). */
  setName(name: string): void {
    this.name = name
  }

  /** Promote from viewer (presence) to an active in-game pilot — call on LAUNCH. */
  enterGame(name: string, ship?: string, visual?: string): void {
    this.name = name
    if (ship) this.activeShip = ship
    if (visual) this.activeVisual = visual
    this.active = true
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'join', name, token: this.token, sessionId: this.sessionId, ship: this.activeShip, visual: this.activeVisual }))
    }
    // If the socket isn't open yet, onopen will send 'join' since active is now true.
  }

  /** Persist progress under our token (no-op if disconnected). */
  saveProgress(progress: PlayerProgress): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ t: 'save', progress }))
  }

  /** Step 1 of SIWS: ask the server for a nonce to sign. */
  requestChallenge(pubkey: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ t: 'auth-challenge', pubkey }))
  }

  /** Step 2 of SIWS: submit the signature (+ current anon token for claim). */
  submitAuth(pubkey: string, signature: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ t: 'auth', pubkey, signature, anonToken: this.token }))
  }

  /** Returns true if a chat line was sent (false when offline). */
  sendChat(text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'chat', text }))
    return true
  }

  sendPvpHit(targetId: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'pvp-hit', targetId }))
    return true
  }

  sendPvpRespawn(p: [number, number, number], q: [number, number, number, number], ship?: string, visual?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    if (ship) this.activeShip = ship
    if (visual) this.activeVisual = visual
    this.ws.send(JSON.stringify({ t: 'pvp-respawn', p, q, ship: this.activeShip, visual: this.activeVisual }))
    return true
  }

  sendRaceFinish(timeMs: number): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'race-finish', timeMs }))
    return true
  }

  requestMarketList(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'market-list' }))
    return true
  }

  createMarketListing(itemId: string, price: number, currency: 'credits' | 'token' = 'credits'): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'market-create', itemId, price, currency }))
    return true
  }

  requestMarketIntent(listingId: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'market-intent', listingId }))
    return true
  }

  buyMarketListing(listingId: string, txSig?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'market-buy', listingId, ...(txSig ? { txSig } : {}) }))
    return true
  }

  cancelMarketListing(listingId: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'market-cancel', listingId }))
    return true
  }

  getPeers(): ReadonlyMap<string, PeerState> {
    return this.peers
  }
}
