const MAX_ACTIVE_LISTINGS = 200
const MAX_PRICE = 999_999_999
const LISTING_STATUSES = new Set(['active', 'sold', 'cancelled'])

function nowValue(now) {
  return Math.max(0, Math.floor(Number((now ?? Date.now)()) || 0))
}

function safeText(value, fallback, max = 64) {
  const text = String(value ?? '').trim()
  return (text || fallback).slice(0, max)
}

function cloneItem(item) {
  return {
    id: safeText(item?.id, '', 96),
    recipeId: safeText(item?.recipeId, '', 48),
    rarity: safeText(item?.rarity, 'common', 16),
    variant: safeText(item?.variant, 'Crafted Cosmetic', 64),
    createdAt: Math.max(0, Math.floor(Number(item?.createdAt) || 0)),
    tradable: item?.tradable !== false,
  }
}

function sanitizeListing(value) {
  if (!value || typeof value !== 'object') return null
  const id = safeText(value.id, '', 96)
  const sellerKey = safeText(value.sellerKey, '', 96)
  const sellerName = safeText(value.sellerName, 'PILOT', 16)
  const price = Math.max(0, Math.floor(Number(value.price) || 0))
  const status = LISTING_STATUSES.has(value.status) ? value.status : 'active'
  const item = cloneItem(value.item)
  if (!id || !sellerKey || !item.id || price <= 0 || price > MAX_PRICE) return null
  return {
    id,
    sellerKey,
    sellerName,
    item,
    price,
    currency: 'credits',
    status,
    createdAt: Math.max(0, Math.floor(Number(value.createdAt) || 0)),
    updatedAt: Math.max(0, Math.floor(Number(value.updatedAt) || 0)),
  }
}

function ensureProgress(store, key) {
  const entry = store?.[key]
  if (!entry || typeof entry !== 'object') return null
  if (!entry.crafting || typeof entry.crafting !== 'object') entry.crafting = { cores: 0, items: [] }
  if (!Array.isArray(entry.crafting.items)) entry.crafting.items = []
  entry.credits = Math.max(0, Number(entry.credits) || 0)
  return entry
}

function findActive(marketplace, listingId) {
  const listing = marketplace.listings.find((row) => row.id === listingId)
  if (!listing) return { ok: false, reason: 'not-found' }
  if (listing.status !== 'active') return { ok: false, reason: 'not-active' }
  return { ok: true, listing }
}

function activeListings(marketplace) {
  return marketplace.listings
    .filter((row) => row.status === 'active')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ACTIVE_LISTINGS)
    .map((row) => ({ ...row, item: cloneItem(row.item) }))
}

export function createMarketplace(seed = {}) {
  const raw = Array.isArray(seed?.listings) ? seed.listings : Array.isArray(seed) ? seed : []
  const listings = []
  const seen = new Set()
  for (const value of raw) {
    const listing = sanitizeListing(value)
    if (!listing || seen.has(listing.id)) continue
    listings.push(listing)
    seen.add(listing.id)
    if (listings.length >= 1000) break
  }
  return { listings }
}

export function marketplaceSnapshot(marketplace) {
  return { listings: marketplace.listings.map((row) => ({ ...row, item: cloneItem(row.item) })) }
}

export function marketplaceList(marketplace) {
  const rows = activeListings(marketplace)
  return { rows, total: rows.length }
}

export function publicMarketplaceRow(row, viewerKey) {
  if (!row) return null
  const { sellerKey: _sellerKey, ...publicRow } = row
  return { ...publicRow, item: cloneItem(row.item), owned: row.sellerKey === viewerKey }
}

export function marketplaceRowsFor(marketplace, viewerKey) {
  return activeListings(marketplace).map((row) => publicMarketplaceRow(row, viewerKey))
}

export function createListing(marketplace, store, sellerKey, sellerName, itemId, price, now = Date.now) {
  const seller = ensureProgress(store, sellerKey)
  if (!seller) return { ok: false, reason: 'missing-progress' }
  const safeItemId = safeText(itemId, '', 96)
  const safePrice = Math.floor(Number(price) || 0)
  if (safePrice <= 0 || safePrice > MAX_PRICE) return { ok: false, reason: 'invalid-price' }
  const itemIndex = seller.crafting.items.findIndex((item) => item?.id === safeItemId)
  if (itemIndex < 0) return { ok: false, reason: 'item-not-found' }
  const item = cloneItem(seller.crafting.items[itemIndex])
  if (!item.tradable) return { ok: false, reason: 'not-tradable' }

  const t = nowValue(now)
  const listing = {
    id: `mkt-${t}-${Math.random().toString(36).slice(2, 8)}`,
    sellerKey: safeText(sellerKey, '', 96),
    sellerName: safeText(sellerName, 'PILOT', 16),
    item,
    price: safePrice,
    currency: 'credits',
    status: 'active',
    createdAt: t,
    updatedAt: t,
  }
  seller.crafting.items.splice(itemIndex, 1)
  marketplace.listings.push(listing)
  return { ok: true, listing: { ...listing, item: cloneItem(listing.item) } }
}

export function buyListing(marketplace, store, buyerKey, listingId, now = Date.now) {
  const active = findActive(marketplace, safeText(listingId, '', 96))
  if (!active.ok) return active
  const listing = active.listing
  if (listing.sellerKey === buyerKey) return { ok: false, reason: 'own-listing' }
  const buyer = ensureProgress(store, buyerKey)
  const seller = ensureProgress(store, listing.sellerKey)
  if (!buyer || !seller) return { ok: false, reason: 'missing-progress' }
  if (buyer.credits < listing.price) return { ok: false, reason: 'missing-credits' }

  buyer.credits -= listing.price
  seller.credits += listing.price
  buyer.crafting.items.push(cloneItem(listing.item))
  listing.status = 'sold'
  listing.updatedAt = nowValue(now)
  return { ok: true, listing: { ...listing, item: cloneItem(listing.item) } }
}

export function cancelListing(marketplace, store, sellerKey, listingId, now = Date.now) {
  const active = findActive(marketplace, safeText(listingId, '', 96))
  if (!active.ok) return active
  const listing = active.listing
  if (listing.sellerKey !== sellerKey) return { ok: false, reason: 'not-seller' }
  const seller = ensureProgress(store, sellerKey)
  if (!seller) return { ok: false, reason: 'missing-progress' }

  seller.crafting.items.push(cloneItem(listing.item))
  listing.status = 'cancelled'
  listing.updatedAt = nowValue(now)
  return { ok: true }
}
