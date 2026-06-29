// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FORGE_STAGE_MS, FORGE_STAGES, HOLDER_IDENTITY_KITS, STATION_TABS, StationMenu } from './stationMenu'
import { createEconomy } from '../sim/economy'
import { createMarket } from '../sim/market'
import { createUpgrades } from '../sim/upgrades'
import { createCraftingState, PITY_GUARANTEE, PITY_RAMP_START } from '../sim/crafting'

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

  it('shows cosmetic slot badges and thumbnails on market listings', () => {
    const comet = {
      id: 'c1', sellerName: 'ACE', price: 120000, currency: 'credits' as const, status: 'active' as const, createdAt: 1, updatedAt: 1, owned: false,
      item: { id: 'c1i', recipeId: 'comet-wake-kit', rarity: 'legendary', variant: 'Celestial Comet Wake', createdAt: 1, tradable: true },
    }
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(makeMarketCtx([comet]))
    ;(menu.root.querySelector('[data-tab="market"]') as HTMLButtonElement).click()

    const row = [...menu.root.querySelectorAll('.station-row')]
      .find((candidate) => candidate.textContent?.includes('Celestial Comet Wake'))!
    expect(row.querySelector('.cosmetic-slot-badge')?.textContent).toBe('TRAIL')
    expect(row.querySelector('.station-thumb')?.classList.contains('slot-trail')).toBe(true)
    expect(row.querySelector('.station-thumb')?.classList.contains('recipe-comet-wake-kit')).toBe(true)
    expect(row.textContent).toContain('ACE')
    expect(row.textContent).toContain('120,000 cr')
  })
})

describe('stationMenu contracts copy', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('describes contract quantity as a delivery action instead of an x multiplier', () => {
    const ctx = {
      outpostId: 'colony',
      econ: createEconomy(),
      market: createMarket(),
      crafting: createCraftingState(),
      upgrades: createUpgrades(),
      contracts: [{
        id: 'contract-copy',
        commodity: 'ORE' as const,
        qty: 10,
        fromId: 'colony',
        toId: 'refinery',
        reward: 900,
        status: 'offered' as const,
      }],
      audio: { blip: () => {} } as any,
      capacity: () => 20,
      selectedShip: () => 'hauler' as const,
      ownedShips: new Set(['hauler'] as const),
      shipPrices: { hauler: 0, fighter: 5000, miner: 8000, interceptor: 15000 },
      onBuyShip: () => {},
      onSelectShip: () => {},
      holderTier: () => 0,
      selectedHolderShipVisual: () => 'standard' as const,
      onSelectHolderShipVisual: () => {},
      marketplaceRows: () => [],
      marketplaceCanTrade: () => true,
      onRefreshMarketplace: () => {},
      onBuyMarketListing: () => {},
      onCancelMarketListing: () => {},
    }
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(ctx as any)
    ;(menu.root.querySelector('[data-tab="contracts"]') as HTMLButtonElement).click()

    expect(menu.root.textContent).toContain('Deliver 10 Raw Ore → Meridian Refinery')
    expect(menu.root.textContent).not.toContain('10×')
  })
})

