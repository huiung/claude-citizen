// Relay + progress server. Position relay is a dumb mirror; persistence is keyed
// by an anonymous client token (no accounts, no passwords) and flushed to a JSON
// file. Swap STORE_FILE for a volume/DB when hosting for real durability.
import { readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import {
  verifySignature, createChallengeStore, createClaimedAnonStore, createSessionStore,
  resolveClaim, issueChallenge,
} from './auth.mjs'
import { fetchHolderStatus, createHolderCache } from './holders.mjs'
import { leaderboardPage, parseLeaderboardParams } from './leaderboard.mjs'
import { createPvpKillAuditLog, pvpLeaderboardPage, mergePvpStats, recordRankedPvpKill } from './pvpLeaderboard.mjs'
import { raceLeaderboardPage, mergeRaceStats, recordRankedRaceFinish } from './raceLeaderboard.mjs'
import { applyPvpHit, applyPvpRespawn, isInPvpZone, normalizeShip, pvpZoneAt, resetPvpHull } from './pvp.mjs'
import { resolveCallsign, identityKey, kickDuplicateActiveClients } from './sessionPeers.mjs'
import { sanitizeProgress } from './progress.mjs'
import {
  buyListing,
  cancelListing,
  createListing,
  createMarketplace,
  marketplaceRowsFor,
  marketplaceSnapshot,
  publicMarketplaceRow,
  reserveListing,
  settleTokenListing,
} from './marketplace.mjs'
import { verifyTokenPayment } from './solanaPay.mjs'
import { buildTokenPaymentTx } from './tokenTx.mjs'
import { toBaseUnits, splitFee } from './tokenSettlement.mjs'
import { Connection, PublicKey } from '@solana/web3.js'
import { getMint } from '@solana/spl-token'
import { randomBytes } from 'crypto'

function loadEnvFile(path = '.env') {
  let text
  try { text = readFileSync(path, 'utf8') } catch { return }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

loadEnvFile()

const PORT = process.env.PORT ?? 8080
const STORE_FILE = process.env.STORE_FILE ?? './progress.json'
const PVP_KILL_LOG_FILE = process.env.PVP_KILL_LOG_FILE ?? STORE_FILE.replace(/[^/\\]+$/, 'pvp-kills.json')
const CLAIMED_ANON_FILE = process.env.CLAIMED_ANON_FILE ?? STORE_FILE.replace(/[^/\\]+$/, 'claimed-anon.json')
const MARKETPLACE_FILE = process.env.MARKETPLACE_FILE ?? STORE_FILE.replace(/[^/\\]+$/, 'marketplace.json')
// Verified sessions persist beside the progress store (same volume) so a relay restart
// doesn't drop wallet logins — otherwise reconnects fall back to anonymous + lose holder flair.
const SESSION_FILE = process.env.SESSION_FILE ?? STORE_FILE.replace(/[^/\\]+$/, 'sessions.json')
// Token-holder status. Verified pubkeys are checked against the mint via Helius; a missing
// key just means no flair and no holder-gated ranked PvP access.
const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const HOLDER_MINT = '6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump'
const TREASURY_WALLET = process.env.TREASURY_WALLET ?? '59vPXLdd9xvTcYAeQs3dZhbPVfFEiitP8btagF56NFj3'
const FEE_BPS = 500
const heliusRpc = HELIUS_API_KEY ? new Connection(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, 'finalized') : null
let cachedMintInfo = null
// Resolve the mint's owning token program (classic SPL vs Token-2022) + decimals, once.
// The Citizen mint is a Token-2022 mint, so payment instructions must target that program.
async function tokenMintInfo() {
  if (cachedMintInfo) return cachedMintInfo
  if (!heliusRpc) return { programId: null, decimals: 6 }
  try {
    const mintPk = new PublicKey(HOLDER_MINT)
    const programId = (await heliusRpc.getAccountInfo(mintPk))?.owner ?? null
    const decimals = (await getMint(heliusRpc, mintPk, undefined, programId ?? undefined)).decimals
    cachedMintInfo = { programId, decimals }
  } catch { cachedMintInfo = { programId: null, decimals: 6 } }
  return cachedMintInfo
}

// Pre-simulate an unsigned tx (sigVerify off) so we never hand the wallet a tx that fails on-chain —
// Phantom shows a "could be malicious" warning whenever it can't cleanly simulate. Returns:
//   { ok: true }                  → simulated clean, safe to send
//   { ok: false, err, logs }      → real on-chain failure, block + log
//   { ok: true, infra: true, err} → RPC/infra hiccup, allow through but log (don't punish users)
async function simulateTokenTx(txBase64) {
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'sim', method: 'simulateTransaction',
        params: [txBase64, { sigVerify: false, replaceRecentBlockhash: true, encoding: 'base64', commitment: 'processed' }],
      }),
    })
    const json = await res.json()
    const value = json?.result?.value
    if (!value) return { ok: true, infra: true, err: json?.error ?? 'no-result' }
    return value.err ? { ok: false, err: value.err, logs: value.logs ?? [] } : { ok: true }
  } catch (e) {
    return { ok: true, infra: true, err: String(e) }
  }
}
const holderCache = createHolderCache()
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const HOLDER_SHIP_VISUALS = new Set(['standard', 'doge-runner', 'void-interceptor', 'sovereign-wraith', 'eclipse-corvette'])
// Area-of-interest: position updates only relay to pilots within this range. Cuts the
// O(N^2) state broadcast to O(N*k) as players spread out across the sector.
const AOI_RADIUS = 3000
const AOI_RADIUS2 = AOI_RADIUS * AOI_RADIUS
const pvpRewardMemory = new Map()
let pvpKillAuditSeed = {}
try { pvpKillAuditSeed = JSON.parse(readFileSync(PVP_KILL_LOG_FILE, 'utf8')) } catch { pvpKillAuditSeed = {} }
const pvpKillAuditLog = createPvpKillAuditLog(undefined, pvpKillAuditSeed)
let pvpKillFlushTimer = null
function flushPvpKillAuditLog() {
  if (pvpKillFlushTimer) return
  pvpKillFlushTimer = setTimeout(() => {
    pvpKillFlushTimer = null
    try { writeFileSync(PVP_KILL_LOG_FILE, JSON.stringify(pvpKillAuditLog.snapshot())) } catch { /* disk unavailable */ }
  }, 500)
}

