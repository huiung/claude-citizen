import {
  CRAFTING_RARITY_LABELS,
  CRAFTING_RECIPES,
  type CraftedCosmeticItem,
  type CraftingCosmeticId,
  type CraftingRarity,
  type CraftingState,
} from '../sim/crafting'

export interface CraftedItemGroup {
  key: string
  recipeId: CraftingCosmeticId
  rarity: CraftingRarity
  variant: string
  count: number
  ids: string[]
}

const RARITY_RANK: Record<CraftingRarity, number> = {
  legendary: 4,
  epic: 3,
  rare: 2,
  common: 1,
}

export function groupCraftedItems(items: readonly CraftedCosmeticItem[]): CraftedItemGroup[] {
  const groups = new Map<string, CraftedItemGroup>()
  for (const item of items) {
    const key = `${item.recipeId}|${item.rarity}|${item.variant}`
    const group = groups.get(key)
    if (group) {
      group.count += 1
      group.ids.push(item.id)
    } else {
      groups.set(key, {
        key,
        recipeId: item.recipeId,
        rarity: item.rarity,
        variant: item.variant,
        count: 1,
        ids: [item.id],
      })
    }
  }
  return [...groups.values()].sort((a, b) => {
    const rarity = RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity]
    if (rarity !== 0) return rarity
    return a.variant.localeCompare(b.variant)
  })
}

function recipeName(recipeId: CraftingCosmeticId): string {
  return CRAFTING_RECIPES.find((recipe) => recipe.id === recipeId)?.name ?? recipeId
}

export class InventoryPanel {
  readonly root: HTMLElement
  private titleEl!: HTMLElement
  private gridEl!: HTMLElement
  private state: CraftingState | null = null
  private onClose?: () => void

  constructor(opts: { onClose?: () => void } = {}) {
    this.onClose = opts.onClose
    this.root = document.getElementById('inventory-panel') ?? document.createElement('div')
    this.titleEl = this.root.querySelector('#inventory-count') as HTMLElement
    this.gridEl = this.root.querySelector('#inventory-grid') as HTMLElement
    this.root.querySelector('#inventory-close')?.addEventListener('click', () => this.close())
  }

  open(state: CraftingState): void {
    this.state = state
    this.render()
    this.root.hidden = false
  }

  close(): void {
    if (!this.isOpen) return
    this.root.hidden = true
    this.onClose?.()
  }

  toggle(state: CraftingState): boolean {
    if (this.isOpen) {
      this.close()
      return false
    }
    this.open(state)
    return true
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  render(): void {
    const state = this.state
    if (!state) return
    const groups = groupCraftedItems(state.items)
    this.titleEl.textContent = `${state.items.length} item${state.items.length === 1 ? '' : 's'}`
    this.gridEl.innerHTML = ''
    if (groups.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'inventory-empty'
      empty.textContent = 'No crafted items yet. Earn credits, refine Cores, then craft kits at a station.'
      this.gridEl.appendChild(empty)
      return
    }
    for (const group of groups) this.gridEl.appendChild(this.card(group))
  }

  private card(group: CraftedItemGroup): HTMLElement {
    const card = document.createElement('div')
    card.className = `inventory-card rarity-${group.rarity}`
    card.innerHTML = `
      <div class="inventory-thumb" aria-hidden="true"><i></i></div>
      <div class="inventory-meta">
        <div class="inventory-rarity">${CRAFTING_RARITY_LABELS[group.rarity]}</div>
        <div class="inventory-name">${group.variant}</div>
        <div class="inventory-recipe">${recipeName(group.recipeId)}</div>
      </div>
      <div class="inventory-count-badge">x${group.count}</div>
    `
    return card
  }
}
