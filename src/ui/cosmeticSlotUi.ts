import { COSMETIC_CATEGORY, type CosmeticCategory } from '../sim/cosmetics'
import type { CraftingCosmeticId } from '../sim/crafting'

interface CosmeticSlotMeta {
  label: string
  description: string
  className: string
}

const COSMETIC_SLOT_META: Readonly<Record<CosmeticCategory, CosmeticSlotMeta>> = {
  trail: {
    label: 'TRAIL',
    description: 'Engine trail slot',
    className: 'slot-trail',
  },
  hull: {
    label: 'HULL',
    description: 'Hull finish slot',
    className: 'slot-hull',
  },
  aura: {
    label: 'AURA',
    description: 'Field aura slot',
    className: 'slot-aura',
  },
}

export interface CosmeticSlotUi extends CosmeticSlotMeta {
  slot: CosmeticCategory
}

export function cosmeticSlotUi(recipeId: CraftingCosmeticId): CosmeticSlotUi {
  const slot = COSMETIC_CATEGORY[recipeId]
  return { slot, ...COSMETIC_SLOT_META[slot] }
}
