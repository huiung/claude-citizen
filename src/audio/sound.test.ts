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
  ambienceToParams,
  boostPunchToParams,
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

describe('ambience audio shaping', () => {
  it('keeps a subtle space bed audible even in empty space', () => {
    const params = ambienceToParams({ atmosphere: 0, quantum: 0, speedFrac: 0 })

    expect(params.spaceGain).toBeGreaterThan(0)
    expect(params.spaceGain).toBeLessThan(ENGINE_GAIN_IDLE)
    expect(params.atmoGain).toBe(0)
    expect(params.quantumGain).toBe(0)
  })

  it('swells atmosphere gain and brightness as the ship enters air', () => {
    const highOrbit = ambienceToParams({ atmosphere: 0.2, quantum: 0, speedFrac: 0.25 })
    const lowFlight = ambienceToParams({ atmosphere: 1, quantum: 0, speedFrac: 0.85 })

    expect(lowFlight.atmoGain).toBeGreaterThan(highOrbit.atmoGain)
    expect(lowFlight.atmoFilterFreq).toBeGreaterThan(highOrbit.atmoFilterFreq)
    expect(lowFlight.spaceGain).toBeLessThan(highOrbit.spaceGain)
  })

  it('adds quantum pressure without drowning the atmosphere layer', () => {
    const params = ambienceToParams({ atmosphere: 0.7, quantum: 1, speedFrac: 1.2 })

    expect(params.quantumGain).toBeGreaterThan(0)
    expect(params.quantumFilterFreq).toBeGreaterThan(params.atmoFilterFreq)
    expect(params.atmoGain).toBeGreaterThan(params.quantumGain)
  })

  it('clamps invalid or out-of-range inputs', () => {
    const quiet = ambienceToParams({ atmosphere: -1, quantum: Number.NaN, speedFrac: -4 })
    const loud = ambienceToParams({ atmosphere: 4, quantum: 9, speedFrac: 9 })

    expect(quiet.atmoGain).toBe(0)
    expect(quiet.quantumGain).toBe(0)
    expect(loud.atmoGain).toBeLessThanOrEqual(0.026)
    expect(loud.quantumGain).toBeLessThanOrEqual(0.012)
  })
})

describe('boost punch shaping', () => {
  it('creates a short layered whoosh that is stronger at speed', () => {
    const slow = boostPunchToParams(0.1)
    const fast = boostPunchToParams(1)

    expect(fast.noisePeak).toBeGreaterThan(slow.noisePeak)
    expect(fast.filterEnd).toBeGreaterThan(slow.filterEnd)
    expect(fast.duration).toBeGreaterThan(0.2)
    expect(fast.duration).toBeLessThan(0.6)
  })

  it('keeps the boost punch below explosion-level loudness', () => {
    const params = boostPunchToParams(9)

    expect(params.noisePeak).toBeLessThanOrEqual(0.105)
    expect(params.tonePeak).toBeLessThanOrEqual(0.042)
    expect(params.filterEnd).toBeLessThanOrEqual(1700)
  })

  it('clamps invalid speed input', () => {
    const invalid = boostPunchToParams(Number.NaN)
    const stopped = boostPunchToParams(0)

    expect(invalid).toEqual(stopped)
  })
})
