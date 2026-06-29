// Vector3 for the orbit/weave vector math. All world coordinates are injected via `world`.
import { Vector3 } from 'three'

// World units/sec. Close-quarters content runs near real flight scale. BOOST stays high because
// black-hole dives need a fast plunge and escape to survive the deep tidal zone.
export const SPEEDS = { CRUISE_BASE: 330, BOOST: 3200, APPROACH: 330, RACE: 330, WARP: 12000 }

// Weighted activity mix. Tune freely; weights are relative.
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

function randRange(rng, min, max) {
  return min + rng() * (max - min)
}

function pickIntro(rng, lines) {
  return lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))]
}

function jitterDirection(baseDir, rng, lateral = 0.34, vertical = 0.16) {
  const side = new Vector3(-baseDir.z, 0, baseDir.x)
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
  side.normalize()
  return baseDir.clone()
    .addScaledVector(side, (rng() - 0.5) * lateral)
    .addScaledVector(new Vector3(0, 1, 0), (rng() - 0.5) * vertical)
    .normalize()
}

function blackHoleDiveProfile(rng) {
  const roll = rng()
  if (roll < 0.14) {
    return {
      diveProfile: 'danger',
      diveDistance: randRange(rng, 6200, 8200),
      skimMs: randRange(rng, 350, 800),
      intro: pickIntro(rng, [
        'Going greedy on the black hole. This may be a terrible idea.',
        'Trying a dangerous black-hole line. If I vanish, pretend it was science.',
        'Pushing close to the event horizon. Keep an eye on the hull.',
      ]),
    }
  }
  if (roll < 0.56) {
    return {
      diveProfile: 'standard',
      diveDistance: randRange(rng, 8200, 11500),
      skimMs: randRange(rng, 650, 1300),
      intro: pickIntro(rng, [
        'Threading the black hole. Watch this.',
        'Taking a measured black-hole dive. Close, but not foolish.',
        'Testing the gravity well line again. Smooth in, smooth out.',
      ]),
    }
  }
  return {
    diveProfile: 'shallow',
    diveDistance: randRange(rng, 11500, 15500),
    skimMs: randRange(rng, 900, 1900),
    intro: pickIntro(rng, [
      'Skimming the black-hole edge this pass.',
      'Keeping this black-hole run tidy. No heroics yet.',
      'Reading the gravity well from the outside edge.',
    ]),
  }
}

/** Build the initial activity object (mutated in place by stepActivity) plus its intro line. */
export function buildActivity(kind, fromPos, rng, nowMs, world) {
  if (!world) throw new Error('buildActivity: world is required')
  switch (kind) {
    case 'cruise': {
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind, phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               cycleMs: randRange(rng, 4500, 6200), boostWindowMs: randRange(rng, 2200, 3800),
               intro: `Setting course for ${lm.name}.` }
    }
    case 'quantum-jump': {
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind, phase: 'spool', target: lm.position.clone(), name: lm.name,
               phaseUntil: nowMs + SPOOL_MS + randRange(rng, 0, 500), intro: `Quantum jump to ${lm.name}. Hold on.` }
    }
    case 'hub-visit': {
      const st = world.stations[Math.floor(rng() * world.stations.length)]
      return { kind, phase: 'approach', center: st.position.clone(), name: st.name,
               target: st.position.clone(), orbitRadius: randRange(rng, 520, 880), orbitHeight: randRange(rng, 80, 220),
               thetaSpeed: randRange(rng, 0.55, 1.1), loiterMs: randRange(rng, 14000, 25000),
               intro: `Pulling in by ${st.name} for a look.` }
    }
    case 'race': {
      const gateTimeoutMs = randRange(rng, 2800, 4400)
      return { kind, phase: 'run', waypoints: world.raceGates.map((g) => g.clone()), index: 0,
               target: world.raceGates[0].clone(), gateTimeoutMs, gateUntil: nowMs + gateTimeoutMs,
               raceSpeed: randRange(rng, SPEEDS.RACE * 0.92, SPEEDS.RACE * 1.08),
               intro: pickIntro(rng, [
                 'Running the hub time trial. Watch the line.',
                 'Trying a cleaner race line through the hub gates.',
                 'Time trial pass. I may clip absolutely nothing this time.',
               ]) }
    }
    case 'black-hole-dive': {
      const dir = new Vector3().subVectors(fromPos, world.blackHoleCenter)
      if (dir.lengthSq() < 1) dir.set(1, 0, 0)
      dir.normalize()
      const profile = blackHoleDiveProfile(rng)
      const diveDir = jitterDirection(dir, rng)
      const escapeDir = jitterDirection(dir, rng, 0.42, 0.2)
      return { kind, phase: 'approach', escapeDir, ...profile,
               target: world.blackHoleCenter.clone().addScaledVector(diveDir, profile.diveDistance),
               intro: profile.intro }
    }
    case 'pvp-training':
      return { kind, phase: 'approach', center: world.pvpArenaCenter.clone(),
               target: world.pvpArenaCenter.clone(), sparMs: randRange(rng, 14000, 28000),
               weaveRadius: randRange(rng, 1000, 1900), weaveHeight: randRange(rng, 320, 720),
               weaveRate: randRange(rng, 0.85, 1.45),
               intro: pickIntro(rng, [
                 'Warming up in the training arena.',
                 'Running a few arena lines. No prizes, just hands.',
                 'Taking the ship through some PvP footwork.',
               ]) }
    case 'wander':
      return { kind, phase: 'drift', center: fromPos.clone(), theta: rng() * Math.PI * 2,
               target: fromPos.clone(), wanderUntil: nowMs + WANDER_MS + rng() * 3000, intro: null }
    default: {
      const lm = farLandmark(fromPos, rng, world.landmarks)
      return { kind: 'cruise', phase: 'fly', target: lm.position.clone(), name: lm.name, t0: nowMs,
               cycleMs: randRange(rng, 4500, 6200), boostWindowMs: randRange(rng, 2200, 3800),
               intro: `Setting course for ${lm.name}.` }
    }
  }
}