let nextColor = 0
const clients = new Map() // ws -> { id, name, color, p, q, token, active, authed, pubkey }

/** If a hello/join carried a valid sessionId, restore the verified pubkey onto the client. */
function applySession(client, sessionId) {
  if (!sessionId) return
  const pubkey = sessions.resolve(String(sessionId).slice(0, 64))
  if (pubkey) { client.authed = true; client.pubkey = pubkey }
}

/** Resolve a verified pubkey's holder status (cached), set it on the client, and tell the player
 *  + nearby peers so cosmetic flair and ranked access stay in sync. */
async function refreshHolder(ws, client) {
  if (!client.authed || !client.pubkey) return
  let status = holderCache.get(client.pubkey, Date.now())
  if (status === null) {
    status = await fetchHolderStatus(client.pubkey, { apiKey: HELIUS_API_KEY, mint: HOLDER_MINT })
    holderCache.set(client.pubkey, status, Date.now())
  }
  if (!clients.has(ws)) return // disconnected during the async lookup
  client.tier = Number(status.tier) || 0
  client.holderBalance = Number(status.balance) || 0
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'holder', tier: client.tier, balance: client.holderBalance }))
  if (client.active && client.tier > 0) broadcast(ws, { t: 'peer-holder', id: client.id, tier: client.tier })
}

function isAdminRequest(req) {
  if (!ADMIN_TOKEN) return false
  const auth = req.headers.authorization ?? ''
  if (auth === `Bearer ${ADMIN_TOKEN}`) return true
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.searchParams.get('token') === ADMIN_TOKEN
  } catch {
    return false
  }
}

