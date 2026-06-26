import { describe, expect, it } from 'vitest'
import { dayKey, dailyObjectives, rollStreak, STREAK_REWARD_CAP } from './daily'

describe('dayKey', () => {
  it('returns the UTC YYYY-MM-DD for an epoch ms', () => {
    expect(dayKey(Date.parse('2026-06-26T13:45:00Z'))).toBe('2026-06-26')
  })

  it('uses UTC, not local time, at the day boundary', () => {
    expect(dayKey(Date.parse('2026-06-26T23:59:59Z'))).toBe('2026-06-26')
    expect(dayKey(Date.parse('2026-06-27T00:00:00Z'))).toBe('2026-06-27')
  })
})

describe('dailyObjectives', () => {
  it('returns exactly 3 objectives', () => {
    expect(dailyObjectives('2026-06-26')).toHaveLength(3)
  })

  it('is deterministic for a given day', () => {
    expect(dailyObjectives('2026-06-26')).toEqual(dailyObjectives('2026-06-26'))
  })

  it('picks 3 distinct kinds', () => {
    const kinds = dailyObjectives('2026-06-26').map((o) => o.kind)
    expect(new Set(kinds).size).toBe(3)
  })

  it('uses the kind as the objective id', () => {
    for (const o of dailyObjectives('2026-06-26')) expect(o.id).toBe(o.kind)
  })

  it('varies across days', () => {
    const a = dailyObjectives('2026-06-26').map((o) => o.kind).join(',')
    const days = ['2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30', '2026-07-01']
    expect(days.some((d) => dailyObjectives(d).map((o) => o.kind).join(',') !== a)).toBe(true)
  })
})

describe('rollStreak', () => {
  it('advances by 1 when the last day was yesterday', () => {
    const r = rollStreak(3, '2026-06-25', '2026-06-26')
    expect(r.streak).toBe(4)
    expect(r.advanced).toBe(true)
    expect(r.reward).toBe(4)
  })

  it('resets to 1 after a missed day', () => {
    const r = rollStreak(9, '2026-06-23', '2026-06-26')
    expect(r.streak).toBe(1)
    expect(r.reward).toBe(1)
    expect(r.advanced).toBe(true)
  })

  it('resets to 1 on first ever play (empty lastStreakDay)', () => {
    const r = rollStreak(0, '', '2026-06-26')
    expect(r.streak).toBe(1)
    expect(r.advanced).toBe(true)
  })

  it('is idempotent for the same day — no re-grant', () => {
    const r = rollStreak(4, '2026-06-26', '2026-06-26')
    expect(r.streak).toBe(4)
    expect(r.reward).toBe(0)
    expect(r.advanced).toBe(false)
  })

  it('caps the reward at STREAK_REWARD_CAP', () => {
    const r = rollStreak(STREAK_REWARD_CAP + 5, '2026-06-25', '2026-06-26')
    expect(r.streak).toBe(STREAK_REWARD_CAP + 6)
    expect(r.reward).toBe(STREAK_REWARD_CAP)
  })
})
