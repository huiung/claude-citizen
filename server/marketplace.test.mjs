import { describe, expect, it } from 'vitest'
import {
  buyListing,
  cancelListing,
  createListing,
  createMarketplace,
  marketplaceList,
  marketplaceRowsFor,
} from './marketplace.mjs'

const item = {
  id: 'item-1',
  recipeId: 'aurum-trail-kit',
  rarity: 'rare',
  variant: 'Blue Aurum Trail',
  createdAt: 100,
  tradable: true,
}

function cloneItem(overrides = {}) {
  return { ...item, ...overrides }
}

describe('marketplace core', () => {
  it('creates a listing by moving a tradable item out of seller inventory', () => {
    const store = { seller: { credits: 100, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()

    const result = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)

    expect(result.ok).toBe(true)
    expect(store.seller.crafting.items).toEqual([])
    expect(marketplaceList(market).rows[0]).toMatchObject({
      sellerKey: 'seller',
      sellerName: 'ACE',
      price: 25000,
      currency: 'credits',
      status: 'active',
      item: cloneItem(),
    })
  })

  it('returns public rows without exposing seller identity keys', () => {
    const store = { 'secret-anon-token': { credits: 100, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    createListing(market, store, 'secret-anon-token', 'ACE', 'item-1', 25000, () => 1000)

    expect(marketplaceRowsFor(market, 'secret-anon-token')[0]).toMatchObject({ owned: true, sellerName: 'ACE' })
    expect(marketplaceRowsFor(market, 'other-token')[0]).toMatchObject({ owned: false, sellerName: 'ACE' })
    expect(marketplaceRowsFor(market, 'other-token')[0]).not.toHaveProperty('sellerKey')
  })

  it('buys an active listing once by moving credits and item', () => {
    const store = {
      seller: { credits: 100, crafting: { cores: 0, items: [cloneItem()] } },
      buyer: { credits: 50000, crafting: { cores: 0, items: [] } },
    }
    const market = createMarketplace()
    const created = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)
    const listing = created.listing

    const bought = buyListing(market, store, 'buyer', listing.id, () => 2000)

    expect(bought.ok).toBe(true)
    expect(store.seller.credits).toBe(25100)
    expect(store.buyer.credits).toBe(25000)
    expect(store.buyer.crafting.items.map((i) => i.id)).toEqual(['item-1'])
    expect(buyListing(market, store, 'buyer', listing.id, () => 3000)).toEqual({ ok: false, reason: 'not-active' })
  })

  it('cancels seller listing by returning the item', () => {
    const store = { seller: { credits: 100, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const created = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)
    const listing = created.listing

    expect(cancelListing(market, store, 'seller', listing.id, () => 2000)).toEqual({ ok: true })
    expect(store.seller.crafting.items.map((i) => i.id)).toEqual(['item-1'])
    expect(marketplaceList(market).rows).toEqual([])
  })

  it('rejects invalid listing attempts without mutating inventory', () => {
    const store = {
      seller: { credits: 100, crafting: { cores: 0, items: [cloneItem({ tradable: false })] } },
    }
    const market = createMarketplace()

    expect(createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)).toEqual({
      ok: false,
      reason: 'not-tradable',
    })
    expect(createListing(market, store, 'seller', 'ACE', 'missing', 25000, () => 1000)).toEqual({
      ok: false,
      reason: 'item-not-found',
    })
    expect(createListing(market, store, 'seller', 'ACE', 'item-1', 0, () => 1000)).toEqual({
      ok: false,
      reason: 'invalid-price',
    })
    expect(store.seller.crafting.items).toHaveLength(1)
    expect(marketplaceList(market).rows).toEqual([])
  })

  it('rejects buys without enough credits and cancels by non-sellers', () => {
    const store = {
      seller: { credits: 100, crafting: { cores: 0, items: [cloneItem()] } },
      buyer: { credits: 100, crafting: { cores: 0, items: [] } },
    }
    const market = createMarketplace()
    const listing = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000).listing

    expect(buyListing(market, store, 'buyer', listing.id, () => 2000)).toEqual({ ok: false, reason: 'missing-credits' })
    expect(cancelListing(market, store, 'buyer', listing.id, () => 2000)).toEqual({ ok: false, reason: 'not-seller' })
    expect(store.buyer.crafting.items).toEqual([])
    expect(marketplaceList(market).rows).toHaveLength(1)
  })
})
