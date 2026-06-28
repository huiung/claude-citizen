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
