import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetClient, type NetEvents } from './client'

class FakeWebSocket {
  static OPEN = 1
  readyState = FakeWebSocket.OPEN
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {
    this.onclose?.()
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  open(): void {
    this.onopen?.()
  }

  static instances: FakeWebSocket[] = []
}

function events(overrides: Partial<NetEvents> = {}): NetEvents {
  return {
    onPeerJoin: vi.fn(),
    onPeerState: vi.fn(),
    onPeerLeave: vi.fn(),
    onStatus: vi.fn(),
    onProgress: vi.fn(),
    onChat: vi.fn(),
    ...overrides,
  }
}

describe('NetClient holder ship visual sync', () => {
  const OriginalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (OriginalWebSocket) vi.stubGlobal('WebSocket', OriginalWebSocket)
  })

  it('sends the selected holder visual when entering and updating the game', () => {
    const net = new NetClient('ACE', 'tok', events())

    net.enterGame('ACE', 'fighter', 'sovereign-wraith')
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(ws.sent[0]).toMatchObject({
      t: 'join',
      name: 'ACE',
      ship: 'fighter',
      visual: 'sovereign-wraith',
    })

    net.sendState([1, 2, 3], [0, 0, 0, 1], 1000, 'fighter', 'void-interceptor')

    expect(ws.sent[1]).toMatchObject({
      t: 'state',
      ship: 'fighter',
      visual: 'void-interceptor',
    })
  })

  it('keeps peer holder visuals from snapshots and live state updates', () => {
    const joined = vi.fn()
    const stated = vi.fn()
    const net = new NetClient('VIEWER', 'tok', events({ onPeerJoin: joined, onPeerState: stated }))

    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit({
      t: 'welcome',
      id: 'self',
      peers: [{
        id: 'p1',
        name: 'RIVAL',
        color: 1,
        p: [0, 0, 0],
        q: [0, 0, 0, 1],
        ship: 'miner',
        visual: 'void-interceptor',
        tier: 3,
      }],
    })

    expect(joined).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p1',
      ship: 'miner',
      visual: 'void-interceptor',
      tier: 3,
    }))

    ws.emit({
      t: 'peer-state',
      id: 'p1',
      p: [1, 0, 0],
      q: [0, 0, 0, 1],
      ship: 'miner',
      visual: 'sovereign-wraith',
    })

    expect(stated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p1',
      visual: 'sovereign-wraith',
    }))
  })

  it('sends marketplace commands and emits marketplace responses', () => {
    const onMarketList = vi.fn()
    const onMarketAction = vi.fn()
    const net = new NetClient('ACE', 'tok', events({ onMarketList, onMarketAction }))

    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(net.requestMarketList()).toBe(true)
    expect(net.createMarketListing('item-1', 25000)).toBe(true)
    expect(net.buyMarketListing('listing-1')).toBe(true)
    expect(net.cancelMarketListing('listing-1')).toBe(true)

    expect(ws.sent.slice(1)).toEqual([
      { t: 'market-list' },
      { t: 'market-create', itemId: 'item-1', price: 25000, currency: 'credits' },
      { t: 'market-buy', listingId: 'listing-1' },
      { t: 'market-cancel', listingId: 'listing-1' },
    ])

    ws.emit({ t: 'market-list', rows: [{ id: 'listing-1', price: 25000 }] })
    ws.emit({ t: 'market-action', ok: true, action: 'buy', progress: { credits: 25000 } })

    expect(onMarketList).toHaveBeenCalledWith([{ id: 'listing-1', price: 25000 }])
    expect(onMarketAction).toHaveBeenCalledWith({ ok: true, action: 'buy', progress: { credits: 25000 } })
  })

  it('createMarketListing with token currency sends currency field', () => {
    const net = new NetClient('ACE', 'tok', events())
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(net.createMarketListing('item-1', 1250, 'token')).toBe(true)

    const frame = ws.sent[ws.sent.length - 1]
    expect(frame).toEqual({ t: 'market-create', itemId: 'item-1', price: 1250, currency: 'token' })
  })

  it('requestMarketIntent sends market-intent frame', () => {
    const net = new NetClient('ACE', 'tok', events())
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(net.requestMarketIntent('mkt-1')).toBe(true)

    const frame = ws.sent[ws.sent.length - 1]
    expect(frame).toEqual({ t: 'market-intent', listingId: 'mkt-1' })
  })

  it('buyMarketListing with txSig sends txSig field', () => {
    const net = new NetClient('ACE', 'tok', events())
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(net.buyMarketListing('mkt-1', 'sig-abc')).toBe(true)

    const frame = ws.sent[ws.sent.length - 1]
    expect(frame).toEqual({ t: 'market-buy', listingId: 'mkt-1', txSig: 'sig-abc' })
  })

  it('buyMarketListing without txSig omits txSig key', () => {
    const net = new NetClient('ACE', 'tok', events())
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    expect(net.buyMarketListing('mkt-1')).toBe(true)

    const frame = ws.sent[ws.sent.length - 1]
    expect(frame).toEqual({ t: 'market-buy', listingId: 'mkt-1' })
    expect(frame).not.toHaveProperty('txSig')
  })

  it('inbound market-intent-result calls onMarketIntent with t stripped', () => {
    const onMarketIntent = vi.fn()
    const net = new NetClient('ACE', 'tok', events({ onMarketIntent }))
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.emit({ t: 'market-intent-result', ok: true, listingId: 'mkt-1', txBase64: 'AAA=' })

    expect(onMarketIntent).toHaveBeenCalledWith({ ok: true, listingId: 'mkt-1', txBase64: 'AAA=' })
  })

  it('routes a callsign message to onCallsign', () => {
    const onCallsign = vi.fn()
    const net = new NetClient('ACE', 'tok', events({ onCallsign }))
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()

    ws.emit({ t: 'callsign', name: 'ACE' })

    expect(onCallsign).toHaveBeenCalledWith('ACE')
  })
})

describe('cosmetics protocol', () => {
  const OriginalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (OriginalWebSocket) vi.stubGlobal('WebSocket', OriginalWebSocket)
  })

  it('includes cached cosmetics in the state frame after setCosmetics', () => {
    const net = new NetClient('ACE', 'tok', events())
    net.setCosmetics('aurum-trail-kit:legendary,,')
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()
    net.sendState([0, 0, 0], [0, 0, 0, 1], 999999, 'hauler')
    const sent = ws.sent
    expect(sent.at(-1)).toMatchObject({ t: 'state', cosmetics: 'aurum-trail-kit:legendary,,' })
  })

  it('reads cosmetics from an inbound peer-join', () => {
    const onPeerJoin = vi.fn()
    const net = new NetClient('VIEWER', 'tok', events({ onPeerJoin }))
    net.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.emit({ t: 'peer-join', id: 'p1', name: 'ACE', color: 1, p: [0, 0, 0], q: [0, 0, 0, 1], cosmetics: 'nebula-hull-kit:epic,,' })
    const peer = [...net.getPeers().values()].find((x) => x.id === 'p1')
    expect(peer?.cosmetics).toBe('nebula-hull-kit:epic,,')
  })
})
