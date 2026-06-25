import {
  CRAFTING_RARITY_LABELS,
  CRAFTING_RECIPES,
  type CraftedCosmeticItem,
  type CraftingCosmeticId,
  type CraftingRarity,
  type CraftingState,
} from '../sim/crafting'
import { COSMETIC_CATEGORY } from '../sim/cosmetics'

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

export function listableItemId(group: CraftedItemGroup, items: readonly CraftedCosmeticItem[]): string | null {
  const ids = new Set(group.ids)
  const candidates = items
    .filter((item) => ids.has(item.id) && item.tradable !== false)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return candidates[0]?.id ?? null
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
  private onListItem?: (itemId: string, price: number, currency: 'credits' | 'token') => void
  private canListItem: () => boolean
  private walletConnected: () => boolean
  private listModal: HTMLElement | null
  private pendingItemId: string | null = null
  private listCurrency: 'credits' | 'token' = 'credits'
  private onEquipItem?: (itemId: string) => void
  private onUnequipSlot?: (slot: 'trail' | 'hull' | 'aura') => void
  private equippedSlots: () => { trail: string | null; hull: string | null; aura: string | null }
  /** An item id to withhold from the view (e.g. one mid-forge), or null to show everything. */
  private hiddenItemId: string | null = null

  constructor(opts: {
    onClose?: () => void
    onListItem?: (itemId: string, price: number, currency: 'credits' | 'token') => void
    canListItem?: () => boolean
    walletConnected?: () => boolean
    onEquipItem?: (itemId: string) => void
    onUnequipSlot?: (slot: 'trail' | 'hull' | 'aura') => void
    equippedSlots?: () => { trail: string | null; hull: string | null; aura: string | null }
  } = {}) {
    this.onClose = opts.onClose
    this.onListItem = opts.onListItem
    this.canListItem = opts.canListItem ?? (() => false)
    this.walletConnected = opts.walletConnected ?? (() => false)
    this.onEquipItem = opts.onEquipItem
    this.onUnequipSlot = opts.onUnequipSlot
    this.equippedSlots = opts.equippedSlots ?? (() => ({ trail: null, hull: null, aura: null }))
    this.root = document.getElementById('inventory-panel') ?? document.createElement('div')
    this.titleEl = this.root.querySelector('#inventory-count') as HTMLElement
    this.gridEl = this.root.querySelector('#inventory-grid') as HTMLElement
    this.root.querySelector('#inventory-close')?.addEventListener('click', () => this.close())
    this.listModal = document.getElementById('list-modal')
    this.wireListModal()
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

  /** Withhold a single item id from the view (an item mid-forge); pass null to clear. */
  setHiddenItem(id: string | null): void {
    this.hiddenItemId = id
    if (this.isOpen) this.render()
  }

  render(): void {
    const state = this.state
    if (!state) return
    const items = this.hiddenItemId
      ? state.items.filter((it) => it.id !== this.hiddenItemId)
      : state.items
    const groups = groupCraftedItems(items)
    this.titleEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`
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

  private wireListModal(): void {
    const m = this.listModal
    if (!m) return
    const credits = m.querySelector('#list-cur-credits') as HTMLButtonElement | null
    const token = m.querySelector('#list-cur-token') as HTMLButtonElement | null
    credits?.addEventListener('click', () => this.setListCurrency('credits'))
    token?.addEventListener('click', () => this.setListCurrency('token'))
    m.querySelector('#list-cancel')?.addEventListener('click', () => this.closeListModal())
    m.querySelector('#list-confirm')?.addEventListener('click', () => this.confirmList())
  }

  private setListCurrency(currency: 'credits' | 'token'): void {
    if (currency === 'token' && !this.walletConnected()) return
    this.listCurrency = currency
    const m = this.listModal!
    m.querySelector('#list-cur-credits')!.classList.toggle('active', currency === 'credits')
    m.querySelector('#list-cur-token')!.classList.toggle('active', currency === 'token')
    ;(m.querySelector('#list-price-unit') as HTMLElement).textContent = currency === 'token' ? '$CITIZEN' : 'cr'
  }

  private openListModal(itemId: string, variant: string): void {
    const m = this.listModal
    if (!m) return
    this.pendingItemId = itemId
    ;(m.querySelector('#list-modal-title') as HTMLElement).textContent = variant
    const token = m.querySelector('#list-cur-token') as HTMLButtonElement
    token.disabled = !this.walletConnected()
    if (token.disabled) token.title = 'Connect a wallet to sell for $CITIZEN'
    this.setListCurrency('credits')
    const price = m.querySelector('#list-price') as HTMLInputElement
    price.value = '25000'
    m.hidden = false
    price.focus()
  }

  private closeListModal(): void {
    if (this.listModal) this.listModal.hidden = true
    this.pendingItemId = null
  }

  private confirmList(): void {
    const m = this.listModal
    if (!m || !this.pendingItemId) return
    const raw = (m.querySelector('#list-price') as HTMLInputElement).value
    const price = this.listCurrency === 'token' ? Math.max(0, Number(raw) || 0) : Math.max(0, Math.floor(Number(raw) || 0))
    if (price > 0) this.onListItem?.(this.pendingItemId, price, this.listCurrency)
    this.closeListModal()
  }

  private card(group: CraftedItemGroup): HTMLElement {
    const card = document.createElement('div')
    card.className = `inventory-card rarity-${group.rarity}`
    const itemId = this.state ? listableItemId(group, this.state.items) : null
    card.innerHTML = `
      <div class="inventory-thumb" aria-hidden="true"><i></i></div>
      <div class="inventory-meta">
        <div class="inventory-rarity">${CRAFTING_RARITY_LABELS[group.rarity]}</div>
        <div class="inventory-name">${group.variant}</div>
        <div class="inventory-recipe">${recipeName(group.recipeId)}</div>
      </div>
      <div class="inventory-count-badge">x${group.count}</div>
    `
    if (itemId && this.onListItem && this.canListItem()) {
      const actions = document.createElement('div')
      actions.className = 'inventory-actions'
      const button = document.createElement('button')
      button.className = 'inventory-list'
      button.textContent = 'List'
      button.addEventListener('click', () => this.openListModal(itemId, group.variant))
      actions.appendChild(button)
      card.appendChild(actions)
    }
    const slot = COSMETIC_CATEGORY[group.recipeId]
    const equippedId = this.equippedSlots()[slot]
    const groupEquipped = equippedId != null && group.ids.includes(equippedId)
    if (groupEquipped) card.classList.add('inventory-equipped')
    if (itemId && (this.onEquipItem || this.onUnequipSlot)) {
      let actions = card.querySelector('.inventory-actions') as HTMLElement | null
      if (!actions) { actions = document.createElement('div'); actions.className = 'inventory-actions'; card.appendChild(actions) }
      const equipBtn = document.createElement('button')
      equipBtn.className = 'inventory-equip'
      equipBtn.textContent = groupEquipped ? 'Unequip' : 'Equip'
      equipBtn.addEventListener('click', () => {
        if (groupEquipped) this.onUnequipSlot?.(slot)
        else this.onEquipItem?.(itemId)
      })
      actions.appendChild(equipBtn)
    }
    return card
  }
}
