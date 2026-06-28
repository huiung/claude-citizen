import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { LANDMARKS, pickDestination } from './landmarks.mjs'

describe('LANDMARKS', () => {
  it('lists the named planets and start outposts with Vector3 positions', () => {
    const ids = LANDMARKS.map((l) => l.id)
    for (const id of ['planet-earth', 'planet-jupiter', 'refinery', 'colony']) {
      expect(ids).toContain(id)
    }
    for (const l of LANDMARKS) {
      expect(l.position).toBeInstanceOf(Vector3)
      expect(typeof l.name).toBe('string')
    }
  })
})

describe('pickDestination', () => {
  it('returns a landmark other than the current one', () => {
    let seed = 0
    const rng = () => ((seed = (seed + 0.37) % 1))
    for (let i = 0; i < 20; i++) {
      const next = pickDestination(LANDMARKS, 'planet-earth', rng)
      expect(LANDMARKS).toContain(next)
      expect(next.id).not.toBe('planet-earth')
    }
  })

  it('still returns a landmark when currentId is unknown/null', () => {
    expect(LANDMARKS).toContain(pickDestination(LANDMARKS, null, () => 0.5))
  })
})

describe('pickDestination weighting', () => {
  it('biases toward higher-weight landmarks (start outposts) over planets', () => {
    let i = 0
    const rng = () => (i++ % 100) / 100 // sweep [0,1)
    const counts = {}
    for (let k = 0; k < 400; k++) {
      const l = pickDestination(LANDMARKS, null, rng)
      counts[l.id] = (counts[l.id] ?? 0) + 1
    }
    const outpostPicks = (counts.refinery ?? 0) + (counts.colony ?? 0)
    const planetPicks = Object.entries(counts)
      .filter(([id]) => id.startsWith('planet-'))
      .reduce((s, [, n]) => s + n, 0)
    expect(outpostPicks).toBeGreaterThan(planetPicks) // bot loiters where players spawn
  })
})

import {
  BLACK_HOLE_CENTER, BLACK_HOLE_TIDAL, BLACK_HOLE_INFLUENCE,
  PVP_ARENA_CENTER, SEASON_HUB_CENTER, RACE_GATES, STATIONS,
} from './landmarks.mjs'

describe('activity landmarks', () => {
  it('exposes the deep-space points the activities target', () => {
    expect(BLACK_HOLE_CENTER.toArray()).toEqual([118000, 9000, 118000])
    expect(PVP_ARENA_CENTER.toArray()).toEqual([92000, 26000, -210000])
    expect(SEASON_HUB_CENTER.toArray()).toEqual([93000, 26300, -218800])
    expect(BLACK_HOLE_TIDAL).toBe(18000)
    expect(BLACK_HOLE_INFLUENCE).toBe(50000)
  })
  it('builds 10 race gates relative to the season hub', () => {
    expect(RACE_GATES).toHaveLength(10)
    // first gate = hub + (0,210,1620)
    expect(RACE_GATES[0].toArray()).toEqual([93000, 26510, -217180])
  })
  it('lists the dockable stations for hub-visit', () => {
    expect(STATIONS).toHaveLength(3)
    expect(STATIONS.every(Boolean)).toBe(true)
    expect(STATIONS.map((s) => s.name)).toContain('Meridian Refinery')
    expect(STATIONS.map((s) => s.name)).toContain('Citizen Season Hub')
  })
})
