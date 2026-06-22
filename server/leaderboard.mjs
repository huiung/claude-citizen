export const LEADERBOARD_PAGE_SIZE = 10
export const LEADERBOARD_MAX_RANK = 100

function score(entry) {
  return typeof entry?.earned === 'number' ? entry.earned : (entry?.credits || 0)
}

function isWalletKey(key) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(key ?? ''))
}

function shortWallet(key) {
  const text = String(key ?? '')
  if (!isWalletKey(text)) return null
  return `${text.slice(0, 4)}...${text.slice(-4)}`
}

export function parseLeaderboardParams(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost')
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0
  const pageOffset = Math.floor(offset / LEADERBOARD_PAGE_SIZE) * LEADERBOARD_PAGE_SIZE
  return {
    offset: Math.min(pageOffset, LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE),
    limit: LEADERBOARD_PAGE_SIZE,
  }
}

export function leaderboardPage(store, { offset = 0, limit = LEADERBOARD_PAGE_SIZE } = {}) {
  const entries = Object.entries(store)
    .filter(([, entry]) => entry && (typeof entry.credits === 'number' || typeof entry.earned === 'number'))

  const bestWalletScoreByName = new Map()
  for (const [key, entry] of entries) {
    if (!isWalletKey(key)) continue
    const name = String(entry.name ?? 'PILOT').trim().toLowerCase()
    if (name === 'pilot') continue
    bestWalletScoreByName.set(name, Math.max(bestWalletScoreByName.get(name) ?? 0, score(entry)))
  }

  const ranked = entries
    .filter(([key, entry]) => {
      if (isWalletKey(key)) return true
      const name = String(entry.name ?? 'PILOT').trim().toLowerCase()
      const walletScore = bestWalletScoreByName.get(name)
      return walletScore === undefined || score(entry) > walletScore
    })
    .sort(([, a], [, b]) => score(b) - score(a))
    .slice(0, LEADERBOARD_MAX_RANK)
    .map(([key, entry], index) => {
      const callsign = entry.name ?? 'PILOT'
      const wallet = shortWallet(key)
      const row = {
        rank: index + 1,
        name: wallet ? `${callsign} (${wallet})` : callsign,
        earned: score(entry),
      }
      if (wallet) {
        row.wallet = wallet
        row.callsign = callsign
      }
      return row
    })

  const safeOffset = Math.min(Math.max(0, Math.floor(offset)), LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE)
  const safeLimit = LEADERBOARD_PAGE_SIZE
  return {
    rows: ranked.slice(safeOffset, safeOffset + safeLimit),
    total: ranked.length,
    offset: safeOffset,
    limit: safeLimit,
    maxRank: LEADERBOARD_MAX_RANK,
  }
}
