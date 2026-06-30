import { describe, it, expect } from 'vitest'
import { FIRE_MODES, modeById, cycleMode, resolveShot, rescaleCooldown, type FireModeId } from './fireModes'

describe('rescaleCooldown', () => {
  it('stretches the remaining cooldown when switching to a slower mode (rapid→heavy)', () => {
    // fired RAPID (intervalMul 1), 0.16s on the clock; switch to HEAVY (intervalMul 2.2)
    expect(rescaleCooldown(0.16, 1, 2.2)).toBeCloseTo(0.352, 6)
  })
  it('shrinks the remaining cooldown when switching to a faster mode (heavy→rapid)', () => {
    expect(rescaleCooldown(0.352, 2.2, 1)).toBeCloseTo(0.16, 6)
  })
  it('preserves the elapsed fraction of the gap', () => {
    // 25% elapsed of a rapid gap → still 25% elapsed of the heavy gap after the swap
    const remaining = 0.16 * 0.75
    expect(rescaleCooldown(remaining, 1, 2.2)).toBeCloseTo(0.352 * 0.75, 6)
  })
  it('is a no-op when not on cooldown or given a zero/negative prev mul', () => {
    expect(rescaleCooldown(0, 1, 2.2)).toBe(0)
    expect(rescaleCooldown(-0.1, 1, 2.2)).toBe(-0.1)
    expect(rescaleCooldown(0.16, 0, 2.2)).toBe(0.16)
  })
})

describe('FIRE_MODES', () => {
  it('has exactly rapid, heavy, scatter in order', () => {
    expect(FIRE_MODES.map((m) => m.id)).toEqual(['rapid', 'heavy', 'scatter'])
  })

  it('every mode has equal nominal DPS (pellets * damageMul / intervalMul ≈ 1)', () => {
    for (const m of FIRE_MODES) {
      const dps = (m.pellets * m.damageMul) / m.intervalMul
      expect(dps).toBeCloseTo(1, 5)
    }
  })

  it('rapid is the identity profile', () => {
    const r = modeById('rapid')
    expect(r).toMatchObject({ intervalMul: 1, damageMul: 1, pellets: 1, spreadRad: 0, speedMul: 1 })
  })

  it('scatter fires multiple pellets in a cone; heavy is a single un-spread bolt', () => {
    expect(modeById('scatter').pellets).toBeGreaterThan(1)
    expect(modeById('scatter').spreadRad).toBeGreaterThan(0)
    expect(modeById('heavy').pellets).toBe(1)
    expect(modeById('heavy').spreadRad).toBe(0)
  })
})

describe('modeById', () => {
  it('returns the matching mode', () => {
    expect(modeById('heavy').id).toBe('heavy')
  })
  it('falls back to rapid for an unknown id', () => {
    expect(modeById('nonsense' as FireModeId).id).toBe('rapid')
  })
})

describe('cycleMode', () => {
  it('cycles forward with wrap', () => {
    expect(cycleMode('rapid', 1)).toBe('heavy')
    expect(cycleMode('heavy', 1)).toBe('scatter')
    expect(cycleMode('scatter', 1)).toBe('rapid')
  })
  it('cycles backward with wrap', () => {
    expect(cycleMode('rapid', -1)).toBe('scatter')
    expect(cycleMode('scatter', -1)).toBe('heavy')
  })
})

describe('resolveShot', () => {
  const base = { interval: 0.16, damage: 12, speed: 1400 }
  it('scales interval, damage, speed by the mode and carries pellets/spread', () => {
    const heavy = resolveShot(base, modeById('heavy'))
    expect(heavy.interval).toBeCloseTo(0.16 * 2.2, 6)
    expect(heavy.damage).toBeCloseTo(12 * 2.2, 6)
    expect(heavy.speed).toBeCloseTo(1400 * 1.25, 6)
    expect(heavy.pellets).toBe(1)
    expect(heavy.spreadRad).toBe(0)
  })
  it('rapid resolves to the base weapon unchanged', () => {
    const r = resolveShot(base, modeById('rapid'))
    expect(r).toEqual({ interval: 0.16, damage: 12, speed: 1400, pellets: 1, spreadRad: 0 })
  })
})

import { Vector3 } from 'three'
import { spreadDirections } from './fireModes'

describe('spreadDirections', () => {
  const fwd = new Vector3(0, 0, -1)
  const rng = () => 0.5 // deterministic

  it('single pellet returns the normalized forward exactly', () => {
    const dirs = spreadDirections(fwd, 1, 0.07, rng)
    expect(dirs).toHaveLength(1)
    expect(dirs[0].x).toBeCloseTo(0, 6)
    expect(dirs[0].y).toBeCloseTo(0, 6)
    expect(dirs[0].z).toBeCloseTo(-1, 6)
  })

  it('returns exactly `pellets` unit vectors', () => {
    const dirs = spreadDirections(fwd, 4, 0.07, rng)
    expect(dirs).toHaveLength(4)
    for (const d of dirs) expect(d.length()).toBeCloseTo(1, 5)
  })

  it('every pellet lies within spreadRad of forward', () => {
    const spreadRad = 0.07
    const dirs = spreadDirections(fwd, 4, spreadRad, rng)
    for (const d of dirs) {
      const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(fwd))))
      expect(angle).toBeLessThanOrEqual(spreadRad + 1e-6)
    }
  })

  it('is deterministic for a fixed rng', () => {
    const a = spreadDirections(fwd, 4, 0.07, () => 0.3)
    const b = spreadDirections(fwd, 4, 0.07, () => 0.3)
    expect(a.map((v) => [v.x, v.y, v.z])).toEqual(b.map((v) => [v.x, v.y, v.z]))
  })

  it('works for a non-axis-aligned forward (still unit, still within cone)', () => {
    const f = new Vector3(1, 2, -3).normalize()
    const dirs = spreadDirections(f, 4, 0.07, rng)
    for (const d of dirs) {
      expect(d.length()).toBeCloseTo(1, 5)
      const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(f))))
      expect(angle).toBeLessThanOrEqual(0.07 + 1e-6)
    }
  })

  it('handles forward aligned with ±Y (degenerate basis) — finite unit vectors within the cone', () => {
    for (const f of [new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0.999, 0.001).normalize()]) {
      const dirs = spreadDirections(f, 4, 0.07, () => 0.5)
      expect(dirs).toHaveLength(4)
      for (const d of dirs) {
        expect(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)).toBe(true)
        expect(d.length()).toBeCloseTo(1, 5)
        const fn = f.clone().normalize()
        const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(fn))))
        expect(angle).toBeLessThanOrEqual(0.07 + 1e-6)
      }
    }
  })
})
