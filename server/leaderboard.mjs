export const LEADERBOARD_PAGE_SIZE = 10
export const LEADERBOARD_MAX_RANK = 100

function score(entry) {
  return typeof entry?.earned === 'number' ? entry.earned : (entry?.credits || 0)
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
  const ranked = Object.values(store)
    .filter((entry) => entry && (typeof entry.credits === 'number' || typeof entry.earned === 'number'))
    .sort((a, b) => score(b) - score(a))
    .slice(0, LEADERBOARD_MAX_RANK)
    .map((entry, index) => ({ rank: index + 1, name: entry.name ?? 'PILOT', earned: score(entry) }))

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
