// Ship catalog — pure logic, no rendering, no DOM. Tested in shipTypes.test.ts.
// Per-hull stat blocks calibrated to the live game scale: the 'hauler' row mirrors
// today's stock ship (CARGO_CAPACITY from economy, TUNING.maxSpeed / boostMultiplier
// from physics, hull 100). Other hulls trade those same axes off against each other.

import { CARGO_CAPACITY } from './economy'
import { TUNING } from './physics'

/** The four flyable hull classes in the catalog. */
export type ShipType = 'hauler' | 'fighter' | 'miner' | 'interceptor'

/** Stat block for one hull. All axes are on the live game scale so any hull can
 *  drop straight into the physics/economy systems via the matching effective fns. */
export interface ShipStat {
  /** Cargo hold capacity in units (same scale as economy CARGO_CAPACITY). */
  cargo: number
  /** Coupled-mode top speed in m/s (same scale as TUNING.maxSpeed). */
  topSpeed: number
  /** Boost speed multiplier (same scale as TUNING.boostMultiplier). */
  boostMultiplier: number
  /** Hull integrity points (stock hauler == 100). */
  hull: number
  /** Short human-facing role label. */
  role: string
  /** Suggested base hull tint (hex) for the shipyard mesh. */
  tint: number
}

// Tier-0 stock hull stats. 'hauler' is pinned to the live constants so an
// un-changed loadout flies exactly as it does today.
export const SHIP_STATS: Record<ShipType, ShipStat> = {
  // Stock workhorse — matches the live game exactly.
  hauler: {
    cargo: CARGO_CAPACITY,            // 20
    topSpeed: TUNING.maxSpeed,        // 80
    boostMultiplier: TUNING.boostMultiplier, // 3.5
    hull: 100,
    role: 'Cargo Hauler',
    tint: 0xb6c2cc,
  },
  // Fast and agile, but barely carries anything and is fragile.
  fighter: {
    cargo: 6,
    topSpeed: 140,
    boostMultiplier: 5,
    hull: 70,
    role: 'Strike Fighter',
    tint: 0xd8453a,
  },
  // Big hold, heavy armour, but ponderous and slow off the line.
  miner: {
    cargo: 45,
    topSpeed: 55,
    boostMultiplier: 2.5,
    hull: 160,
    role: 'Mining Rig',
    tint: 0xe0a83c,
  },
  // Aggressive pirate craft — quickest hull, glass jaw, no room for loot.
  interceptor: {
    cargo: 4,
    topSpeed: 160,
    boostMultiplier: 6,
    hull: 60,
    role: 'Pirate Interceptor',
    tint: 0x6a3f8f,
  },
}

/** All hull types in catalog order. */
export const SHIP_TYPES: ShipType[] = ['hauler', 'fighter', 'miner', 'interceptor']

/** Stat block for a hull. */
export function shipStats(type: ShipType): ShipStat {
  return SHIP_STATS[type]
}
