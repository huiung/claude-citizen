# Marketplace Phase 1 Design

## Goal

Create a first marketplace loop for crafted cosmetic items. Phase 1 uses in-game credits for settlement while keeping the listing shape open for future SOL or token settlement.

## Scope

- Wallet-connected players can list tradable crafted cosmetic items for credits.
- Listed items are removed from the seller inventory and held by the server listing store.
- Buyers can purchase active listings if they have enough credits.
- Purchases transfer credits to the seller and transfer the item to the buyer inventory.
- Sellers can cancel their own listings and receive the item back.
- Anonymous pilots can view the market but cannot list, buy, or cancel listings.
- The station UI gains a `MARKET` tab for browsing listings.
- The inventory UI gains a sell/list action for tradable items.

## Non-Goals

- No on-chain settlement in this phase.
- No auction bidding.
- No real-money/SOL escrow.
- No performance bonus from crafted cosmetics.
- No fee or tax in Phase 1.

## Data Model

A marketplace listing is server-owned data:

```ts
{
  id: string
  sellerKey: string
  sellerName: string
  item: CraftedCosmeticItem
  price: number
  currency: 'credits'
  status: 'active' | 'sold' | 'cancelled'
  createdAt: number
  updatedAt: number
}
```

Only `active` listings appear in the public market list. `currency` is explicit so a later phase can add token or SOL listings without changing the UI contract.

## Server Flow

The server remains the authority for final marketplace state.

- `market-list`: returns active listings.
- `market-create`: validates seller identity, price, and item ownership, then removes the item from seller progress and creates an active listing.
- `market-buy`: validates buyer identity, listing status, and buyer credits, then moves credits to seller progress and item to buyer progress.
- `market-cancel`: validates seller ownership, marks listing cancelled, and restores the item to seller progress.

All mutations sanitize progress before writing to the store. Marketplace mutations require a verified wallet session and use the wallet pubkey as the seller or buyer key. Anonymous pilots can browse active listings but cannot trade.

## Client Flow

The station menu gets a `MARKET` tab:

- Lists active items with rarity, variant, seller, and price.
- Has `Buy` buttons for affordable listings when a wallet is connected.
- Has `Cancel` buttons for the player's own active listings.
- Refreshes after list/buy/cancel actions.

The inventory panel groups crafted items as it does now, but each group can list one item at a time. Phase 1 uses a conservative fixed quick-list price selector or numeric prompt to avoid a large custom modal.

## Error Handling

Client messages should surface short, direct errors:

- Listing no longer available.
- Not enough credits.
- Item is no longer in inventory.
- Only the seller can cancel this listing.
- Server unavailable.
- Connect wallet to trade.

The server must reject duplicate purchase attempts by checking active status at mutation time.

## Testing

- Unit-test marketplace create/buy/cancel logic with seller and buyer progress stores.
- Test that listed items leave seller inventory and return on cancel.
- Test that buy moves item and credits exactly once.
- Test server sanitization rejects invalid price and non-tradable items.
- Add focused UI tests only where existing DOM tests can cover tab/action wiring cheaply.

## Rollout

This can ship as an off-chain, credits-only market. The UI copy should say "Credits Marketplace" or "Pilot Marketplace" rather than implying token/SOL trading.
