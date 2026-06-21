import { describe, expect, it } from 'vitest'
import {
  canPageLeaderboard,
  leaderboardRangeText,
  leaderboardUrl,
  nextLeaderboardOffset,
  normalizeLeaderboardPage,
} from './leaderboard'

describe('leaderboard UI paging', () => {
  it('normalizes legacy array responses', () => {
    const page = normalizeLeaderboardPage([{ name: 'A', earned: 10 }], 20)

    expect(page.offset).toBe(20)
    expect(page.total).toBe(1)
    expect(page.rows[0].name).toBe('A')
  })

  it('formats rank ranges and button availability', () => {
    const page = normalizeLeaderboardPage({
      rows: Array.from({ length: 7 }, (_, i) => ({ rank: 31 + i, name: `P${i}`, earned: 100 - i })),
      total: 37,
      offset: 30,
      limit: 10,
      maxRank: 100,
    })

    expect(leaderboardRangeText(page)).toBe('31-37 / 37')
    expect(canPageLeaderboard(page)).toEqual({ prev: true, next: false })
  })

  it('builds capped leaderboard page urls', () => {
    expect(leaderboardUrl('https://example.test/leaderboard', 999)).toBe('https://example.test/leaderboard?offset=90&limit=10')
    expect(nextLeaderboardOffset(90, 1)).toBe(90)
    expect(nextLeaderboardOffset(10, -1)).toBe(0)
  })
})
