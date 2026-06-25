import { describe, expect, it } from 'vitest'
import { sortFilterListings } from './marketListSort'
import type { MarketListing } from '../net/client'

function row(id: string, price: number, currency: 'credits' | 'token', createdAt: number): MarketListing {
  return {
    id, sellerName: 'X', price, currency, status: 'active', createdAt, updatedAt: createdAt, owned: false,
    item: { id: id + '-i', recipeId: 'aurum-trail-kit', rarity: 'rare', variant: 'V', createdAt, tradable: true },
  }
}
const rows: MarketListing[] = [
  row('a', 300, 'credits', 30),
  row('b', 100, 'token', 20),
  row('c', 200, 'credits', 10),
]

describe('sortFilterListings', () => {
  it("'new' preserves input order", () => {
    expect(sortFilterListings(rows, 'new', 'all').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('price-asc / price-desc sort by price', () => {
    expect(sortFilterListings(rows, 'price-asc', 'all').map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(sortFilterListings(rows, 'price-desc', 'all').map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })
  it('filters by currency', () => {
    expect(sortFilterListings(rows, 'new', 'credits').map((r) => r.id)).toEqual(['a', 'c'])
    expect(sortFilterListings(rows, 'new', 'token').map((r) => r.id)).toEqual(['b'])
  })
  it('does not mutate the input', () => {
    const before = rows.map((r) => r.id)
    sortFilterListings(rows, 'price-asc', 'all')
    expect(rows.map((r) => r.id)).toEqual(before)
  })
  it('empty result when no row matches the filter', () => {
    expect(sortFilterListings([row('a', 1, 'credits', 1)], 'new', 'token')).toEqual([])
  })
})
