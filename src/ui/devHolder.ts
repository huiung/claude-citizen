export interface DevHolderOverride {
  tier: number
  balance: number
}

const TIER_BALANCE_FLOORS: Record<number, number> = {
  0: 0,
  1: 1,
  2: 100_000,
  3: 1_000_000,
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

export function readLocalDevHolderOverride(
  storage: Pick<Storage, 'getItem'>,
  locationLike: Pick<Location, 'hostname'>,
): DevHolderOverride | null {
  if (!isLocalHost(locationLike.hostname)) return null
  const rawTier = storage.getItem('scc.devHolderTier')
  if (rawTier === null) return null
  const tier = Math.max(0, Math.min(3, Math.floor(Number(rawTier) || 0)))
  const rawBalance = storage.getItem('scc.devHolderBalance')
  const parsedBalance = rawBalance === null ? NaN : Math.floor(Number(rawBalance))
  const floor = TIER_BALANCE_FLOORS[tier] ?? 0
  const balance = Number.isFinite(parsedBalance) ? Math.max(0, parsedBalance) : floor
  return { tier, balance: Math.max(balance, floor) }
}
