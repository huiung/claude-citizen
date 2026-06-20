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

/** Query Helius for `pubkey`'s holding of `mint` and resolve a cosmetic tier (0..3).
 *  Resolves 0 on any failure (network, rate limit, missing key) — game just shows no flair. */
export async function fetchHolderTier(pubkey, { apiKey, mint }) {
  if (!apiKey || !mint || !pubkey) return 0
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'holder', method: 'getTokenAccountsByOwner',
        params: [pubkey, { mint }, { encoding: 'jsonParsed' }],
      }),
    })
    if (!res.ok) return 0
    return holderTier(parseHolderBalance(await res.json()))
  } catch {
    return 0
  }
}
