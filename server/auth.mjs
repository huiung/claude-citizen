// Pure auth helpers for the relay. No sockets here — easy to unit-test.
// publicKey is PUBLIC, so it is never trusted until a nonce signature verifies.
import { randomBytes } from 'crypto'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

/** The exact text the wallet signs. Deterministic; binds pubkey + nonce. */
export function buildMessage(pubkey, nonce, issuedAt) {
  return `Sign in to Claude Citizen\npubkey: ${pubkey}\nnonce: ${nonce}\nissued: ${issuedAt}`
}

/** ed25519 verify. Returns false (never throws) on malformed base58. */
export function verifySignature(message, signatureB58, pubkeyB58) {
  try {
    const sig = bs58.decode(signatureB58)
    const pub = bs58.decode(pubkeyB58)
    const msg = new TextEncoder().encode(message)
    return nacl.sign.detached.verify(msg, sig, pub)
  } catch {
    return false
  }
}

/** One-time, TTL'd nonce challenges keyed by pubkey. In-memory (single instance). */
export function createChallengeStore(ttlMs = 5 * 60 * 1000) {
  const m = new Map()
  return {
    issue(pubkey, { nonce, message }, now) {
      m.set(pubkey, { nonce, message, expiresAt: now + ttlMs })
    },
    /** Returns the challenge once, then deletes it. null if missing or expired. */
    consume(pubkey, now) {
      const c = m.get(pubkey)
      if (!c) return null
      m.delete(pubkey)
      if (c.expiresAt < now) return null
      return c
    },
  }
}

/** Maps a sessionId back to a verified pubkey (reconnect without re-signing). Seeds from a
 *  saved snapshot so verified sessions survive a relay restart. */
export function createSessionStore(initial = {}) {
  const m = new Map(Object.entries(initial ?? {}))
  return {
    create(pubkey) {
      const id = randomBytes(24).toString('base64url')
      m.set(id, pubkey)
      return id
    },
    resolve(id) {
      return m.get(id) ?? null
    },
    /** Plain object for persistence — survives a relay restart so sessions don't drop. */
    snapshot() {
      return Object.fromEntries(m)
    },
  }
}

/** A안: claim anon progress only if the wallet has none; otherwise keep the wallet's. */
export function createClaimedAnonStore(initial = []) {
  const values = Array.isArray(initial)
    ? initial
    : Object.entries(initial ?? {}).filter(([, value]) => value).map(([key]) => key)
  const claimed = new Set(values.map((token) => String(token).slice(0, 64)).filter(Boolean))
  return {
    claim(token) {
      const safe = String(token ?? '').slice(0, 64)
      if (!safe) return false
      claimed.add(safe)
      return true
    },
    has(token) {
      return claimed.has(String(token ?? '').slice(0, 64))
    },
    snapshot() {
      return [...claimed]
    },
  }
}

export function resolveClaim(store, pubkey, anonToken) {
  if (!store[pubkey]) {
    store[pubkey] = (anonToken && store[anonToken]) || null
  }
  if (anonToken && anonToken !== pubkey) delete store[anonToken]
  return store[pubkey]
}

/** Convenience: make a fresh challenge for a pubkey and register it. */
export function issueChallenge(challengeStore, pubkey, now) {
  const nonce = randomBytes(16).toString('hex')
  const message = buildMessage(pubkey, nonce, now)
  challengeStore.issue(pubkey, { nonce, message }, now)
  return { nonce, message }
}
