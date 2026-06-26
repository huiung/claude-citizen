import {
  buy, cargoUsed, COMMODITIES, type CommodityId, type Outpost, OUTPOSTS,
  type PlayerEconomy, sell,
} from '../sim/economy'
import { currentPrice, type MarketState, recordTrade } from '../sim/market'
import {
  boostMultiplier, cargoCapacity, miningYield, nextPrice, purchase, type ShipUpgrades, topSpeed,
  type UpgradeTrack,
} from '../sim/upgrades'
import { abandon, accept, completeContract, type Contract } from '../sim/contracts'
import { SHIP_RANK_REQ, SHIP_STATS, SHIP_TYPES, type ShipType } from '../sim/shipTypes'
import { rankForCredits, RANKS } from '../sim/ranks'
import {
  CRAFT_CORE_CREDIT_COST,
  CRAFTING_RECIPES,
  CRAFTING_RARITY_LABELS,
  craftCosmetic,
  refineCraftCore,
  PITY_GUARANTEE,
  PITY_RAMP_START,
  type CraftingState,
  type CraftingCosmeticId,
  type CraftedCosmeticItem,
} from '../sim/crafting'
import { groupCraftedItems } from './inventory'
import type { GameAudio } from '../audio/sound'
import { HOLDER_SHIP_VISUALS, resolveHolderShipVisual, type HolderShipVisualId } from './holderShipVisual'
import type { MarketListing } from '../net/client'
import { sortFilterListings, type CurrencyFilter, type MarketSort } from './marketListSort'
import { cosmeticSlotUi } from './cosmeticSlotUi'

const COMMODITY_ORDER: CommodityId[] = ['ORE', 'ALLOY']
type Tab = 'trade' | 'upgrades' | 'contracts' | 'shipyard' | 'hangar' | 'crafting' | 'market'

function isCraftingCosmeticId(id: string): id is CraftingCosmeticId {
  return CRAFTING_RECIPES.some((recipe) => recipe.id === id)
}

/** Forge animation stage labels (smelt → shape → engrave), shown in order. */
export const FORGE_STAGES = ['Smelt', 'Shape', 'Engrave'] as const
/** Duration of each forge stage in ms; total = FORGE_STAGES.length × FORGE_STAGE_MS (≈ 2.25 s). */
export const FORGE_STAGE_MS = 750

export const STATION_TABS: readonly { id: Tab; label: string }[] = [
  { id: 'trade', label: 'TRADE' },
  { id: 'crafting', label: 'CRAFTING' },
  { id: 'market', label: 'MARKET' },
  { id: 'upgrades', label: 'UPGRADES' },
  { id: 'shipyard', label: 'SHIPYARD' },
  { id: 'hangar', label: 'HANGAR' },
  { id: 'contracts', label: 'CONTRACTS' },
]

export interface HolderIdentityKit {
  tier: number
  name: string
  description: string
}

export const HOLDER_IDENTITY_KITS: readonly HolderIdentityKit[] = [
  { tier: 1, name: 'Holder Name Color', description: 'Gold callsign styling on nameplates and chat.' },
  { tier: 2, name: 'Elite Name Color', description: 'Cyan callsign styling on nameplates and chat.' },
  { tier: 3, name: 'T3 Name Color', description: 'Purple callsign styling on nameplates and chat.' },
]

export interface StationContext {
  outpostId: string
  econ: PlayerEconomy
  market: MarketState
  crafting: CraftingState
  upgrades: ShipUpgrades
  contracts: Contract[]
  audio: GameAudio
  /** Effective cargo capacity of the current craft (base + upgrade delta). */
  capacity: () => number
  /** Currently flown craft type. */
  selectedShip: () => ShipType
  /** Live set of owned craft (mutated by onBuyShip). */
  ownedShips: Set<ShipType>
  shipPrices: Record<ShipType, number>
  onBuyShip: (type: ShipType) => void
  onSelectShip: (type: ShipType) => void
  /** Verified token-holder tier, cosmetic only. */
  holderTier: () => number
  selectedHolderShipVisual: () => HolderShipVisualId
  onSelectHolderShipVisual: (id: HolderShipVisualId) => void
  marketplaceRows: () => readonly MarketListing[]
  marketplaceCanTrade: () => boolean
  onRefreshMarketplace: () => void
  onBuyMarketListing: (listingId: string) => void
  onCancelMarketListing: (listingId: string) => void
}

