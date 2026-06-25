import { describe, expect, it } from 'vitest'
import { createEconomy } from './economy'
import {
  CRAFT_CORE_CREDIT_COST,
  CRAFTING_RECIPES,
  craftCosmetic,
  refineCraftCore,
  createCraftingState,
  normalizeCraftingState,
  rollCraftingRarity,
  equipCosmetic,
  unequipCosmetic,
  PITY_GUARANTEE,
  PITY_RAMP_START,
  nextPityCount,
} from './crafting'

describe('crafting economy', () => {
  it('defines credit-backed cosmetic recipes with core gates', () => {
    expect(CRAFTING_RECIPES.map((recipe) => recipe.id)).toEqual([
      'aurum-trail-kit',
      'nebula-hull-kit',
      'void-runner-kit',
    ])
    expect(CRAFT_CORE_CREDIT_COST).toBe(50_000)
    expect(CRAFTING_RECIPES[0].creditCost).toBe(25_000)
    expect(CRAFTING_RECIPES[1].creditCost).toBe(75_000)
    expect(CRAFTING_RECIPES[1].coreCost).toBe(1)
    expect(CRAFTING_RECIPES[2].creditCost).toBe(200_000)
    expect(CRAFTING_RECIPES[2].coreCost).toBe(3)
  })

  it('refines craft cores from credits without touching cargo resources', () => {
    const econ = createEconomy()
    econ.credits = 60_000
    econ.cargo.ORE = 12
    econ.cargo.ALLOY = 3
    const crafting = createCraftingState()

    expect(refineCraftCore(econ, crafting)).toEqual({ ok: true })
    expect(econ.credits).toBe(10_000)
    expect(econ.cargo).toEqual({ ORE: 12, ALLOY: 3 })
    expect(crafting.cores).toBe(1)
  })

  it('crafts inventory items by consuming credits and craft cores', () => {
    const econ = createEconomy()
    econ.credits = 100_000
    econ.cargo.ORE = 7
    econ.cargo.ALLOY = 2
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
    expect(econ.credits).toBe(75_000)
    expect(econ.cargo).toEqual({ ORE: 7, ALLOY: 2 })
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
    expect(econ.credits).toBe(0)
    expect(econ.cargo).toEqual({ ORE: 7, ALLOY: 2 })
    expect(crafting.cores).toBe(0)
    expect(crafting.items.map((item) => item.recipeId)).toEqual(['aurum-trail-kit', 'nebula-hull-kit'])
  })

  it('allows duplicate crafts of the same recipe as separate inventory items', () => {
    const econ = createEconomy()
    econ.credits = 60_000
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

  it('rejects unknown recipes and missing credits without mutating state', () => {
    const econ = createEconomy()
    econ.credits = 10
    econ.cargo.ORE = 10
    econ.cargo.ALLOY = 99
    const crafting = createCraftingState()

    expect(craftCosmetic(econ, crafting, 'missing' as never)).toEqual({ ok: false, reason: 'unknown-recipe' })
    expect(craftCosmetic(econ, crafting, 'aurum-trail-kit')).toEqual({ ok: false, reason: 'missing-credits' })
    expect(econ.credits).toBe(10)
    expect(econ.cargo).toEqual({ ORE: 10, ALLOY: 99 })
    expect(crafting.items).toEqual([])
  })

  it('rejects core-gated recipes when craft cores are missing', () => {
    const econ = createEconomy()
    econ.credits = 999_999
    const crafting = createCraftingState()

    expect(craftCosmetic(econ, crafting, 'void-runner-kit')).toEqual({ ok: false, reason: 'missing-cores' })
    expect(econ.credits).toBe(999_999)
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
      equipped: { trail: null, hull: null, aura: null },
    })
  })
})

describe('equipped loadout', () => {
  const item = { id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'legendary', variant: 'Radiant Aurum Trail', createdAt: 1, tradable: true } as const

  it('new state has empty slots', () => {
    expect(createCraftingState().equipped).toEqual({ trail: null, hull: null, aura: null })
  })

  it('normalizes old state without equipped to empty slots', () => {
    expect(normalizeCraftingState({ cores: 0, items: [] }).equipped).toEqual({ trail: null, hull: null, aura: null })
  })

  it('equips an item into its recipe category and unequips', () => {
    const state = { cores: 0, items: [{ ...item }], equipped: { trail: null, hull: null, aura: null } }
    equipCosmetic(state, 'i1')
    expect(state.equipped.trail).toBe('i1')
    unequipCosmetic(state, 'trail')
    expect(state.equipped.trail).toBe(null)
  })

  it('ignores equipping an unknown item id', () => {
    const state = createCraftingState()
    equipCosmetic(state, 'nope')
    expect(state.equipped).toEqual({ trail: null, hull: null, aura: null })
  })

  it('drops an equipped id that is not in items when normalizing', () => {
    const out = normalizeCraftingState({ cores: 0, items: [], equipped: { trail: 'ghost', hull: null, aura: null } })
    expect(out.equipped.trail).toBe(null)
  })
})

describe('rollCraftingRarity pity', () => {
  it('uses base bands when pityCount is 0 (unchanged)', () => {
    expect(rollCraftingRarity(0.5, 0)).toBe('common')
    expect(rollCraftingRarity(0.8, 0)).toBe('rare')
    expect(rollCraftingRarity(0.95, 0)).toBe('epic')
    expect(rollCraftingRarity(0.999, 0)).toBe('legendary')
  })

  it('defaults pityCount to 0 so existing single-arg callers are unaffected', () => {
    expect(rollCraftingRarity(0.5)).toBe('common')
  })

  it('guarantees epic-or-better at the guarantee threshold for ANY roll', () => {
    for (const v of [0, 0.3, 0.5, 0.84, 0.85, 0.999_999]) {
      const r = rollCraftingRarity(v, PITY_GUARANTEE)
      expect(r === 'epic' || r === 'legendary').toBe(true)
    }
    // legendary still reachable within the guarantee band
    expect(rollCraftingRarity(0.5, PITY_GUARANTEE)).toBe('epic')
    expect(rollCraftingRarity(0.95, PITY_GUARANTEE)).toBe('legendary')
  })

  it('raises epic+ probability monotonically across the ramp', () => {
    const epicPlusAt = (count: number): number => {
      let hits = 0
      const N = 1000
      for (let i = 0; i < N; i++) {
        const r = rollCraftingRarity(i / N, count)
        if (r === 'epic' || r === 'legendary') hits++
      }
      return hits / N
    }
    expect(epicPlusAt(PITY_RAMP_START)).toBeCloseTo(0.08, 1) // base ~8%
    expect(epicPlusAt(17)).toBeGreaterThan(epicPlusAt(PITY_RAMP_START))
    expect(epicPlusAt(PITY_GUARANTEE)).toBe(1)
  })

  it('nextPityCount resets on epic/legendary and increments otherwise', () => {
    expect(nextPityCount('common', 5)).toBe(6)
    expect(nextPityCount('rare', 0)).toBe(1)
    expect(nextPityCount('epic', 9)).toBe(0)
    expect(nextPityCount('legendary', 19)).toBe(0)
    expect(nextPityCount('common', -3)).toBe(1) // clamps bad input
  })
})
