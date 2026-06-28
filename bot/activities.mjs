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

function farLandmark(fromPos, rng, pool = LANDMARKS) {
  const far = pool.filter((l) => l.position.distanceTo(fromPos) > 5000)
  const options = far.length ? far : pool
  return options[Math.floor(rng() * options.length)]
}

const SPOOL_MS = 1200

/** Build the initial activity object (mutated in place by stepActivity) plus its intro line. */
export function buildActivity(kind, fromPos, rng, nowMs) {
  switch (kind) {
    case 'cruise': {
      const lm = farLandmark(fromPos, rng)
      return { kind, phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               intro: `Setting course for ${lm.name}.` }
    }
    case 'quantum-jump': {
      const lm = farLandmark(fromPos, rng)
      return { kind, phase: 'spool', target: lm.position.clone(), name: lm.name,
               phaseUntil: nowMs + SPOOL_MS, intro: `Quantum jump to ${lm.name}. Hold on.` }
    }
    case 'hub-visit': {
      const st = STATIONS[Math.floor(rng() * STATIONS.length)]
      return { kind, phase: 'approach', center: st.position.clone(), name: st.name,
               target: st.position.clone(), intro: `Pulling in by ${st.name} for a look.` }
    }
    case 'race':
      return { kind, phase: 'run', waypoints: RACE_GATES.map((g) => g.clone()), index: 0,
               target: RACE_GATES[0].clone(), intro: 'Running the hub time trial. Watch the line.' }
    case 'black-hole-dive': {
      const dir = new Vector3().subVectors(fromPos, BLACK_HOLE_CENTER)
      if (dir.lengthSq() < 1) dir.set(1, 0, 0)
      dir.normalize()
      return { kind, phase: 'approach', escapeDir: dir.clone(),
               target: BLACK_HOLE_CENTER.clone().addScaledVector(dir, 20000),
               intro: 'Threading the black hole. Watch this.' }
    }
    case 'pvp-training':
      return { kind, phase: 'approach', center: PVP_ARENA_CENTER.clone(),
               target: PVP_ARENA_CENTER.clone(), intro: 'Warming up in the training arena.' }
    default: {
      // Unknown kind → behave exactly like cruise (a far target, never the bot's current spot, so it
      // can't instantly satisfy stepActivity's arrival check and spin-loop transitions).
      const lm = farLandmark(fromPos, rng)
      return { kind: 'cruise', phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               intro: `Setting course for ${lm.name}.` }
    }
  }
}
