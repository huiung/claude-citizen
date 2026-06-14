import { Vector3 } from 'three'

export const DOCK_RANGE = 200      // metres
export const DOCK_MAX_SPEED = 18   // m/s — must slow down to dock

export interface DockTarget {
  id: string
  position: Vector3
}

/**
 * Returns the id of the outpost the ship may dock with, or null.
 * Dockable = within range AND moving slowly enough. Nearest wins on ties.
 */
export function dockableTarget(
  shipPos: Vector3,
  shipSpeed: number,
  targets: DockTarget[],
): string | null {
  if (shipSpeed > DOCK_MAX_SPEED) return null
  let best: string | null = null
  let bestDist = DOCK_RANGE
  for (const t of targets) {
    const d = shipPos.distanceTo(t.position)
    if (d <= bestDist) {
      bestDist = d
      best = t.id
    }
  }
  return best
}
