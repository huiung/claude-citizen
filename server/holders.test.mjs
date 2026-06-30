import { describe, it, expect } from 'vitest'
import { parseHolderBalance, holderTier, createHolderCache, holderStatus, fetchHolderStatus } from './holders.mjs'

describe('fetchHolderStatus', () => {
  const OPTS = { apiKey: 'k', mint: 'm', retryDelayMs: 0 }
  const okResp = (ui) => ({ ok: true, json: async () => ({ result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } } }] } }) })

  it('verifies a real balance → ok true with balance/tier', async () => {
    const s = await fetchHolderStatus('PK', { ...OPTS, fetchImpl: async () => okResp(1500) })
    expect(s).toEqual({ balance: 1500, tier: 1, ok: true })
  })

  it('a genuine zero is a VERIFIED result (ok true), not a failure', async () => {
    const s = await fetchHolderStatus('PK', { ...OPTS, fetchImpl: async () => okResp(0) })
    expect(s).toEqual({ balance: 0, tier: 0, ok: true })
  })

  it('missing apiKey/mint/pubkey → ok false (not a verified 0)', async () => {
    expect((await fetchHolderStatus('PK', { mint: 'm', retryDelayMs: 0 })).ok).toBe(false) // no apiKey
    expect((await fetchHolderStatus('', OPTS)).ok).toBe(false)                              // no pubkey
  })

  it('HTTP error after retries → ok false (fail-closed, balance 0)', async () => {
    let calls = 0
    const s = await fetchHolderStatus('PK', { ...OPTS, retries: 1, fetchImpl: async () => { calls++; return { ok: false, status: 429 } } })
    expect(s).toEqual({ balance: 0, tier: 0, ok: false })
    expect(calls).toBe(2) // initial + 1 retry
  })

  it('a JSON-RPC error body (200 OK) is a failure, not a verified 0', async () => {
    const s = await fetchHolderStatus('PK', { ...OPTS, retries: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: 'rate limited' } }) }) })
    expect(s.ok).toBe(false)
  })

  it('a thrown network error → ok false', async () => {
    const s = await fetchHolderStatus('PK', { ...OPTS, retries: 0, fetchImpl: async () => { throw new Error('ECONNRESET') } })
    expect(s.ok).toBe(false)
  })

  it('retries a transient failure then succeeds → ok true', async () => {
    let calls = 0
    const s = await fetchHolderStatus('PK', { ...OPTS, retries: 1, fetchImpl: async () => { calls++; if (calls === 1) throw new Error('blip'); return okResp(250000) } })
    expect(s).toEqual({ balance: 250000, tier: 2, ok: true })
    expect(calls).toBe(2)
  })
})

describe('parseHolderBalance', () => {
  // Shape returned by Helius getTokenAccountsByOwner (jsonParsed).
  const withAmount = (ui) => ({
    result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } } }] },
  })
  it('returns the balance for a single account', () => {
    expect(parseHolderBalance(withAmount(1500))).toBe(1500)
  })
  it('returns 0 for an empty balance', () => {
    expect(parseHolderBalance(withAmount(0))).toBe(0)
  })
  it('returns 0 with no token accounts', () => {
    expect(parseHolderBalance({ result: { value: [] } })).toBe(0)
  })
  it('returns 0 (never throws) on malformed / error responses', () => {
    expect(parseHolderBalance(null)).toBe(0)
    expect(parseHolderBalance({})).toBe(0)
    expect(parseHolderBalance({ error: { message: 'rate limited' } })).toBe(0)
  })
  it('sums multiple token accounts for the same mint', () => {
    const multi = { result: { value: [
      { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 30 } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 42 } } } } } },
    ] } }
    expect(parseHolderBalance(multi)).toBe(72)
  })
})

describe('holderTier', () => {
  it('tier 0 below the holder threshold', () => {
    expect(holderTier(0)).toBe(0)
  })
  it('tier 1 (gold) for 1 .. 99,999', () => {
    expect(holderTier(1)).toBe(1)
    expect(holderTier(99_999)).toBe(1)
  })
  it('tier 2 (cyan) for 100k .. 999,999', () => {
    expect(holderTier(100_000)).toBe(2)
    expect(holderTier(999_999)).toBe(2)
  })
  it('tier 3 (whale) for 1M+', () => {
    expect(holderTier(1_000_000)).toBe(3)
    expect(holderTier(50_000_000)).toBe(3)
  })
})

describe('holderStatus', () => {
  it('returns both balance and tier so gameplay gates can use exact balances', () => {
    expect(holderStatus(999)).toEqual({ balance: 999, tier: 1 })
    expect(holderStatus(1000)).toEqual({ balance: 1000, tier: 1 })
    expect(holderStatus(100_000)).toEqual({ balance: 100_000, tier: 2 })
  })
})

describe('createHolderCache', () => {
  it('returns a cached value within TTL, misses after expiry', () => {
    const c = createHolderCache(1000)
    c.set('PK', 2, 0)
    expect(c.get('PK', 500)).toBe(2)      // within TTL
    expect(c.get('PK', 1500)).toBeNull()   // expired
  })
  it('returns null for an unknown key', () => {
    expect(createHolderCache(1000).get('nope', 0)).toBeNull()
  })
  it('distinguishes tier 0 (known non-holder) from null (unknown)', () => {
    const c = createHolderCache(1000)
    c.set('PK', 0, 0)
    expect(c.get('PK', 100)).toBe(0) // cached non-holder, not a miss
  })
})
