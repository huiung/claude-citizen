import { describe, expect, it } from 'vitest'
import { holderNameplateClass, holderNameplateText } from './nameplate'

describe('holder nameplates', () => {
  it('keeps the callsign text unchanged for holder tiers', () => {
    expect(holderNameplateText('ORION', 0)).toBe('ORION')
    expect(holderNameplateText('ORION', 1)).toBe('ORION')
    expect(holderNameplateText('ORION', 3)).toBe('ORION')
  })

  it('keeps holder flair in the class name only', () => {
    expect(holderNameplateClass(0)).toBe('nameplate')
    expect(holderNameplateClass(2)).toBe('nameplate holder t2')
  })
})
