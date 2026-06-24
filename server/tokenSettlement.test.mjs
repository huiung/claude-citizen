// server/tokenSettlement.test.mjs
import { describe, expect, it } from 'vitest'
import { toBaseUnits, splitFee } from './tokenSettlement.mjs'

describe('token settlement math', () => {
  it('converts a human token price to base units with decimals', () => {
    expect(toBaseUnits(1250, 6)).toBe(1_250_000_000n)
    expect(toBaseUnits(1250.5, 6)).toBe(1_250_500_000n)
  })

  it('rounds to nearest base unit', () => {
    expect(toBaseUnits(0.0000005, 6)).toBe(1n) // 0.5 base unit rounds up
  })

  it('splits a 5% fee, remainder to seller', () => {
    expect(splitFee(1_000_000n, 500)).toEqual({ feeRaw: 50_000n, sellerRaw: 950_000n })
  })

  it('floors the fee so seller is never short-changed by rounding', () => {
    expect(splitFee(999n, 500)).toEqual({ feeRaw: 49n, sellerRaw: 950n }) // 999*500/10000 = 49.95 -> 49
  })
})
