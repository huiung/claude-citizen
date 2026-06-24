// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { groupCraftedItems, listableItemId, InventoryPanel } from './inventory'
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

  it('selects the oldest tradable item from a grouped stack for listing', () => {
    const items = [
      item('item-2', 'aurum-trail-kit', 'rare', 'Blue Aurum Trail'),
      item('item-1', 'aurum-trail-kit', 'rare', 'Blue Aurum Trail'),
      { ...item('item-0', 'aurum-trail-kit', 'rare', 'Blue Aurum Trail'), tradable: false },
    ]
    const [group] = groupCraftedItems(items)

    expect(listableItemId(group, items)).toBe('item-1')
  })
})

describe('listing modal', () => {
  function setupDom() {
    document.body.innerHTML = `
      <div id="inventory-panel" hidden>
        <div id="inventory-count"></div>
        <div id="inventory-grid"></div>
        <button id="inventory-close"></button>
      </div>
      <div id="list-modal" hidden>
        <div id="list-modal-title"></div>
        <button id="list-cur-credits"></button>
        <button id="list-cur-token"></button>
        <input id="list-price" />
        <span id="list-price-unit"></span>
        <button id="list-confirm"></button>
        <button id="list-cancel"></button>
      </div>`
  }
  const state = {
    cores: 0,
    items: [{ id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'rare', variant: 'Blue Aurum Trail', createdAt: 1, tradable: true }],
  }

  it('opens the modal (not window.prompt) and lists with the chosen currency', () => {
    setupDom()
    const onListItem = vi.fn()
    const panel = new InventoryPanel({ onListItem, canListItem: () => true, walletConnected: () => true })
    panel.open(state as any)
    ;(document.querySelector('.inventory-list') as HTMLButtonElement).click()
    expect(document.getElementById('list-modal')!.hidden).toBe(false)
    ;(document.getElementById('list-cur-token') as HTMLButtonElement).click()
    ;(document.getElementById('list-price') as HTMLInputElement).value = '1250'
    ;(document.getElementById('list-confirm') as HTMLButtonElement).click()
    expect(onListItem).toHaveBeenCalledWith('i1', 1250, 'token')
    expect(document.getElementById('list-modal')!.hidden).toBe(true)
  })

  it('disables the token option when no wallet is connected', () => {
    setupDom()
    const panel = new InventoryPanel({ onListItem: vi.fn(), canListItem: () => true, walletConnected: () => false })
    panel.open(state as any)
    ;(document.querySelector('.inventory-list') as HTMLButtonElement).click()
    expect((document.getElementById('list-cur-token') as HTMLButtonElement).disabled).toBe(true)
  })
})
