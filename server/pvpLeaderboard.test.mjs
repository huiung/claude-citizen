import { describe, expect, it } from 'vitest'
import {
  createPvpKillAuditLog,
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

  it('keeps a capped ranked kill audit log without exposing raw identity keys', () => {
    const log = createPvpKillAuditLog(3)

    log.record({
      zone: 'practice',
      killerKey: 'raw-killer-key',
      killerName: 'PRACTICE',
      victimKey: 'raw-victim-key',
      victimName: 'TARGET',
      now: 900,
      reward: 0,
    })
    log.record({
      zone: 'ranked',
      killerKey: 'raw-killer-key',
      killerName: 'ALPHA',
      victimKey: 'raw-victim-key',
      victimName: 'BRAVO',
      now: 1000,
      reward: 180,
      killerBalance: 1500,
      victimBalance: 1200,
    })
    log.record({
      zone: 'ranked',
      killerKey: 'raw-killer-key',
      killerName: 'ALPHA',
      victimKey: 'raw-victim-key',
      victimName: 'BRAVO',
      now: 1100,
      reward: 0,
      killerBalance: 1500,
      victimBalance: 1200,
    })
    log.record({
      zone: 'ranked',
      killerKey: 'other-killer-key',
      killerName: 'CHARLIE',
      victimKey: 'raw-victim-key',
      victimName: 'BRAVO',
      now: 1200,
      reward: 180,
    })

    const snapshot = log.snapshot()
    expect(snapshot.total).toBe(3)
    expect(snapshot.rows.map((row) => row.killerName)).toEqual(['CHARLIE', 'ALPHA', 'ALPHA'])
    expect(snapshot.rows[1]).toMatchObject({
      at: 1100,
      zone: 'ranked',
      killerName: 'ALPHA',
      victimName: 'BRAVO',
      reward: 0,
      killerBalance: 1500,
      victimBalance: 1200,
    })
    expect(JSON.stringify(snapshot)).not.toContain('raw-killer-key')
    expect(snapshot.rows[1].killerHash).toHaveLength(12)
    expect(snapshot.rows[1].killerHash).toBe(snapshot.rows[2].killerHash)
    expect(snapshot.rows[0].victimHash).toBe(snapshot.rows[1].victimHash)
  })

  it('hydrates capped audit rows from a persisted snapshot', () => {
    const log = createPvpKillAuditLog(2, {
      rows: [
        {
          at: 1000,
          zone: 'ranked',
          killerName: 'ALPHA',
          victimName: 'BRAVO',
          killerHash: '111111111111',
          victimHash: '222222222222',
          reward: 180,
          killerBalance: 1500,
          victimBalance: 1200,
        },
        {
          at: 900,
          zone: 'ranked',
          killerName: 'CHARLIE',
          victimName: 'DELTA',
          killerHash: '333333333333',
          victimHash: '444444444444',
          reward: 0,
        },
        {
          at: 800,
          zone: 'ranked',
          killerName: 'ECHO',
          victimName: 'FOXTROT',
          killerHash: '555555555555',
          victimHash: '666666666666',
          reward: 180,
        },
      ],
    })

    expect(log.snapshot().rows.map((row) => row.killerName)).toEqual(['ALPHA', 'CHARLIE'])

    log.record({
      zone: 'ranked',
      killerKey: 'new-killer',
      killerName: 'NEWACE',
      victimKey: 'new-victim',
      victimName: 'NEWTARGET',
      now: 1100,
      reward: 180,
    })

    const snapshot = log.snapshot()
    expect(snapshot.rows).toHaveLength(2)
    expect(snapshot.rows.map((row) => row.killerName)).toEqual(['NEWACE', 'ALPHA'])
    expect(snapshot.rows[1].killerHash).toBe('111111111111')
  })
})
