import { describe, it, expect } from 'vitest'
import { PLANETS, SUN_POSITION, SUN_RADIUS } from './solarSystem'

describe('planet orbits clear the sun', () => {
  // The sun's collision shell (resolvePlanetCollisions): radius * 1.06 + 30.
  const sunCollision = SUN_RADIUS * 1.06 + 30
  // Quantum arrival standoff (destinationArrival): max(radius * 1.5, 650), placed toward the ship.
  const standoff = (radius: number) => Math.max(radius * 1.5, 650)

  it('every planet sits outside the sun collision shell', () => {
    for (const p of PLANETS) {
      const d = p.position.distanceTo(SUN_POSITION)
      expect(d, `${p.name} orbit ${Math.round(d)} must clear sun shell ${Math.round(sunCollision)}`).toBeGreaterThan(sunCollision)
    }
  })

  it('every quantum arrival point lands outside the sun (not flung to the sun surface)', () => {
    for (const p of PLANETS) {
      // Closest the arrival point can be to the sun = orbit distance minus the standoff.
      const nearestArrival = p.position.distanceTo(SUN_POSITION) - standoff(p.radius)
      expect(nearestArrival, `${p.name} arrival can fall inside the sun shell`).toBeGreaterThan(sunCollision)
    }
  })
})
