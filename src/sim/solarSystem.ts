// A named solar system — Sun + Mercury..Saturn — at a compressed (playable) scale.
// Pure data; world positions are precomputed from sun-centered orbits. The curated
// trade outposts stay where they are; this is the giant backdrop + quantum-travel targets.

import { Vector3 } from 'three'

/** Sun sits far down the -Z axis from spawn so the whole system reads as a backdrop ahead. */
export const SUN_POSITION = new Vector3(0, -4000, -52000)
export const SUN_RADIUS = 22000
export const SUN_COLOR = 0xfff0be

export type SurfaceKind = 'earth' | 'mars' | 'rocky' | 'venus' | 'gas'

export interface Planet {
  name: string
  radius: number
  color: number
  position: Vector3
  hasRings: boolean
  surface: SurfaceKind
  seed: number
}

// distance from the sun, body radius, color, orbital angle (deg). Distances are
// heavily compressed vs reality so the system is crossable with quantum travel.
// angle 90° puts a body on the sun→spawn side (toward the player). Earth sits there,
// nearest and dead ahead at launch; the others fan out around the sun.
const SPEC: ReadonlyArray<{ name: string; dist: number; radius: number; color: number; angle: number; surface: SurfaceKind; rings?: boolean }> = [
  { name: 'Earth', dist: 37000, radius: 4300, color: 0x3a72a8, angle: 90, surface: 'earth' },
  { name: 'Venus', dist: 33000, radius: 4000, color: 0xd9ad6a, angle: 160, surface: 'venus' },
  { name: 'Mercury', dist: 28000, radius: 1700, color: 0x9a8a78, angle: 225, surface: 'rocky' },
  { name: 'Mars', dist: 52000, radius: 2400, color: 0xc25433, angle: 315, surface: 'mars' },
  { name: 'Jupiter', dist: 82000, radius: 16000, color: 0xc9aa80, angle: 25, surface: 'gas' },
  { name: 'Saturn', dist: 112000, radius: 13000, color: 0xdac89c, angle: 200, surface: 'gas', rings: true },
]

export const PLANETS: ReadonlyArray<Planet> = SPEC.map((s, i) => {
  const a = (s.angle * Math.PI) / 180
  return {
    name: s.name,
    radius: s.radius,
    color: s.color,
    hasRings: !!s.rings,
    surface: s.surface,
    seed: 1000 + i * 137,
    // Orbit on the ecliptic plane (industry-standard — real planets lie ~flat, ±7°). Keeping them
    // co-planar makes the system readable & navigable; distances and order stay compressed-but-real.
    position: new Vector3(
      SUN_POSITION.x + Math.cos(a) * s.dist,
      SUN_POSITION.y,
      SUN_POSITION.z + Math.sin(a) * s.dist,
    ),
  }
})

/** Farthest extent of the system from the sun — used to push the procedural galaxy outside it. */
export const SYSTEM_RADIUS = 130000
