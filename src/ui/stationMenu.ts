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
import type { GameAudio } from '../audio/sound'

const COMMODITY_ORDER: CommodityId[] = ['ORE', 'ALLOY']
type Tab = 'trade' | 'upgrades' | 'contracts' | 'shipyard'

export interface StationContext {
  outpostId: string
  econ: PlayerEconomy
  market: MarketState
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
  private onChange: () => void
  private onUndock: () => void
  private bodyEl!: HTMLElement
  private creditsEl!: HTMLElement
  private cargoEl!: HTMLElement
  private hintEl!: HTMLElement
  private flash: ReturnType<typeof setTimeout> | null = null

  constructor(opts: { onChange: () => void; onUndock: () => void }) {
    this.onChange = opts.onChange
    this.onUndock = opts.onUndock
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
          <button data-tab="trade">TRADE</button>
          <button data-tab="upgrades">UPGRADES</button>
          <button data-tab="shipyard">SHIPYARD</button>
          <button data-tab="contracts">CONTRACTS</button>
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
        this.tab = (btn as HTMLElement).dataset.tab as Tab
        this.render()
      }))
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.code === 'Escape') this.onUndock()
    })
  }

  open(ctx: StationContext): void {
    this.ctx = ctx
    this.root.querySelector('#station-name')!.textContent = OUTPOSTS[ctx.outpostId]?.name ?? 'OUTPOST'
    this.root.hidden = false
    this.tab = 'trade'
    this.render()
  }

  close(): void {
    this.root.hidden = true
  }

  get isOpen(): boolean {
    return !this.root.hidden
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
      case 'upgrades': return 'Spend credits to fly faster and haul more.'
      case 'shipyard': return 'Buy a hull and switch to it. Each trades cargo, speed, and toughness differently.'
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
    else if (this.tab === 'upgrades') this.renderUpgrades()
    else if (this.tab === 'shipyard') this.renderShipyard()
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
      const label = `${c.qty}× ${COMMODITIES[c.commodity].name} → ${toName}`
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

  private btn(label: string, kind: 'buy' | 'sell', disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.textContent = label
    b.className = kind
    b.disabled = disabled
    b.addEventListener('click', onClick)
    return b
  }
}
