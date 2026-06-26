import { describe, expect, it } from 'vitest'
import {
  holderShipVisualById,
  holderShipVisualsForTier,
  loadHolderShipVisual,
  resolveHolderShipVisual,
  saveHolderShipVisual,
} from './holderShipVisual'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('holder ship visuals', () => {
  it('unlocks meme and premium holder hulls by tier', () => {
    expect(holderShipVisualsForTier(0).map((visual) => visual.id)).toEqual(['standard'])
    expect(holderShipVisualsForTier(1).map((visual) => visual.id)).toEqual(['standard'])
    expect(holderShipVisualsForTier(2).map((visual) => visual.id)).toEqual(['standard', 'doge-runner'])
    expect(holderShipVisualsForTier(3).map((visual) => visual.id)).toEqual([
      'standard',
      'doge-runner',
      'void-interceptor',
      'sovereign-wraith',
      'eclipse-corvette',
      'abyssal-driller',
    ])
  })

  it('falls back to the standard hull when a saved visual is locked', () => {
    expect(resolveHolderShipVisual('doge-runner', 0).id).toBe('standard')
    expect(resolveHolderShipVisual('doge-runner', 1).id).toBe('standard')
    expect(resolveHolderShipVisual('doge-runner', 2).id).toBe('doge-runner')
    expect(resolveHolderShipVisual('void-interceptor', 2).id).toBe('standard')
    expect(resolveHolderShipVisual('void-interceptor', 3).id).toBe('void-interceptor')
    expect(resolveHolderShipVisual('sovereign-wraith', 2).id).toBe('standard')
    expect(resolveHolderShipVisual('sovereign-wraith', 3).id).toBe('sovereign-wraith')
    expect(resolveHolderShipVisual('eclipse-corvette', 2).id).toBe('standard')
    expect(resolveHolderShipVisual('eclipse-corvette', 3).id).toBe('eclipse-corvette')
    expect(resolveHolderShipVisual('abyssal-driller', 2).id).toBe('standard')
    expect(resolveHolderShipVisual('abyssal-driller', 3).id).toBe('abyssal-driller')
    expect(resolveHolderShipVisual('missing', 3).id).toBe('standard')
  })

  it('persists only known ship visual ids', () => {
    const storage = new MemoryStorage()

    saveHolderShipVisual(storage, 'doge-runner')
    expect(loadHolderShipVisual(storage)).toBe('doge-runner')

    saveHolderShipVisual(storage, 'void-interceptor')
    expect(loadHolderShipVisual(storage)).toBe('void-interceptor')

    saveHolderShipVisual(storage, 'sovereign-wraith')
    expect(loadHolderShipVisual(storage)).toBe('sovereign-wraith')

    saveHolderShipVisual(storage, 'eclipse-corvette')
    expect(loadHolderShipVisual(storage)).toBe('eclipse-corvette')

    saveHolderShipVisual(storage, 'abyssal-driller')
    expect(loadHolderShipVisual(storage)).toBe('abyssal-driller')

    storage.setItem('scc.holderShipVisual.v1', 'not-real')
    expect(loadHolderShipVisual(storage)).toBe('standard')
    expect(holderShipVisualById('not-real')).toBeNull()
  })

  it('presents the doge runner as a premium racing hull', () => {
    expect(holderShipVisualById('doge-runner')).toMatchObject({
      name: 'Doge Runner Mk II',
      description: 'T2 holder-only gold racing hull. Stats stay unchanged.',
    })
  })

  it('presents the sovereign wraith as a T3 heavy prestige hull', () => {
    expect(holderShipVisualById('sovereign-wraith')).toMatchObject({
      name: 'Sovereign Wraith',
      description: 'T3 holder-only sovereign heavy fighter. Stats stay unchanged.',
    })
  })

  it('presents the eclipse corvette as a T3 command ship visual', () => {
    expect(holderShipVisualById('eclipse-corvette')).toMatchObject({
      name: 'Eclipse Corvette',
      description: 'T3 holder-only command ship hull. Stats stay unchanged.',
      requiredTier: 3,
    })
  })

  it('presents the deep core mining ring as a T3 prestige miner visual', () => {
    expect(holderShipVisualById('abyssal-driller')).toMatchObject({
      name: 'Deep Core Mining Ring',
      description: 'T3 holder-only oversized deep-core mining rig. Stats stay unchanged.',
      requiredTier: 3,
    })
  })
})
