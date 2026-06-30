// Token-holder cosmetics. Pure parsing/tier/cache here; the Helius fetch is the only side
// effect. Holder tier NEVER affects gameplay/economy — cosmetics only (no P2W).

/** Sum the mint's token-account balances from a Helius getTokenAccountsByOwner response.
 *  Returns the total uiAmount. Never throws — bad/error responses → 0. */
export function parseHolderBalance(resp) {
  try {
    const accounts = resp?.result?.value
    if (!Array.isArray(accounts)) return 0
    let total = 0
    for (const a of accounts) {
      const ui = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount
      if (typeof ui === 'number') total += ui
    }
    return total
  } catch {
    return 0
  }
}

/** Cosmetic tier from a token balance: 0 none · 1 gold (1+) · 2 cyan (100k+) · 3 whale (1M+). */
export function holderTier(balance) {
  if (balance >= 1_000_000) return 3
  if (balance >= 100_000) return 2
  if (balance >= 1) return 1
  return 0
}

export function holderStatus(balance) {
  const safeBalance = Math.max(0, Number(balance) || 0)
  return { balance: safeBalance, tier: holderTier(safeBalance) }
}

/** pubkey → tier (number) with TTL. get() returns null on miss/expiry, the cached tier
 *  otherwise (so a known non-holder tier 0 is distinct from an unknown null). */
export function createHolderCache(ttlMs = 5 * 60 * 1000) {
  const m = new Map()
  return {
    set(pubkey, tier, now) { m.set(pubkey, { tier, expiresAt: now + ttlMs }) },
    get(pubkey, now) {
      const e = m.get(pubkey)
      if (!e) return null
      if (e.expiresAt < now) { m.delete(pubkey); return null }
      return e.tier
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Query Helius for `pubkey`'s holding of `mint` and resolve a status `{ balance, tier, ok }`.
 *  `ok` distinguishes a VERIFIED result (success, even a genuine 0 balance) from a FAILED lookup
 *  (network, rate limit, RPC error, missing key). The caller must never cache a failed lookup as a
 *  real 0 — a transient Helius blip would otherwise lock a genuine holder out of the gate for the
 *  cache TTL. Retries transient failures `retries` times before giving up (still fail-closed:
 *  ok=false carries balance 0). */
export async function fetchHolderStatus(pubkey, { apiKey, mint, fetchImpl = fetch, retries = 1, retryDelayMs = 250 } = {}) {
  if (!apiKey || !mint || !pubkey) return { balance: 0, tier: 0, ok: false }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'holder', method: 'getTokenAccountsByOwner',
          params: [pubkey, { mint }, { encoding: 'jsonParsed' }],
        }),
      })
      if (!res.ok) throw new Error(`helius http ${res.status}`)
      const json = await res.json()
      // A JSON-RPC error in the body (e.g. rate limit) often rides a 200 — treat it as a failure, not a verified 0.
      if (json?.error) throw new Error(json.error?.message || 'helius rpc error')
      return { ...holderStatus(parseHolderBalance(json)), ok: true }
    } catch {
      if (attempt < retries) { await sleep(retryDelayMs); continue }
      return { balance: 0, tier: 0, ok: false }
    }
  }
  return { balance: 0, tier: 0, ok: false } // unreachable; satisfies control-flow analysis
}

export async function fetchHolderTier(pubkey, opts) {
  return (await fetchHolderStatus(pubkey, opts)).tier
}
