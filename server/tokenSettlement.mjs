// server/tokenSettlement.mjs
// Pure token-amount math. All on-chain amounts are BigInt base units (never floats).

/** Human token amount → integer base units, rounded to nearest unit. */
export function toBaseUnits(amount, decimals) {
  const safe = Math.max(0, Number(amount) || 0)
  const factor = 10 ** Math.max(0, Math.floor(Number(decimals) || 0))
  return BigInt(Math.round(safe * factor))
}

/** Split a total into treasury fee (floored) + seller remainder. feeBps is basis points (500 = 5%). */
export function splitFee(totalRaw, feeBps) {
  const total = BigInt(totalRaw)
  const bps = BigInt(Math.max(0, Math.floor(Number(feeBps) || 0)))
  const feeRaw = (total * bps) / 10_000n
  return { feeRaw, sellerRaw: total - feeRaw }
}