describe('stationMenu casino settle economy', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const CASINO_SPIN_MS = 2600 // mirror StationMenu.CASINO_SPIN_MS (private)

  // rng→number map: floor(rng * 37). 0.03 → number 1 (RED, wins a 'red' bet); 0 → number 0 (GREEN, loses).
  const RNG_RED_WIN = 0.03
  const RNG_GREEN_LOSE = 0

  function mountCasinoMenu(credits: number, onChange: () => void = () => {}) {
    const econ = createEconomy()
    econ.credits = credits
    econ.earned = 0
    const blips: string[] = []
    const ctx = {
      outpostId: 'colony',
      econ,
      market: createMarket(),
      crafting: createCraftingState(),
      upgrades: createUpgrades(),
      contracts: [],
      audio: { blip: (k: string) => blips.push(k) } as any,
      capacity: () => 20,
      selectedShip: () => 'hauler' as const,
      ownedShips: new Set(['hauler'] as const),
      shipPrices: { hauler: 0, fighter: 5000, miner: 8000, interceptor: 15000 },
      onBuyShip: () => {},
      onSelectShip: () => {},
      holderTier: () => 0,
      selectedHolderShipVisual: () => 'standard' as const,
      onSelectHolderShipVisual: () => {},
      marketplaceRows: () => [],
      marketplaceCanTrade: () => true,
      onRefreshMarketplace: () => {},
      onBuyMarketListing: () => {},
      onCancelMarketListing: () => {},
    }
    const menu = new StationMenu({ onChange, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(ctx as any)
    ;(menu.root.querySelector('[data-tab="casino"]') as HTMLButtonElement).click()
    return { menu, ctx, econ, blips, root: menu.root }
  }

  const spinBtn = (root: HTMLElement) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'SPIN' || b.textContent === 'SPINNING…') as HTMLButtonElement
  const chip = (root: HTMLElement, label: string) =>
    [...root.querySelectorAll('.casino-chip')].find((b) => b.textContent === label) as HTMLButtonElement

  it('(a) a winning spin settles once at the reveal; spend is deferred', () => {
    vi.useFakeTimers()
    const rng = vi.spyOn(Math, 'random').mockReturnValue(RNG_RED_WIN)
    try {
      let changes = 0
      const start = 100_000
      const { root, econ } = mountCasinoMenu(start, () => { changes++ })
      chip(root, '10,000').click() // stake 10,000; default bet 'red'
      const stake = 10_000
      spinBtn(root).click()
      // spend deferred: credits unchanged immediately after spin()
      expect(econ.credits).toBe(start)
      expect(changes).toBe(0)
      vi.advanceTimersByTime(CASINO_SPIN_MS)
      // win pays 2× stake: net +stake
      expect(econ.credits).toBe(start - stake + stake * 2)
      expect(changes).toBe(1)
    } finally {
      rng.mockRestore()
      vi.useRealTimers()
    }
  })

  it('(b) a losing spin debits the stake at the reveal; onChange fires once', () => {
    vi.useFakeTimers()
    const rng = vi.spyOn(Math, 'random').mockReturnValue(RNG_GREEN_LOSE)
    try {
      let changes = 0
      const start = 100_000
      const { root, econ } = mountCasinoMenu(start, () => { changes++ })
      chip(root, '10,000').click()
      const stake = 10_000
      spinBtn(root).click()
      expect(econ.credits).toBe(start)
      vi.advanceTimersByTime(CASINO_SPIN_MS)
      expect(econ.credits).toBe(start - stake)
      expect(changes).toBe(1)
    } finally {
      rng.mockRestore()
      vi.useRealTimers()
    }
  })

  it('(c) cancel mid-spin commits exactly once; the reveal timer does not double-settle', () => {
    vi.useFakeTimers()
    const rng = vi.spyOn(Math, 'random').mockReturnValue(RNG_RED_WIN)
    try {
      let changes = 0
      const start = 100_000
      const { menu, root, econ } = mountCasinoMenu(start, () => { changes++ })
      chip(root, '10,000').click()
      const stake = 10_000
      spinBtn(root).click()
      expect(econ.credits).toBe(start)
      // cancelForge() runs on tab switch (and on close/undock); switch tabs before the reveal.
      ;(root.querySelector('[data-tab="trade"]') as HTMLButtonElement).click()
      const afterCancel = econ.credits
      // settled once on cancel: a win commits start - stake + 2*stake
      expect(afterCancel).toBe(start - stake + stake * 2)
      expect(changes).toBe(1)
      // advancing past the reveal timer must not settle again
      vi.advanceTimersByTime(CASINO_SPIN_MS * 2)
      expect(econ.credits).toBe(afterCancel)
      expect(changes).toBe(1)
      // sanity: menu is still usable
      expect(menu.isOpen).toBe(true)
    } finally {
      rng.mockRestore()
      vi.useRealTimers()
    }
  })

  it('(d) gambling never touches lifetime earned (Career)', () => {
    vi.useFakeTimers()
    try {
      // a win first
      const win = vi.spyOn(Math, 'random').mockReturnValue(RNG_RED_WIN)
      const a = mountCasinoMenu(100_000)
      chip(a.root, '10,000').click()
      spinBtn(a.root).click()
      vi.advanceTimersByTime(CASINO_SPIN_MS)
      expect(a.econ.earned).toBe(0)
      win.mockRestore()
      // fresh root: duplicate #ids across two mounts break jsdom's scoped querySelector
      document.body.innerHTML = ''
      // then a loss
      const lose = vi.spyOn(Math, 'random').mockReturnValue(RNG_GREEN_LOSE)
      const b = mountCasinoMenu(100_000)
      chip(b.root, '10,000').click()
      spinBtn(b.root).click()
      vi.advanceTimersByTime(CASINO_SPIN_MS)
      expect(b.econ.earned).toBe(0)
      lose.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('station crafting forge sequence', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  function mountCraftingMenu(credits: number) {
    const econ = createEconomy()
    econ.credits = credits
    const ctx = {
      outpostId: 'colony',
      econ,
      market: createMarket(),
      crafting: createCraftingState(),
      upgrades: createUpgrades(),
      contracts: [],
      audio: { blip: () => {} } as any,
      capacity: () => 20,
      selectedShip: () => 'hauler' as const,
      ownedShips: new Set(['hauler'] as const),
      shipPrices: { hauler: 0, fighter: 5000, miner: 8000, interceptor: 15000 },
      onBuyShip: () => {},
      onSelectShip: () => {},
      holderTier: () => 0,
      selectedHolderShipVisual: () => 'standard' as const,
      onSelectHolderShipVisual: () => {},
      marketplaceRows: () => [],
      marketplaceCanTrade: () => true,
      onRefreshMarketplace: () => {},
      onBuyMarketListing: () => {},
      onCancelMarketListing: () => {},
    }
    const menu = new StationMenu({ onChange() {}, onUndock() {} })
    document.body.appendChild(menu.root)
    menu.open(ctx as any)
    ;(menu.root.querySelector('[data-tab="crafting"]') as HTMLButtonElement).click()
    return { menu, ctx, root: menu.root }
  }

  const craftBtn = (root: HTMLElement) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Craft') as HTMLButtonElement

  it('runs staged forging then reveals the crafted rarity', () => {
    vi.useFakeTimers()
    try {
      const { root } = mountCraftingMenu(100_000)
      craftBtn(root).click()
      expect(root.textContent).toContain('Forging')
      expect(craftBtn(root)!.disabled).toBe(true)
      vi.advanceTimersByTime(FORGE_STAGE_MS * (FORGE_STAGES.length + 1))
      expect(root.textContent).toContain('Forged')
    } finally {
      vi.useRealTimers()
    }
  })

  it('guards against re-entry: a second Craft click while forging does not double-spend', () => {
    vi.useFakeTimers()
    try {
      const { ctx, root } = mountCraftingMenu(100_000)
      craftBtn(root).click()
      expect(ctx.crafting.items.length).toBe(1)
      craftBtn(root).click() // disabled + guarded; must not add another item
      expect(ctx.crafting.items.length).toBe(1)
      vi.advanceTimersByTime(FORGE_STAGE_MS * (FORGE_STAGES.length + 1))
      expect(ctx.crafting.items.length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('withholds the crafted item from the inventory preview until the forge completes', () => {
    vi.useFakeTimers()
    try {
      const { root } = mountCraftingMenu(100_000)
      craftBtn(root).click()
      // mid-forge: the just-crafted item is hidden, so the preview still reads empty
      expect(root.textContent).toContain('Crafted Inventory: empty')
      vi.advanceTimersByTime(FORGE_STAGE_MS * (FORGE_STAGES.length + 1))
      // reveal: the item now appears in the preview
      expect(root.textContent).toContain('Inventory stacks: 1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the pity indicator counting down, with a ramp highlight past the ramp start', () => {
    const { menu, ctx, root } = mountCraftingMenu(0)
    ctx.crafting.pityCount = 3
    ;(menu as any).render()
    expect(root.textContent).toContain(`Epic+ guaranteed in ${PITY_GUARANTEE - 3}`)
    expect(root.textContent).not.toContain('Odds rising')
    ctx.crafting.pityCount = PITY_RAMP_START + 1
    ;(menu as any).render()
    expect(root.textContent).toContain('Odds rising')
  })

  it('shows cosmetic slot badges and thumbnails on craft recipes and inventory stacks', () => {
    const { menu, ctx, root } = mountCraftingMenu(0)
    ctx.crafting.items.push({
      id: 'aura-1',
      recipeId: 'void-runner-kit',
      rarity: 'epic',
      variant: 'Void Runner Eclipse',
      createdAt: 1,
      tradable: true,
    })
    ;(menu as any).render()

    const rows = [...root.querySelectorAll('.station-row')]
    const recipeRow = rows.find((row) => row.textContent?.includes('Void Runner Kit'))!
    const stackRow = rows.find((row) => row.textContent?.includes('Void Runner Eclipse'))!

    expect(recipeRow.querySelector('.cosmetic-slot-badge')?.textContent).toBe('AURA')
    expect(recipeRow.querySelector('.station-thumb')?.classList.contains('slot-aura')).toBe(true)
    expect(stackRow.querySelector('.cosmetic-slot-badge')?.textContent).toBe('AURA')
    expect(stackRow.querySelector('.station-thumb')?.classList.contains('slot-aura')).toBe(true)
  })

  it('cancels the forge when switching station tabs mid-forge', () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const { ctx, root } = mountCraftingMenu(100_000)
      ctx.audio.blip = (k: string) => calls.push(k)
      craftBtn(root).click()                 // forge starts (fires one 'forge')
      const afterStart = calls.length
      ;(root.querySelector('[data-tab="trade"]') as HTMLButtonElement).click()  // switch away
      vi.advanceTimersByTime(FORGE_STAGE_MS * (FORGE_STAGES.length + 1))
      expect(calls.length).toBe(afterStart)  // no further forge blips after switching
    } finally {
      vi.useRealTimers()
    }
  })
})
