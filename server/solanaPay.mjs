// On-chain settlement check. parseSettlement is pure; verifyTokenPayment is the only side effect.

function ownerDeltas(meta, mint) {
  const sum = (rows, sign, acc) => {
    if (!Array.isArray(rows)) return
    for (const r of rows) {
      if (r?.mint !== mint || typeof r?.owner !== 'string') continue
      let amt = 0n
      try { amt = BigInt(r?.uiTokenAmount?.amount ?? '0') } catch { amt = 0n }
      acc.set(r.owner, (acc.get(r.owner) ?? 0n) + sign * amt)
    }
  }
  const acc = new Map()
  sum(meta?.postTokenBalances, 1n, acc)
  sum(meta?.preTokenBalances, -1n, acc)
  return acc
}

function findMemo(txJson) {
  const ix = txJson?.transaction?.message?.instructions
  if (!Array.isArray(ix)) return ''
  for (const i of ix) {
    if (i?.program === 'spl-memo' && typeof i.parsed === 'string') return i.parsed
  }
  return ''
}

/** Pure: from a getTransaction(jsonParsed) result, the mint deltas reaching seller/treasury + memo.
 *  Returns zeros + empty memo on error/garbage. Never throws. */
export function parseSettlement(txJson, { mint, seller, treasury }) {
  try {
    if (!txJson || txJson.meta?.err) return { sellerRaw: 0n, treasuryRaw: 0n, memo: '' }
    const deltas = ownerDeltas(txJson.meta, mint)
    return {
      sellerRaw: deltas.get(seller) ?? 0n,
      treasuryRaw: deltas.get(treasury) ?? 0n,
      memo: findMemo(txJson),
    }
  } catch {
    return { sellerRaw: 0n, treasuryRaw: 0n, memo: '' }
  }
}

/** Networked: confirm `txSig` paid >= sellerRaw to seller and >= feeRaw to treasury, with the
 *  expected memo nonce, for `mint`. Resolves false on any RPC/parse failure. */
export async function verifyTokenPayment(txSig, { apiKey, mint, seller, treasury, sellerRaw, feeRaw, nonce }) {
  if (!apiKey || !txSig || !mint || !seller || !treasury || !nonce) return false
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'verify', method: 'getTransaction',
        params: [txSig, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
      }),
    })
    if (!res.ok) return false
    const json = await res.json()
    const { sellerRaw: gotSeller, treasuryRaw: gotTreasury, memo } = parseSettlement(json.result, { mint, seller, treasury })
    return memo === nonce && gotSeller >= BigInt(sellerRaw) && gotTreasury >= BigInt(feeRaw)
  } catch {
    return false
  }
}
