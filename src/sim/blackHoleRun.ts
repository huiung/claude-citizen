// Tracks one dive into the black hole's influence: the smallest center-distance reached, and whether
// the run qualifies for submission on a survived exit. Pure; the flight loop drives it. Unit-tested.
import { TIDAL_RADIUS } from './blackHole'

export interface BlackHoleRun {
  /** True while inside the influence radius on the current run. */
  active: boolean
  /** Smallest center-distance seen this run; Infinity when inactive/unstarted. */
  min: number
}

export function createBlackHoleRun(): BlackHoleRun {
  return { active: false, min: Infinity }
}

/** First crossing into influence: begin a run at the current distance. */
export function enterRun(run: BlackHoleRun, distance: number): void {
  run.active = true
  run.min = distance
}

/** Each frame within influence (and quantum-idle): lower the running minimum. */
export function sampleRun(run: BlackHoleRun, distance: number): void {
  if (run.active && distance < run.min) run.min = distance
}

/**
 * Survived out (left influence alive, or jumped away alive). Returns the distance to SUBMIT (rounded),
 * or null if the run never reached the tidal `gate`. Resets the run either way.
 */
export function exitRunAlive(run: BlackHoleRun, gate: number = TIDAL_RADIUS): number | null {
  const submit = run.active && run.min < gate ? Math.round(run.min) : null
  run.active = false
  run.min = Infinity
  return submit
}

/** Died (horizon / hull zero). Discard the run; no submission. */
export function dieRun(run: BlackHoleRun): void {
  run.active = false
  run.min = Infinity
}
