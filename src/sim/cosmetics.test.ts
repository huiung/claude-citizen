import { describe, expect, it } from 'vitest'
import { COSMETIC_CATEGORY, cosmeticStyle, decodeCosmetics } from './cosmetics'

describe('cosmeticStyle', () => {
  it('maps each recipe to its category', () => {
    expect(COSMETIC_CATEGORY['aurum-trail-kit']).toBe('trail')
    expect(COSMETIC_CATEGORY['nebula-hull-kit']).toBe('hull')
    expect(COSMETIC_CATEGORY['void-runner-kit']).toBe('aura')
  })

  it('scales intensity by rarity and flags legendary', () => {
    const c = cosmeticStyle('aurum-trail-kit', 'common')
    const l = cosmeticStyle('aurum-trail-kit', 'legendary')
    expect(c.category).toBe('trail')
    expect(l.intensity).toBeGreaterThan(c.intensity)
    expect(l.legendary).toBe(true)
    expect(c.legendary).toBe(false)
    expect(typeof l.color).toBe('number')
  })
})

describe('decodeCosmetics', () => {
  it('decodes a wire string into styles, slot order trail,hull,aura', () => {
    const styles = decodeCosmetics('aurum-trail-kit:legendary,,void-runner-kit:rare')
    expect(styles.map((s) => s.category)).toEqual(['trail', 'aura'])
    expect(styles[0].legendary).toBe(true)
  })

  it('never throws on garbage and skips unknown tokens', () => {
    expect(decodeCosmetics('')).toEqual([])
    expect(decodeCosmetics('bogus:nope,nebula-hull-kit:epic,junk')).toEqual([
      expect.objectContaining({ category: 'hull' }),
    ])
    expect(decodeCosmetics(null as unknown as string)).toEqual([])
  })
})
