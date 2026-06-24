import { describe, expect, it } from 'vitest'
import {
  buyListing,
  cancelListing,
  createListing,
  createMarketplace,
  marketplaceList,
  marketplaceRowsFor,
  publicMarketplaceRow,
  reserveListing,
  settleTokenListing,
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

describe('marketplace currency', () => {
  it('creates a token listing with currency token', () => {
    const store = { seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const r = createListing(market, store, 'seller', 'ACE', 'item-1', 1250, () => 1000, 'token')
    expect(r.ok).toBe(true)
    expect(r.listing.currency).toBe('token')
  })

  it('defaults to credits when currency omitted', () => {
    const store = { seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const r = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)
    expect(r.listing.currency).toBe('credits')
  })

  it('reserves a token listing for one buyer and rejects a second buyer', () => {
    const store = { seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const { listing } = createListing(market, store, 'seller', 'ACE', 'item-1', 1250, () => 1000, 'token')
    const a = reserveListing(market, 'buyerA', listing.id, 'nonce-a', () => 2000)
    expect(a.ok).toBe(true)
    expect(a.nonce).toBe('nonce-a')
    const b = reserveListing(market, 'buyerB', listing.id, 'nonce-b', () => 2001)
    expect(b).toEqual({ ok: false, reason: 'reserved' })
  })

  it('lets the reservation expire and a new buyer reserve', () => {
    const store = { seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const { listing } = createListing(market, store, 'seller', 'ACE', 'item-1', 1250, () => 1000, 'token')
    reserveListing(market, 'buyerA', listing.id, 'nonce-a', () => 2000)
    const b = reserveListing(market, 'buyerB', listing.id, 'nonce-b', () => 2000 + 120_001)
    expect(b.ok).toBe(true)
  })

  it('rejects reserving a credits listing', () => {
    const store = { seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const { listing } = createListing(market, store, 'seller', 'ACE', 'item-1', 25000, () => 1000)
    expect(reserveListing(market, 'buyerA', listing.id, 'n', () => 2000)).toEqual({ ok: false, reason: 'not-token' })
  })

  it('settles a reserved token listing: item to buyer, no server credits move', () => {
    const store = {
      seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } },
      buyerA: { credits: 0, crafting: { cores: 0, items: [] } },
    }
    const market = createMarketplace()
    const { listing } = createListing(market, store, 'seller', 'ACE', 'item-1', 1250, () => 1000, 'token')
    reserveListing(market, 'buyerA', listing.id, 'nonce-a', () => 2000)
    const r = settleTokenListing(market, store, 'buyerA', listing.id, () => 3000)
    expect(r.ok).toBe(true)
    expect(store.buyerA.crafting.items.map((i) => i.id)).toEqual(['item-1'])
    expect(store.seller.credits).toBe(0)
    expect(r.listing.status).toBe('sold')
    expect(market.reservations.has(listing.id)).toBe(false)
  })

  it('exposes a short wallet suffix on public rows and hides the raw sellerKey', () => {
    const wallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    const store = { [wallet]: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } } }
    const market = createMarketplace()
    const { listing } = createListing(market, store, wallet, 'ACE', 'item-1', 1250, () => 1000, 'token')
    const pub = publicMarketplaceRow(listing, 'viewer-x')
    expect(pub.sellerShort).toBe('7xKX...gAsU')
    expect(pub.sellerKey).toBeUndefined()
  })

  it('refuses to settle for a buyer who does not hold the reservation', () => {
    const store = {
      seller: { credits: 0, crafting: { cores: 0, items: [cloneItem()] } },
      buyerB: { credits: 0, crafting: { cores: 0, items: [] } },
    }
    const market = createMarketplace()
    const { listing } = createListing(market, store, 'seller', 'ACE', 'item-1', 1250, () => 1000, 'token')
    reserveListing(market, 'buyerA', listing.id, 'nonce-a', () => 2000)
    expect(settleTokenListing(market, store, 'buyerB', listing.id, () => 3000)).toEqual({ ok: false, reason: 'not-reserved' })
  })
})
