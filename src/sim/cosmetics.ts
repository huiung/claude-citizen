// Pure cosmetic-effect math + loadout codec. No three.js, no IO — safe to unit test and to share
// between the local ship, remote peers, and the wire protocol. Effects are visual only (no stats).
import {
  CRAFTING_VARIANTS,
  type CraftedCosmeticItem,
  type CraftingCosmeticId,
  type CraftingRarity,
  type CraftingState,
} from './crafting'

export type CosmeticCategory = 'trail' | 'hull' | 'aura'

export const COSMETIC_CATEGORY: Readonly<Record<CraftingCosmeticId, CosmeticCategory>> = {
  'aurum-trail-kit': 'trail',
  'nebula-hull-kit': 'hull',
  'comet-wake-kit': 'trail',
  'void-runner-kit': 'aura',
}

export const COSMETIC_SLOTS: readonly CosmeticCategory[] = ['trail', 'hull', 'aura']

export interface CosmeticStyle {
  recipeId: CraftingCosmeticId
  category: CosmeticCategory
  color: number
  intensity: number
  legendary: boolean
}

const RARITY_INTENSITY: Readonly<Record<CraftingRarity, number>> = {
  common: 0.35,
  rare: 0.55,
  epic: 0.78,
  legendary: 1,
}

// Color encodes RARITY (loot-tier palette) for an at-a-glance tier read. The cosmetic's category
// is already conveyed by the effect type (trail/hull/aura), so the color channel signals rarity.
const RARITY_COLOR: Readonly<Record<CraftingRarity, number>> = {
  common: 0xb8c4d0, // cool grey-white
  rare: 0x4ea3ff, // blue
  epic: 0xb65cff, // purple
  legendary: 0xffb838, // gold (also hue-cycles at render time)
}

const KNOWN_RARITIES = new Set<CraftingRarity>(['common', 'rare', 'epic', 'legendary'])
function isRecipe(id: string): id is CraftingCosmeticId {
  return id === 'aurum-trail-kit' || id === 'nebula-hull-kit' || id === 'comet-wake-kit' || id === 'void-runner-kit'
}

export function cosmeticStyle(recipeId: CraftingCosmeticId, rarity: CraftingRarity): CosmeticStyle {
  return {
    recipeId,
    category: COSMETIC_CATEGORY[recipeId],
    color: RARITY_COLOR[rarity] ?? RARITY_COLOR.common,
    intensity: RARITY_INTENSITY[rarity] ?? RARITY_INTENSITY.common,
    legendary: rarity === 'legendary',
  }
}

/** For each slot, find the equipped item by id in the inventory; missing (sold/listed) → null. */
export function resolveEquipped(state: CraftingState): Record<CosmeticCategory, { recipeId: CraftingCosmeticId; rarity: CraftingRarity } | null> {
  const byId = new Map<string, CraftedCosmeticItem>(state.items.map((i) => [i.id, i]))
  const out: Record<CosmeticCategory, { recipeId: CraftingCosmeticId; rarity: CraftingRarity } | null> = { trail: null, hull: null, aura: null }
  for (const slot of COSMETIC_SLOTS) {
    const id = (state as { equipped?: Record<string, string | null> }).equipped?.[slot]
    const item = id ? byId.get(id) : undefined
    if (item) out[slot] = { recipeId: item.recipeId, rarity: item.rarity }
  }
  return out
}

/** Resolved equipped → styles (skips empty slots). For the local ship. */
export function equippedStyles(state: CraftingState): CosmeticStyle[] {
  const resolved = resolveEquipped(state)
  const styles: CosmeticStyle[] = []
  for (const slot of COSMETIC_SLOTS) {
    const r = resolved[slot]
    if (r) styles.push(cosmeticStyle(r.recipeId, r.rarity))
  }
  return styles
}

/** Resolved equipped → compact wire string (slot order trail,hull,aura). */
export function encodeEquipped(state: CraftingState): string {
  const resolved = resolveEquipped(state)
  return COSMETIC_SLOTS.map((slot) => {
    const r = resolved[slot]
    return r ? `${r.recipeId}:${r.rarity}` : ''
  }).join(',')
}

/** Wire string → styles. Never throws; skips unknown recipe/rarity tokens. For peers. */
export function decodeCosmetics(str: string): CosmeticStyle[] {
  if (typeof str !== 'string' || !str) return []
  const styles: CosmeticStyle[] = []
  for (const field of str.split(',')) {
    const [recipeId, rarity] = field.split(':')
    if (isRecipe(recipeId) && KNOWN_RARITIES.has(rarity as CraftingRarity)) {
      styles.push(cosmeticStyle(recipeId, rarity as CraftingRarity))
    }
  }
  return styles
}
// CRAFTING_VARIANTS imported for future per-variant theming; referenced to satisfy noUnusedLocals.
void CRAFTING_VARIANTS
