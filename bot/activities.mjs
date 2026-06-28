// Vector3 for the orbit/weave vector math. All world coordinates are injected via `world`.
import { Vector3 } from 'three'

// World units/sec. Close-quarters content (race, arena weave, hub orbit, post-content wander) runs at
// roughly the real flight scale (TUNING.maxSpeed 95 × boost 3.5 ≈ 332) so the bot reads as a pilot
// actually flying the content, not teleporting through it. BOOST stays high — it's only used for the
// black-hole dive's long in-and-out, which has to be a fast plunge to survive the deep tidal zone.
export const SPEEDS = { CRUISE_BASE: 330, BOOST: 3200, APPROACH: 330, RACE: 330, WARP: 12000 }

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

function farLandmark(fromPos, rng, landmarks) {
  if (!landmarks?.length) throw new Error('farLandmark: world.landmarks is empty')
  const far = landmarks.filter((l) => l.position.distanceTo(fromPos) > 5000)
  const options = far.length ? far : landmarks
  return options[Math.floor(rng() * options.length)]
}

const SPOOL_MS = 1200

/** Build the initial activity object (mutated in place by stepActivity) plus its intro line. */
export function buildActivity(kind, fromPos, rng, nowMs, world) {
  if (!world) throw new Error('buildActivity: world is required') // fail fast on a mis-wired caller
  switch (kind) {
    case 'cruise': {
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind, phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               intro: `Setting course for ${lm.name}.` }
    }
    case 'quantum-jump': {
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind, phase: 'spool', target: lm.position.clone(), name: lm.name,
               phaseUntil: nowMs + SPOOL_MS, intro: `Quantum jump to ${lm.name}. Hold on.` }
    }
    case 'hub-visit': {
      const st = world.stations[Math.floor(rng() * world.stations.length)]
      return { kind, phase: 'approach', center: st.position.clone(), name: st.name,
               target: st.position.clone(), intro: `Pulling in by ${st.name} for a look.` }
    }
    case 'race':
      return { kind, phase: 'run', waypoints: world.raceGates.map((g) => g.clone()), index: 0,
               target: world.raceGates[0].clone(), intro: 'Running the hub time trial. Watch the line.' }
    case 'black-hole-dive': {
      const dir = new Vector3().subVectors(fromPos, world.blackHoleCenter)
      if (dir.lengthSq() < 1) dir.set(1, 0, 0)
      dir.normalize()
      return { kind, phase: 'approach', escapeDir: dir.clone(),
               // 9000 from center plunges well inside the 18000 tidal zone (qualifies for the board and
               // reads as a real deep dive). The bot survives because the plunge is fast (BOOST in/out)
               // and the skim is short (SKIM_MS) — see the survival sim in activities.test.mjs.
               target: world.blackHoleCenter.clone().addScaledVector(dir, 9000),
               intro: 'Threading the black hole. Watch this.' }
    }
    case 'pvp-training':
      return { kind, phase: 'approach', center: world.pvpArenaCenter.clone(),
               target: world.pvpArenaCenter.clone(), intro: 'Warming up in the training arena.' }
    case 'wander':
      // A short, slow local loiter around wherever the last activity finished — so the bot lingers and
      // enjoys the spot for a few seconds instead of teleporting off the instant it's done. No intro
      // line (it's a between-beats pause, not a headline activity).
      return { kind, phase: 'drift', center: fromPos.clone(), theta: rng() * Math.PI * 2,
               target: fromPos.clone(), wanderUntil: nowMs + WANDER_MS + rng() * 3000, intro: null }
    default: {
      // Unknown kind → behave exactly like cruise (a far target, never the bot's current spot, so it
      // can't instantly satisfy stepActivity's arrival check and spin-loop transitions).
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind: 'cruise', phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               intro: `Setting course for ${lm.name}.` }
    }
  }
}

const ARRIVE = 1200          // generic arrival radius
const GATE_HIT = 260         // race gate radius (230) + margin
const LOITER_MS = 20000
const SKIM_MS = 1000         // dwell at the dive's deepest point — short, so the deep (9000) dive survives
const SPAR_MS = 20000
const WANDER_MS = 5000       // base local-loiter time after a content piece (+ up to 3s jitter)