// HTTP server: a /stats endpoint for the landing page + the WebSocket upgrade.
const httpServer = createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    // `helius` = is the API key present in this runtime? (boolean only — never the key value)
    res.end(JSON.stringify({ online: clients.size, registered: Object.keys(store).length, helius: !!HELIUS_API_KEY }))
    return
  }
  if (req.url?.startsWith('/leaderboard')) {
    // Top pilots by credits — every activity (mining, bounties, contracts) settles into credits.
    const top = leaderboardPage(store, parseLeaderboardParams(req.url))
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(req.url.includes('?') ? top : top.rows))
    return
  }
  if (req.url?.startsWith('/pvp-leaderboard')) {
    const top = pvpLeaderboardPage(store, parseLeaderboardParams(req.url))
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(req.url.includes('?') ? top : top.rows))
    return
  }
  if (req.url?.startsWith('/race-leaderboard')) {
    const top = raceLeaderboardPage(store, parseLeaderboardParams(req.url))
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(req.url.includes('?') ? top : top.rows))
    return
  }
  if (req.url?.startsWith('/pvp-kill-log')) {
    if (!isAdminRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(pvpKillAuditLog.snapshot()))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('star-citizen-caliber relay')
})
const wss = new WebSocketServer({ server: httpServer })

// Wallet auth: short-lived nonce challenges (in-memory) + verified-session lookup (persisted).
const challenges = createChallengeStore()
let sessionSeed = {}
try { sessionSeed = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) } catch { sessionSeed = {} }
const sessions = createSessionStore(sessionSeed)
function flushSessions() {
  try { writeFileSync(SESSION_FILE, JSON.stringify(sessions.snapshot())) } catch { /* disk unavailable */ }
}
let claimedAnonSeed = []
try { claimedAnonSeed = JSON.parse(readFileSync(CLAIMED_ANON_FILE, 'utf8')) } catch { claimedAnonSeed = [] }
const claimedAnonTokens = createClaimedAnonStore(claimedAnonSeed)
function flushClaimedAnonTokens() {
  try { writeFileSync(CLAIMED_ANON_FILE, JSON.stringify(claimedAnonTokens.snapshot())) } catch { /* disk unavailable */ }
}

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

function broadcast(from, msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients.keys()) {
    if (ws !== from && ws.readyState === ws.OPEN) ws.send(data)
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastAll(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data)
  }
}

function sendToIdentity(key, msg) {
  if (!key) return
  for (const [ws, client] of clients) {
    if (identityKey(client) === key) send(ws, msg)
  }
}

function sendMarketList(ws, client) {
  const viewerKey = client?.authed && client?.pubkey ? client.pubkey : null
  send(ws, { t: 'market-list', rows: marketplaceRowsFor(marketplace, viewerKey) })
}

function broadcastMarketList() {
  for (const [ws, client] of clients) {
    if (ws.readyState === ws.OPEN) sendMarketList(ws, client)
  }
}

let marketplaceSeed = {}
try { marketplaceSeed = JSON.parse(readFileSync(MARKETPLACE_FILE, 'utf8')) } catch { marketplaceSeed = {} }
const marketplace = createMarketplace(marketplaceSeed)
let marketplaceFlushTimer = null
function flushMarketplace() {
  if (marketplaceFlushTimer) return
  marketplaceFlushTimer = setTimeout(() => {
    marketplaceFlushTimer = null
    try { writeFileSync(MARKETPLACE_FILE, JSON.stringify(marketplaceSnapshot(marketplace))) } catch { /* disk unavailable */ }
  }, 500)
}

function kickDuplicatePeers(ws, client) {
  for (const removed of kickDuplicateActiveClients(clients, ws, client)) {
    broadcast(ws, { t: 'peer-leave', id: removed.client.id })
  }
}

function anonymousProgressAllowed(client) {
  return client.authed || !client.token || !claimedAnonTokens.has(client.token)
}

