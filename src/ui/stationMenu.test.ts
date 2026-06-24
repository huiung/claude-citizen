// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { HOLDER_IDENTITY_KITS, STATION_TABS, StationMenu } from './stationMenu'
import { createEconomy } from '../sim/economy'
import { createMarket } from '../sim/market'
import { createUpgrades } from '../sim/upgrades'
import { createCraftingState } from '../sim/crafting'

describe('station hangar holder identity kits', () => {
  it('lists all three holder name color tiers', () => {
    expect(HOLDER_IDENTITY_KITS.map((kit) => kit.tier)).toEqual([1, 2, 3])
    expect(HOLDER_IDENTITY_KITS[2]).toMatchObject({
      tier: 3,
      name: 'T3 Name Color',
      description: 'Purple callsign styling on nameplates and chat.',
    })
  })

  it('includes a marketplace tab for crafted cosmetic trading', () => {
    expect(STATION_TABS.map((tab) => tab.id)).toContain('market')
    expect(STATION_TABS.map((tab) => tab.label)).toContain('MARKET')
  })
})

describe('stationMenu market tab currency display', () => {
  it('shows $CITIZEN unit and enabled Buy for a token listing', () => {
    const tokenRow = {
      id: 'mkt-1',
      sellerName: 'ACE',
      price: 1250,
      currency: 'token' as const,
      status: 'active' as const,
      item: { id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'rare', variant: 'Blue Aurum Trail', createdAt: 1, tradable: true },
      owned: false,
      createdAt: 1,
      updatedAt: 1,
    }

    const ctx = {
      outpostId: 'colony',
      econ: createEconomy(),
      market: createMarket(),
      crafting: createCraftingState(),
      upgrades: createUpgrades(),
      contracts: [],
      audio: {} as any,
      capacity: () => 20,
      selectedShip: () => 'hauler' as const,
      ownedShips: new Set(['hauler'] as const),
      shipPrices: { hauler: 0, fighter: 5000, miner: 8000, interceptor: 15000 },
      onBuyShip: () => {},
      onSelectShip: () => {},
      holderTier: () => 0,
      selectedHolderShipVisual: () => 'standard' as const,
      onSelectHolderShipVisual: () => {},
      marketplaceRows: () => [tokenRow],
      marketplaceCanTrade: () => true,
      onRefreshMarketplace: () => {},
      onBuyMarketListing: () => {},
      onCancelMarketListing: () => {},
    }

    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(ctx)

    // Switch to the market tab
    ;(menu.root.querySelector('[data-tab="market"]') as HTMLButtonElement).click()

    expect(menu.root.textContent).toContain('1,250 $CITIZEN')

    const buyBtn = Array.from(menu.root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Buy',
    ) as HTMLButtonElement | undefined
    expect(buyBtn).toBeDefined()
    expect(buyBtn!.disabled).toBe(false)
  })
})
