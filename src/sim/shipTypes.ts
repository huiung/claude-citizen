// Ship catalog — pure logic, no rendering, no DOM. Tested in shipTypes.test.ts.
// Per-hull stat blocks calibrated to the live game scale: the 'hauler' row mirrors
// today's stock ship (CARGO_CAPACITY from economy, TUNING.maxSpeed / boostMultiplier
// from physics, hull 100). Other hulls trade those same axes off against each other.

import { CARGO_CAPACITY } from './economy'
import { TUNING, type ShipTuningOverride } from './physics'

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
  /** Pitch/yaw rate ceiling in rad/s (same scale as TUNING.maxAngularSpeed). */
  maxAngularSpeed: number
  /** Roll rate ceiling in rad/s (same scale as TUNING.maxRollSpeed). */
  maxRollSpeed: number
  /** Pitch/yaw angular-acceleration budget in rad/s² (same scale as TUNING.angularAccel).
   *
   *  This is the hull's mass as the pilot experiences it, and it is a separate axis from the rate
   *  ceilings on purpose: the ceiling decides how fast a hull can come about once it is up to speed,
   *  this decides how long that takes and — the part that reads as weight — how far the hull keeps
   *  swinging after the stick is released (ω²/2α radians). A low ceiling with a high budget is a
   *  nimble tug; a high ceiling with a low budget is a heavy that eventually gets there. */
  angularAccel: number
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
    topSpeed: TUNING.maxSpeed,        // 95
    boostMultiplier: TUNING.boostMultiplier, // 3.5
    maxAngularSpeed: TUNING.maxAngularSpeed, // 1.7
    maxRollSpeed: TUNING.maxRollSpeed,       // 2.0
    angularAccel: TUNING.angularAccel,       // 3.4 — 0.50 s to full rate, 24° of swing past release
    hull: 100,
    role: 'Cargo Hauler',
    tint: 0xb6c2cc,
  },
  // Fast and agile, but barely carries anything and is fragile.
  fighter: {
    cargo: 6,
    topSpeed: 140,
    boostMultiplier: 5,
    maxAngularSpeed: 2.2,
    maxRollSpeed: 2.7,
    angularAccel: 6.6,  // 0.33 s to full rate
    hull: 70,
    role: 'Strike Fighter',
    tint: 0xd8453a,
  },
  // Big hold, heavy armour, but ponderous and slow off the line.
  miner: {
    cargo: 45,
    topSpeed: 55,
    boostMultiplier: 2.5,
    maxAngularSpeed: 1.2,
    maxRollSpeed: 1.4,
    angularAccel: 1.5,  // 0.80 s to full rate, 27° of swing past release — the ponderous end
    hull: 160,
    role: 'Mining Rig',
    tint: 0xe0a83c,
  },
  // Aggressive pirate craft — quickest hull, glass jaw, no room for loot.
  interceptor: {
    cargo: 4,
    topSpeed: 160,
    boostMultiplier: 6,
    maxAngularSpeed: 2.4,
    maxRollSpeed: 3.0,
    angularAccel: 8,    // 0.30 s to full rate — snaps round faster than the old shared response did
    hull: 60,
    role: 'Pirate Interceptor',
    tint: 0x6a3f8f,
  },
}

/** All hull types in catalog order. */
export const SHIP_TYPES: ShipType[] = ['hauler', 'fighter', 'miner', 'interceptor']

/** Minimum rank index (see ranks.ts RANKS) required to buy each hull. Hauler is the
 *  stock ship (Cadet); the rest unlock as you climb, so rank gates the lineup. */
export const SHIP_RANK_REQ: Record<ShipType, number> = {
  hauler: 0,      // Cadet
  fighter: 1,     // Ensign
  miner: 2,       // Pilot
  interceptor: 3, // Ace
}

/** Stat block for a hull. */
export function shipStats(type: ShipType): ShipStat {
  return SHIP_STATS[type]
}

/** Handling type for a `ShipTuningOverride`, with the three angular fields required. */
export type ShipHandling = Required<Pick<ShipTuningOverride, 'maxAngularSpeed' | 'maxRollSpeed' | 'angularAccel'>>

/** The handling half of a `ShipTuningOverride` for a hull.
 *
 *  Separate from the speed half because no upgrade tier touches handling — it belongs to the hull, not
 *  the loadout — so there is deliberately no "effective handling" the way there is an effSpeed(). It
 *  exists as a function so every caller that steps a ship gets all three fields; passing two of them
 *  and forgetting `angularAccel` would silently fall back to the hauler's mass. */
export function shipHandling(type: ShipType): ShipHandling {
  const s = SHIP_STATS[type]
  return { maxAngularSpeed: s.maxAngularSpeed, maxRollSpeed: s.maxRollSpeed, angularAccel: s.angularAccel }
}

/** Pitch/yaw rate ceiling in degrees per second, for display. Radians are the physics unit and
 *  meaningless on a shipyard row. */
export function turnRateDegPerSec(type: ShipType): number {
  return Math.round((SHIP_STATS[type].maxAngularSpeed * 180) / Math.PI)
}
