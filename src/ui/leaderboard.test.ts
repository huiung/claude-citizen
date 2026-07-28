import { describe, expect, it } from 'vitest'
import {
  canPageLeaderboard,
  leaderboardEndpointUrl,
  leaderboardMetricText,
  leaderboardPilotDisplayText,
  leaderboardRangeText,
  leaderboardUrl,
  nextLeaderboardOffset,
  normalizeLeaderboardPage,
  pvpSeasonCopy,
  pvpSeasonParts,
  defaultLandingLeaderboardMode,
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

  it('builds career, PvP, and Race leaderboard endpoints from a websocket url', () => {
    expect(leaderboardEndpointUrl('ws://127.0.0.1:8080', 'career')).toBe('http://127.0.0.1:8080/leaderboard')
    expect(leaderboardEndpointUrl('wss://claudecitizen.com', 'pvp')).toBe('https://claudecitizen.com/pvp-leaderboard')
    expect(leaderboardEndpointUrl('wss://claudecitizen.com', 'race')).toBe('https://claudecitizen.com/race-leaderboard')
  })

  it('formats career, PvP, and Race row metrics', () => {
    expect(leaderboardMetricText({ name: 'ACE', earned: 1234 }, 'career')).toBe('1,234 cr')
    expect(leaderboardMetricText({ name: 'ACE', kills: 7, deaths: 2, streak: 3 }, 'pvp')).toContain('7 K / 2 D')
    expect(leaderboardMetricText({ name: 'ACE', timeMs: 42180, finishes: 3 }, 'race')).toBe('00:42.18 - 3 runs')
  })

  it('formats hub pilot rows with callsign and shortened wallet when present', () => {
    expect(leaderboardPilotDisplayText({ name: 'ACE (7GgB...6QnU)', callsign: 'ACE', wallet: '7GgB...6QnU' })).toBe('ACE  7GgB...6QnU')
    expect(leaderboardPilotDisplayText({ name: 'MAV (9AbC...2XyZ)' })).toBe('MAV  9AbC...2XyZ')
    expect(leaderboardPilotDisplayText({ name: 'PILOT' })).toBe('PILOT')
  })

  it('formats PvP season contest copy while the season is live', () => {
    expect(pvpSeasonCopy(Date.UTC(2026, 5, 22))).toEqual({
      title: 'SEASON 1 LIVE',
      ends: 'ENDS JUN 30 23:59 UTC',
      prizes: 'TOP 3: 1 / 0.5 / 0.25 SOL',
      rules: 'RANKED ONLY - 1,000+ TOKENS',
    })
  })

  it('drops the countdown and the prize table once the season has ended', () => {
    // A finished contest must not keep advertising SOL payouts. There is no Season 2.
    const ended = pvpSeasonCopy(Date.UTC(2026, 6, 1))
    expect(ended.title).toBe('SEASON 1 ENDED')
    expect(ended.ends).toBe('')
    expect(ended.prizes).toBe('')
    expect(ended.rules).toBe('RANKED ONLY - 1,000+ TOKENS')
  })

  it('renders only the non-empty season details', () => {
    expect(pvpSeasonParts(Date.UTC(2026, 5, 22)).details).toEqual([
      'ENDS JUN 30 23:59 UTC',
      'TOP 3: 1 / 0.5 / 0.25 SOL',
      'RANKED ONLY - 1,000+ TOKENS',
    ])
    expect(pvpSeasonParts(Date.UTC(2026, 6, 1)).details).toEqual(['RANKED ONLY - 1,000+ TOKENS'])
  })

  it('opens every visitor on the career board, mobile included', () => {
    expect(defaultLandingLeaderboardMode(true)).toBe('career')
    expect(defaultLandingLeaderboardMode(false)).toBe('career')
  })
})

describe('blackhole leaderboard mode', () => {
  it('maps to the black-hole endpoint path', () => {
    expect(leaderboardEndpointUrl('ws://host:8080', 'blackhole')).toBe('http://host:8080/black-hole-leaderboard')
  })
  it('formats the closest-approach metric in metres', () => {
    expect(leaderboardMetricText({ rank: 1, name: 'ACE', distance: 6210 } as any, 'blackhole')).toContain('6,210')
    expect(leaderboardMetricText({ rank: 1, name: 'ACE', distance: 6210 } as any, 'blackhole')).toContain('m')
  })
})
