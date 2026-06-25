// Pure, client-side sort + currency filter for the marketplace tab. No DOM, no IO.
import type { MarketListing } from '../net/client'

export type MarketSort = 'new' | 'price-asc' | 'price-desc'
export type CurrencyFilter = 'all' | 'credits' | 'token'

/** Filter by currency then sort. 'new' keeps the server order (createdAt desc). Non-mutating. */
export function sortFilterListings(rows: readonly MarketListing[], sort: MarketSort, currency: CurrencyFilter): MarketListing[] {
  const filtered = currency === 'all' ? [...rows] : rows.filter((r) => r.currency === currency)
  if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price)
  else if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price)
  return filtered
}
