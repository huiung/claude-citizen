// Vector3 + landmark imports are used by buildActivity / stepActivity (added in Tasks 3 & 4).
import { Vector3 } from 'three'
import {
  LANDMARKS, STATIONS, RACE_GATES, PVP_ARENA_CENTER,
  BLACK_HOLE_CENTER, BLACK_HOLE_INFLUENCE,
} from './landmarks.mjs'

// World units/sec. Tuned so the bot reads as a lively pilot, not a crawler.
export const SPEEDS = { CRUISE_BASE: 900, BOOST: 3200, APPROACH: 1500, RACE: 2500, WARP: 40000 }

// Weighted activity mix. Tune freely; weights are relative. All weights must be > 0 — a zero weight
// would never be picked by the loop and would silently bias the kinds[last] fallback instead.
export const ACTIVITY_WEIGHTS = {
  cruise: 4,
  'hub-visit': 3,
  'quantum-jump': 2,
  race: 2,
  'pvp-training': 2,
  'black-hole-dive': 1,
}

/** Weighted pick of the next activity, excluding `prevKind` (no immediate repeat). */
export function pickActivity(prevKind, rng) {
  const kinds = Object.keys(ACTIVITY_WEIGHTS).filter((k) => k !== prevKind)
  const total = kinds.reduce((s, k) => s + ACTIVITY_WEIGHTS[k], 0)
  let r = rng() * total
  for (const k of kinds) { r -= ACTIVITY_WEIGHTS[k]; if (r <= 0) return k }
  return kinds[kinds.length - 1]
}
