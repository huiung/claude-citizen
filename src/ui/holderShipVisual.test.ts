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
  it('unlocks the void interceptor only for top tier holders', () => {
    expect(holderShipVisualsForTier(0).map((visual) => visual.id)).toEqual(['standard'])
    expect(holderShipVisualsForTier(2).map((visual) => visual.id)).toEqual(['standard'])
    expect(holderShipVisualsForTier(3).map((visual) => visual.id)).toEqual(['standard', 'void-interceptor'])
  })

  it('falls back to the standard hull when a saved visual is locked', () => {
    expect(resolveHolderShipVisual('void-interceptor', 2).id).toBe('standard')
    expect(resolveHolderShipVisual('void-interceptor', 3).id).toBe('void-interceptor')
    expect(resolveHolderShipVisual('missing', 3).id).toBe('standard')
  })

  it('persists only known ship visual ids', () => {
    const storage = new MemoryStorage()

    saveHolderShipVisual(storage, 'void-interceptor')
    expect(loadHolderShipVisual(storage)).toBe('void-interceptor')

    storage.setItem('scc.holderShipVisual.v1', 'not-real')
    expect(loadHolderShipVisual(storage)).toBe('standard')
    expect(holderShipVisualById('not-real')).toBeNull()
  })
})