function normalizeHolderShipVisual(visual) {
  const v = typeof visual === 'string' ? visual.slice(0, 32) : 'standard'
  return HOLDER_SHIP_VISUALS.has(v) ? v : 'standard'
}

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    try {
    // Viewer presence — someone on the landing page. Counts toward "online" but is NOT
    // a peer (no ship, never broadcast). Promoted to an active pilot on 'join' (LAUNCH).
    if (msg.t === 'hello' && !clients.has(ws)) {
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null
      const client = {
        id: Math.random().toString(36).slice(2, 10),
        name: null, color: -1, p: [0, 0, 0], q: [0, 0, 0, 1], token,
        active: false, authed: false, pubkey: null, tier: 0, holderBalance: 0, visual: 'standard',
      }
      resetPvpHull(client, 'hauler')
      applySession(client, msg.sessionId)
      clients.set(ws, client)
      const key = identityKey(client)
      if (key && anonymousProgressAllowed(client) && !(key in store)) { store[key] = null; flush() } // seen → counts as registered
      void refreshHolder(ws, client) // resolve holder flair if this viewer carried a verified session
      if (client.authed && client.pubkey) {
        const locked = resolveCallsign({ authed: true, storedName: store[client.pubkey]?.name, requestedName: client.name })
        if (locked && locked.toLowerCase() !== 'pilot') { client.name = locked; send(ws, { t: 'callsign', name: locked }) }
      }
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
        client.visual = normalizeHolderShipVisual(msg.visual)
        resetPvpHull(client, normalizeShip(msg.ship))
      } else {
        client = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(msg.name ?? 'PILOT').slice(0, 16),
          color: nextColor++, p: [0, 0, 0], q: [0, 0, 0, 1], token,
          active: true, authed: false, pubkey: null, tier: 0, holderBalance: 0, visual: normalizeHolderShipVisual(msg.visual),
        }
        resetPvpHull(client, normalizeShip(msg.ship))
        clients.set(ws, client)
      }
      if (!client.authed) applySession(client, msg.sessionId)
      client.name = resolveCallsign({ authed: client.authed, storedName: store[identityKey(client)]?.name, requestedName: client.name })
      if (client.authed && client.name && client.name.toLowerCase() !== 'pilot') send(ws, { t: 'callsign', name: client.name })
      const key = identityKey(client)
      // Single live session per identity — kick any other live pilot on the same key.
      kickDuplicatePeers(ws, client)
      // Only active pilots are peers (have ships).
      const peers = [...clients.values()].filter((c) => c.active && c !== client).map(({ token: _t, active: _a, authed: _au, pubkey: _pk, holderBalance: _hb, ...rest }) => rest)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers }))
      if (key && anonymousProgressAllowed(client)) {
        if (store[key]) ws.send(JSON.stringify({ t: 'progress', data: store[key] }))
        else if (!(key in store)) { store[key] = null; flush() }
      }
      broadcast(ws, { t: 'peer-join', id: client.id, name: client.name, color: client.color, p: client.p, q: client.q, tier: client.tier ?? 0, ship: client.ship, visual: client.visual, hull: client.hull, maxHull: client.maxHull })
      void refreshHolder(ws, client) // (re)check holder flair now that we're an active, visible pilot
      console.log(`[join] ${client.name} (${client.id})${client.token ? ' +token' : ''} — ${clients.size} online`)
      return
    }

    const client = clients.get(ws)
    if (!client) return

    if (msg.t === 'auth-challenge') {
      if (client.authed) return // already verified — don't re-challenge a live identity
      const pubkey = typeof msg.pubkey === 'string' ? msg.pubkey.slice(0, 64) : null
      if (!pubkey) return
      const { message } = issueChallenge(challenges, pubkey, Date.now())
      ws.send(JSON.stringify({ t: 'challenge', message }))
      return
    }

    if (msg.t === 'auth') {
      if (client.authed) { ws.send(JSON.stringify({ t: 'auth-error' })); return } // no identity swap on a live connection
      const pubkey = typeof msg.pubkey === 'string' ? msg.pubkey.slice(0, 64) : null
      const signature = typeof msg.signature === 'string' ? msg.signature.slice(0, 128) : null
      const anonToken = typeof msg.anonToken === 'string' ? msg.anonToken.slice(0, 64) : null
      if (!pubkey || !signature) { ws.send(JSON.stringify({ t: 'auth-error' })); return }

      const ch = challenges.consume(pubkey, Date.now())
      if (!ch || !verifySignature(ch.message, signature, pubkey)) {
        ws.send(JSON.stringify({ t: 'auth-error' }))
        return
      }
      // Verified. Bind this connection to the pubkey and run the claim.
      client.authed = true
      client.pubkey = pubkey
      client.name = resolveCallsign({ authed: true, storedName: store[pubkey]?.name, requestedName: client.name })
      kickDuplicatePeers(ws, client)
      resolveClaim(store, pubkey, anonToken)
      if (anonToken && anonToken !== pubkey && claimedAnonTokens.claim(anonToken)) flushClaimedAnonTokens()
      flush()
      const sessionId = sessions.create(pubkey)
      flushSessions() // persist so this login survives a relay restart
      ws.send(JSON.stringify({ t: 'auth-ok', pubkey, sessionId, name: client.name }))
      if (store[pubkey]) ws.send(JSON.stringify({ t: 'progress', data: store[pubkey] }))
      void refreshHolder(ws, client) // grant holder flair if this wallet holds the token
      return
    }

    if (msg.t === 'state' && client.active && Array.isArray(msg.p) && Array.isArray(msg.q)) {
      client.p = msg.p.slice(0, 3).map(Number)
      client.q = msg.q.slice(0, 4).map(Number)
      const ship = normalizeShip(msg.ship)
      client.visual = normalizeHolderShipVisual(msg.visual ?? client.visual)
      if (ship !== client.ship && !isInPvpZone(client.p)) resetPvpHull(client, ship)
      // Relay only to active pilots within AOI_RADIUS (distant pilots aren't visible anyway).
      const out = JSON.stringify({ t: 'peer-state', id: client.id, p: client.p, q: client.q, ship: client.ship, visual: client.visual, hull: client.hull, maxHull: client.maxHull })
      const [px, py, pz] = client.p
      for (const [ws2, c2] of clients) {
        if (ws2 === ws || !c2.active || ws2.readyState !== ws2.OPEN) continue
        const dx = c2.p[0] - px, dy = c2.p[1] - py, dz = c2.p[2] - pz
        if (dx * dx + dy * dy + dz * dz <= AOI_RADIUS2) ws2.send(out)
      }
      return
    }

    if (msg.t === 'pvp-respawn' && client.active) {
      const result = applyPvpRespawn(client, {
        p: Array.isArray(msg.p) ? msg.p : undefined,
        q: Array.isArray(msg.q) ? msg.q : undefined,
        ship: typeof msg.ship === 'string' ? normalizeShip(msg.ship) : undefined,
      })
      if (!result.ok) return
      client.visual = normalizeHolderShipVisual(msg.visual ?? client.visual)
      const out = {
        t: 'peer-state',
        id: client.id,
        p: client.p,
        q: client.q,
        ship: client.ship,
        visual: client.visual,
        hull: client.hull,
        maxHull: client.maxHull,
      }
      broadcastAll(out)
      broadcastAll({ t: 'pvp-health', id: client.id, hull: client.hull, maxHull: client.maxHull })
      return
    }

    if (msg.t === 'pvp-hit' && client.active) {
      const targetId = typeof msg.targetId === 'string' ? msg.targetId.slice(0, 16) : ''
      let targetWs = null
      let target = null
      for (const [ws2, c2] of clients) {
        if (c2.id === targetId) { targetWs = ws2; target = c2; break }
      }
      const result = applyPvpHit({ attacker: client, target, now: Date.now(), rewardMemory: pvpRewardMemory })
      if (!result.ok) return
      broadcastAll({ t: 'pvp-health', id: target.id, hull: target.hull, maxHull: target.maxHull })
      send(ws, { t: 'pvp-hit', targetId: target.id, hull: result.hull, maxHull: result.maxHull, damage: result.damage, killed: result.killed })
      send(targetWs, { t: 'pvp-damage', attackerId: client.id, attackerName: client.name, hull: result.hull, maxHull: result.maxHull, damage: result.damage, killed: result.killed })
      if (result.killed) {
        const killZone = pvpZoneAt(client.p)
        if (killZone?.id === 'ranked') {
          const auditRow = pvpKillAuditLog.record({
            zone: killZone.id,
            killerKey: identityKey(client),
            killerName: client.name,
            victimKey: identityKey(target),
            victimName: target.name,
            now: Date.now(),
            reward: result.reward,
            killerBalance: client.holderBalance,
            victimBalance: target.holderBalance,
          })
          if (auditRow) flushPvpKillAuditLog()
        }
        if (result.reward > 0 && killZone?.id === 'ranked') {
          const recorded = recordRankedPvpKill(store, {
            killerKey: identityKey(client),
            killerName: client.name,
            victimKey: identityKey(target),
            victimName: target.name,
            now: Date.now(),
          })
          if (recorded) flush()
        }
        if (result.reward > 0) send(ws, { t: 'pvp-reward', credits: result.reward, victimId: target.id, victimName: target.name })
        broadcastAll({
          t: 'pvp-kill',
          killerId: client.id,
          killerName: client.name,
          victimId: target.id,
          victimName: target.name,
          reward: result.reward,
        })
        broadcastAll({ t: 'pvp-health', id: target.id, hull: target.hull, maxHull: target.maxHull })
      }
      return
    }

    if (msg.t === 'save') {
      const key = identityKey(client)
      if (!key) return
      if (!anonymousProgressAllowed(client)) return
      const clean = sanitizeProgress(msg.progress)
      if (clean) {
        clean.name = client.name
        store[key] = mergeRaceStats(mergePvpStats(clean, store[key]), store[key])
        flush()
      } // stamp callsign for the leaderboard
      return
    }

    if (msg.t === 'race-finish' && client.active) {
      const recorded = recordRankedRaceFinish(store, {
        key: identityKey(client),
        name: client.name,
        timeMs: msg.timeMs,
        now: Date.now(),
      })
      if (recorded) {
        flush()
        send(ws, { t: 'race-recorded', timeMs: Math.max(0, Math.floor(Number(msg.timeMs) || 0)) })
      }
      return
    }

    if (msg.t === 'market-list') {
      sendMarketList(ws, client)
      return
    }

    if (msg.t === 'market-create' && client.active) {
      const key = client.authed && client.pubkey ? client.pubkey : null
      const result = key
        ? createListing(marketplace, store, key, client.name, msg.itemId, msg.price, Date.now, msg.currency === 'token' ? 'token' : 'credits')
        : { ok: false, reason: 'wallet-required' }
      if (result.ok) {
        flush()
        flushMarketplace()
      }
      send(ws, {
        t: 'market-action',
        action: 'create',
        ...result,
        listing: result.ok ? publicMarketplaceRow(result.listing, key) : undefined,
        progress: key ? store[key] : undefined,
      })
      sendMarketList(ws, client)
      return
    }

    if (msg.t === 'market-intent' && client.active) {
      const key = client.authed && client.pubkey ? client.pubkey : null
      if (!key) { send(ws, { t: 'market-intent-result', ok: false, reason: 'wallet-required', listingId: msg.listingId }); return }
      if (!heliusRpc) { send(ws, { t: 'market-intent-result', ok: false, reason: 'token-disabled', listingId: msg.listingId }); return }
      const nonce = randomBytes(16).toString('hex')
      const reserved = reserveListing(marketplace, key, msg.listingId, nonce, Date.now)
      if (!reserved.ok) { send(ws, { t: 'market-intent-result', ok: false, reason: reserved.reason, listingId: msg.listingId }); return }
      try {
        const { programId, decimals } = await tokenMintInfo()
        const totalRaw = toBaseUnits(reserved.listing.price, decimals)
        const { feeRaw, sellerRaw } = splitFee(totalRaw, FEE_BPS)
        const txBase64 = await buildTokenPaymentTx(heliusRpc, {
          buyer: key, seller: reserved.listing.sellerKey, treasury: TREASURY_WALLET, mint: HOLDER_MINT,
          decimals, sellerRaw, feeRaw, nonce, tokenProgram: programId ? programId.toBase58() : undefined,
        })
        const sim = await simulateTokenTx(txBase64)
        if (sim.infra) {
          console.warn(`[market-intent] pre-sim RPC unavailable, proceeding: listing=${msg.listingId}`, sim.err)
        } else if (!sim.ok) {
          console.warn(`[market-intent] sim failed listing=${msg.listingId} buyer=${key}:`, JSON.stringify(sim.err), (sim.logs || []).slice(-6))
          marketplace.reservations.delete(msg.listingId)
          send(ws, { t: 'market-intent-result', ok: false, reason: 'sim-failed', listingId: msg.listingId })
          return
        }
        send(ws, { t: 'market-intent-result', ok: true, listingId: msg.listingId, txBase64 })
      } catch {
        marketplace.reservations.delete(msg.listingId)
        send(ws, { t: 'market-intent-result', ok: false, reason: 'build-failed', listingId: msg.listingId })
      }
      return
    }

    if (msg.t === 'market-buy' && client.active) {
      const key = client.authed && client.pubkey ? client.pubkey : null
      if (!key) {
        send(ws, { t: 'market-action', action: 'buy', ok: false, reason: 'wallet-required' })
        return
      }
      const target = marketplace.listings.find((row) => row.id === msg.listingId)
      let result
      if (target && target.status === 'active' && target.currency === 'token') {
        const { decimals } = await tokenMintInfo()
        const reservation = marketplace.reservations.get(msg.listingId)
        if (!reservation || reservation.buyerKey !== key || reservation.expiresAt <= Date.now()) {
          result = { ok: false, reason: 'not-reserved' }
        } else {
          const totalRaw = toBaseUnits(target.price, decimals)
          const { feeRaw, sellerRaw } = splitFee(totalRaw, FEE_BPS)
          const paid = await verifyTokenPayment(msg.txSig, {
            apiKey: HELIUS_API_KEY, mint: HOLDER_MINT, seller: target.sellerKey, treasury: TREASURY_WALLET,
            sellerRaw, feeRaw, nonce: reservation.nonce,
          })
          result = paid ? settleTokenListing(marketplace, store, key, msg.listingId, Date.now) : { ok: false, reason: 'payment-unverified' }
        }
      } else {
        result = buyListing(marketplace, store, key, msg.listingId, Date.now)
      }
      if (result.ok) {
        flush()
        flushMarketplace()
        sendToIdentity(result.listing.sellerKey, {
          t: 'market-action',
          ok: true,
          action: 'sold',
          listing: publicMarketplaceRow(result.listing, result.listing.sellerKey),
          progress: store[result.listing.sellerKey],
        })
        broadcastMarketList()
      }
      send(ws, {
        t: 'market-action',
        action: 'buy',
        ...result,
        listing: result.ok ? publicMarketplaceRow(result.listing, key) : undefined,
        progress: store[key],
      })
      if (!result.ok) sendMarketList(ws, client)
      return
    }

    if (msg.t === 'market-cancel' && client.active) {
      const key = client.authed && client.pubkey ? client.pubkey : null
      const result = key
        ? cancelListing(marketplace, store, key, msg.listingId, Date.now)
        : { ok: false, reason: 'wallet-required' }
      if (result.ok) {
        flush()
        flushMarketplace()
        broadcastMarketList()
      }
      send(ws, {
        t: 'market-action',
        action: 'cancel',
        ...result,
        listing: result.ok && result.listing ? publicMarketplaceRow(result.listing, key) : undefined,
        progress: key ? store[key] : undefined,
      })
      if (!result.ok) sendMarketList(ws, client)
      return
    }

    if (msg.t === 'chat' && typeof msg.text === 'string') {
      const now = Date.now()
      if (now - (client.lastChat ?? 0) < 700) return // rate limit
      client.lastChat = now
      const text = msg.text.slice(0, 160).trim()
      if (text) {
        const out = { t: 'chat', name: client.name, text, tier: client.tier ?? 0 }
        broadcast(ws, out)
        ws.send(JSON.stringify(out)) // echo to sender so they see their own line
      }
      return
    }
    } catch { /* per-message failure: drop it, keep the relay alive */ }
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
