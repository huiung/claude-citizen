import { describe, expect, it } from 'vitest'
import { HOLDER_IDENTITY_KITS } from './stationMenu'

describe('station hangar holder identity kits', () => {
  it('lists all three holder name color tiers', () => {
    expect(HOLDER_IDENTITY_KITS.map((kit) => kit.tier)).toEqual([1, 2, 3])
    expect(HOLDER_IDENTITY_KITS[2]).toMatchObject({
      tier: 3,
      name: 'T3 Name Color',
      description: 'Purple callsign styling on nameplates and chat.',
    })
  })
})
