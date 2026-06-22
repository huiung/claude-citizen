import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import {
  buildMessage, verifySignature,
  createChallengeStore, createSessionStore, resolveClaim,
} from './auth.mjs'

const enc = (s) => new TextEncoder().encode(s)

describe('buildMessage', () => {
  it('is deterministic for the same inputs', () => {
    expect(buildMessage('PK', 'n1', 1000)).toBe(buildMessage('PK', 'n1', 1000))
  })
  it('binds pubkey and nonce into the text', () => {
    const m = buildMessage('PK', 'n1', 1000)
    expect(m).toContain('PK')
    expect(m).toContain('n1')
  })
})

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const kp = nacl.sign.keyPair()
    const pubkey = bs58.encode(kp.publicKey)
    const msg = buildMessage(pubkey, 'nonce123', 1000)
    const sig = bs58.encode(nacl.sign.detached(enc(msg), kp.secretKey))
    expect(verifySignature(msg, sig, pubkey)).toBe(true)
  })
  it('rejects a tampered message', () => {
    const kp = nacl.sign.keyPair()
    const pubkey = bs58.encode(kp.publicKey)
    const msg = buildMessage(pubkey, 'nonce123', 1000)
    const sig = bs58.encode(nacl.sign.detached(enc(msg), kp.secretKey))
    expect(verifySignature(msg + 'x', sig, pubkey)).toBe(false)
  })
  it('rejects a signature from a different key', () => {
    const kp = nacl.sign.keyPair(); const other = nacl.sign.keyPair()
    const pubkey = bs58.encode(kp.publicKey)
    const msg = buildMessage(pubkey, 'n', 1)
    const sig = bs58.encode(nacl.sign.detached(enc(msg), other.secretKey))
    expect(verifySignature(msg, sig, pubkey)).toBe(false)
  })
  it('returns false on malformed input instead of throwing', () => {
    expect(verifySignature('m', 'not-base58!!', 'also-bad!!')).toBe(false)
  })
})

describe('createChallengeStore', () => {
  it('consumes a nonce exactly once', () => {
    const s = createChallengeStore(1000)
    s.issue('pk', { nonce: 'n', message: 'msg' }, 0)
    expect(s.consume('pk', 100)?.nonce).toBe('n')
    expect(s.consume('pk', 100)).toBeNull() // 1회용
  })
  it('rejects an expired nonce', () => {
    const s = createChallengeStore(1000)
    s.issue('pk', { nonce: 'n', message: 'msg' }, 0)
    expect(s.consume('pk', 2000)).toBeNull()
  })
  it('returns null for an unknown pubkey', () => {
    expect(createChallengeStore(1000).consume('nope', 0)).toBeNull()
  })
})

describe('createSessionStore', () => {
  it('round-trips sessionId -> pubkey', () => {
    const s = createSessionStore()
    const id = s.create('PK')
    expect(typeof id).toBe('string')
    expect(s.resolve(id)).toBe('PK')
  })
  it('returns null for an unknown session', () => {
    expect(createSessionStore().resolve('missing')).toBeNull()
  })
  it('seeds from a saved snapshot (survives a restart)', () => {
    const s = createSessionStore({ 'sid-1': 'PK1', 'sid-2': 'PK2' })
    expect(s.resolve('sid-1')).toBe('PK1')
    expect(s.resolve('sid-2')).toBe('PK2')
  })
  it('snapshot() returns a persistable plain object including new sessions', () => {
    const s = createSessionStore({ 'sid-1': 'PK1' })
    const id = s.create('PK2')
    const snap = s.snapshot()
    expect(snap['sid-1']).toBe('PK1')
    expect(snap[id]).toBe('PK2')
  })
})

describe('resolveClaim', () => {
  it('claims anon progress when the wallet has none', () => {
    const store = { anon1: { credits: 500 } }
    resolveClaim(store, 'PK', 'anon1')
    expect(store['PK']).toEqual({ credits: 500 })
    expect('anon1' in store).toBe(false)
  })
  it('keeps existing wallet data and ignores anon (A안)', () => {
    const store = { anon1: { credits: 500 }, PK: { credits: 9000 } }
    resolveClaim(store, 'PK', 'anon1')
    expect(store['PK']).toEqual({ credits: 9000 })
    expect('anon1' in store).toBe(false)
  })
  it('sets null when neither side has data', () => {
    const store = {}
    resolveClaim(store, 'PK', undefined)
    expect(store['PK']).toBeNull()
  })
})
