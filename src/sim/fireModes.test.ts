import { describe, it, expect } from 'vitest'
import { FIRE_MODES, modeById, cycleMode, resolveShot, type FireModeId } from './fireModes'

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
