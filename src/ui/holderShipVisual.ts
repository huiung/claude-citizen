export type HolderShipVisualId = 'standard' | 'doge-runner' | 'void-interceptor' | 'sovereign-wraith'

export interface HolderShipVisual {
  id: HolderShipVisualId
  name: string
  description: string
  requiredTier: number
}

export const HOLDER_SHIP_VISUALS: readonly HolderShipVisual[] = [
  {
    id: 'standard',
    name: 'Standard Hull',
    description: 'Use the normal ship hull for your selected craft.',
    requiredTier: 0,
  },
  {
    id: 'doge-runner',
    name: 'Doge Runner Mk II',
    description: 'T2 holder-only gold racing hull. Stats stay unchanged.',
    requiredTier: 2,
  },
  {
    id: 'void-interceptor',
    name: 'Void Interceptor',
    description: 'T3 holder-only visual hull. Stats stay unchanged.',
    requiredTier: 3,
  },
  {
    id: 'sovereign-wraith',
    name: 'Sovereign Wraith',
    description: 'T3 holder-only sovereign heavy fighter. Stats stay unchanged.',
    requiredTier: 3,
  },
] as const

const STORAGE_KEY = 'scc.holderShipVisual.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function holderShipVisualById(id: string | null): HolderShipVisual | null {
  return HOLDER_SHIP_VISUALS.find((visual) => visual.id === id) ?? null
}

export function holderShipVisualsForTier(tier: number): readonly HolderShipVisual[] {
  const t = Math.max(0, Math.floor(tier))
  return HOLDER_SHIP_VISUALS.filter((visual) => visual.requiredTier <= t)
}

export function resolveHolderShipVisual(id: string | null, tier: number): HolderShipVisual {
  const visual = holderShipVisualById(id)
  return visual && visual.requiredTier <= Math.max(0, Math.floor(tier))
    ? visual
    : HOLDER_SHIP_VISUALS[0]
}

export function loadHolderShipVisual(storage: StorageLike): HolderShipVisualId {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    return holderShipVisualById(stored)?.id ?? 'standard'
  } catch {
    return 'standard'
  }
}

export function saveHolderShipVisual(storage: StorageLike, id: HolderShipVisualId): void {
  try {
    storage.setItem(STORAGE_KEY, id)
  } catch {
    // Cosmetic preference only; ignore private-mode/storage failures.
  }
}
