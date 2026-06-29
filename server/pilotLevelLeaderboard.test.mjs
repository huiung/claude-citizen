import { describe, expect, it } from 'vitest'
import { pilotLevelLeaderboardPage, mergePilotStats, mergeCampaignStats } from './pilotLevelLeaderboard.mjs'
import { sanitizeProgress } from './progress.mjs'

const WALLET_A = '7GgB2mDWpD6nA3xJ9sS6e5zqZTa3YL6hFLaeL5Qz6QnU'
const WALLET_B = '9AbC123456789ABCDEFGHJKLMNPQRSTUVWXYZ2XyZ'
const ANON = 'anon-token'

describe('pilot level leaderboard', () => {
  it('ranks higher level first, then higher xp, filtering out level-0 pilots', () => {
    const store = {
      [ANON]: { name: 'ANON', pilot: { level: 5, xp: 120 } },
      [WALLET_A]: { name: 'ACE', pilot: { level: 5, xp: 300 } },
      [WALLET_B]: { name: 'MAV', pilot: { level: 3, xp: 999 } },
      lowbie: { name: 'NOOB', pilot: { level: 0, xp: 50 } },
      empty: { name: 'EMPTY' },
    }

    const page = pilotLevelLeaderboardPage(store)

    expect(page.rows.map((row) => row.name)).toEqual([
      'ACE (7GgB...6QnU)',
      'ANON',
      'MAV (9AbC...2XyZ)',
    ])
    expect(page.rows[0]).toMatchObject({ rank: 1, level: 5, xp: 300, callsign: 'ACE', wallet: '7GgB...6QnU' })
    expect(page.rows[1]).toEqual({ rank: 2, name: 'ANON', level: 5, xp: 120 })
    expect(page.total).toBe(3)
  })

  it('breaks level/xp ties by callsign key', () => {
    const store = {
      bbb: { name: 'BBB', pilot: { level: 4, xp: 100 } },
      aaa: { name: 'AAA', pilot: { level: 4, xp: 100 } },
    }
    const page = pilotLevelLeaderboardPage(store)
    expect(page.rows.map((row) => row.name)).toEqual(['AAA', 'BBB'])
  })

  it('hides stale anonymous rows already claimed by a wallet row with the same callsign', () => {
    const page = pilotLevelLeaderboardPage({
      [WALLET_A]: { name: 'MAV', pilot: { level: 5, xp: 200 } },
      staleAnon: { name: 'MAV', pilot: { level: 4, xp: 900 } },
      strongerAnon: { name: 'MAV', pilot: { level: 6, xp: 0 } },
      otherAnon: { name: 'OTHER', pilot: { level: 3, xp: 10 } },
    })

    expect(page.rows.map((row) => row.name)).toEqual([
      'MAV',
      'MAV (7GgB...6QnU)',
      'OTHER',
    ])
    expect(page.total).toBe(3)
  })

  it('keeps anonymous PILOT rows even when a wallet-connected PILOT exists', () => {
    const page = pilotLevelLeaderboardPage({
      [WALLET_A]: { name: 'PILOT', pilot: { level: 5, xp: 0 } },
      anonPilot: { name: 'PILOT', pilot: { level: 4, xp: 0 } },
    })
    expect(page.rows.map((row) => row.name)).toEqual([
      'PILOT (7GgB...6QnU)',
      'PILOT',
    ])
    expect(page.total).toBe(2)
  })

  it('excludes operator bot rows', () => {
    const page = pilotLevelLeaderboardPage({
      'bot-claude-abc': { name: 'CLAUDE', pilot: { level: 20, xp: 0 } },
      anonClaude: { name: 'CLAUDE', pilot: { level: 19, xp: 0 } },
      realPilot: { name: 'ACE', pilot: { level: 2, xp: 0 } },
    })
    expect(page.rows.map((row) => row.name)).toEqual(['ACE'])
    expect(page.total).toBe(1)
  })

  it('paginates with global ranks and total capped at 100', () => {
    const store = {}
    for (let i = 0; i < 120; i++) store[`p${i}`] = { name: `P${i}`, pilot: { level: 5, xp: 1000 - i } }
    const page = pilotLevelLeaderboardPage(store, { offset: 10, limit: 10 })
    expect(page.total).toBe(100)
    expect(page.offset).toBe(10)
    expect(page.rows).toHaveLength(10)
    expect(page.rows[0].rank).toBe(11)
    expect(page.rows[9].rank).toBe(20)
  })

  it('re-attaches client-reported pilot from a sanitized save', () => {
    const clean = { credits: 100, earned: 120, name: 'ACE' }
    expect(mergePilotStats(clean, { pilot: { level: 4, xp: 33 } })).toEqual({
      credits: 100,
      earned: 120,
      name: 'ACE',
      pilot: { level: 4, xp: 33 },
    })
    // Missing/garbage pilot defaults to level 1, xp 0 (the empty pilot).
    expect(mergePilotStats(clean, { pilot: { level: 'x' } })).toEqual({
      credits: 100,
      earned: 120,
      name: 'ACE',
      pilot: { level: 0, xp: 0 },
    })
  })
})

describe('mergeCampaignStats', () => {
  it('reattaches client-reported campaign that sanitizeProgress drops', () => {
    const raw = { credits: 0, earned: 0, campaign: { step: 2, progress: 40, sectorUnlocked: 2 } }
    const clean = sanitizeProgress(raw)
    expect(clean.campaign).toBeUndefined()
    const merged = mergeCampaignStats(clean, raw)
    expect(merged.campaign).toEqual({ step: 2, progress: 40, sectorUnlocked: 2 })
  })

  it('clamps bad campaign data (lower bounds)', () => {
    const merged = mergeCampaignStats({}, { campaign: { step: -3, progress: -9, sectorUnlocked: 0 } })
    expect(merged.campaign.step).toBe(0)
    expect(merged.campaign.progress).toBe(0)
    expect(merged.campaign.sectorUnlocked).toBe(1)
  })

  it('omits campaign when the source has none', () => {
    const merged = mergeCampaignStats({ credits: 5 }, { credits: 5 })
    expect(merged.campaign).toBeUndefined()
  })
})
