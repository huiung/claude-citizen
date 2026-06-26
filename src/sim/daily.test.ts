import { describe, expect, it } from 'vitest'
import { dayKey } from './daily'

describe('dayKey', () => {
  it('returns the UTC YYYY-MM-DD for an epoch ms', () => {
    expect(dayKey(Date.parse('2026-06-26T13:45:00Z'))).toBe('2026-06-26')
  })

  it('uses UTC, not local time, at the day boundary', () => {
    expect(dayKey(Date.parse('2026-06-26T23:59:59Z'))).toBe('2026-06-26')
    expect(dayKey(Date.parse('2026-06-27T00:00:00Z'))).toBe('2026-06-27')
  })
})