/** Advance the activity by one tick. Mutates phase/timers on `a`; returns the steering command. */
export function stepActivity(a, botPos, dtSec, nowMs, world) {
  if (!world) throw new Error('stepActivity: world is required') // fail fast on a mis-wired caller
  switch (a.kind) {
    case 'cruise': {
      const cyc = (nowMs - a.t0) % 5000 // 3s boost / 2s cruise
      const speed = cyc < 3000 ? SPEEDS.BOOST : SPEEDS.CRUISE_BASE
      return { target: a.target, speed, done: botPos.distanceTo(a.target) < ARRIVE }
    }
    case 'quantum-jump': {
      if (a.phase === 'spool') {
        if (nowMs >= a.phaseUntil) { a.phase = 'warp' } else {
          return { target: a.target, speed: 0, done: false } // hold and charge
        }
      }
      return { target: a.target, speed: SPEEDS.WARP, done: botPos.distanceTo(a.target) < ARRIVE }
    }
    case 'hub-visit': {
      if (a.phase === 'approach') {
        if (botPos.distanceTo(a.center) < ARRIVE) { a.phase = 'loiter'; a.loiterUntil = nowMs + LOITER_MS; a.theta = 0 }
        return { target: a.center, speed: SPEEDS.APPROACH, done: false }
      }
      a.theta += dtSec * 0.8 // slow circle around the station
      const orbit = new Vector3(Math.cos(a.theta) * 600, 120, Math.sin(a.theta) * 600).add(a.center)
      return { target: orbit, speed: SPEEDS.APPROACH, done: nowMs >= a.loiterUntil }
    }
    case 'race': {
      if (a.index < a.waypoints.length && botPos.distanceTo(a.waypoints[a.index]) < GATE_HIT) a.index += 1
      const done = a.index >= a.waypoints.length
      return { target: a.waypoints[Math.min(a.index, a.waypoints.length - 1)], speed: SPEEDS.RACE, done }
    }
    case 'black-hole-dive': {
      if (a.phase === 'approach') {
        if (botPos.distanceTo(a.target) < ARRIVE) { a.phase = 'skim'; a.skimUntil = nowMs + SKIM_MS }
        return { target: a.target, speed: SPEEDS.BOOST, done: false }
      }
      if (a.phase === 'skim') {
        if (nowMs >= a.skimUntil) {
          a.phase = 'escape'
          a.escape = world.blackHoleCenter.clone().addScaledVector(a.escapeDir, world.blackHoleInfluence + 8000)
        }
        return { target: a.target, speed: SPEEDS.APPROACH, done: false }
      }
      return { target: a.escape ?? a.target, speed: SPEEDS.BOOST, done: botPos.distanceTo(world.blackHoleCenter) > world.blackHoleInfluence }
    }
    case 'pvp-training': {
      if (a.phase === 'approach') {
        if (botPos.distanceTo(a.center) < ARRIVE) { a.phase = 'spar'; a.sparUntil = nowMs + SPAR_MS; a.t = 0 }
        return { target: a.center, speed: SPEEDS.APPROACH, done: false }
      }
      a.t += dtSec // weave: lissajous figure around the arena center
      const weave = new Vector3(Math.sin(a.t * 1.3) * 1400, Math.sin(a.t * 0.7) * 500, Math.cos(a.t * 1.1) * 1400).add(a.center)
      return { target: weave, speed: SPEEDS.RACE, done: nowMs >= a.sparUntil }
    }
    case 'wander': {
      a.theta += dtSec * 0.5 // slow, lazy local orbit around the spot
      const off = new Vector3(Math.cos(a.theta) * 1200, Math.sin(a.theta * 0.6) * 350, Math.sin(a.theta) * 1200)
      return { target: a.center.clone().add(off), speed: SPEEDS.CRUISE_BASE, done: nowMs >= a.wanderUntil }
    }
    default:
      return { target: a.target, speed: SPEEDS.CRUISE_BASE, done: true }
  }
}
