import { describe, expect, it } from 'vitest'
import { pilotLevelLeaderboardPage, mergePilotStats, mergeCampaignStats } from './pilotLevelLeaderboard.mjs'
import { sanitizeProgress } from './progress.mjs'

const WALLET_A = '7GgB2mDWpD6nA3xJ9sS6e5zqZTa3YL6hFLaeL5Qz6QnU'
const WALLET_B = '9AbC123456789ABCDEFGHJKLMNPQRSTUVWXYZ2XyZ'
const WALLET_C = '4ZxY123456789ABCDEFGHJKLMNPQRSTUVWXYZ7Bnm'
const ANON = 'anon-token'

describe('pilot level leaderboard', () => {
  it('ranks higher level first, then higher xp, filtering out level-0 pilots and anon entries', () => {
    const store = {
      [ANON]: { name: 'ANON', pilot: { level: 5, xp: 120 } },
      [WALLET_A]: { name: 'ACE', pilot: { level: 5, xp: 300 } },
      [WALLET_B]: { name: 'MAV', pilot: { level: 3, xp: 999 } },
      [WALLET_C]: { name: 'NOOB', pilot: { level: 0, xp: 50 } },
      empty: { name: 'EMPTY' },
    }

    const page = pilotLevelLeaderboardPage(store)

    // ANON excluded (non-wallet key); level-0 NOOB excluded; empty excluded
    expect(page.rows.map((row) => row.name)).toEqual([
      'ACE (7GgB...6QnU)',
      'MAV (9AbC...2XyZ)',
    ])
    expect(page.rows[0]).toMatchObject({ rank: 1, level: 5, xp: 300, callsign: 'ACE', wallet: '7GgB...6QnU' })
    expect(page.total).toBe(2)
  })

  it('breaks level/xp ties by callsign key', () => {
    const store = {
      [WALLET_B]: { name: 'BBB', pilot: { level: 4, xp: 100 } },
      [WALLET_A]: { name: 'AAA', pilot: { level: 4, xp: 100 } },
    }
    const page = pilotLevelLeaderboardPage(store)
    // WALLET_A ('7Gg...') sorts before WALLET_B ('9Ab...') by key
    expect(page.rows.map((row) => row.callsign)).toEqual(['AAA', 'BBB'])
  })

  it('includes only wallet-key entries, excluding qualifying anon rows', () => {
    const page = pilotLevelLeaderboardPage({
      [WALLET_A]: { name: 'ACE', pilot: { level: 5, xp: 200 } },
      ['a'.repeat(64)]: { name: 'ANON', pilot: { level: 9, xp: 900 } },
      'anon-token-1': { name: 'OTHER', pilot: { level: 8, xp: 10 } },
    })

    expect(page.rows.map((row) => row.callsign)).toEqual(['ACE'])
    expect(page.total).toBe(1)
  })

  it('excludes operator bot rows', () => {
    const page = pilotLevelLeaderboardPage({
      'bot-claude-abc': { name: 'CLAUDE', pilot: { level: 20, xp: 0 } },
      [WALLET_B]: { name: 'MAV', pilot: { level: 19, xp: 0 } },
      [WALLET_A]: { name: 'ACE', pilot: { level: 2, xp: 0 } },
    })
    expect(page.rows.map((row) => row.callsign)).toEqual(['MAV', 'ACE'])
    expect(page.total).toBe(2)
  })

  it('paginates with global ranks and total capped at 100', () => {
    const store = {}
    const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    for (let i = 0; i < 120; i++) {
      const tail = `${b58[Math.floor(i / 58)]}${b58[i % 58]}`
      const key = `1111111111111111111111111111111${tail}` // 33 base58 chars
      store[key] = { name: `P${i}`, pilot: { level: 5, xp: 1000 - i } }
    }
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
