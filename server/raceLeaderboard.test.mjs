import { describe, expect, it } from 'vitest'
import { raceLeaderboardPage, recordRankedRaceFinish, mergeRaceStats } from './raceLeaderboard.mjs'

const WALLET_A = '7GgB123456789ABCDEFGHJKLMNPQRSTUVWXYZ6QnU'
const WALLET_B = '9AbC123456789ABCDEFGHJKLMNPQRSTUVWXYZ2XyZ'
const ANON = 'anon-token'

describe('ranked race leaderboard', () => {
  it('records only verified wallet race finishes and keeps the best time', () => {
    const store = {}

    expect(recordRankedRaceFinish(store, { key: ANON, name: 'ANON', timeMs: 32100, now: 1000 })).toBe(false)
    expect(recordRankedRaceFinish(store, { key: WALLET_A, name: 'ACE', timeMs: 41230, now: 2000 })).toBe(true)
    expect(recordRankedRaceFinish(store, { key: WALLET_A, name: 'ACE', timeMs: 43999, now: 3000 })).toBe(true)
    expect(recordRankedRaceFinish(store, { key: WALLET_A, name: 'ACE', timeMs: 39870, now: 4000 })).toBe(true)

    expect(store[WALLET_A].race).toEqual({
      bestTimeMs: 39870,
      finishes: 3,
      lastFinishAt: 4000,
    })
    expect(store[ANON]).toBeUndefined()
  })

  it('sorts lower times first, then more finishes, then newer runs', () => {
    const store = {
      [WALLET_A]: { name: 'ACE', race: { bestTimeMs: 42000, finishes: 4, lastFinishAt: 5000 } },
      [WALLET_B]: { name: 'MAV', race: { bestTimeMs: 42000, finishes: 6, lastFinishAt: 4000 } },
      '11111111111111111111111111111111': { name: 'ZEN', race: { bestTimeMs: 39800, finishes: 1, lastFinishAt: 1000 } },
      [ANON]: { name: 'ANON', race: { bestTimeMs: 12000, finishes: 99, lastFinishAt: 9000 } },
    }

    const page = raceLeaderboardPage(store)

    expect(page.rows.map((row) => row.name)).toEqual([
      'ZEN (1111...1111)',
      'MAV (9AbC...2XyZ)',
      'ACE (7GgB...6QnU)',
    ])
    expect(page.rows[0].timeMs).toBe(39800)
    expect(page.total).toBe(3)
  })

  it('preserves race stats when ordinary progress saves arrive', () => {
    const progress = { credits: 100, earned: 120, name: 'ACE' }
    const previous = { race: { bestTimeMs: 39870, finishes: 3, lastFinishAt: 4000 } }

    expect(mergeRaceStats(progress, previous)).toEqual({
      credits: 100,
      earned: 120,
      name: 'ACE',
      race: { bestTimeMs: 39870, finishes: 3, lastFinishAt: 4000 },
    })
  })
})
