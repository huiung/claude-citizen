import { describe, expect, it } from 'vitest'
import {
  ASSET_BLIP_SPECS,
  BLIP_SPECS,
  clamp,
  ENGINE_FREQ_BOOST,
  ENGINE_FREQ_IDLE,
  ENGINE_FREQ_MAX,
  ENGINE_GAIN_BOOST_MULT,
  ENGINE_GAIN_IDLE,
  ENGINE_GAIN_MAX,
  miningToGain,
  thrustToFrequency,
  thrustToGain,
} from './sound'

describe('clamp', () => {
  it('passes through in-range values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
  it('clamps below and above', () => {
    expect(clamp(-2, 0, 1)).toBe(0)
    expect(clamp(9, 0, 1)).toBe(1)
  })
})

describe('thrustToFrequency', () => {
  it('idles at the idle frequency at zero thrust', () => {
    expect(thrustToFrequency(0)).toBe(ENGINE_FREQ_IDLE)
  })

  it('reaches the max frequency at full thrust (no boost)', () => {
    expect(thrustToFrequency(1)).toBe(ENGINE_FREQ_MAX)
  })

  it('boost lifts the ceiling at full thrust', () => {
    expect(thrustToFrequency(1, true)).toBe(ENGINE_FREQ_MAX + ENGINE_FREQ_BOOST)
    expect(thrustToFrequency(1, true)).toBeGreaterThan(thrustToFrequency(1, false))
  })

  it('increases monotonically with thrust', () => {
    expect(thrustToFrequency(0.25)).toBeLessThan(thrustToFrequency(0.75))
  })

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(thrustToFrequency(-5)).toBe(ENGINE_FREQ_IDLE)
    expect(thrustToFrequency(5)).toBe(ENGINE_FREQ_MAX)
    expect(Number.isFinite(thrustToFrequency(NaN))).toBe(true)
  })
})

describe('thrustToGain', () => {
  it('idles quiet but audible at zero thrust', () => {
    expect(thrustToGain(0)).toBe(ENGINE_GAIN_IDLE)
    expect(thrustToGain(0)).toBeGreaterThan(0)
  })

  it('reaches max gain at full thrust without boost', () => {
    expect(thrustToGain(1)).toBe(ENGINE_GAIN_MAX)
  })

  it('boost multiplies the gain', () => {
    expect(thrustToGain(1, true)).toBeCloseTo(ENGINE_GAIN_MAX * ENGINE_GAIN_BOOST_MULT)
    expect(thrustToGain(0.5, true)).toBeGreaterThan(thrustToGain(0.5, false))
  })

  it('increases monotonically with thrust', () => {
    expect(thrustToGain(0.2)).toBeLessThan(thrustToGain(0.8))
  })

  it('clamps out-of-range input', () => {
    expect(thrustToGain(-1)).toBe(ENGINE_GAIN_IDLE)
    expect(thrustToGain(2)).toBe(ENGINE_GAIN_MAX)
  })
})

describe('BLIP_SPECS', () => {
  it('defines all three cue kinds with sane, finite tone data', () => {
    for (const kind of ['dock', 'trade', 'error'] as const) {
      const spec = BLIP_SPECS[kind]
      expect(spec.dur).toBeGreaterThan(0)
      expect(spec.peak).toBeGreaterThan(0)
      expect(Number.isFinite(spec.from)).toBe(true)
      expect(Number.isFinite(spec.to)).toBe(true)
    }
  })

  it('error cue descends in pitch, dock cue rises', () => {
    expect(BLIP_SPECS.error.to).toBeLessThan(BLIP_SPECS.error.from)
    expect(BLIP_SPECS.dock.to).toBeGreaterThan(BLIP_SPECS.dock.from)
  })
})

describe('ASSET_BLIP_SPECS', () => {
  it('uses CC0 asset cues for short events while leaving trade synthetic', () => {
    expect(Object.keys(ASSET_BLIP_SPECS).sort()).toEqual(['dock', 'error', 'explosion', 'fire', 'hit'])
    expect(ASSET_BLIP_SPECS).not.toHaveProperty('trade')
  })

  it('keeps every asset cue on public Kenney OGG paths with conservative gain', () => {
    for (const spec of Object.values(ASSET_BLIP_SPECS)) {
      expect(spec.variants.length).toBeGreaterThan(0)
      expect(spec.gain).toBeGreaterThan(0)
      expect(spec.gain).toBeLessThanOrEqual(0.75)
      for (const path of spec.variants) {
        expect(path.startsWith('/audio/kenney-sci-fi/')).toBe(true)
        expect(path.endsWith('.ogg')).toBe(true)
      }
    }
  })

  it('keeps an oscillator fallback for every asset-backed cue', () => {
    for (const kind of Object.keys(ASSET_BLIP_SPECS)) {
      expect(BLIP_SPECS).toHaveProperty(kind)
    }
  })
})

describe('mining audio shaping', () => {
  it('only gives a quiet gain while actively mining something in range', () => {
    const activeGain = miningToGain(true, true)

    expect(activeGain).toBeGreaterThan(0)
    expect(activeGain).toBeLessThan(ENGINE_GAIN_IDLE)
    expect(miningToGain(true, false)).toBe(0)
    expect(miningToGain(false, true)).toBe(0)
  })
})
