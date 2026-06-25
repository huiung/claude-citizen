import { describe, expect, it } from 'vitest'
import { nextRank, rankBonus, rankForCredits, RANKS, rankProgress } from './ranks'

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
  it('reaches the new prestige ranks and caps at Warlord', () => {
    expect(rankForCredits(700_000).name).toBe('Vanguard')
    expect(rankForCredits(2_000_000).name).toBe('Warlord')
    expect(rankForCredits(10_000_000).name).toBe('Warlord')
  })
})

describe('nextRank', () => {
  it('returns the next rank, or null at the top', () => {
    expect(nextRank(RANKS[0])?.name).toBe('Ensign')
    expect(nextRank(RANKS[5])?.name).toBe('Vanguard')
    expect(nextRank(RANKS[7])).toBeNull()
  })
})

describe('rankProgress', () => {
  it('is 0 at a threshold and approaches 1 before the next', () => {
    expect(rankProgress(1_000)).toBeCloseTo(0) // just hit Ensign
    expect(rankProgress(3_000)).toBeCloseTo((3_000 - 1_000) / (5_000 - 1_000)) // halfway to Pilot
  })
  it('is 1 when maxed (Admiral)', () => {
    expect(rankProgress(5_000_000)).toBe(1) // maxed at Warlord
  })
})

describe('rankBonus', () => {
  it('is 0 at Cadet and climbs to 0.5 at Admiral', () => {
    expect(rankBonus(0)).toBe(0)
    expect(rankBonus(5_000)).toBeCloseTo(0.16) // Pilot
    expect(rankBonus(250_000)).toBe(0.5) // Admiral
  })
  it('matches the rank held at the given earnings', () => {
    for (const r of RANKS) expect(rankBonus(r.min)).toBe(r.bonus)
  })
  it('freezes the bonus at the 0.5 cap for prestige ranks', () => {
    expect(rankBonus(700_000)).toBe(0.5) // Vanguard
    expect(rankBonus(2_000_000)).toBe(0.5) // Warlord
  })
})
