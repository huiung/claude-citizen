import { describe, expect, it } from 'vitest'
import {
  combatFeedbackAlpha,
  createCombatFeedbackState,
  registerHitMarker,
  registerKillBanner,
} from './combatFeedback'

describe('combat feedback state', () => {
  it('shows a short hit marker pulse', () => {
    const state = createCombatFeedbackState()

    registerHitMarker(state, 1000)

    expect(state.hitMarker.text).toBeUndefined()
    expect(state.hitMarker.born).toBe(1000)
    expect(state.hitMarker.until).toBe(1240)
    expect(combatFeedbackAlpha(state.hitMarker, 1120)).toBeGreaterThan(0.7)
    expect(combatFeedbackAlpha(state.hitMarker, 1300)).toBe(0)
  })

  it('shows kill banners longer than normal hit markers', () => {
    const state = createCombatFeedbackState()

    registerKillBanner(state, 'ELIMINATED BRAVO', '+1 ranked kill', 2000)

    expect(state.killBanner?.text).toBe('ELIMINATED BRAVO')
    expect(state.killBanner?.subtext).toBe('+1 ranked kill')
    expect(state.killBanner?.until).toBe(4300)
  })

  it('does not keep damage number banners', () => {
    const state = createCombatFeedbackState()

    expect('damageBanners' in state).toBe(false)
  })
})
