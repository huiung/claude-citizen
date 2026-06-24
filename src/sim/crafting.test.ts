import { describe, expect, it } from 'vitest'
import { createEconomy } from './economy'
import {
  CRAFTING_RECIPES,
  craftCosmetic,
  refineCraftCore,
  createCraftingState,
  normalizeCraftingState,
  rollCraftingRarity,
} from './crafting'

describe('crafting economy', () => {
  it('defines ore-backed cosmetic recipes for the first player-economy loop', () => {
    expect(CRAFTING_RECIPES.map((recipe) => recipe.id)).toEqual([
      'aurum-trail-kit',
      'nebula-hull-kit',
      'void-runner-kit',
    ])
    expect(CRAFTING_RECIPES[0].cost.ORE).toBe(50_000)
    expect(CRAFTING_RECIPES[1].coreCost).toBe(1)
    expect(CRAFTING_RECIPES[2].coreCost).toBe(3)
  })

  it('refines craft cores from a large ore and alloy bundle', () => {
    const econ = createEconomy()
    econ.cargo.ORE = 120_000
    econ.cargo.ALLOY = 1_200
    const crafting = createCraftingState()

    expect(refineCraftCore(econ, crafting)).toEqual({ ok: true })
    expect(econ.cargo).toEqual({ ORE: 20_000, ALLOY: 200 })
    expect(crafting.cores).toBe(1)
  })

  it('crafts inventory items by consuming cargo resources and craft cores', () => {
    const econ = createEconomy()
    econ.cargo.ORE = 250_000
    econ.cargo.ALLOY = 2_500
    const crafting = createCraftingState()
    crafting.cores = 1

    expect(craftCosmetic(econ, crafting, 'aurum-trail-kit', { random: () => 0.94, now: () => 1000 })).toEqual({
      ok: true,
      item: {
        id: 'aurum-trail-kit-1000-940000',
        recipeId: 'aurum-trail-kit',
        rarity: 'epic',
        variant: 'Solar Aurum Trail',
        createdAt: 1000,
        tradable: true,
      },
    })
    expect(econ.cargo).toEqual({ ORE: 200_000, ALLOY: 2_000 })
    expect(crafting.items).toHaveLength(1)

    expect(craftCosmetic(econ, crafting, 'nebula-hull-kit', { random: () => 0.995, now: () => 2000 })).toEqual({
      ok: true,
      item: {
        id: 'nebula-hull-kit-2000-995000',
        recipeId: 'nebula-hull-kit',
        rarity: 'legendary',
        variant: 'Supernova Nebula Hull',
        createdAt: 2000,
        tradable: true,
      },
    })
    expect(econ.cargo).toEqual({ ORE: 50_000, ALLOY: 500 })
    expect(crafting.cores).toBe(0)
    expect(crafting.items.map((item) => item.recipeId)).toEqual(['aurum-trail-kit', 'nebula-hull-kit'])
  })

  it('allows duplicate crafts of the same recipe as separate inventory items', () => {
    const econ = createEconomy()
    econ.cargo.ORE = 100_000
    econ.cargo.ALLOY = 1_000
    const crafting = createCraftingState()

    expect(craftCosmetic(econ, crafting, 'aurum-trail-kit', { random: () => 0.1, now: () => 10 })).toMatchObject({
      ok: true,
      item: { rarity: 'common', variant: 'Standard Aurum Trail' },
    })
    expect(craftCosmetic(econ, crafting, 'aurum-trail-kit', { random: () => 0.8, now: () => 20 })).toMatchObject({
      ok: true,
      item: { rarity: 'rare', variant: 'Blue Aurum Trail' },
    })
    expect(crafting.items.map((item) => item.id)).toEqual([
      'aurum-trail-kit-10-100000',
      'aurum-trail-kit-20-800000',
    ])
  })

  it('rolls rarity from stable crafting odds', () => {
    expect(rollCraftingRarity(0)).toBe('common')
    expect(rollCraftingRarity(0.699)).toBe('common')
    expect(rollCraftingRarity(0.7)).toBe('rare')
    expect(rollCraftingRarity(0.919)).toBe('rare')
    expect(rollCraftingRarity(0.92)).toBe('epic')
    expect(rollCraftingRarity(0.989)).toBe('epic')
    expect(rollCraftingRarity(0.99)).toBe('legendary')
  })

  it('rejects unknown recipes and missing materials without mutating cargo', () => {
    const econ = createEconomy()
    econ.cargo.ORE = 10
    econ.cargo.ALLOY = 99
    const crafting = createCraftingState()

    expect(craftCosmetic(econ, crafting, 'missing' as never)).toEqual({ ok: false, reason: 'unknown-recipe' })
    expect(craftCosmetic(econ, crafting, 'aurum-trail-kit')).toEqual({ ok: false, reason: 'missing-materials' })
    expect(econ.cargo).toEqual({ ORE: 10, ALLOY: 99 })
    expect(crafting.items).toEqual([])
  })

  it('rejects core-gated recipes when craft cores are missing', () => {
    const econ = createEconomy()
    econ.cargo.ORE = 999_999
    econ.cargo.ALLOY = 99_999
    const crafting = createCraftingState()

    expect(craftCosmetic(econ, crafting, 'void-runner-kit')).toEqual({ ok: false, reason: 'missing-cores' })
    expect(econ.cargo).toEqual({ ORE: 999_999, ALLOY: 99_999 })
    expect(crafting.cores).toBe(0)
  })

  it('normalizes saved crafted item inventory and migrates legacy cosmetic ids', () => {
    expect(normalizeCraftingState({
      cores: 2.7,
      items: [
        {
          id: 'custom-id',
          recipeId: 'void-runner-kit',
          rarity: 'legendary',
          variant: 'Void Runner Singularity',
          createdAt: 1234.8,
          tradable: false,
          ignored: 'x',
        },
        { id: '', recipeId: 'bad', rarity: 'rare', variant: 'Bad', createdAt: -1 },
      ],
      cosmetics: ['nebula-hull-kit', 'bad'],
    })).toEqual({
      cores: 2,
      items: [
        {
          id: 'custom-id',
          recipeId: 'void-runner-kit',
          rarity: 'legendary',
          variant: 'Void Runner Singularity',
          createdAt: 1234,
          tradable: false,
        },
        {
          id: 'legacy-nebula-hull-kit-1',
          recipeId: 'nebula-hull-kit',
          rarity: 'common',
          variant: 'Pale Nebula Hull',
          createdAt: 0,
          tradable: true,
        },
      ],
    })
  })
})
