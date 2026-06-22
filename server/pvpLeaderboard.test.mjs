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

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function wallet(n = 0) {
  return `${'1'.repeat(31)}${BASE58[n % BASE58.length]}${BASE58[Math.floor(n / BASE58.length) % BASE58.length]}`
}

describe('ranked PvP leaderboard', () => {
  it('records a ranked kill, victim death, streak, and best streak', () => {
    const killerKey = wallet(1)
    const victimKey = wallet(2)
    const store = {
      [killerKey]: { name: 'OLDACE', earned: 100 },
      [victimKey]: {
        name: 'BRAVO',
        earned: 80,
        pvp: stats({ rankedKills: 2, rankedDeaths: 1, rankedStreak: 2, bestRankedStreak: 2, lastRankedKillAt: 500 }),
      },
    }

    recordRankedPvpKill(store, {
      killerKey,
      killerName: 'ACE',
      victimKey,
      victimName: 'BRAVO',
      now: 1000,
    })

    expect(store[killerKey].pvp).toEqual(stats({
      rankedKills: 1,
      rankedDeaths: 0,
      rankedStreak: 1,
      bestRankedStreak: 1,
      lastRankedKillAt: 1000,
    }))
    expect(store[killerKey].name).toBe('ACE')
    expect(store[victimKey].pvp).toEqual(stats({
      rankedKills: 2,
      rankedDeaths: 2,
      rankedStreak: 0,
      bestRankedStreak: 2,
      lastRankedKillAt: 500,
    }))
  })

  it('sorts ranked PvP rows by kills, best streak, fewer deaths, then recency', () => {
    const store = {
      [wallet(1)]: { name: 'ALPHA', pvp: stats({ rankedKills: 3, rankedDeaths: 2, bestRankedStreak: 3, lastRankedKillAt: 100 }) },
      [wallet(2)]: { name: 'BRAVO', pvp: stats({ rankedKills: 3, rankedDeaths: 1, bestRankedStreak: 2, lastRankedKillAt: 900 }) },
      [wallet(3)]: { name: 'CHARLIE', pvp: stats({ rankedKills: 3, rankedDeaths: 1, bestRankedStreak: 2, lastRankedKillAt: 1200 }) },
      [wallet(4)]: { name: 'DELTA', pvp: stats({ rankedKills: 0, rankedDeaths: 8 }) },
    }

    const page = pvpLeaderboardPage(store, { offset: 0, limit: 10 })

    expect(page.rows.map((row) => row.callsign)).toEqual(['ALPHA', 'CHARLIE', 'BRAVO'])
    expect(page.rows[0]).toMatchObject({
      rank: 1,
      name: `ALPHA (${wallet(1).slice(0, 4)}...${wallet(1).slice(-4)})`,
      kills: 3,
      deaths: 2,
      streak: 0,
      bestStreak: 3,
    })
    expect(page.total).toBe(3)
  })

  it('shows shortened wallet addresses for ranked PvP wallet identities', () => {
    const key = '7GgB2mDWpD6nA3xJ9sS6e5zqZTa3YL6hFLaeL5Qz6QnU'
    const store = {
      [key]: { name: 'DUPENAME', pvp: stats({ rankedKills: 4, lastRankedKillAt: 1000 }) },
      anonToken: { name: 'PILOT', pvp: stats({ rankedKills: 1, lastRankedKillAt: 900 }) },
    }

    const page = pvpLeaderboardPage(store, { offset: 0, limit: 10 })

    expect(page.rows[0]).toMatchObject({
      name: 'DUPENAME (7GgB...6QnU)',
      wallet: '7GgB...6QnU',
      callsign: 'DUPENAME',
      kills: 4,
    })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(1)
  })

  it('rejects ranked PvP records without wallet identities', () => {
    const store = {}

    expect(recordRankedPvpKill(store, {
      killerKey: 'anon-killer-token',
      killerName: 'ANON',
      victimKey: wallet(8),
      victimName: 'TARGET',
      now: 1000,
    })).toBe(false)
    expect(recordRankedPvpKill(store, {
      killerKey: wallet(9),
      killerName: 'ACE',
      victimKey: 'anon-victim-token',
      victimName: 'ANON',
      now: 1000,
    })).toBe(false)
    expect(store).toEqual({})
  })

  it('pages ranked PvP rows with the same 100-rank cap as the career leaderboard', () => {
    const store = {}
    for (let i = 0; i < 120; i++) {
      store[wallet(i)] = { name: `P${i}`, pvp: stats({ rankedKills: 120 - i, lastRankedKillAt: i }) }
    }

    const page = pvpLeaderboardPage(store, { offset: 90, limit: 10 })

    expect(page.total).toBe(100)
    expect(page.rows).toHaveLength(10)
    expect(page.rows[0]).toMatchObject({ rank: 91, callsign: 'P90', kills: 30 })
    expect(page.rows[9]).toMatchObject({ rank: 100, callsign: 'P99', kills: 21 })
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
