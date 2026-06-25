import { PVP_ARENA_DESTINATIONS, CITIZEN_SEASON_HUB_DESTINATION } from '../sim/pvp'
import type { SolarMapNavigationTarget } from './solarSystemMap'

/**
 * The named quantum destinations to draw on the atlas, as map nav targets. On mobile companion only
 * the Citizen Season Hub is reachable (matching setQuantumDestinationFromAtlas's gate), so the rest are
 * omitted — drawing them would only produce markers a click would reject. `worldPosition` is cloned so
 * callers can offset it freely without mutating the source destinations.
 */
export function landmarkTargets(isMobile: boolean): SolarMapNavigationTarget[] {
  const source = isMobile
    ? PVP_ARENA_DESTINATIONS.filter((d) => d.id === CITIZEN_SEASON_HUB_DESTINATION.id)
    : PVP_ARENA_DESTINATIONS
  return source.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    worldPosition: d.position.clone(),
    radius: d.radius,
  }))
}
