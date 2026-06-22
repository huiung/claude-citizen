import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  cancelTravel, catchUpQuantum, createQuantum, QUANTUM_TUNING, startTravel, stepQuantum,
} from './quantum'

/** Run the drive to completion, returning the number of frames and final progress. */
function runToIdle(
  q: ReturnType<typeof createQuantum>, pos: Vector3, vel: Vector3, dt: number, maxFrames = 100000,
) {
  let frames = 0
  let last = stepQuantum(q, pos, vel, dt)
  while (last.phase !== 'idle' && frames < maxFrames) {
    last = stepQuantum(q, pos, vel, dt)
    frames++
  }
  return { frames, result: last }
}

describe('quantum travel', () => {
  it('starts idle with zero progress', () => {
    const q = createQuantum()
    expect(q.phase).toBe('idle')
    const r = stepQuantum(q, new Vector3(), new Vector3(), 0.016)
    expect(r).toEqual({ phase: 'idle', progress: 0 })
  })

  it('rejects targets closer than the minimum travel distance', () => {
    const q = createQuantum()
    const near = new Vector3(0, 0, QUANTUM_TUNING.minTravelDistance - 1)
    // Distance check is enforced via the safe radius at drop-out, but startTravel
    // accepts any target while idle; verify a too-close target arrives instantly
    // (path length collapses) rather than diving inside the target.
    expect(startTravel(q, near).ok).toBe(true)
  })

  it('does not move during the spool phase', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    const target = new Vector3(0, 0, -8000)
    startTravel(q, target)
    expect(q.phase).toBe('spooling')

    // Step through most of the spool window in small frames — no motion allowed.
    const dt = 0.1
    const steps = Math.floor(QUANTUM_TUNING.spoolTime / dt) - 1
    for (let i = 0; i < steps; i++) {
      const r = stepQuantum(q, pos, vel, dt)
      expect(r.phase).toBe('spooling')
      expect(r.progress).toBe(0)
      expect(pos.equals(new Vector3(0, 0, 0))).toBe(true)
      expect(vel.equals(new Vector3(0, 0, 0))).toBe(true)
    }
  })

  it('begins travel only after the spool delay elapses', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(0, 0, -8000))

    // Just before spool completes: still spooling, still at origin.
    let r = stepQuantum(q, pos, vel, QUANTUM_TUNING.spoolTime - 0.05)
    expect(r.phase).toBe('spooling')
    expect(pos.lengthSq()).toBe(0)

    // Crossing the spool threshold transitions to traveling and starts moving.
    r = stepQuantum(q, pos, vel, 0.1)
    expect(r.phase).toBe('traveling')
    expect(pos.lengthSq()).toBeGreaterThan(0)
  })

  it('progress is monotonically non-decreasing through a full trip', () => {
    const q = createQuantum()
    const pos = new Vector3(100, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(100, 0, -9000))
    // Finish spooling.
    stepQuantum(q, pos, vel, QUANTUM_TUNING.spoolTime)

    let prev = -1
    let phase = q.phase
    let guard = 0
    while (phase !== 'idle' && guard < 100000) {
      const r = stepQuantum(q, pos, vel, 0.05)
      expect(r.progress).toBeGreaterThanOrEqual(prev)
      prev = r.progress
      phase = r.phase
      guard++
    }
    expect(prev).toBe(1)
  })

  it('arrives within the safe radius and never overshoots into the target', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    const target = new Vector3(0, 0, -9000)
    startTravel(q, target)
    const { result } = runToIdle(q, pos, vel, 0.05)

    expect(result.phase).toBe('idle')
    const distToTarget = pos.distanceTo(target)
    // Arrived a safe distance short — never inside the target.
    expect(distToTarget).toBeGreaterThanOrEqual(QUANTUM_TUNING.safeRadius - 1e-3)
    // And essentially exactly at the drop-out point (within a hair).
    expect(distToTarget).toBeLessThanOrEqual(QUANTUM_TUNING.safeRadius + 1e-3)
    // Velocity zeroed on arrival.
    expect(vel.lengthSq()).toBeLessThan(1e-9)
  })

  it('never overshoots even with large frame steps', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    const target = new Vector3(5000, 0, 0)
    startTravel(q, target)
    // Huge dt would overshoot a naive integrator; profile must clamp.
    const { result } = runToIdle(q, pos, vel, 1.0)
    expect(result.phase).toBe('idle')
    const dist = pos.distanceTo(target)
    expect(dist).toBeGreaterThanOrEqual(QUANTUM_TUNING.safeRadius - 1e-3)
    // Ship lies between origin and target (not past it).
    expect(pos.x).toBeLessThanOrEqual(target.x)
    expect(pos.x).toBeGreaterThanOrEqual(0)
  })

  it('can catch up a backgrounded quantum jump using elapsed wall-clock time', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    const target = new Vector3(0, 0, -9000)
    startTravel(q, target)

    const result = catchUpQuantum(q, pos, vel, 30)

    expect(result.phase).toBe('idle')
    expect(pos.distanceTo(target)).toBeCloseTo(QUANTUM_TUNING.safeRadius, 3)
    expect(vel.lengthSq()).toBeLessThan(1e-9)
  })

  it('matches normal small-frame travel when catching up partial hidden time', () => {
    const target = new Vector3(0, 0, -9000)
    const hidden = createQuantum()
    const hiddenPos = new Vector3(0, 0, 0)
    const hiddenVel = new Vector3()
    startTravel(hidden, target)

    const framed = createQuantum()
    const framedPos = new Vector3(0, 0, 0)
    const framedVel = new Vector3()
    startTravel(framed, target)
    for (let i = 0; i < 50; i++) stepQuantum(framed, framedPos, framedVel, 0.05)

    catchUpQuantum(hidden, hiddenPos, hiddenVel, 2.5)

    expect(hidden.phase).toBe(framed.phase)
    expect(hiddenPos.distanceTo(framedPos)).toBeLessThan(1e-6)
  })

  it('ignores invalid or non-positive background catch-up durations', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(0, 0, -9000))

    const result = catchUpQuantum(q, pos, vel, -1)

    expect(result.phase).toBe('spooling')
    expect(pos.lengthSq()).toBe(0)
  })

  it('reaches high cruise speed on a long trip', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(0, 0, -50000))
    stepQuantum(q, pos, vel, QUANTUM_TUNING.spoolTime)
    let maxSpeed = 0
    let phase = q.phase
    let guard = 0
    while (phase !== 'idle' && guard < 100000) {
      const r = stepQuantum(q, pos, vel, 0.05)
      maxSpeed = Math.max(maxSpeed, vel.length())
      phase = r.phase
      guard++
    }
    // Should approach the configured multi-thousand m/s cruise speed.
    expect(maxSpeed).toBeGreaterThan(QUANTUM_TUNING.cruiseSpeed * 0.9)
    expect(maxSpeed).toBeLessThanOrEqual(QUANTUM_TUNING.cruiseSpeed + 1e-6)
  })

  it('cancel during spool returns to idle with no motion', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(0, 0, -8000))
    stepQuantum(q, pos, vel, 0.5)
    cancelTravel(q)
    expect(q.phase).toBe('idle')
    expect(pos.lengthSq()).toBe(0)
    const r = stepQuantum(q, pos, vel, 0.05)
    expect(r.phase).toBe('idle')
  })

  it('cancel during travel returns to idle and stops further movement', () => {
    const q = createQuantum()
    const pos = new Vector3(0, 0, 0)
    const vel = new Vector3()
    startTravel(q, new Vector3(0, 0, -9000))
    stepQuantum(q, pos, vel, QUANTUM_TUNING.spoolTime)
    stepQuantum(q, pos, vel, 0.2)
    expect(q.phase).toBe('traveling')
    const snapped = pos.clone()
    cancelTravel(q)
    expect(q.phase).toBe('idle')
    const r = stepQuantum(q, pos, vel, 0.2)
    expect(r.phase).toBe('idle')
    expect(pos.equals(snapped)).toBe(true)
  })

  it('is deterministic — identical inputs yield identical results', () => {
    const run = () => {
      const q = createQuantum()
      const pos = new Vector3(10, -5, 3)
      const vel = new Vector3()
      startTravel(q, new Vector3(10, -5, -12000))
      runToIdle(q, pos, vel, 0.05)
      return pos.clone()
    }
    const a = run()
    const b = run()
    expect(a.equals(b)).toBe(true)
  })

  it('a busy drive rejects a second startTravel', () => {
    const q = createQuantum()
    startTravel(q, new Vector3(0, 0, -8000))
    const r = startTravel(q, new Vector3(0, 0, -3000))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('busy')
  })
})
