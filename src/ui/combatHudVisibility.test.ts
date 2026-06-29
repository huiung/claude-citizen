import { describe, expect, it } from 'vitest'
import { shouldShowCombatHud } from './combatHudVisibility'

describe('combat HUD visibility', () => {
  it('shows target brackets during bot training arena footage', () => {
    expect(shouldShowCombatHud({
      running: true,
      docked: false,
      bot: true,
      botActivityKind: 'pvp-training',
    })).toBe(true)
  })

  it('keeps the normal bot tour HUD clean outside combat training', () => {
    expect(shouldShowCombatHud({
      running: true,
      docked: false,
      bot: true,
      botActivityKind: 'black-hole-dive',
    })).toBe(false)
  })
})
