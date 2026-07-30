// Callsign uniqueness over a REAL relay process and REAL sockets.
//
// callsigns.test.mjs pins the pure rules; this file pins the WIRING, which is the part a future
// refactor is most likely to break silently — dropping the grantCallsign call at one of its three
// call sites, or reordering it past resolveClaim, leaves every unit test green while the lock stops
// working. The wallet handshake is plain ed25519 over a nonce message, so a genuine signing wallet
// runs headlessly here: nothing about this flow is faked.
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

const SERVER_ENTRY = fileURLToPath(new URL('./index.mjs', import.meta.url))

/** The relay logs the PORT env var rather than the bound port, so pick a free one up front. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function makeWallet() {
  const kp = nacl.sign.keyPair()
  return {
    pubkey: bs58.encode(kp.publicKey),
    sign: (message) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)),
  }
}

let relay
let port

/** A connected test pilot: buffers inbound frames so assertions can await one by type. */
class Pilot {
  constructor(token) { this.token = token; this.frames = [] }

  static async open(token) {
    const pilot = new Pilot(token)
    pilot.ws = new WebSocket(`ws://127.0.0.1:${port}`)
    pilot.ws.on('message', (raw) => { try { pilot.frames.push(JSON.parse(raw)) } catch { /* not ours */ } })
    await new Promise((resolve, reject) => { pilot.ws.once('open', resolve); pilot.ws.once('error', reject) })
    return pilot
  }

  send(msg) { this.ws.send(JSON.stringify(msg)) }

  /** Await a frame of one of `types`, removing it from the buffer. null on timeout. */
  async wait(types, ms = 4000) {
    const wanted = Array.isArray(types) ? types : [types]
    const deadline = Date.now() + ms
    for (;;) {
      const hit = this.frames.find((f) => wanted.includes(f.t))
      if (hit) { this.frames = this.frames.filter((f) => f !== hit); return hit }
      if (Date.now() > deadline) return null
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  seen(t) { return this.frames.some((f) => f.t === t) }

  /** Full SIWS handshake with a real signature. Resolves to the auth-ok/auth-error frame. */
  async link(wallet) {
    this.send({ t: 'auth-challenge', pubkey: wallet.pubkey })
    const challenge = await this.wait('challenge')
    expect(challenge, 'relay should issue a nonce challenge').not.toBe(null)
    this.send({ t: 'auth', pubkey: wallet.pubkey, signature: wallet.sign(challenge.message), anonToken: this.token })
    return this.wait(['auth-ok', 'auth-error'])
  }

  /** Link a wallet from the landing page (viewer presence), then launch under `name`. */
  static async launchWithWallet(token, wallet, name) {
    const pilot = await Pilot.open(token)
    pilot.send({ t: 'hello', token })
    await pilot.link(wallet)
    pilot.send({ t: 'join', name, token })
    await pilot.wait('welcome')
    return pilot
  }

  close() { try { this.ws.close() } catch { /* already gone */ } }
}

beforeAll(async () => {
  port = await freePort()
  // Temp store dir: progress.json, callsigns.json and friends must not touch the real ones.
  const dir = mkdtempSync(join(tmpdir(), 'callsign-relay-'))
  relay = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port), STORE_FILE: join(dir, 'progress.json'), HELIUS_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    let out = ''
    relay.stdout.on('data', (chunk) => { out += chunk; if (out.includes('listening')) resolve() })
    relay.on('exit', (code) => reject(new Error(`relay exited early (${code}): ${out}`)))
    setTimeout(() => reject(new Error(`relay never listened: ${out}`)), 10_000)
  })
}, 20_000)

afterAll(async () => {
  if (!relay) return
  const exited = new Promise((r) => relay.once('exit', r))
  relay.kill('SIGTERM')
  await exited
})

