import { describe, expect, it } from 'vitest'
import { dayKey, dailyObjectives } from './daily'

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
