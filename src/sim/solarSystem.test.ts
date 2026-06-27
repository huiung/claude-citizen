import { describe, it, expect } from 'vitest'
import { PLANETS, SUN_POSITION, SUN_RADIUS, SYSTEM_RADIUS } from './solarSystem'

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

describe('planet spacing', () => {
  const distFromSun = (p: typeof PLANETS[number]) => p.position.distanceTo(SUN_POSITION)

  it('every planet clears the sun with breathing room', () => {
    for (const p of PLANETS) expect(distFromSun(p) - SUN_RADIUS).toBeGreaterThanOrEqual(15000)
  })

  it('distances strictly increase from Mercury outward', () => {
    const sorted = [...PLANETS].sort((a, b) => distFromSun(a) - distFromSun(b))
    for (let i = 1; i < sorted.length; i++) {
      expect(distFromSun(sorted[i])).toBeGreaterThan(distFromSun(sorted[i - 1]))
    }
  })

  it('the outermost planet body stays within the system bound', () => {
    const outer = PLANETS[PLANETS.length - 1]
    expect(distFromSun(outer) + outer.radius).toBeLessThanOrEqual(SYSTEM_RADIUS)
  })
})
