import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AMBIENT_VOLUME,
  DEFAULT_MOUSE_SENSITIVITY,
  applyMouseSensitivity,
  clampAmbientVolume,
  clampMouseSensitivity,
  formatAmbientVolume,
  formatMouseSensitivity,
  loadGameSettings,
  saveGameSettings,
} from './settings'

describe('game settings', () => {
  it('loads defaults when storage is empty or invalid', () => {
    expect(loadGameSettings(new MapStorage())).toEqual({
      mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
      ambientVolume: DEFAULT_AMBIENT_VOLUME,
    })

    const storage = new MapStorage()
    storage.setItem('scc.settings.v1', JSON.stringify({ mouseSensitivity: 99, ambientVolume: 9 }))

    expect(loadGameSettings(storage)).toEqual({
      mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
      ambientVolume: DEFAULT_AMBIENT_VOLUME,
    })
  })

  it('saves and restores clamped settings', () => {
    const storage = new MapStorage()

    saveGameSettings(storage, { mouseSensitivity: 1.35, ambientVolume: 1.4 })

    expect(loadGameSettings(storage)).toEqual({ mouseSensitivity: 1.35, ambientVolume: 1 })
  })

  it('loads old mouse-only settings with default ambience volume', () => {
    const storage = new MapStorage()
    storage.setItem('scc.settings.v1', JSON.stringify({ mouseSensitivity: 1.25 }))

    expect(loadGameSettings(storage)).toEqual({ mouseSensitivity: 1.25, ambientVolume: DEFAULT_AMBIENT_VOLUME })
  })

  it('clamps and formats mouse sensitivity for the slider UI', () => {
    expect(clampMouseSensitivity(0.1)).toBe(0.5)
    expect(clampMouseSensitivity(3)).toBe(2)
    expect(formatMouseSensitivity(1.255)).toBe('1.25x')
  })

  it('applies sensitivity to raw pointer movement', () => {
    expect(applyMouseSensitivity(10, 0.5)).toBe(5)
    expect(applyMouseSensitivity(10, 2)).toBe(20)
  })

  it('clamps and formats ambient volume for the slider UI', () => {
    expect(clampAmbientVolume(-1)).toBe(0)
    expect(clampAmbientVolume(2)).toBe(1)
    expect(formatAmbientVolume(0.654)).toBe('65%')
  })
})

class MapStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}
