// Relay + progress server. Position relay is a dumb mirror; persistence is keyed
// by an anonymous client token (no accounts, no passwords) and flushed to a JSON
// file. Swap STORE_FILE for a volume/DB when hosting for real durability.
import { readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import {
  verifySignature, createChallengeStore, createSessionStore,
  resolveClaim, issueChallenge,
} from './auth.mjs'
import { fetchHolderStatus, createHolderCache } from './holders.mjs'
import { leaderboardPage, parseLeaderboardParams } from './leaderboard.mjs'
import { pvpLeaderboardPage, mergePvpStats, recordRankedPvpKill } from './pvpLeaderboard.mjs'
import { applyPvpHit, isInPvpZone, normalizeShip, pvpZoneAt, resetPvpHull } from './pvp.mjs'

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
// Verified sessions persist beside the progress store (same volume) so a relay restart
// doesn't drop wallet logins — otherwise reconnects fall back to anonymous + lose holder flair.
const SESSION_FILE = process.env.SESSION_FILE ?? STORE_FILE.replace(/[^/\\]+$/, 'sessions.json')
// Token-holder status. Verified pubkeys are checked against the mint via Helius; a missing
// key just means no flair and no holder-gated ranked PvP access.
const HELIUS_API_KEY = process.env.HELIUS_API_KEY
const HOLDER_MINT = '6FCeoWmjurxX7EsH7zdWRMDn4HGTBhJXLryKTqkepump'
const holderCache = createHolderCache()
// Area-of-interest: position updates only relay to pilots within this range. Cuts the
// O(N^2) state broadcast to O(N*k) as players spread out across the sector.
const AOI_RADIUS = 3000
const AOI_RADIUS2 = AOI_RADIUS * AOI_RADIUS
const pvpRewardMemory = new Map()

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

/** The progress key for a client: verified pubkey if authed, else the raw token. */
function identityKey(client) {
  return client.authed && client.pubkey ? client.pubkey : client.token
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

/** Accept only the small, known progress shape — never trust the client blindly. */
function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null
  const credits = Number(p.credits) || 0
  return {
    credits,
    // Lifetime earnings drive rank; older saves without it seed from current balance.
    earned: typeof p.earned === 'number' && p.earned >= 0 ? Number(p.earned) : credits,
    cargo: { ORE: Number(p.cargo?.ORE) || 0, ALLOY: Number(p.cargo?.ALLOY) || 0 },
    upgrades: {
      cargo: Number(p.upgrades?.cargo) || 0,
      speed: Number(p.upgrades?.speed) || 0,
      boost: Number(p.upgrades?.boost) || 0,
      mining: Number(p.upgrades?.mining) || 0,
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

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastAll(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data)
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
      const client = {
        id: Math.random().toString(36).slice(2, 10),
        name: null, color: -1, p: [0, 0, 0], q: [0, 0, 0, 1], token,
        active: false, authed: false, pubkey: null, tier: 0, holderBalance: 0,
      }
      resetPvpHull(client, 'hauler')
      applySession(client, msg.sessionId)
      clients.set(ws, client)
      const key = identityKey(client)
      if (key && !(key in store)) { store[key] = null; flush() } // seen → counts as registered
      void refreshHolder(ws, client) // resolve holder flair if this viewer carried a verified session
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
        resetPvpHull(client, normalizeShip(msg.ship))
      } else {
        client = {
          id: Math.random().toString(36).slice(2, 10),
          name: String(msg.name ?? 'PILOT').slice(0, 16),
          color: nextColor++, p: [0, 0, 0], q: [0, 0, 0, 1], token,
          active: true, authed: false, pubkey: null, tier: 0, holderBalance: 0,
        }
        resetPvpHull(client, normalizeShip(msg.ship))
        clients.set(ws, client)
      }
      if (!client.authed) applySession(client, msg.sessionId)
      const key = identityKey(client)
      // Single live session per identity — kick any other live pilot on the same key.
      if (key) {
        for (const [ws2, c2] of clients) {
          if (ws2 !== ws && c2.active && identityKey(c2) === key) {
            try { ws2.send(JSON.stringify({ t: 'kicked' })) } catch { /* already gone */ }
            ws2.close()
          }
        }
      }
      // Only active pilots are peers (have ships).
      const peers = [...clients.values()].filter((c) => c.active && c !== client).map(({ token: _t, active: _a, authed: _au, pubkey: _pk, holderBalance: _hb, ...rest }) => rest)
      ws.send(JSON.stringify({ t: 'welcome', id: client.id, peers }))
      if (key) {
        if (store[key]) ws.send(JSON.stringify({ t: 'progress', data: store[key] }))
        else if (!(key in store)) { store[key] = null; flush() }
      }
      broadcast(ws, { t: 'peer-join', id: client.id, name: client.name, color: client.color, p: client.p, q: client.q, tier: client.tier ?? 0, ship: client.ship, hull: client.hull, maxHull: client.maxHull })
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
      resolveClaim(store, pubkey, anonToken)
      flush()
      const sessionId = sessions.create(pubkey)
      flushSessions() // persist so this login survives a relay restart
      ws.send(JSON.stringify({ t: 'auth-ok', pubkey, sessionId }))
      if (store[pubkey]) ws.send(JSON.stringify({ t: 'progress', data: store[pubkey] }))
      void refreshHolder(ws, client) // grant holder flair if this wallet holds the token
      return
    }

    if (msg.t === 'state' && client.active && Array.isArray(msg.p) && Array.isArray(msg.q)) {
      client.p = msg.p.slice(0, 3).map(Number)
      client.q = msg.q.slice(0, 4).map(Number)
      const ship = normalizeShip(msg.ship)
      if (ship !== client.ship && !isInPvpZone(client.p)) resetPvpHull(client, ship)
      // Relay only to active pilots within AOI_RADIUS (distant pilots aren't visible anyway).
      const out = JSON.stringify({ t: 'peer-state', id: client.id, p: client.p, q: client.q, ship: client.ship, hull: client.hull, maxHull: client.maxHull })
      const [px, py, pz] = client.p
      for (const [ws2, c2] of clients) {
        if (ws2 === ws || !c2.active || ws2.readyState !== ws2.OPEN) continue
        const dx = c2.p[0] - px, dy = c2.p[1] - py, dz = c2.p[2] - pz
        if (dx * dx + dy * dy + dz * dz <= AOI_RADIUS2) ws2.send(out)
      }
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
        if (result.reward > 0 && pvpZoneAt(client.p)?.id === 'ranked') {
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
      const clean = sanitizeProgress(msg.progress)
      if (clean) {
        clean.name = client.name
        store[key] = mergePvpStats(clean, store[key])
        flush()
      } // stamp callsign for the leaderboard
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
