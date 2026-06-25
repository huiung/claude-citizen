import { describe, expect, it } from 'vitest'
import { landmarkTargets } from './solarMapLandmarks'
import { PVP_ARENA_DESTINATIONS, CITIZEN_SEASON_HUB_DESTINATION } from '../sim/pvp'

describe('landmarkTargets', () => {
  it('maps every named destination on desktop, preserving id/name/kind/radius', () => {
    const targets = landmarkTargets(false)
    expect(targets.length).toBe(PVP_ARENA_DESTINATIONS.length)
    for (const dest of PVP_ARENA_DESTINATIONS) {
      const t = targets.find((x) => x.id === dest.id)
      expect(t).toBeDefined()
      expect(t!.name).toBe(dest.name)
      expect(t!.kind).toBe(dest.kind)
      expect(t!.radius).toBe(dest.radius)
      expect(t!.worldPosition.x).toBe(dest.position.x)
      expect(t!.worldPosition.z).toBe(dest.position.z)
    }
  })

  it('includes the black hole on desktop', () => {
    expect(landmarkTargets(false).some((t) => t.id === 'black-hole-approach')).toBe(true)
  })

  it('on mobile, returns only the Citizen Season Hub (the one destination a click can set)', () => {
    const targets = landmarkTargets(true)
    expect(targets.map((t) => t.id)).toEqual([CITIZEN_SEASON_HUB_DESTINATION.id])
  })

  it('clones worldPosition so mutating a target does not touch the source destination', () => {
    const before = PVP_ARENA_DESTINATIONS[0].position.x
    const t = landmarkTargets(false).find((x) => x.id === PVP_ARENA_DESTINATIONS[0].id)!
    t.worldPosition.x += 12345
    expect(PVP_ARENA_DESTINATIONS[0].position.x).toBe(before)
  })
})
