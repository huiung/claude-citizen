import { describe, expect, it } from 'vitest'
import { hudShipIdentity } from './shipIdentity'

describe('ship identity HUD labels', () => {
  it('shows the selected base ship class without a visual line for standard hulls', () => {
    expect(hudShipIdentity('fighter', 'standard', 3)).toEqual({
      shipClass: 'FIGHTER',
      visual: null,
    })
  })

  it('shows the active holder visual separately from the base ship class', () => {
    expect(hudShipIdentity('fighter', 'sovereign-wraith', 3)).toEqual({
      shipClass: 'FIGHTER',
      visual: 'SOVEREIGN WRAITH',
    })
  })

  it('falls back to standard when the selected visual is locked', () => {
    expect(hudShipIdentity('interceptor', 'void-interceptor', 2)).toEqual({
      shipClass: 'INTERCEPTOR',
      visual: null,
    })
  })
})
