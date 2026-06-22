import { describe, expect, it } from 'vitest'
import {
  mergePvpStats,
  pvpLeaderboardPage,
  recordRankedPvpKill,
} from './pvpLeaderboard.mjs'

function stats(overrides = {}) {
  return {
    rankedKills: 0,
    rankedDeaths: 0,
    rankedStreak: 0,
    bestRankedStreak: 0,
    lastRankedKillAt: 0,
    ...overrides,
  }
}

describe('ranked PvP leaderboard', () => {
  it('records a ranked kill, victim death, streak, and best streak', () => {
    const store = {
      killer: { name: 'OLDACE', earned: 100 },
      victim: {
        name: 'BRAVO',
        earned: 80,
        pvp: stats({ rankedKills: 2, rankedDeaths: 1, rankedStreak: 2, bestRankedStreak: 2, lastRankedKillAt: 500 }),
      },
    }

    recordRankedPvpKill(store, {
      killerKey: 'killer',
      killerName: 'ACE',
      victimKey: 'victim',
      victimName: 'BRAVO',
      now: 1000,
    })

    expect(store.killer.pvp).toEqual(stats({
      rankedKills: 1,
      rankedDeaths: 0,
      rankedStreak: 1,
      bestRankedStreak: 1,
      lastRankedKillAt: 1000,
    }))
    expect(store.killer.name).toBe('ACE')
    expect(store.victim.pvp).toEqual(stats({
      rankedKills: 2,
      rankedDeaths: 2,
      rankedStreak: 0,
      bestRankedStreak: 2,
      lastRankedKillAt: 500,
    }))
  })

  it('sorts ranked PvP rows by kills, best streak, fewer deaths, then recency', () => {
    const store = {
      alpha: { name: 'ALPHA', pvp: stats({ rankedKills: 3, rankedDeaths: 2, bestRankedStreak: 3, lastRankedKillAt: 100 }) },
      bravo: { name: 'BRAVO', pvp: stats({ rankedKills: 3, rankedDeaths: 1, bestRankedStreak: 2, lastRankedKillAt: 900 }) },
      charlie: { name: 'CHARLIE', pvp: stats({ rankedKills: 3, rankedDeaths: 1, bestRankedStreak: 2, lastRankedKillAt: 1200 }) },
      delta: { name: 'DELTA', pvp: stats({ rankedKills: 0, rankedDeaths: 8 }) },
    }

    const page = pvpLeaderboardPage(store, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.name)).toEqual(['ALPHA', 'CHARLIE', 'BRAVO'])
    expect(page.rows[0]).toEqual({
      rank: 1,
      name: 'ALPHA',
      kills: 3,
      deaths: 2,
      streak: 0,
      bestStreak: 3,
    })
    expect(page.total).toBe(3)
  })

  it('pages ranked PvP rows with the same 100-rank cap as the career leaderboard', () => {
    const store = {}
    for (let i = 0; i < 120; i++) {
      store[`p${i}`] = { name: `P${i}`, pvp: stats({ rankedKills: 120 - i, lastRankedKillAt: i }) }
    }

    const page = pvpLeaderboardPage(store, { offset: 90, limit: 10 })

    expect(page.total).toBe(100)
    expect(page.rows).toHaveLength(10)
    expect(page.rows[0]).toMatchObject({ rank: 91, name: 'P90', kills: 30 })
    expect(page.rows[9]).toMatchObject({ rank: 100, name: 'P99', kills: 21 })
  })

  it('preserves existing PvP stats when normal progress is saved', () => {
    const cleanProgress = { name: 'ACE', credits: 100, earned: 200 }
    const previousEntry = { pvp: stats({ rankedKills: 4, rankedDeaths: 2, rankedStreak: 3, bestRankedStreak: 3 }) }

    expect(mergePvpStats(cleanProgress, previousEntry)).toEqual({
      name: 'ACE',
      credits: 100,
      earned: 200,
      pvp: previousEntry.pvp,
    })
    expect(mergePvpStats(cleanProgress, null)).toEqual(cleanProgress)
  })
})
