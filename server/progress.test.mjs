import { describe, expect, it } from 'vitest'
import { sanitizeProgress } from './progress.mjs'

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
    })
  })

  it('migrates old saves without crafting to an empty crafting state', () => {
    const clean = sanitizeProgress({
      credits: 100,
      cargo: { ORE: 0, ALLOY: 0 },
      upgrades: {},
      hangar: {},
    })

    expect(clean?.crafting).toEqual({ cores: 0, items: [] })
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
