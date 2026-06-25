import { describe, expect, it } from 'vitest'
import { sanitizeProgress, sanitizeCrafting } from './progress.mjs'

describe('progress sanitization', () => {
  it('keeps known crafted inventory items and drops unknown entries', () => {
    const clean = sanitizeProgress({
      credits: 123,
      earned: 456,
      cargo: { ORE: 7, ALLOY: 8 },
      upgrades: { cargo: 1, speed: 2, boost: 3, mining: 4 },
      hangar: { selected: 'fighter', owned: ['hauler', 'fighter'] },
      crafting: {
        cores: 2.9,
        items: [
          {
            id: 'item-1',
            recipeId: 'aurum-trail-kit',
            rarity: 'rare',
            variant: 'Blue Aurum Trail',
            createdAt: 123.9,
            tradable: false,
          },
          { id: 'bad', recipeId: 'bad-kit', rarity: 'legendary', variant: 'Bad', createdAt: 1 },
          { id: 'bad-rarity', recipeId: 'void-runner-kit', rarity: 'mythic', variant: 'Bad', createdAt: 1 },
        ],
      },
    })

    expect(clean?.crafting).toEqual({
      cores: 2,
      items: [
        {
          id: 'item-1',
          recipeId: 'aurum-trail-kit',
          rarity: 'rare',
          variant: 'Blue Aurum Trail',
          createdAt: 123,
          tradable: false,
        },
      ],
      equipped: { trail: null, hull: null, aura: null },
      pityCount: 0,
    })
  })

  it('migrates old saves without crafting to an empty crafting state', () => {
    const clean = sanitizeProgress({
      credits: 100,
      cargo: { ORE: 0, ALLOY: 0 },
      upgrades: {},
      hangar: {},
    })

    expect(clean?.crafting).toEqual({ cores: 0, items: [], equipped: { trail: null, hull: null, aura: null }, pityCount: 0 })
  })

  it('migrates legacy crafted cosmetic ids into common inventory items', () => {
    const clean = sanitizeProgress({
      credits: 100,
      cargo: { ORE: 0, ALLOY: 0 },
      upgrades: {},
      hangar: {},
      crafting: {
        cosmetics: ['aurum-trail-kit', 'bad-kit', 'void-runner-kit'],
      },
    })

    expect(clean?.crafting.items.map((item) => [item.id, item.recipeId, item.rarity, item.tradable])).toEqual([
      ['legacy-aurum-trail-kit-0', 'aurum-trail-kit', 'common', true],
      ['legacy-void-runner-kit-1', 'void-runner-kit', 'common', true],
    ])
  })
})

describe('sanitizeCrafting equipped', () => {
  const item = { id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'legendary', variant: 'Radiant Aurum Trail', createdAt: 1, tradable: true }

  it('defaults equipped to empty slots for old state', () => {
    expect(sanitizeCrafting({ cores: 0, items: [] }).equipped).toEqual({ trail: null, hull: null, aura: null })
  })

  it('keeps an equipped slot only when the item id is present', () => {
    const out = sanitizeCrafting({ cores: 0, items: [item], equipped: { trail: 'i1', hull: 'ghost', aura: null } })
    expect(out.equipped).toEqual({ trail: 'i1', hull: null, aura: null })
  })

  it('passes through and clamps pityCount', () => {
    expect(sanitizeCrafting({ cores: 0, items: [] }).pityCount).toBe(0)        // missing → 0
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 12 }).pityCount).toBe(12)
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: -4 }).pityCount).toBe(0)   // clamp low
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 999 }).pityCount).toBe(20) // clamp to guarantee
    expect(sanitizeCrafting({ cores: 0, items: [], pityCount: 7.9 }).pityCount).toBe(7)  // floored
  })
})
