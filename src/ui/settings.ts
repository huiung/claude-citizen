export interface GameSettings {
  mouseSensitivity: number
  ambientVolume: number
}

export const SETTINGS_STORAGE_KEY = 'scc.settings.v1'
export const DEFAULT_MOUSE_SENSITIVITY = 1
export const MIN_MOUSE_SENSITIVITY = 0.5
export const MAX_MOUSE_SENSITIVITY = 2
export const DEFAULT_AMBIENT_VOLUME = 0.8
export const MIN_AMBIENT_VOLUME = 0
export const MAX_AMBIENT_VOLUME = 1

export function clampMouseSensitivity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MOUSE_SENSITIVITY
  return Math.min(MAX_MOUSE_SENSITIVITY, Math.max(MIN_MOUSE_SENSITIVITY, value))
}

export function formatMouseSensitivity(value: number): string {
  const clamped = clampMouseSensitivity(value)
  return `${(Math.floor(clamped * 100) / 100).toFixed(2)}x`
}

export function applyMouseSensitivity(delta: number, sensitivity: number): number {
  return delta * clampMouseSensitivity(sensitivity)
}

export function clampAmbientVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AMBIENT_VOLUME
  return Math.min(MAX_AMBIENT_VOLUME, Math.max(MIN_AMBIENT_VOLUME, value))
}

export function formatAmbientVolume(value: number): string {
  return `${Math.round(clampAmbientVolume(value) * 100)}%`
}

export function loadGameSettings(storage: Pick<Storage, 'getItem'>): GameSettings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return defaultGameSettings()
    const parsed = JSON.parse(raw) as Partial<GameSettings>
    const mouseSensitivity = isValidMouseSensitivity(parsed.mouseSensitivity)
      ? parsed.mouseSensitivity
      : DEFAULT_MOUSE_SENSITIVITY
    const ambientVolume = isValidAmbientVolume(parsed.ambientVolume)
      ? parsed.ambientVolume
      : DEFAULT_AMBIENT_VOLUME
    return { mouseSensitivity, ambientVolume }
  } catch {
    return defaultGameSettings()
  }
}

export function saveGameSettings(storage: Pick<Storage, 'setItem'>, settings: GameSettings): void {
  const next: GameSettings = {
    mouseSensitivity: clampMouseSensitivity(settings.mouseSensitivity),
    ambientVolume: clampAmbientVolume(settings.ambientVolume),
  }
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage can fail in private mode; the in-memory setting still works for this session.
  }
}

export function defaultGameSettings(): GameSettings {
  return { mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY, ambientVolume: DEFAULT_AMBIENT_VOLUME }
}

function isValidMouseSensitivity(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_MOUSE_SENSITIVITY
    && value <= MAX_MOUSE_SENSITIVITY
}

function isValidAmbientVolume(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_AMBIENT_VOLUME
    && value <= MAX_AMBIENT_VOLUME
}