const ARRIVE = 1200
const GATE_HIT = 260
const GATE_TIMEOUT_MS = 3500
const LOITER_MS = 20000
const SKIM_MS = 1000
const SPAR_MS = 20000
const WANDER_MS = 5000

/** Advance the activity by one tick. Mutates phase/timers on `a`; returns the steering command. */
export function stepActivity(a, botPos, dtSec, nowMs, world) {
  if (!world) throw new Error('stepActivity: world is required')
  switch (a.kind) {
    case 'cruise': {
      const cyc = (nowMs - a.t0) % (a.cycleMs ?? 5000)
      const speed = cyc < (a.boostWindowMs ?? 3000) ? SPEEDS.BOOST : SPEEDS.CRUISE_BASE
      return { target: a.target, speed, done: botPos.distanceTo(a.target) < ARRIVE }
    }
    case 'quantum-jump': {
      if (a.phase === 'spool') {
        if (nowMs >= a.phaseUntil) { a.phase = 'warp' } else {
          return { target: a.target, speed: 0, done: false }
        }
      }
      return { target: a.target, speed: SPEEDS.WARP, done: botPos.distanceTo(a.target) < ARRIVE }
    }
    case 'hub-visit': {
      if (a.phase === 'approach') {
        if (botPos.distanceTo(a.center) < ARRIVE) { a.phase = 'loiter'; a.loiterUntil = nowMs + (a.loiterMs ?? LOITER_MS); a.theta = 0 }
        return { target: a.center, speed: SPEEDS.APPROACH, done: false }
      }
      a.theta += dtSec * (a.thetaSpeed ?? 0.8)
      const orbit = new Vector3(Math.cos(a.theta) * (a.orbitRadius ?? 600), a.orbitHeight ?? 120, Math.sin(a.theta) * (a.orbitRadius ?? 600)).add(a.center)
      return { target: orbit, speed: SPEEDS.APPROACH, done: nowMs >= a.loiterUntil }
    }
    case 'race': {
      const reached = a.index < a.waypoints.length && botPos.distanceTo(a.waypoints[a.index]) < GATE_HIT
      const stalled = nowMs >= a.gateUntil
      if (reached || stalled) { a.index += 1; a.gateUntil = nowMs + (a.gateTimeoutMs ?? GATE_TIMEOUT_MS) }
      const done = a.index >= a.waypoints.length
      return { target: a.waypoints[Math.min(a.index, a.waypoints.length - 1)], speed: a.raceSpeed ?? SPEEDS.RACE, done }
    }
    case 'black-hole-dive': {
      if (a.phase === 'approach') {
        if (botPos.distanceTo(a.target) < ARRIVE) { a.phase = 'skim'; a.skimUntil = nowMs + (a.skimMs ?? SKIM_MS) }
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
        if (botPos.distanceTo(a.center) < ARRIVE) { a.phase = 'spar'; a.sparUntil = nowMs + (a.sparMs ?? SPAR_MS); a.t = 0 }
        return { target: a.center, speed: SPEEDS.APPROACH, done: false }
      }
      a.t += dtSec * (a.weaveRate ?? 1)
      const radius = a.weaveRadius ?? 1400
      const height = a.weaveHeight ?? 500
      const weave = new Vector3(Math.sin(a.t * 1.3) * radius, Math.sin(a.t * 0.7) * height, Math.cos(a.t * 1.1) * radius).add(a.center)
      return { target: weave, speed: a.raceSpeed ?? SPEEDS.RACE, done: nowMs >= a.sparUntil }
    }
    case 'wander': {
      a.theta += dtSec * 0.5
      const off = new Vector3(Math.cos(a.theta) * 1200, Math.sin(a.theta * 0.6) * 350, Math.sin(a.theta) * 1200)
      return { target: a.center.clone().add(off), speed: SPEEDS.CRUISE_BASE, done: nowMs >= a.wanderUntil }
    }
    default:
      return { target: a.target, speed: SPEEDS.CRUISE_BASE, done: true }
  }
}
