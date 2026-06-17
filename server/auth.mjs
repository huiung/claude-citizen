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

/** Maps a short-lived sessionId back to a verified pubkey (reconnect without re-signing). */
export function createSessionStore() {
  const m = new Map()
  return {
    create(pubkey) {
      const id = randomBytes(24).toString('base64url')
      m.set(id, pubkey)
      return id
    },
    resolve(id) {
      return m.get(id) ?? null
    },
  }
}

/** A안: claim anon progress only if the wallet has none; otherwise keep the wallet's. */
export function resolveClaim(store, pubkey, anonToken) {
  if (!store[pubkey]) {
    store[pubkey] = (anonToken && store[anonToken]) || null
  }
  return store[pubkey]
}

/** Convenience: make a fresh challenge for a pubkey and register it. */
export function issueChallenge(challengeStore, pubkey, now) {
  const nonce = randomBytes(16).toString('hex')
  const message = buildMessage(pubkey, nonce, now)
  challengeStore.issue(pubkey, { nonce, message }, now)
  return { nonce, message }
}
