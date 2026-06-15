// Quantum travel — Star-Citizen-style fast point-to-point flight.
// Pure logic, deterministic, no DOM, no three.js scene graph (Vector3 math only).
// Tested in quantum.test.ts.
//
// Lifecycle: idle → spooling (charge ~2s, no motion) → traveling
//   (accelerate to a very high cruise speed, fly toward target, decelerate) → idle.
// The ship arrives a SAFE distance short of the target and never overshoots into it.

import { Vector3 } from 'three'

/** Phases of the quantum drive. */
export type QuantumPhase = 'idle' | 'spooling' | 'traveling'

/** Tuning for the quantum drive. All travel feel lives here. */
export const QUANTUM_TUNING = {
  /** Seconds the drive must charge before any motion begins. */
  spoolTime: 2,
  /** Peak cruise speed (m/s) — orders of magnitude above sublight TUNING.maxSpeed. */
  cruiseSpeed: 6000,
  /** Acceleration / deceleration magnitude (m/s²) for the spin-up and braking ramps. */
  accel: 1500,
  /** Drop-out distance (m): travel ends this far short of the target, never inside it. */
  safeRadius: 250,
  /** startTravel rejects targets whose path length is below this (m). */
  minTravelDistance: 600,
}

export interface QuantumState {
  phase: QuantumPhase
  /** Countdown remaining in the spooling phase (s). */
  spoolRemaining: number
  /** World-space destination. */
  target: Vector3
  /** Origin captured at travel start, for progress measurement. */
  origin: Vector3
  /** Total path length (origin → drop-out point) for this trip (m). */
  pathLength: number
  /** Distance already covered along the path (m). */
  traveled: number
  /** Current along-path speed (m/s). */
  speed: number
}

/** A fresh, idle quantum drive. */
export function createQuantum(): QuantumState {
  return {
    phase: 'idle',
    spoolRemaining: 0,
    target: new Vector3(),
    origin: new Vector3(),
    pathLength: 0,
    traveled: 0,
    speed: 0,
  }
}

export type StartResult = { ok: boolean; reason?: string }

const _dir = new Vector3()

/**
 * Begin a quantum jump toward `target`. Captures the destination and enters the
 * spooling phase. Rejects (and stays idle) if the target is closer than
 * `minTravelDistance` — short hops aren't worth a jump and risk arriving inside
 * the safe radius.
 *
 * NOTE: the origin is captured later, on the first traveling step, so the trip
 * measures from wherever the ship actually is when motion begins. `target` is
 * cloned; the caller's vector is never retained.
 */
export function startTravel(q: QuantumState, target: Vector3): StartResult {
  if (q.phase !== 'idle') return { ok: false, reason: 'busy' }
  q.target.copy(target)
  q.phase = 'spooling'
  q.spoolRemaining = QUANTUM_TUNING.spoolTime
  q.traveled = 0
  q.speed = 0
  q.pathLength = 0
  return { ok: true }
}

/** Abort the jump (during spool or travel) and return to idle. */
export function cancelTravel(q: QuantumState): void {
  q.phase = 'idle'
  q.spoolRemaining = 0
  q.traveled = 0
  q.speed = 0
  q.pathLength = 0
}

export interface StepResult {
  phase: QuantumPhase
  /** 0..1 fraction of the path covered (0 while idle/spooling, 1 on arrival). */
  progress: number
}

/**
 * Advance the drive by `dt` seconds.
 *
 * - idle: no-op, progress 0.
 * - spooling: counts the spool timer down with NO motion; on expiry it captures
 *   the origin/path from the live `shipPos`, zeroes `shipVel`, and begins travel.
 *   If the live distance to target has dropped below the safe radius it arrives
 *   immediately rather than overshooting.
 * - traveling: MUTATES `shipPos` along the origin→drop-out path using a
 *   trapezoidal accel/cruise/decel speed profile, and keeps `shipVel` in sync
 *   with the along-path velocity. On arrival the ship is snapped exactly onto
 *   the drop-out point (safe radius short of target), `shipVel` is zeroed, and
 *   the phase flips to idle.
 *
 * Deterministic: identical inputs always yield identical mutations.
 */
export function stepQuantum(
  q: QuantumState, shipPos: Vector3, shipVel: Vector3, dt: number,
): StepResult {
  if (q.phase === 'idle') return { phase: 'idle', progress: 0 }

  if (q.phase === 'spooling') {
    // No motion at all while charging.
    q.spoolRemaining -= dt
    if (q.spoolRemaining > 0) return { phase: 'spooling', progress: 0 }

    // Spool complete: lock in the trip from the ship's current position.
    q.origin.copy(shipPos)
    _dir.copy(q.target).sub(shipPos)
    const distToTarget = _dir.length()
    // Drop out `safeRadius` short of the target so we never arrive inside it.
    q.pathLength = Math.max(0, distToTarget - QUANTUM_TUNING.safeRadius)
    q.traveled = 0
    q.speed = 0
    shipVel.set(0, 0, 0)

    if (q.pathLength <= 1e-6) {
      // Already at (or inside the safe radius of) the target — finish at once.
      _finishAtDropout(q, shipPos)
      shipVel.set(0, 0, 0)
      return { phase: 'idle', progress: 1 }
    }
    q.phase = 'traveling'
    // fall through into the traveling step so this frame makes progress
  }

  // --- traveling ---
  // Trapezoidal profile: ramp up at `accel`, cruise at `cruiseSpeed`, ramp down
  // so we hit zero speed exactly at the path end. Remaining-distance braking
  // guarantees we never overshoot the drop-out point.
  const { accel, cruiseSpeed } = QUANTUM_TUNING
  const remaining = q.pathLength - q.traveled

  // Speed cap from braking distance: v <= sqrt(2 * accel * remaining).
  const brakeCap = Math.sqrt(2 * accel * Math.max(0, remaining))
  // Accelerate toward cruise, but never above the brake cap.
  q.speed = Math.min(q.speed + accel * dt, cruiseSpeed, brakeCap)
  if (q.speed < 0) q.speed = 0

  let stepDist = q.speed * dt
  if (stepDist >= remaining) {
    // Arrive this frame: snap onto the drop-out point, stop, go idle.
    _finishAtDropout(q, shipPos)
    shipVel.set(0, 0, 0)
    return { phase: 'idle', progress: 1 }
  }

  q.traveled += stepDist
  // Position = origin + dir * traveled.
  _dir.copy(q.target).sub(q.origin).normalize()
  shipPos.copy(q.origin).addScaledVector(_dir, q.traveled)
  shipVel.copy(_dir).multiplyScalar(q.speed)

  return { phase: 'traveling', progress: q.pathLength > 0 ? q.traveled / q.pathLength : 1 }
}

/** Place the ship exactly on the drop-out point and reset the drive to idle. */
function _finishAtDropout(q: QuantumState, shipPos: Vector3): void {
  if (q.pathLength > 1e-6) {
    _dir.copy(q.target).sub(q.origin).normalize()
    shipPos.copy(q.origin).addScaledVector(_dir, q.pathLength)
  }
  q.traveled = q.pathLength
  q.speed = 0
  q.phase = 'idle'
  q.spoolRemaining = 0
}
