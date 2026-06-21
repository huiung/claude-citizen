export const LEADERBOARD_PAGE_SIZE = 10
export const LEADERBOARD_MAX_RANK = 100

export interface LeaderboardRow {
  rank?: number
  name: string
  earned: number
}

export interface LeaderboardPage {
  rows: LeaderboardRow[]
  total: number
  offset: number
  limit: number
  maxRank?: number
}

export function leaderboardUrl(baseUrl: string, offset: number): string {
  const url = new URL(baseUrl, 'http://localhost')
  const safeOffset = Math.min(Math.max(0, Math.floor(offset)), LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE)
  url.searchParams.set('offset', String(safeOffset))
  url.searchParams.set('limit', String(LEADERBOARD_PAGE_SIZE))
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) return url.toString()
  return `${url.pathname}${url.search}`
}

export function normalizeLeaderboardPage(payload: unknown, fallbackOffset = 0): LeaderboardPage {
  if (Array.isArray(payload)) {
    return {
      rows: payload as LeaderboardRow[],
      total: payload.length,
      offset: fallbackOffset,
      limit: LEADERBOARD_PAGE_SIZE,
      maxRank: LEADERBOARD_MAX_RANK,
    }
  }
  const raw = payload as Partial<LeaderboardPage> | null
  const rows = Array.isArray(raw?.rows) ? raw.rows : []
  const total = Number.isFinite(Number(raw?.total)) ? Number(raw?.total) : rows.length
  const offset = Number.isFinite(Number(raw?.offset)) ? Number(raw?.offset) : fallbackOffset
  const limit = Number.isFinite(Number(raw?.limit)) ? Number(raw?.limit) : LEADERBOARD_PAGE_SIZE
  const maxRank = Number.isFinite(Number(raw?.maxRank)) ? Number(raw?.maxRank) : LEADERBOARD_MAX_RANK
  return { rows, total, offset, limit, maxRank }
}

export function leaderboardRangeText(page: LeaderboardPage): string {
  if (page.total <= 0 || page.rows.length <= 0) return `0 / ${Math.min(page.maxRank ?? LEADERBOARD_MAX_RANK, LEADERBOARD_MAX_RANK)}`
  const start = page.offset + 1
  const end = page.offset + page.rows.length
  return `${start}-${end} / ${page.total}`
}

export function canPageLeaderboard(page: LeaderboardPage): { prev: boolean; next: boolean } {
  const cap = Math.min(page.total, page.maxRank ?? LEADERBOARD_MAX_RANK)
  return {
    prev: page.offset > 0,
    next: page.offset + page.limit < cap,
  }
}

export function nextLeaderboardOffset(current: number, dir: -1 | 1): number {
  return Math.min(
    Math.max(0, current + dir * LEADERBOARD_PAGE_SIZE),
    LEADERBOARD_MAX_RANK - LEADERBOARD_PAGE_SIZE,
  )
}
