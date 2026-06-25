// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
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
  // Each test mounts its own StationMenu root; clear leftovers so duplicate ids across roots
  // don't make jsdom's scoped `#id` querySelector return null in a later test.
  beforeEach(() => { document.body.innerHTML = '' })

  function makeMarketCtx(rows: readonly any[]) {
    return {
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
      marketplaceRows: () => rows,
      marketplaceCanTrade: () => true,
      onRefreshMarketplace: () => {},
      onBuyMarketListing: () => {},
      onCancelMarketListing: () => {},
    }
  }

  it('shows $CITIZEN unit and enabled Buy for a token listing', () => {
    const tokenRow = {
      id: 'mkt-1', sellerName: 'ACE', sellerShort: '7xKX...gAsU', price: 1250,
      currency: 'token' as const, status: 'active' as const, owned: false, createdAt: 1, updatedAt: 1,
      item: { id: 'i1', recipeId: 'aurum-trail-kit', rarity: 'rare', variant: 'Blue Aurum Trail', createdAt: 1, tradable: true },
    }
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(makeMarketCtx([tokenRow]))
    ;(menu.root.querySelector('[data-tab="market"]') as HTMLButtonElement).click()

    expect(menu.root.textContent).toContain('1,250 $CITIZEN')
    expect(menu.root.textContent).toContain('ACE (7xKX...gAsU)')
    const buyBtn = Array.from(menu.root.querySelectorAll('button')).find((b) => b.textContent === 'Buy') as HTMLButtonElement | undefined
    expect(buyBtn).toBeDefined()
    expect(buyBtn!.disabled).toBe(false)
  })

  it('sorts and filters market listings via the controls', () => {
    const mk = (id: string, price: number, currency: 'credits' | 'token') => ({
      id, sellerName: 'X', price, currency, status: 'active' as const, createdAt: Number(id), updatedAt: 1, owned: false,
      item: { id: id + 'i', recipeId: 'aurum-trail-kit', rarity: 'rare', variant: 'V' + id, createdAt: 1, tradable: true },
    })
    const rows = [mk('3', 300, 'credits'), mk('1', 100, 'token'), mk('2', 200, 'credits')]
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(makeMarketCtx(rows))
    ;(menu.root.querySelector('[data-tab="market"]') as HTMLButtonElement).click()

    const names = () => [...menu.root.querySelectorAll('.station-row .s-name')].map((e) => e.textContent ?? '')
    const findBtn = (prefix: string) => [...menu.root.querySelectorAll('button')].find((b) => b.textContent?.startsWith(prefix)) as HTMLButtonElement

    expect(names().filter((n) => /V[123]/.test(n))[0]).toContain('V3') // default Newest = input order
    findBtn('Sort:').click() // -> Price ↑
    expect(names().filter((n) => /V[123]/.test(n))[0]).toContain('V1') // cheapest first
    findBtn('Show:').click() // -> Credits only (token V1 filtered out)
    expect(names().filter((n) => /V[123]/.test(n)).some((n) => n.includes('V1'))).toBe(false)
  })

  it('tags market rows with a rarity class', () => {
    const epic = {
      id: 'e1', sellerName: 'X', price: 50, currency: 'credits' as const, status: 'active' as const, createdAt: 1, updatedAt: 1, owned: false,
      item: { id: 'e1i', recipeId: 'nebula-hull-kit', rarity: 'epic', variant: 'Epic Nebula', createdAt: 1, tradable: true },
    }
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(makeMarketCtx([epic]))
    ;(menu.root.querySelector('[data-tab="market"]') as HTMLButtonElement).click()
    expect(menu.root.querySelector('.station-row.mkt-rarity-epic')).toBeTruthy()
  })
})
