import { describe, expect, it } from 'vitest'
import { readLocalDevHolderOverride } from './devHolder'

function storage(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return {
    getItem: (key: string) => values[key] ?? null,
  }
}

describe('local dev holder override', () => {
  it('reads a tier 3 holder override on localhost', () => {
    expect(readLocalDevHolderOverride(
      storage({ 'scc.devHolderTier': '3' }),
      { hostname: '127.0.0.1' },
    )).toEqual({ tier: 3, balance: 1_000_000 })
  })

  it('allows an explicit local test balance', () => {
    expect(readLocalDevHolderOverride(
      storage({ 'scc.devHolderTier': '2', 'scc.devHolderBalance': '250000' }),
      { hostname: 'localhost' },
    )).toEqual({ tier: 2, balance: 250_000 })
  })

  it('ignores overrides outside local development hosts', () => {
    expect(readLocalDevHolderOverride(
      storage({ 'scc.devHolderTier': '3', 'scc.devHolderBalance': '1000000' }),
      { hostname: 'claudecitizen.com' },
    )).toBeNull()
  })
})
