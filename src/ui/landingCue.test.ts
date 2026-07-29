import { describe, expect, it } from 'vitest'
import type { LandingApproach } from '../sim/landing'
import { CUE_APPROACH_LATERAL, formatCueDistance, landingCueText, placeSkypadMarker } from './landingCue'

const approach = (over: Partial<LandingApproach>): LandingApproach =>
  ({ blocker: 'ready', lateral: 0, alt: 0, speed: 0, ...over })

describe('formatCueDistance', () => {
  it('reads in metres up close and kilometres beyond one', () => {
    expect(formatCueDistance(212.4)).toBe('212 m')
    expect(formatCueDistance(999)).toBe('999 m')
    expect(formatCueDistance(3410)).toBe('3.4 km')
  })

  it('never shows a negative distance', () => {
    expect(formatCueDistance(-5)).toBe('0 m')
  })
})

describe('landingCueText', () => {
  const cue = (over: Partial<LandingApproach>, city = 'Seoul') => landingCueText(approach(over), city, 45, 40, 30)

  it('says nothing once the ship is eligible — the LAND prompt owns that moment', () => {
    expect(cue({ blocker: 'ready' })).toBeNull()
  })

  it('sends a distant pilot to the beam and a close one onto the deck', () => {
    expect(cue({ blocker: 'lateral', lateral: 3400 })).toContain('3.4 km')
    expect(cue({ blocker: 'lateral', lateral: 3400 })).toContain('BEAM')
    expect(cue({ blocker: 'lateral', lateral: CUE_APPROACH_LATERAL - 100 })).toContain('OFF CENTRE')
  })

  it('asks a high pilot to descend even though eligibility blames the lateral offset first', () => {
    // The bad version of this cue tells someone 1.6km up to strafe onto a deck they cannot reach.
    const high = cue({ blocker: 'lateral', lateral: 212, alt: 1600 })

    expect(high).toContain('DESCEND')
    expect(high).toContain('ALT 1.6 km')
    expect(high).toContain('212 m OFF CENTRE') // the drift is still worth saying, just not first
  })

  it('drops the drift note once the ship is over the deck', () => {
    expect(cue({ blocker: 'altitude', lateral: 12, alt: 320 })).not.toContain('OFF CENTRE')
  })

  it('gives the number to fix AND the key that fixes it', () => {
    // A cue that says only "TOO FAST" leaves a pilot who has not read the controls exactly as stuck.
    const fast = cue({ blocker: 'speed', speed: 186.6 }, 'Tokyo')
    expect(fast).toContain('187 m/s')
    expect(fast).toContain('BRAKE WITH X')
    expect(fast).toContain('30')

    expect(cue({ blocker: 'altitude', alt: 320 })).toContain('40 m')
    expect(cue({ blocker: 'below-deck', alt: -9 })).toContain('CLIMB WITH R')
  })

  it('names the city in HUD case', () => {
    expect(cue({ blocker: 'speed', speed: 90 }, 'São Paulo')).toContain('SÃO PAULO')
  })
})

describe('placeSkypadMarker', () => {
  const W = 1600
  const H = 1000

  it('puts an on-screen pad at its projected pixel, unflagged', () => {
    const p = placeSkypadMarker(0, 0, false, W, H, 42)

    expect(p).toEqual({ x: 800, y: 500, edge: false })
  })

  it('pins an off-screen pad to the border on its own side', () => {
    const right = placeSkypadMarker(1.8, 0, false, W, H, 42)
    const top = placeSkypadMarker(0, 1.8, false, W, H, 42)

    expect(right).toEqual({ x: W - 42, y: 500, edge: true })
    expect(top).toEqual({ x: 800, y: 42, edge: true })
  })

  it('flips a pad behind the camera before pinning it', () => {
    // A perspective divide by a negative w mirrors the point: taken at face value, a pad behind and
    // to the right pins to the LEFT edge and turns the pilot the wrong way.
    const behind = placeSkypadMarker(0.5, 0, true, W, H, 42)

    expect(behind.x).toBe(42)
    expect(behind.edge).toBe(true)
  })

  it('keeps the marker inside the viewport for a degenerate size', () => {
    const p = placeSkypadMarker(-4, 4, false, 60, 60, 42)

    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeLessThanOrEqual(60)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeLessThanOrEqual(60)
  })
})
