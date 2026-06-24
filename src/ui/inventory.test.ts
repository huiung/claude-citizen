import { describe, expect, it } from 'vitest'
import { groupCraftedItems } from './inventory'
import type { CraftedCosmeticItem } from '../sim/crafting'

const item = (id: string, recipeId: CraftedCosmeticItem['recipeId'], rarity: CraftedCosmeticItem['rarity'], variant: string): CraftedCosmeticItem => ({
  id,
  recipeId,
  rarity,
  variant,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
  tradable: true,
})

describe('crafted inventory UI grouping', () => {
  it('stacks identical crafted cosmetics without losing item ids', () => {
    const groups = groupCraftedItems([
      item('item-1', 'aurum-trail-kit', 'rare', 'Blue Aurum Trail'),
      item('item-2', 'aurum-trail-kit', 'rare', 'Blue Aurum Trail'),
      item('item-3', 'aurum-trail-kit', 'epic', 'Solar Aurum Trail'),
    ])

    expect(groups).toEqual([
      {
        key: 'aurum-trail-kit|epic|Solar Aurum Trail',
        recipeId: 'aurum-trail-kit',
        rarity: 'epic',
        variant: 'Solar Aurum Trail',
        count: 1,
        ids: ['item-3'],
      },
      {
        key: 'aurum-trail-kit|rare|Blue Aurum Trail',
        recipeId: 'aurum-trail-kit',
        rarity: 'rare',
        variant: 'Blue Aurum Trail',
        count: 2,
        ids: ['item-1', 'item-2'],
      },
    ])
  })
})
