import { describe, expect, it } from 'vitest'
import { clampBet, colorOf, MAX_BET, MIN_BET, payoutMultiplier, spinRoulette, WHEEL_SIZE } from './roulette'

describe('colorOf', () => {
  it('0 is green, known reds are red, the rest are black', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(3)).toBe('red')
    expect(colorOf(2)).toBe('black')
    expect(colorOf(4)).toBe('black')
  })
})

describe('spinRoulette', () => {
  it('maps rng [0,1) into 0..36 with matching color', () => {
    expect(spinRoulette(() => 0)).toEqual({ number: 0, color: 'green' })
    expect(spinRoulette(() => 0.999999).number).toBe(WHEEL_SIZE - 1)
    const r = spinRoulette(() => 0.5)
    expect(r.number).toBeGreaterThanOrEqual(0)
    expect(r.number).toBeLessThanOrEqual(36)
    expect(r.color).toBe(colorOf(r.number))
  })
})

describe('payoutMultiplier', () => {
  it('even-money bets pay 2x on a win, 0 on a loss', () => {
    expect(payoutMultiplier('red', { number: 1, color: 'red' })).toBe(2)
    expect(payoutMultiplier('red', { number: 2, color: 'black' })).toBe(0)
    expect(payoutMultiplier('black', { number: 2, color: 'black' })).toBe(2)
    expect(payoutMultiplier('even', { number: 4, color: 'black' })).toBe(2)
    expect(payoutMultiplier('odd', { number: 4, color: 'black' })).toBe(0)
    expect(payoutMultiplier('low', { number: 5, color: 'red' })).toBe(2)
    expect(payoutMultiplier('high', { number: 5, color: 'red' })).toBe(0)
    expect(payoutMultiplier('high', { number: 36, color: 'red' })).toBe(2)
  })
  it('the green 0 loses ALL bet types (the house edge)', () => {
    const zero = { number: 0, color: 'green' as const }
    for (const bet of ['red', 'black', 'even', 'odd', 'low', 'high'] as const) {
      expect(payoutMultiplier(bet, zero)).toBe(0)
    }
  })
})

describe('clampBet', () => {
  it('clamps to [MIN_BET, MAX_BET], caps at balance, 0 when below MIN_BET', () => {
    expect(clampBet(50, 100_000)).toBe(MIN_BET)
    expect(clampBet(999_999, 100_000)).toBe(MAX_BET)
    expect(clampBet(5000, 3000)).toBe(3000)
    expect(clampBet(5000, 50)).toBe(0)
  })
})