describe('callsign uniqueness over a live relay', () => {
  const walletA = makeWallet()
  const walletB = makeWallet()
  const open = []
  afterAll(() => open.forEach((p) => p.close()))

  it('grants a free callsign to the first wallet that asks', async () => {
    const a = await Pilot.launchWithWallet('anon-a', walletA, 'ACE')
    open.push(a)
    expect((await a.wait('callsign'))?.name).toBe('ACE')
    expect(a.seen('callsign-taken')).toBe(false)
    // Persist the row so the sticky lock has something to read (in-memory is immediate).
    a.send({ t: 'save', progress: { credits: 10, cargo: { ORE: 0, ALLOY: 0 } } })
  })

  it('refuses a different wallet, tells it why, and does NOT block the flight', async () => {
    const b = await Pilot.launchWithWallet('anon-b', walletB, 'ACE')
    open.push(b)
    const taken = await b.wait('callsign-taken')
    expect(taken).toMatchObject({ requested: 'ACE', name: 'PILOT' })
    expect(taken.message).toMatch(/another wallet/i)
    expect(taken.message).toMatch(/pick a different/i)
    expect(b.ws.readyState).toBe(WebSocket.OPEN) // refused the name, not the flight
  })

  it('refuses case and whitespace variants of a locked callsign', async () => {
    for (const variant of ['ace', 'Ace', 'ACE ', ' aCe']) {
      const v = await Pilot.launchWithWallet(`anon-v-${variant.trim()}-${variant.length}`, makeWallet(), variant)
      open.push(v)
      expect((await v.wait('callsign-taken'))?.name, `${JSON.stringify(variant)} should collide`).toBe('PILOT')
    }
  })

  it('lets the owning wallet reclaim its callsign on a later connection', async () => {
    const again = await Pilot.launchWithWallet('anon-a', walletA, 'ACE')
    open.push(again)
    expect((await again.wait('callsign'))?.name).toBe('ACE')
    expect(again.seen('callsign-taken')).toBe(false)
  })

  it('keeps the lock permanent — the owning wallet cannot rename itself', async () => {
    const renamed = await Pilot.launchWithWallet('anon-a', walletA, 'RENAMED')
    open.push(renamed)
    expect((await renamed.wait('callsign'))?.name).toBe('ACE')
  })

  // The regression that matters most: the anonymous path must stay completely unrestricted.
  it('lets an anonymous pilot fly under a wallet-locked callsign, unchallenged', async () => {
    const anon = await Pilot.open('anon-free')
    open.push(anon)
    anon.send({ t: 'join', name: 'ACE', token: 'anon-free' })
    expect(await anon.wait('welcome')).not.toBe(null)
    await anon.wait('progress') // drain the join-time "nothing saved" frame
    expect(anon.seen('callsign-taken')).toBe(false)
    expect(anon.seen('callsign')).toBe(false) // no name is forced on an anonymous pilot
  })

  it('lets an anonymous pilot fly under a case variant of a locked callsign too', async () => {
    const anon = await Pilot.open('anon-free-2')
    open.push(anon)
    anon.send({ t: 'join', name: 'ace', token: 'anon-free-2' })
    await anon.wait('welcome')
    expect(anon.seen('callsign-taken')).toBe(false)
  })

  it('migrates anonymous progress on a wallet claim without laundering a locked callsign', async () => {
    const anon = await Pilot.open('anon-claim')
    open.push(anon)
    anon.send({ t: 'join', name: 'ACE', token: 'anon-claim' }) // unrestricted while anonymous
    await anon.wait('welcome')
    await anon.wait('progress')
    anon.send({ t: 'save', progress: { credits: 5, cargo: { ORE: 0, ALLOY: 0 } } })

    const auth = await anon.link(makeWallet())
    expect(auth?.t).toBe('auth-ok')
    expect(auth.name).toBe('PILOT') // ACE belongs to walletA — it does not come along
    expect((await anon.wait('callsign-taken'))?.requested).toBe('ACE') // and the player is told
    const progress = await anon.wait('progress')
    expect(progress?.data?.credits).toBe(5) // progress DOES migrate
    expect(progress.data.name).toBe('PILOT') // the row is stamped with the granted name
  })

  // The landing-page order: link the wallet FIRST, press LAUNCH after. The connection is a viewer
  // with no callsign at all, so the claimed row's own name is the only request there is.
  it('keeps a returning anonymous pilot their name when the wallet links before LAUNCH', async () => {
    const first = await Pilot.open('anon-preflight')
    open.push(first)
    first.send({ t: 'join', name: 'WAYFARER', token: 'anon-preflight' })
    await first.wait('welcome')
    await first.wait('progress')
    first.send({ t: 'save', progress: { credits: 3, cargo: { ORE: 0, ALLOY: 0 } } })
    first.close()

    const viewer = await Pilot.open('anon-preflight') // fresh page load: 'hello', no name yet
    open.push(viewer)
    viewer.send({ t: 'hello', token: 'anon-preflight' })
    const auth = await viewer.link(makeWallet())
    expect(auth?.name).toBe('WAYFARER') // not wiped to PILOT by the claim
    expect((await viewer.wait('progress'))?.data).toMatchObject({ credits: 3, name: 'WAYFARER' })
  })

  it('does not let a pre-LAUNCH wallet link launder a locked name off a claimed row', async () => {
    const first = await Pilot.open('anon-preflight-2')
    open.push(first)
    first.send({ t: 'join', name: 'ACE', token: 'anon-preflight-2' }) // fine while anonymous
    await first.wait('welcome')
    await first.wait('progress')
    first.send({ t: 'save', progress: { credits: 4, cargo: { ORE: 0, ALLOY: 0 } } })
    first.close()

    const viewer = await Pilot.open('anon-preflight-2')
    open.push(viewer)
    viewer.send({ t: 'hello', token: 'anon-preflight-2' })
    const auth = await viewer.link(makeWallet())
    expect(auth?.name).toBe('PILOT') // ACE is walletA's
    expect((await viewer.wait('callsign-taken'))?.requested).toBe('ACE')
    expect((await viewer.wait('progress'))?.data).toMatchObject({ credits: 4, name: 'PILOT' })
  })

  it('carries a free anonymous callsign through the wallet claim', async () => {
    const anon = await Pilot.open('anon-free-name')
    open.push(anon)
    anon.send({ t: 'join', name: 'DRIFTER', token: 'anon-free-name' })
    await anon.wait('welcome')
    await anon.wait('progress')
    anon.send({ t: 'save', progress: { credits: 7, cargo: { ORE: 0, ALLOY: 0 } } })

    const auth = await anon.link(makeWallet())
    expect(auth?.name).toBe('DRIFTER')
    expect(anon.seen('callsign-taken')).toBe(false)
    expect((await anon.wait('progress'))?.data?.credits).toBe(7)
  })
})
