import {
  buy, CARGO_CAPACITY, cargoFree, cargoUsed, COMMODITIES, type CommodityId,
  type Outpost, type PlayerEconomy, sell,
} from '../sim/economy'

const COMMODITY_ORDER: CommodityId[] = ['ORE', 'ALLOY']

/**
 * A self-contained docking trade screen. Built from the DOM, no framework.
 * Open it when docked; it calls back when the player undocks.
 */
export class TradePanel {
  readonly root: HTMLElement
  private outpost!: Outpost
  private econ!: PlayerEconomy
  private onChange: () => void
  private onUndock: () => void
  private bodyEl!: HTMLElement
  private creditsEl!: HTMLElement
  private cargoEl!: HTMLElement
  private flash: ReturnType<typeof setTimeout> | null = null

  constructor(opts: { onChange: () => void; onUndock: () => void }) {
    this.onChange = opts.onChange
    this.onUndock = opts.onUndock
    this.root = document.createElement('div')
    this.root.id = 'trade'
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="trade-card">
        <div class="trade-head">
          <h2 id="trade-name">OUTPOST</h2>
          <button id="trade-undock">UNDOCK ▸</button>
        </div>
        <div class="trade-stats">
          <span>CREDITS <b id="trade-credits">0</b></span>
          <span>CARGO <b id="trade-cargo">0/0</b></span>
        </div>
        <div id="trade-body"></div>
        <div class="trade-hint" id="trade-hint">Buy low here, sell high at the other outpost.</div>
      </div>`
    this.bodyEl = this.root.querySelector('#trade-body')!
    this.creditsEl = this.root.querySelector('#trade-credits')!
    this.cargoEl = this.root.querySelector('#trade-cargo')!
    this.root.querySelector('#trade-undock')!.addEventListener('click', () => this.onUndock())
    document.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.code === 'Escape') this.onUndock()
    })
  }

  open(outpost: Outpost, econ: PlayerEconomy): void {
    this.outpost = outpost
    this.econ = econ
    this.root.querySelector('#trade-name')!.textContent = outpost.name
    this.root.hidden = false
    this.render()
  }

  close(): void {
    this.root.hidden = true
  }

  get isOpen(): boolean {
    return !this.root.hidden
  }

  private hint(msg: string): void {
    const el = this.root.querySelector('#trade-hint') as HTMLElement
    el.textContent = msg
    el.classList.add('flash')
    if (this.flash) clearTimeout(this.flash)
    this.flash = setTimeout(() => {
      el.classList.remove('flash')
      el.textContent = 'Buy low here, sell high at the other outpost.'
    }, 1800)
  }

  private trade(kind: 'buy' | 'sell', id: CommodityId, qty: number): void {
    const fn = kind === 'buy' ? buy : sell
    const r = fn(this.econ, this.outpost, id, qty)
    if (!r.ok) {
      const msg: Record<string, string> = {
        'no-credits': 'Not enough credits.',
        'no-cargo-space': 'Cargo hold full.',
        'no-stock': "You don't have that to sell.",
        'bad-qty': 'Invalid amount.',
      }
      this.hint(msg[r.reason])
      return
    }
    this.onChange()
    this.render()
  }

  private render(): void {
    this.creditsEl.textContent = String(this.econ.credits)
    this.cargoEl.textContent = `${cargoUsed(this.econ)}/${CARGO_CAPACITY}`
    this.bodyEl.innerHTML = ''
    for (const id of COMMODITY_ORDER) {
      const price = this.outpost.prices[id]
      const held = this.econ.cargo[id]
      const row = document.createElement('div')
      row.className = 'trade-row'
      row.innerHTML = `
        <span class="c-name">${COMMODITIES[id].name}</span>
        <span class="c-price">${price} cr</span>
        <span class="c-held">×${held}</span>
        <span class="c-actions"></span>`
      const actions = row.querySelector('.c-actions')!
      for (const [label, kind, qty] of [
        ['Buy 1', 'buy', 1], ['Buy 5', 'buy', 5], ['Sell 1', 'sell', 1], ['Sell all', 'sell', held],
      ] as [string, 'buy' | 'sell', number][]) {
        const btn = document.createElement('button')
        btn.textContent = label
        btn.className = kind
        const disabled =
          (kind === 'buy' && (price * qty > this.econ.credits || qty > cargoFree(this.econ))) ||
          (kind === 'sell' && held < Math.max(1, qty))
        btn.disabled = disabled
        btn.addEventListener('click', () => this.trade(kind, id, Math.max(1, qty)))
        actions.appendChild(btn)
      }
      this.bodyEl.appendChild(row)
    }
  }
}
