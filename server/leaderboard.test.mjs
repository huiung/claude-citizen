import { describe, expect, it } from 'vitest'
import { leaderboardPage, parseLeaderboardParams } from './leaderboard.mjs'

function entry(name, earned) {
  return { name, earned, credits: earned - 100 }
}

const WALLET = '7GgB2mDWpD6nA3xJ9sS6e5zqZTa3YL6hFLaeL5Qz6QnU'

describe('leaderboard paging', () => {
  it('returns a 10 pilot page with global ranks and total capped at 100', () => {
    const store = {}
    for (let i = 0; i < 120; i++) store[`p${i}`] = entry(`P${i}`, 1000 - i)

    const page = leaderboardPage(store, { offset: 10, limit: 10 })

    expect(page.total).toBe(100)
    expect(page.offset).toBe(10)
    expect(page.limit).toBe(10)
    expect(page.rows).toHaveLength(10)
    expect(page.rows[0]).toEqual({ rank: 11, name: 'P10', earned: 990 })
    expect(page.rows[9].rank).toBe(20)
  })

  it('ignores empty saves and falls back from earned to credits', () => {
    const page = leaderboardPage({
      a: { name: 'A', credits: 50 },
      b: null,
      c: { name: 'C' },
      d: { name: 'D', earned: 70, credits: 20 },
    }, { offset: 0, limit: 10 })

    expect(page.total).toBe(2)
    expect(page.rows.map((row) => row.name)).toEqual(['D', 'A'])
    expect(page.rows.map((row) => row.earned)).toEqual([70, 50])
  })

  it('shows callsign and shortened wallet for wallet-connected career pilots', () => {
    const page = leaderboardPage({
      [WALLET]: { name: 'ACE', earned: 1000 },
      anonToken: { name: 'ANON', earned: 900 },
    }, { offset: 0, limit: 10 })

    expect(page.rows[0]).toMatchObject({
      name: 'ACE (7GgB...6QnU)',
      callsign: 'ACE',
      wallet: '7GgB...6QnU',
      earned: 1000,
    })
    expect(page.rows[1]).toEqual({ rank: 2, name: 'ANON', earned: 900 })
  })

  it('hides stale anonymous career rows already claimed by a wallet row with the same callsign', () => {
    const page = leaderboardPage({
      [WALLET]: { name: 'MAV', earned: 1200 },
      staleAnon: { name: 'MAV', earned: 1100 },
      strongerAnon: { name: 'MAV', earned: 1300 },
      otherAnon: { name: 'OTHER', earned: 1000 },
    }, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.name)).toEqual([
      'MAV',
      'MAV (7GgB...6QnU)',
      'OTHER',
    ])
    expect(page.total).toBe(3)
  })

  it('keeps anonymous PILOT rows even when a wallet-connected PILOT exists', () => {
    const page = leaderboardPage({
      [WALLET]: { name: 'PILOT', earned: 1200 },
      anonPilot: { name: 'PILOT', earned: 1100 },
      otherAnon: { name: 'OTHER', earned: 1000 },
    }, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.name)).toEqual([
      'PILOT (7GgB...6QnU)',
      'PILOT',
      'OTHER',
    ])
    expect(page.total).toBe(3)
  })

  it('clamps request params to 10-row pages through rank 100', () => {
    expect(parseLeaderboardParams('/leaderboard?offset=999&limit=999')).toEqual({ offset: 90, limit: 10 })
    expect(parseLeaderboardParams('/leaderboard?offset=-40&limit=2')).toEqual({ offset: 0, limit: 10 })
  })
})
