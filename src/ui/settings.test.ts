import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOUSE_SENSITIVITY,
  applyMouseSensitivity,
  clampMouseSensitivity,
  formatMouseSensitivity,
  loadGameSettings,
  saveGameSettings,
} from './settings'

describe('game settings', () => {
  it('loads default mouse sensitivity when storage is empty or invalid', () => {
    expect(loadGameSettings(new MapStorage()).mouseSensitivity).toBe(DEFAULT_MOUSE_SENSITIVITY)

    const storage = new MapStorage()
    storage.setItem('scc.settings.v1', JSON.stringify({ mouseSensitivity: 99 }))

    expect(loadGameSettings(storage).mouseSensitivity).toBe(DEFAULT_MOUSE_SENSITIVITY)
  })

  it('saves and restores a clamped mouse sensitivity', () => {
    const storage = new MapStorage()

    saveGameSettings(storage, { mouseSensitivity: 1.35 })

    expect(loadGameSettings(storage).mouseSensitivity).toBe(1.35)
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
