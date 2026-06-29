// Server-authoritative play-access gate. Flying requires a verified wallet holding >= the threshold.
// Fail-closed: a failed Helius balance fetch resolves holderBalance to 0 (see holders.mjs), which is
// below the threshold, so an unverifiable connection is rejected here. The operator showcase bot
// (isBot, granted via BOT_COSMETIC_SECRET) is exempt so it can produce footage. Separate from the
// ranked gate (PVP_RANKED_MIN_TOKEN_BALANCE = 1000).
export const LAUNCH_MIN_TOKEN_BALANCE = 1

export function launchGate(client, minBalance) {
  if (client?.isBot) return { ok: true, reason: null }
  if (!client?.authed) return { ok: false, reason: 'wallet-required' }
  if ((Number(client.holderBalance) || 0) < minBalance) return { ok: false, reason: 'insufficient-tokens' }
  return { ok: true, reason: null }
}
