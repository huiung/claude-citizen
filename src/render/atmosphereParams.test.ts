import { describe, expect, it } from 'vitest'
import { ATMOSPHERE_PARAMS } from './atmosphereParams'

const KINDS = ['earth', 'mars', 'rocky', 'venus', 'gas'] as const

describe('ATMOSPHERE_PARAMS', () => {
  it('covers every SurfaceKind', () => {
    for (const kind of KINDS) expect(ATMOSPHERE_PARAMS[kind]).toBeDefined()
  })

  it('keeps exponents and intensities in sane shader ranges', () => {
    for (const kind of KINDS) {
      const p = ATMOSPHERE_PARAMS[kind]
      expect(p.power).toBeGreaterThanOrEqual(1.5)
      expect(p.power).toBeLessThanOrEqual(5)
      expect(p.intensity).toBeGreaterThan(0)
      expect(p.intensity).toBeLessThanOrEqual(1.5)
      for (const c of [p.baseColor, p.rayleighColor, p.sunsetColor]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(0xffffff)
      }
    }
  })

  it('gives airless rocky bodies a much fainter glow than earth', () => {
    expect(ATMOSPHERE_PARAMS.rocky.intensity).toBeLessThan(ATMOSPHERE_PARAMS.earth.intensity * 0.5)
  })

  it("gives mars a blue-leaning sunset (real Rayleigh quirk of thin CO2 air)", () => {
    const sunset = ATMOSPHERE_PARAMS.mars.sunsetColor
    const r = (sunset >> 16) & 0xff, b = sunset & 0xff
    expect(b).toBeGreaterThan(r)
  })
})
