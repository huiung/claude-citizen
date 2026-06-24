import type { PlayerEconomy } from './economy'

export type CraftingCosmeticId = 'aurum-trail-kit' | 'nebula-hull-kit' | 'void-runner-kit'
export type CraftingRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface CraftedCosmeticItem {
  id: string
  recipeId: CraftingCosmeticId
  rarity: CraftingRarity
  variant: string
  createdAt: number
  tradable: boolean
}

export interface CraftingRecipe {
  id: CraftingCosmeticId
  name: string
  description: string
  creditCost: number
  coreCost?: number
}

export interface CraftingState {
  cores: number
  items: CraftedCosmeticItem[]
}

export interface CraftingRollOptions {
  random?: () => number
  now?: () => number
}

export const CRAFT_CORE_CREDIT_COST = 50_000

export const CRAFTING_RECIPES: readonly CraftingRecipe[] = [
  {
    id: 'aurum-trail-kit',
    name: 'Aurum Trail Kit',
    description: 'Craft a cosmetic engine trail kit with a random rarity roll.',
    creditCost: 25_000,
  },
  {
    id: 'nebula-hull-kit',
    name: 'Nebula Hull Kit',
    description: 'Craft a hull finish kit. Requires a refined Craft Core.',
    creditCost: 75_000,
    coreCost: 1,
  },
  {
    id: 'void-runner-kit',
    name: 'Void Runner Kit',
    description: 'Craft a high-end deep-space cosmetic kit for future trading.',
    creditCost: 200_000,
    coreCost: 3,
  },
]

export const CRAFTING_RARITY_LABELS: Readonly<Record<CraftingRarity, string>> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
}

export const CRAFTING_VARIANTS: Readonly<Record<CraftingCosmeticId, Record<CraftingRarity, string>>> = {
  'aurum-trail-kit': {
    common: 'Standard Aurum Trail',
    rare: 'Blue Aurum Trail',
    epic: 'Solar Aurum Trail',
    legendary: 'Radiant Aurum Trail',
  },
  'nebula-hull-kit': {
    common: 'Pale Nebula Hull',
    rare: 'Azure Nebula Hull',
    epic: 'Violet Nebula Hull',
    legendary: 'Supernova Nebula Hull',
  },
  'void-runner-kit': {
    common: 'Void Runner Matte',
    rare: 'Void Runner Cyan',
    epic: 'Void Runner Eclipse',
    legendary: 'Void Runner Singularity',
  },
}

const RECIPE_BY_ID = new Map(CRAFTING_RECIPES.map((recipe) => [recipe.id, recipe]))
const RARITIES = new Set<CraftingRarity>(['common', 'rare', 'epic', 'legendary'])
const STORAGE_KEY = 'scc.crafting.v1'
const MAX_ITEMS = 200

export function createCraftingState(): CraftingState {
  return { cores: 0, items: [] }
}

export function rollCraftingRarity(value = Math.random()): CraftingRarity {
  const roll = Math.max(0, Math.min(0.999_999, Number(value) || 0))
  if (roll < 0.7) return 'common'
  if (roll < 0.92) return 'rare'
  if (roll < 0.99) return 'epic'
  return 'legendary'
}

export function variantForCraft(recipeId: CraftingCosmeticId, rarity: CraftingRarity): string {
  return CRAFTING_VARIANTS[recipeId][rarity]
}

function sanitizeItem(value: unknown): CraftedCosmeticItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CraftedCosmeticItem>
  if (typeof raw.recipeId !== 'string' || !RECIPE_BY_ID.has(raw.recipeId as CraftingCosmeticId)) return null
  if (typeof raw.rarity !== 'string' || !RARITIES.has(raw.rarity as CraftingRarity)) return null
  const recipeId = raw.recipeId as CraftingCosmeticId
  const rarity = raw.rarity as CraftingRarity
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 96) : null
  if (!id) return null
  const variant = typeof raw.variant === 'string' && raw.variant.trim()
    ? raw.variant.slice(0, 64)
    : variantForCraft(recipeId, rarity)
  const createdAt = Math.max(0, Math.floor(Number(raw.createdAt) || 0))
  return { id, recipeId, rarity, variant, createdAt, tradable: raw.tradable !== false }
}

