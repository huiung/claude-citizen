import type { ShipType } from '../sim/shipTypes'
import { resolveHolderShipVisual, type HolderShipVisualId } from './holderShipVisual'

export interface HudShipIdentity {
  shipClass: string
  visual: string | null
}

export function hudShipIdentity(
  shipType: ShipType,
  selectedVisual: HolderShipVisualId,
  holderTier: number,
): HudShipIdentity {
  const visual = resolveHolderShipVisual(selectedVisual, holderTier)
  return {
    shipClass: shipType.toUpperCase(),
    visual: visual.id === 'standard' ? null : visual.name.toUpperCase(),
  }
}
