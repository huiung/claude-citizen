import { describe, expect, it } from 'vitest'
import { engineGlowColor, engineGlowStyle } from './engineGlow'

describe('holder engine glow styling', () => {
  it('keeps the standard engine bloom cyan', () => {
    expect(engineGlowColor(0)).toBe(0x9fe0ff)
  })

  it('does not tint engine bells by holder tier', () => {
    expect(engineGlowColor(1)).toBe(0x9fe0ff)
    expect(engineGlowColor(2)).toBe(0x9fe0ff)
    expect(engineGlowColor(3)).toBe(0x9fe0ff)
  })

  it('brightens and grows while boost is held, not just on ignition', () => {
    const cruise = engineGlowStyle({ thrust: 0.2, boost: false, speedFrac: 0.3, cosmeticTier: 0, time: 0 })
    const boosting = engineGlowStyle({ thrust: 0.2, boost: true, speedFrac: 0.3, cosmeticTier: 0, time: 0 })

    expect(boosting.discIntensity).toBeGreaterThan(cruise.discIntensity)
    expect(boosting.scale).toBeGreaterThan(cruise.scale)
  })

  it('stays subtle enough to read as glow, not a large trail', () => {
    const style = engineGlowStyle({ thrust: 1, boost: true, speedFrac: 1, cosmeticTier: 3, time: 0.2 })

    expect(style.scale).toBeLessThanOrEqual(1.55)
    expect(style.discOpacity).toBeLessThanOrEqual(0.82)
  })
})