function migrateLegacyCosmetics(value: unknown, offset: number): CraftedCosmeticItem[] {
  const raw = Array.isArray(value) ? value : []
  const items: CraftedCosmeticItem[] = []
  for (const id of raw) {
    if (typeof id !== 'string' || !RECIPE_BY_ID.has(id as CraftingCosmeticId)) continue
    const recipeId = id as CraftingCosmeticId
    if (items.some((item) => item.recipeId === recipeId)) continue
    items.push({
      id: `legacy-${recipeId}-${offset + items.length}`,
      recipeId,
      rarity: 'common',
      variant: variantForCraft(recipeId, 'common'),
      createdAt: 0,
      tradable: true,
    })
  }
  return items
}

export function normalizeCraftingState(value: unknown): CraftingState {
  if (!value || typeof value !== 'object') return createCraftingState()
  const rawCores = Math.floor(Number((value as { cores?: unknown }).cores) || 0)
  const cores = Math.max(0, Math.min(999_999, rawCores))
  const rawItems = Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items
    : []
  const items: CraftedCosmeticItem[] = []
  const seen = new Set<string>()
  for (const raw of rawItems) {
    const item = sanitizeItem(raw)
    if (!item || seen.has(item.id)) continue
    items.push(item)
    seen.add(item.id)
    if (items.length >= MAX_ITEMS) break
  }
  if (items.length < MAX_ITEMS) {
    for (const item of migrateLegacyCosmetics((value as { cosmetics?: unknown }).cosmetics, items.length)) {
      if (seen.has(item.id)) continue
      items.push(item)
      seen.add(item.id)
      if (items.length >= MAX_ITEMS) break
    }
  }
  return { cores, items }
}

export function hasCraftedCosmetic(state: CraftingState, id: CraftingCosmeticId): boolean {
  return state.items.some((item) => item.recipeId === id)
}

export type CraftResult =
  | { ok: true; item: CraftedCosmeticItem }
  | { ok: false; reason: 'unknown-recipe' | 'missing-credits' | 'missing-cores' }

export type RefineCoreResult =
  | { ok: true }
  | { ok: false; reason: 'missing-credits' }

export function refineCraftCore(econ: PlayerEconomy, state: CraftingState): RefineCoreResult {
  if (econ.credits < CRAFT_CORE_CREDIT_COST) return { ok: false, reason: 'missing-credits' }
  econ.credits -= CRAFT_CORE_CREDIT_COST
  state.cores += 1
  return { ok: true }
}

export function craftCosmetic(
  econ: PlayerEconomy,
  state: CraftingState,
  id: CraftingCosmeticId,
  opts: CraftingRollOptions = {},
): CraftResult {
  const recipe = RECIPE_BY_ID.get(id)
  if (!recipe) return { ok: false, reason: 'unknown-recipe' }
  const coreCost = Math.max(0, Math.floor(recipe.coreCost ?? 0))
  if (state.cores < coreCost) return { ok: false, reason: 'missing-cores' }
  if (econ.credits < recipe.creditCost) return { ok: false, reason: 'missing-credits' }
  econ.credits -= recipe.creditCost
  state.cores -= coreCost

  const randomValue = Math.max(0, Math.min(0.999_999, Number((opts.random ?? Math.random)()) || 0))
  const rarity = rollCraftingRarity(randomValue)
  const createdAt = Math.max(0, Math.floor((opts.now ?? Date.now)()))
  const item: CraftedCosmeticItem = {
    id: `${id}-${createdAt}-${Math.floor(randomValue * 1_000_000).toString().padStart(6, '0')}`,
    recipeId: id,
    rarity,
    variant: variantForCraft(id, rarity),
    createdAt,
    tradable: true,
  }
  state.items.push(item)
  return { ok: true, item }
}

export function loadCraftingState(storage: Storage = localStorage): CraftingState {
  try {
    return normalizeCraftingState(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return createCraftingState()
  }
}

export function saveCraftingState(state: CraftingState, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeCraftingState(state)))
  } catch {
    /* storage unavailable - crafting inventory remains session-only until relay sync */
  }
}