/**
 * The docking station screen: trade (dynamic prices), ship upgrades, and delivery
 * contracts, as tabs. Built from the DOM, no framework. main.ts owns all the state;
 * this just reads/mutates it and reports changes.
 */
export class StationMenu {
  readonly root: HTMLElement
  private ctx!: StationContext
  private tab: Tab = 'trade'
  private marketSort: MarketSort = 'new'
  private marketCurrency: CurrencyFilter = 'all'
  private onChange: () => void
  private onUndock: () => void
  /** Notifies the host when an item enters (id) or leaves (null) the forge, so other
   *  views (e.g. the inventory panel) can withhold the in-progress item until reveal. */
  private onForgeChange?: (forgingItemId: string | null) => void
  private onContractDelivered?: () => void
  private bodyEl!: HTMLElement
  private creditsEl!: HTMLElement
  private cargoEl!: HTMLElement
  private hintEl!: HTMLElement
  private flash: ReturnType<typeof setTimeout> | null = null
  private forging: { item: CraftedCosmeticItem; stage: number } | null = null
  private forgeTimers: ReturnType<typeof setTimeout>[] = []

  constructor(opts: { onChange: () => void; onUndock: () => void; onForgeChange?: (forgingItemId: string | null) => void; onContractDelivered?: () => void }) {
    this.onChange = opts.onChange
    this.onUndock = opts.onUndock
    this.onForgeChange = opts.onForgeChange
    this.onContractDelivered = opts.onContractDelivered
    this.root = document.createElement('div')
    this.root.id = 'station'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="station-card">
        <div class="station-head">
          <h2 id="station-name">OUTPOST</h2>
          <button id="station-undock">UNDOCK ▸</button>
        </div>
        <div class="station-stats">
          <span>CREDITS <b id="station-credits">0</b></span>
          <span>CARGO <b id="station-cargo">0/0</b></span>
        </div>
        <div class="station-tabs">
          ${STATION_TABS.map((tab) => `<button data-tab="${tab.id}">${tab.label}</button>`).join('')}
        </div>
        <div id="station-body"></div>
        <div class="station-hint" id="station-hint"></div>
      </div>`
    this.bodyEl = this.root.querySelector('#station-body')!
    this.creditsEl = this.root.querySelector('#station-credits')!
    this.cargoEl = this.root.querySelector('#station-cargo')!
    this.hintEl = this.root.querySelector('#station-hint')!
    this.root.querySelector('#station-undock')!.addEventListener('click', () => this.onUndock())
    this.root.querySelectorAll('.station-tabs button').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.cancelForge()
        this.tab = (btn as HTMLElement).dataset.tab as Tab
        this.render()
      }))
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.code === 'Escape') this.onUndock()
    })
  }

  open(ctx: StationContext): void {
    this.cancelForge() // defensive: drop any leftover forge from a previous dock
    this.ctx = ctx
    this.root.querySelector('#station-name')!.textContent = OUTPOSTS[ctx.outpostId]?.name ?? 'OUTPOST'
    this.root.hidden = false
    this.tab = 'trade'
    this.render()
  }

  close(): void {
    this.cancelForge() // stop pending forge timers so the chime/hint don't fire on a hidden menu
    this.root.hidden = true
  }

  private cancelForge(): void {
    for (const t of this.forgeTimers) clearTimeout(t)
    this.forgeTimers = []
    if (this.forging) {
      this.forging = null
      this.onForgeChange?.(null) // un-hide the (already committed) item in other views
    }
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  refresh(): void {
    if (this.root.hidden) return
    this.render()
  }

  private hint(msg: string, bad = false): void {
    this.hintEl.textContent = msg
    this.hintEl.classList.toggle('flash', bad)
    if (this.flash) clearTimeout(this.flash)
    this.flash = setTimeout(() => {
      this.hintEl.classList.remove('flash')
      this.hintEl.textContent = this.defaultHint()
    }, 2000)
  }

  private defaultHint(): string {
    switch (this.tab) {
      case 'trade': return 'Buy low here, sell high at the other outpost. Mine ORE from asteroids for free.'
      case 'crafting': return 'Spend credits, refine Craft Cores, then craft cosmetic kits with rarity rolls.'
      case 'market': return 'Buy and sell crafted cosmetics with credits or the $CITIZEN token. Token sales settle on-chain.'
      case 'upgrades': return 'Spend credits to fly faster and haul more.'
      case 'shipyard': return 'Buy a hull and switch to it. Each trades cargo, speed, and toughness differently.'
      case 'hangar': return 'Holder ship visuals are cosmetic only: no speed, combat, or economy advantage.'
      case 'contracts': return 'Accept a haul, deliver to its destination outpost for the reward.'
    }
  }

  /** Outpost with live market prices spliced in. */
  private livePrices(): Outpost {
    const base = OUTPOSTS[this.ctx.outpostId]
    return {
      ...base,
      prices: {
        ORE: currentPrice(this.ctx.market, base.id, 'ORE'),
        ALLOY: currentPrice(this.ctx.market, base.id, 'ALLOY'),
      },
    }
  }

  private capacity(): number {
    return this.ctx.capacity()
  }

  private trade(kind: 'buy' | 'sell', id: CommodityId, qty: number): void {
    const outpost = this.livePrices()
    const r = kind === 'buy'
      ? buy(this.ctx.econ, outpost, id, qty, this.capacity())
      : sell(this.ctx.econ, outpost, id, qty)
    if (!r.ok) {
      const msg: Record<string, string> = {
        'no-credits': 'Not enough credits.',
        'no-cargo-space': 'Cargo hold full.',
        'no-stock': "You don't have that to sell.",
        'bad-qty': 'Invalid amount.',
      }
      this.ctx.audio.blip('error')
      this.hint(msg[r.reason], true)
      return
    }
    recordTrade(this.ctx.market, outpost.id, id, qty, kind)
    this.ctx.audio.blip('trade')
    this.onChange()
    this.render()
  }

  private buyUpgrade(track: UpgradeTrack): void {
    const r = purchase(this.ctx.upgrades, this.ctx.econ, track)
    if (!r.ok) {
      this.ctx.audio.blip('error')
      this.hint(r.reason === 'maxed' ? 'Already at max tier.' : 'Not enough credits.', true)
      return
    }
    this.ctx.audio.blip('trade')
    this.onChange()
    this.render()
  }

  private resolveContract(c: Contract, action: 'accept' | 'abandon' | 'complete'): void {
    if (action === 'accept') {
      accept(c)
      this.ctx.audio.blip('trade')
    } else if (action === 'abandon') {
      abandon(c)
      this.ctx.audio.blip('error')
    } else {
      const r = completeContract(c, this.ctx.econ, this.ctx.outpostId)
      if (!r.ok) {
        this.ctx.audio.blip('error')
        const msg: Record<string, string> = {
          'not-accepted': 'Not an active contract.',
          'wrong-outpost': 'Deliver this at its destination outpost.',
          'insufficient-cargo': "You don't have the goods to deliver.",
        }
        this.hint(msg[r.reason], true)
        return
      }
      this.ctx.audio.blip('dock')
      this.hint(`Delivered. +${r.reward} cr`)
      this.onContractDelivered?.()
    }
    this.onChange()
    this.render()
  }

  private render(): void {
    this.creditsEl.textContent = String(Math.floor(this.ctx.econ.credits))
    this.cargoEl.textContent = `${Math.floor(cargoUsed(this.ctx.econ))}/${this.capacity()}`
    this.root.querySelectorAll('.station-tabs button').forEach((b) =>
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === this.tab))
    this.hintEl.textContent = this.defaultHint()
    this.bodyEl.innerHTML = ''
    if (this.tab === 'trade') this.renderTrade()
    else if (this.tab === 'crafting') this.renderCrafting()
    else if (this.tab === 'market') this.renderMarket()
    else if (this.tab === 'upgrades') this.renderUpgrades()
    else if (this.tab === 'shipyard') this.renderShipyard()
    else if (this.tab === 'hangar') this.renderHangar()
    else this.renderContracts()
  }

  private renderTrade(): void {
    const outpost = this.livePrices()
    const free = this.capacity() - cargoUsed(this.ctx.econ)
    for (const id of COMMODITY_ORDER) {
      const price = outpost.prices[id]
      const held = Math.floor(this.ctx.econ.cargo[id])
      const row = this.rowEl(`${COMMODITIES[id].name}`, `${price} cr`, `×${held}`)
      const actions = row.querySelector('.s-actions')!
      for (const [label, kind, qty] of [
        ['Buy 1', 'buy', 1], ['Buy 5', 'buy', 5], ['Sell 1', 'sell', 1], ['Sell all', 'sell', held],
      ] as [string, 'buy' | 'sell', number][]) {
        const disabled =
          (kind === 'buy' && (price * qty > this.ctx.econ.credits || qty > free)) ||
          (kind === 'sell' && held < Math.max(1, qty))
        actions.appendChild(this.btn(label, kind, disabled, () => this.trade(kind, id, Math.max(1, qty))))
      }
      this.bodyEl.appendChild(row)
    }
  }

  private craft(id: CraftingCosmeticId): void {
    if (this.forging) return // ignore re-entry while a forge is running
    const r = craftCosmetic(this.ctx.econ, this.ctx.crafting, id)
    if (!r.ok) {
      this.ctx.audio.blip('error')
      const msg: Record<typeof r.reason, string> = {
        'unknown-recipe': 'Unknown crafting recipe.',
        'missing-credits': 'Not enough credits.',
        'missing-cores': 'Not enough Craft Cores.',
      }
      this.hint(msg[r.reason], true)
      return
    }
    this.onChange() // commit spend + pity immediately (persists even if the reveal is interrupted)
    this.startForge(r.item)
  }

  private startForge(item: CraftedCosmeticItem): void {
    this.forging = { item, stage: 0 }
    this.onForgeChange?.(item.id) // withhold the in-progress item from other views (inventory panel)
    this.ctx.audio.blip('forge')
    this.render()
    // stage 0 already rendered above; schedule stages 1..N-1, then the reveal
    for (let i = 1; i < FORGE_STAGES.length; i++) {
      this.forgeTimers.push(
        setTimeout(() => {
          if (!this.forging) return
          this.forging.stage = i
          this.ctx.audio.blip('forge')
          this.render()
        }, FORGE_STAGE_MS * i),
      )
    }
    this.forgeTimers.push(setTimeout(() => this.finishForge(), FORGE_STAGE_MS * FORGE_STAGES.length))
  }

  private finishForge(): void {
    const f = this.forging
    if (!f) return
    this.forging = null
    this.forgeTimers = []
    this.onForgeChange?.(null) // reveal: un-hide the item in other views
    this.ctx.audio.blip('forge-done')
    if (f.item.rarity === 'legendary') this.ctx.audio.blip('error') // reuse forceField_003 asset as a legendary sting
    this.render() // render() resets hintEl to defaultHint(); the hint() below writes the reveal over it
    this.hint(`Forged ${CRAFTING_RARITY_LABELS[f.item.rarity]} ${f.item.variant}.`)
  }

  private refineCore(): void {
    const r = refineCraftCore(this.ctx.econ, this.ctx.crafting)
    if (!r.ok) {
      this.ctx.audio.blip('error')
      this.hint('Not enough credits to refine a Craft Core.', true)
      return
    }
    this.ctx.audio.blip('trade')
    this.hint('Craft Core refined.')
    this.onChange()
    this.render()
  }

  private craftingCostText(creditCost: number, coreCost = 0): string {
    const parts = [`${creditCost.toLocaleString()} cr`]
    if (coreCost > 0) parts.push(`${coreCost} CORE`)
    return parts.join(' + ')
  }

  private renderCrafting(): void {
    const note = document.createElement('div')
    note.className = 'station-empty'
    note.textContent = 'Cosmetic only for now. Crafted items become the base for future equip and marketplace features.'
    this.bodyEl.appendChild(note)

    if (this.forging) {
      const f = this.forging
      const panel = document.createElement('div')
      panel.className = 'station-empty forge-progress'
      panel.textContent = `Forging… ${FORGE_STAGES[f.stage]} (${f.stage + 1}/${FORGE_STAGES.length})`
      this.bodyEl.appendChild(panel)
    }

    const coreCost = this.craftingCostText(CRAFT_CORE_CREDIT_COST)
    const canRefine = this.ctx.econ.credits >= CRAFT_CORE_CREDIT_COST
    const coreRow = this.rowEl('Craft Core', 'Convert credits into a rare crafting catalyst.', `${this.ctx.crafting.cores} CORE`)
    coreRow.querySelector('.s-price')!.textContent = coreCost
    coreRow.querySelector('.s-actions')!.appendChild(this.btn('Refine', 'buy', !canRefine, () => this.refineCore()))
    this.bodyEl.appendChild(coreRow)

    for (const recipe of CRAFTING_RECIPES) {
      const cost = this.craftingCostText(recipe.creditCost, recipe.coreCost)
      const affordable =
        !this.forging &&
        this.ctx.econ.credits >= recipe.creditCost &&
        this.ctx.crafting.cores >= (recipe.coreCost ?? 0)
      // Crafting is repeatable (multiple copies to equip/trade), so always show the cost — never
      // hide it behind an "owned" label. Owned counts live in the inventory section below.
      const row = this.rowEl(recipe.name, recipe.description, cost)
      this.decorateCosmeticRow(row, recipe.id)
      const actions = row.querySelector('.s-actions')!
      actions.appendChild(this.btn('Craft', 'buy', !affordable, () => this.craft(recipe.id)))
      this.bodyEl.appendChild(row)
    }

    const remain = PITY_GUARANTEE - this.ctx.crafting.pityCount
    const pityEl = document.createElement('div')
    pityEl.className = 'station-empty pity-indicator'
    pityEl.textContent = `Epic+ guaranteed in ${remain}`
    if (this.ctx.crafting.pityCount > PITY_RAMP_START) {
      pityEl.textContent += ' · Odds rising ↑'
      pityEl.classList.add('pity-ramp')
    }
    this.bodyEl.appendChild(pityEl)

    this.renderCraftingInventory()
  }

  private renderCraftingInventory(): void {
    // While a forge is animating, withhold the just-crafted item from the preview so the
    // reveal isn't spoiled. The item is already committed + persisted; it surfaces on finish.
    const forgingId = this.forging?.item.id
    const items = forgingId
      ? this.ctx.crafting.items.filter((it) => it.id !== forgingId)
      : this.ctx.crafting.items
    const groups = groupCraftedItems(items)

    const header = document.createElement('div')
    header.className = 'station-empty'
    header.textContent = items.length === 0
      ? 'Crafted Inventory: empty'
      : `Inventory stacks: ${groups.length} stack${groups.length === 1 ? '' : 's'} (${items.length} items). Press I for details.`
    this.bodyEl.appendChild(header)

    for (const group of groups.slice(0, 4)) {
      const recipe = CRAFTING_RECIPES.find((candidate) => candidate.id === group.recipeId)
      const row = this.rowEl(`${CRAFTING_RARITY_LABELS[group.rarity]} ${group.variant}`, recipe?.name ?? group.recipeId, `x${group.count}`)
      this.decorateCosmeticRow(row, group.recipeId)
      const actions = row.querySelector('.s-actions')!
      const span = document.createElement('span')
      span.className = 'maxed'
      span.textContent = 'STACK'
      actions.appendChild(span)
      this.bodyEl.appendChild(row)
    }
  }

  private renderMarket(): void {
    const canTrade = this.ctx.marketplaceCanTrade()
    const note = document.createElement('div')
    note.className = 'station-empty'
    note.textContent = canTrade
      ? 'Marketplace: trade crafted cosmetics for credits or $CITIZEN. Press I to list your own items.'
      : 'Marketplace: connect a wallet to list, buy, or cancel crafted cosmetics.'
    this.bodyEl.appendChild(note)

    const refreshRow = this.rowEl('Market Listings', 'Server-synced active listings', `${this.ctx.marketplaceRows().length} LIVE`)
    refreshRow.querySelector('.s-actions')!.appendChild(this.btn('Refresh', 'buy', false, () => {
      this.ctx.onRefreshMarketplace()
      this.hint('Refreshing market listings.')
    }))
    this.bodyEl.appendChild(refreshRow)

    const SORT_LABEL: Record<MarketSort, string> = { new: 'Newest', 'price-asc': 'Price ↑', 'price-desc': 'Price ↓' }
    const SORT_NEXT: Record<MarketSort, MarketSort> = { new: 'price-asc', 'price-asc': 'price-desc', 'price-desc': 'new' }
    const CUR_LABEL: Record<CurrencyFilter, string> = { all: 'All', credits: 'Credits', token: '$CITIZEN' }
    const CUR_NEXT: Record<CurrencyFilter, CurrencyFilter> = { all: 'credits', credits: 'token', token: 'all' }
    const controls = document.createElement('div')
    controls.className = 'market-controls'
    const ctl = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.className = 'market-ctl'
      b.textContent = label
      b.addEventListener('click', onClick)
      return b
    }
    controls.append(
      ctl(`Sort: ${SORT_LABEL[this.marketSort]}`, () => { this.marketSort = SORT_NEXT[this.marketSort]; this.render() }),
      ctl(`Show: ${CUR_LABEL[this.marketCurrency]}`, () => { this.marketCurrency = CUR_NEXT[this.marketCurrency]; this.render() }),
    )
    this.bodyEl.appendChild(controls)

    const rows = sortFilterListings(this.ctx.marketplaceRows(), this.marketSort, this.marketCurrency)
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'station-empty'
      empty.textContent = 'No listings match this filter.'
      this.bodyEl.appendChild(empty)
      return
    }

    for (const listing of rows) {
      const rarity = CRAFTING_RARITY_LABELS[listing.item.rarity as keyof typeof CRAFTING_RARITY_LABELS] ?? listing.item.rarity
      const unit = listing.currency === 'token' ? '$CITIZEN' : 'cr'
      const seller = listing.sellerShort ? `Seller ${listing.sellerName} (${listing.sellerShort})` : `Seller ${listing.sellerName}`
      const row = this.rowEl(`${rarity} ${listing.item.variant}`, seller, `${listing.price.toLocaleString()} ${unit}`)
      if (isCraftingCosmeticId(listing.item.recipeId)) this.decorateCosmeticRow(row, listing.item.recipeId)
      row.classList.add('mkt-rarity-' + listing.item.rarity)
      const actions = row.querySelector('.s-actions')!
      if (listing.owned) {
        actions.appendChild(this.btn('Cancel', 'sell', !canTrade, () => this.ctx.onCancelMarketListing(listing.id)))
      } else {
        const tooPoor = listing.currency === 'credits' && listing.price > this.ctx.econ.credits
        actions.appendChild(this.btn('Buy', 'buy', !canTrade || tooPoor, () => this.ctx.onBuyMarketListing(listing.id)))
      }
      this.bodyEl.appendChild(row)
    }
  }

  private renderUpgrades(): void {
    const u = this.ctx.upgrades
    const tracks: [UpgradeTrack, string, string][] = [
      ['cargo', 'Cargo Hold', `${cargoCapacity(u)} units`],
      ['speed', 'Top Speed', `${topSpeed(u)} m/s`],
      ['boost', 'Boost', `${boostMultiplier(u)}×`],
      ['mining', 'Mining Yield', `${miningYield(u)}/s`],
    ]
    for (const [track, name, current] of tracks) {
      const price = nextPrice(u, track)
      const row = this.rowEl(name, current, price === null ? 'MAX' : `${price} cr`)
      const actions = row.querySelector('.s-actions')!
      if (price === null) {
        const span = document.createElement('span')
        span.className = 'maxed'
        span.textContent = 'MAXED'
        actions.appendChild(span)
      } else {
        actions.appendChild(this.btn('Upgrade', 'buy', price > this.ctx.econ.credits, () => this.buyUpgrade(track)))
      }
      this.bodyEl.appendChild(row)
    }
  }

  private renderContracts(): void {
    const here = this.ctx.outpostId
    const visible = this.ctx.contracts.filter((c) => c.status === 'offered' || c.status === 'accepted')
    if (visible.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'station-empty'
      empty.textContent = 'No contracts available right now.'
      this.bodyEl.appendChild(empty)
      return
    }
    for (const c of visible) {
      const toName = OUTPOSTS[c.toId]?.name ?? c.toId
      const label = `Deliver ${c.qty} ${COMMODITIES[c.commodity].name} → ${toName}`
      const row = this.rowEl(label, `${c.reward} cr`, c.status === 'accepted' ? 'ACTIVE' : '')
      const actions = row.querySelector('.s-actions')!
      if (c.status === 'offered') {
        actions.appendChild(this.btn('Accept', 'buy', false, () => this.resolveContract(c, 'accept')))
      } else {
        const canComplete = c.toId === here && this.ctx.econ.cargo[c.commodity] >= c.qty
        actions.appendChild(this.btn('Deliver', 'buy', !canComplete, () => this.resolveContract(c, 'complete')))
        actions.appendChild(this.btn('Drop', 'sell', false, () => this.resolveContract(c, 'abandon')))
      }
      this.bodyEl.appendChild(row)
    }
  }

  private renderShipyard(): void {
    const current = this.ctx.selectedShip()
    const rankIdx = rankForCredits(this.ctx.econ.earned).index
    for (const type of SHIP_TYPES) {
      const s = SHIP_STATS[type]
      const owned = this.ctx.ownedShips.has(type)
      const isCurrent = type === current
      const reqIdx = SHIP_RANK_REQ[type]
      const locked = !owned && rankIdx < reqIdx
      const stats = `cargo ${s.cargo} · spd ${s.topSpeed} · hull ${s.hull}`
      const right = isCurrent ? 'IN USE' : owned ? 'OWNED' : locked ? `🔒 ${RANKS[reqIdx].name}` : `${this.ctx.shipPrices[type]} cr`
      const row = this.rowEl(s.role, stats, right)
      const actions = row.querySelector('.s-actions')!
      if (isCurrent) {
        const span = document.createElement('span')
        span.className = 'maxed'
        span.textContent = 'FLYING'
        actions.appendChild(span)
      } else if (owned) {
        actions.appendChild(this.btn('Fly', 'buy', false, () => {
          this.ctx.onSelectShip(type)
          this.onChange()
          this.render()
        }))
      } else if (locked) {
        const span = document.createElement('span')
        span.className = 'maxed'
        span.textContent = `${RANKS[reqIdx].name} rank`
        actions.appendChild(span)
      } else {
        const price = this.ctx.shipPrices[type]
        actions.appendChild(this.btn('Buy', 'buy', price > this.ctx.econ.credits, () => {
          this.ctx.onBuyShip(type)
          this.ctx.audio.blip('trade')
          this.onChange()
          this.render()
        }))
      }
      this.bodyEl.appendChild(row)
    }
  }

  private renderHangar(): void {
    const tier = this.ctx.holderTier()
    const selected = resolveHolderShipVisual(this.ctx.selectedHolderShipVisual(), tier)
    for (const kit of HOLDER_IDENTITY_KITS) {
      const unlocked = tier >= kit.tier
      const row = this.rowEl(kit.name, kit.description, unlocked ? 'ACTIVE' : `HOLDER T${kit.tier}`)
      const actions = row.querySelector('.s-actions')!
      const span = document.createElement('span')
      span.className = 'maxed'
      span.textContent = unlocked ? 'AUTO' : 'LOCKED'
      actions.appendChild(span)
      this.bodyEl.appendChild(row)
    }
    for (const visual of HOLDER_SHIP_VISUALS) {
      const unlocked = tier >= visual.requiredTier
      const active = selected.id === visual.id
      const row = this.rowEl(visual.name, visual.description, active ? 'ACTIVE' : unlocked ? 'UNLOCKED' : `HOLDER T${visual.requiredTier}`)
      const actions = row.querySelector('.s-actions')!
      if (active) {
        const span = document.createElement('span')
        span.className = 'maxed'
        span.textContent = 'SELECTED'
        actions.appendChild(span)
      } else if (unlocked) {
        actions.appendChild(this.btn('Select', 'buy', false, () => {
          this.ctx.onSelectHolderShipVisual(visual.id)
          this.ctx.audio.blip('trade')
          this.render()
        }))
      } else {
        const span = document.createElement('span')
        span.className = 'maxed'
        span.textContent = 'LOCKED'
        actions.appendChild(span)
      }
      this.bodyEl.appendChild(row)
    }
  }

  private rowEl(name: string, mid: string, right: string): HTMLElement {
    const row = document.createElement('div')
    row.className = 'station-row'
    row.innerHTML = `
      <span class="s-name">${name}</span>
      <span class="s-price">${mid}</span>
      <span class="s-held">${right}</span>
      <span class="s-actions"></span>`
    return row
  }

  private decorateCosmeticRow(row: HTMLElement, recipeId: CraftingCosmeticId): void {
    const slot = cosmeticSlotUi(recipeId)
    row.classList.add('cosmetic-row', slot.className, slot.recipeClassName)
    row.dataset.slot = slot.slot

    const nameEl = row.querySelector('.s-name')!
    const name = nameEl.textContent ?? ''
    nameEl.textContent = ''
    nameEl.classList.add('station-cosmetic-name')
    const thumb = document.createElement('span')
    thumb.className = `station-thumb cosmetic-thumb ${slot.className} ${slot.recipeClassName}`
    thumb.dataset.slot = slot.slot
    thumb.title = slot.description
    thumb.setAttribute('aria-label', slot.description)
    thumb.appendChild(document.createElement('i'))
    const nameText = document.createElement('span')
    nameText.className = 's-name-text'
    nameText.textContent = name
    nameEl.append(thumb, nameText)

    const priceEl = row.querySelector('.s-price')!
    const detail = priceEl.textContent ?? ''
    priceEl.textContent = ''
    priceEl.classList.add('s-price-with-badge')
    const badge = document.createElement('span')
    badge.className = 'cosmetic-slot-badge'
    badge.dataset.slot = slot.slot
    badge.textContent = slot.label
    const detailText = document.createElement('span')
    detailText.textContent = detail
    priceEl.append(badge, detailText)
  }

  private btn(label: string, kind: 'buy' | 'sell', disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.textContent = label
    b.className = kind
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }
}
