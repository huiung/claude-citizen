import { describe, expect, it } from 'vitest'
import { nextRank, rankForCredits, RANKS, rankProgress } from './ranks'

describe('rankForCredits', () => {
  it('floors at Cadet for zero / negative', () => {
    expect(rankForCredits(0).name).toBe('Cadet')
    expect(rankForCredits(-50).name).toBe('Cadet')
  })
  it('picks the highest threshold met', () => {
    expect(rankForCredits(999).name).toBe('Cadet')
    expect(rankForCredits(1_000).name).toBe('Ensign')
    expect(rankForCredits(5_000).name).toBe('Pilot')
    expect(rankForCredits(20_000).name).toBe('Ace')
    expect(rankForCredits(80_000).name).toBe('Commander')
    expect(rankForCredits(250_000).name).toBe('Admiral')
  })
  it('caps at Admiral past the top threshold', () => {
    expect(rankForCredits(10_000_000).name).toBe('Admiral')
  })
})

describe('nextRank', () => {
  it('returns the next rank, or null at the top', () => {
    expect(nextRank(RANKS[0])?.name).toBe('Ensign')
    expect(nextRank(RANKS[5])).toBeNull()
  })
})

describe('rankProgress', () => {
  it('is 0 at a threshold and approaches 1 before the next', () => {
    expect(rankProgress(1_000)).toBeCloseTo(0) // just hit Ensign
    expect(rankProgress(3_000)).toBeCloseTo((3_000 - 1_000) / (5_000 - 1_000)) // halfway to Pilot
  })
  it('is 1 when maxed (Admiral)', () => {
    expect(rankProgress(500_000)).toBe(1)
  })
})
