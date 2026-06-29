import { describe, expect, it } from 'vitest'
import { leaderboardPage, parseLeaderboardParams } from './leaderboard.mjs'

function entry(name, earned) {
  return { name, earned, credits: earned - 100 }
}

const WALLET = '7GgB2mDWpD6nA3xJ9sS6e5zqZTa3YL6hFLaeL5Qz6QnU'
const WALLET_B = '9AbC123456789ABCDEFGHJKLMNPQRSTUVWXYZ2XyZ'

describe('leaderboard paging', () => {
  it('returns a 10 pilot page with global ranks and total capped at 100', () => {
    const store = {}
    // base58 wallet-style keys only (anon keys are excluded from the board)
    const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    for (let i = 0; i < 120; i++) {
      const tail = `${b58[Math.floor(i / 58)]}${b58[i % 58]}`
      const key = `1111111111111111111111111111111${tail}` // 33 base58 chars
      store[key] = entry(`P${i}`, 1000 - i)
    }

    const page = leaderboardPage(store, { offset: 10, limit: 10 })

    expect(page.total).toBe(100)
    expect(page.offset).toBe(10)
    expect(page.limit).toBe(10)
    expect(page.rows).toHaveLength(10)
    expect(page.rows[0].rank).toBe(11)
    expect(page.rows[0].callsign).toBe('P10')
    expect(page.rows[0].earned).toBe(990)
    expect(page.rows[9].rank).toBe(20)
  })

  it('ignores empty saves and falls back from earned to credits', () => {
    const page = leaderboardPage({
      [WALLET]: { name: 'A', credits: 50 },
      b: null,
      [WALLET_B]: { name: 'C' },
      '11111111111111111111111111111111': { name: 'D', earned: 70, credits: 20 },
    }, { offset: 0, limit: 10 })

    expect(page.total).toBe(2)
    expect(page.rows.map((row) => row.callsign)).toEqual(['D', 'A'])
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
    // anon entry is excluded entirely (wallet-only board)
    expect(page.total).toBe(1)
    expect(page.rows).toHaveLength(1)
  })

  it('includes only wallet-key entries, excluding qualifying anon rows', () => {
    const page = leaderboardPage({
      [WALLET]: { name: 'ACE', earned: 1000 },
      ['a'.repeat(64)]: { name: 'ANON', earned: 5000 },
      'anon-token-1': { name: 'OTHER', earned: 4000 },
    }, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.callsign)).toEqual(['ACE'])
    expect(page.total).toBe(1)
  })

  it('excludes operator bot rows from the career leaderboard', () => {
    const page = leaderboardPage({
      'bot-claude-abc': { name: 'CLAUDE', earned: 999999 },
      [WALLET_B]: { name: 'MAV', earned: 888888 },
      [WALLET]: { name: 'ACE', earned: 1000 },
    }, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.callsign)).toEqual(['MAV', 'ACE'])
    expect(page.total).toBe(2)
  })

  it('clamps request params to 10-row pages through rank 100', () => {
    expect(parseLeaderboardParams('/leaderboard?offset=999&limit=999')).toEqual({ offset: 90, limit: 10 })
    expect(parseLeaderboardParams('/leaderboard?offset=-40&limit=2')).toEqual({ offset: 0, limit: 10 })
  })
})
