import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, computeCityLayout } from './cityChunk'
import {
  CITY_SHEET_SEGMENTS, cityGroundRadius, cityLocalFromDirection, cityTangentFrame, SHEET_LIFT,
} from './cityLayout'
import {
  cityGroundRadiusAt, computePadDeckPixels, computePadLot, computePadMarkingPixels, computePadWorld,
  padDeckRadiusAt, PAD_DECK_HEIGHT, PAD_RADIUS,
} from './cityPad'
import { samplePlanetSurface } from './planetTextures'

describe('computePadLot', () => {
  it('is deterministic', () => {
    expect(computePadLot(1234, 2)).toEqual(computePadLot(1234, 2))
  })

  it('picks a cell no building occupies', () => {
    const lot = computePadLot(1234, 2)
    const cell = CITY_BLOCK + CITY_ROAD
    const extent = CITY_TIER_RADIUS[2]
    const lotGx = Math.floor((lot.x + extent) / cell)
    const lotGz = Math.floor((lot.z + extent) / cell)
    for (const b of computeCityLayout(1234, 2)) {
      const same = Math.floor((b.x + extent) / cell) === lotGx && Math.floor((b.z + extent) / cell) === lotGz
      expect(same).toBe(false)
    }
  })

  it('stays clear of the skirt edge', () => {
    const lot = computePadLot(99, 0)
    expect(Math.hypot(lot.x, lot.z)).toBeLessThan(CITY_TIER_RADIUS[0] - PAD_RADIUS)
  })

  it('skips blocked candidates deterministically', () => {
    const free = computePadLot(1234, 2)
    const isBlocked = (x: number, z: number) => x === free.x && z === free.z
    const blocked = computePadLot(1234, 2, isBlocked)
    expect(blocked).not.toEqual(free)
    expect(computePadLot(1234, 2, isBlocked)).toEqual(blocked)
  })

  it('falls back to the nearest free cell when everything is blocked', () => {
    const free = computePadLot(1234, 2)
    expect(computePadLot(1234, 2, () => true)).toEqual(free)
  })
})

describe('computePadWorld', () => {
  const planetPos = new THREE.Vector3(10, -20, 30)
  const site = { direction: new THREE.Vector3(1, 0.2, 0.3).normalize(), tier: 2 as const, seed: 777 }

  it('is deterministic and puts the deck top in the lifted-fabric altitude band', () => {
    const a = computePadWorld(site, planetPos, 1274, 4300)
    const b = computePadWorld(site, planetPos, 1274, 4300)
    expect(a.center.distanceTo(b.center)).toBe(0) // beam and chunk must agree exactly
    expect(a.normal.length()).toBeCloseTo(1, 9)
    const r = a.center.distanceTo(planetPos)
    expect(r).toBeGreaterThan(4300) // above the sphere (SHEET_LIFT + deck)
    expect(r).toBeLessThan(4300 * 1.05) // but still near the surface
  })
})

describe('computePadMarkingPixels', () => {
  it('draws a landing ring: lit at the ring radius and centre dot, dark between', () => {
    const size = 64
    const px = computePadMarkingPixels(size)
    const at = (x: number, y: number) => px[(y * size + x) * 4]
    const c = Math.floor((size - 1) / 2)
    expect(at(c, c)).toBeGreaterThan(200) // centre dot
    expect(at(c + Math.round(c * 0.68), c)).toBeGreaterThan(200) // ring band
    expect(at(c + Math.round(c * 0.4), c)).toBe(0) // between: dark deck
  })
})

describe('computePadDeckPixels', () => {
  const SIZE = 128
  const px = computePadDeckPixels(SIZE)
  const c = (SIZE - 1) / 2
  const rgb = (x: number, y: number): [number, number, number] => {
    const i = (y * SIZE + x) * 4
    return [px[i], px[i + 1], px[i + 2]]
  }
  const lum = (x: number, y: number): number => {
    const [r, g, b] = rgb(x, y)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  /** Texel at a given fraction of the deck radius, along +x from the centre. */
  const atRadius = (frac: number): [number, number] => [Math.round(c + c * frac), Math.round(c)]

  it('is deterministic — two captures must never differ by the noise', () => {
    expect(Array.from(computePadDeckPixels(SIZE))).toEqual(Array.from(px))
  })

  it('is opaque everywhere', () => {
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255)
  })

  it('paints the marking ring brighter than the concrete, so daylight can see it', () => {
    // The bug this fixes: the ring existed only as an emissiveMap on a night-weighted intensity, so
    // in daylight the deck was one flat tone with no marking on it at all.
    expect(lum(...atRadius(0.68))).toBeGreaterThan(lum(...atRadius(0.4)) * 1.2)
    expect(lum(...atRadius(0))).toBeGreaterThan(lum(...atRadius(0.4)) * 1.2)
  })

  it('puts the painted ring at the same radius as the glowing one', () => {
    // Two textures describe the same marking; if they drift the paint and the glow sit apart.
    const mark = computePadMarkingPixels(64)
    const mc = (64 - 1) / 2
    for (const frac of [0.68, 0, 0.4, 0.9]) {
      const litInMark = mark[(Math.round(mc) * 64 + Math.round(mc + mc * frac)) * 4] > 200
      const paintedInDeck = lum(...atRadius(frac)) > lum(...atRadius(0.45)) * 1.15
      expect(paintedInDeck).toBe(litInMark)
    }
  })

  it('varies the concrete without straying far from the flat colour it replaces', () => {
    // The deck's exposure was tuned against the Blue Marble terrain around it; only the variation is
    // new. Sampled off the marking radii so the paint does not skew the range.
    const flat = 0.2126 * 0x9a + 0.7152 * 0xa2 + 0.0722 * 0xab
    const samples: number[] = []
    for (let y = 2; y < SIZE; y += 3) {
      for (let x = 2; x < SIZE; x += 3) {
        const r = Math.hypot(x - c, y - c) / c
        if (r < 0.14 || (r > 0.58 && r < 0.78) || r > 1) continue
        samples.push(lum(x, y))
      }
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    expect(mean).toBeGreaterThan(flat * 0.9)
    expect(mean).toBeLessThan(flat * 1.02)
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(flat * 0.12) // there IS variation
    expect(Math.max(...samples)).toBeLessThan(flat * 1.15) // but no blown patches
  })

  it('keeps the concrete grey rather than tinting it', () => {
    for (const [x, y] of [atRadius(0.3), atRadius(0.5), atRadius(0.85)]) {
      const [r, , b] = rgb(x, y)
      expect(b).toBeGreaterThan(r) // the base is a cool grey; noise must not invert that
      expect(b - r).toBeLessThan(40)
    }
  })
})

describe('cityGroundRadiusAt', () => {
  const planetPos = new THREE.Vector3(10, -20, 30)
  const site = { direction: new THREE.Vector3(1, 0.2, 0.3).normalize(), tier: 2 as const, seed: 777 }
  const SEED = 1274
  const RADIUS = 4300
  const extent = CITY_TIER_RADIUS[2]
  const cell = (extent * 2) / CITY_SHEET_SEGMENTS

  /** The sheet's own per-vertex formula, transcribed from buildCityChunk. If cityGroundRadiusAt
   *  stops agreeing with this at the grid points, the walker is standing on a surface the player
   *  cannot see. */
  const vertexRadius = (x: number, z: number): number => {
    const { u, v } = cityTangentFrame(site.direction)
    const d = site.direction.clone().multiplyScalar(RADIUS).addScaledVector(u, x).addScaledVector(v, z).normalize()
    const t = samplePlanetSurface('earth', SEED, d.x, d.y, d.z, undefined, RADIUS)
    const g = cityGroundRadius(RADIUS, t.height) + SHEET_LIFT
    const lr = Math.hypot(x, z)
    return lr > extent ? g - (lr - extent) * 0.9 : g
  }

  it('reproduces the sheet exactly at its vertices', () => {
    for (const k of [10, 17, 20, 25]) {
      const x = -extent + k * cell
      const z = -extent + (k + 3) * cell
      expect(cityGroundRadiusAt(site, SEED, RADIUS, x, z)).toBeCloseTo(vertexRadius(x, z), 6)
    }
  })

  /** A sheet vertex as a point relative to the planet centre. */
  const vertexPoint = (x: number, z: number): THREE.Vector3 => {
    const { u, v } = cityTangentFrame(site.direction)
    return site.direction.clone().multiplyScalar(RADIUS).addScaledVector(u, x).addScaledVector(v, z)
      .normalize().multiplyScalar(vertexRadius(x, z))
  }
  /** Where the ray from the planet centre through (x, z) meets a triangle's plane. This is the
   *  answer a raycast against the rendered mesh would give, and it is the thing the walker must
   *  stand on. */
  const planeRadius = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, x: number, z: number): number => {
    const { u, v } = cityTangentFrame(site.direction)
    const dir = site.direction.clone().multiplyScalar(RADIUS).addScaledVector(u, x).addScaledVector(v, z).normalize()
    const nrm = c.clone().sub(a).cross(b.clone().sub(a))
    return a.dot(nrm) / dir.dot(nrm)
  }

  it('lands on the flat triangle the GPU draws, not on an arc through its corners', () => {
    // A triangle is flat in 3D; interpolating the three corner RADII traces an arc above it, and the
    // chord sag over a 70-unit cell at radius 4300 is ~0.12 units. Written down that is nothing.
    // On a 1.8-unit figure it is the height of the boots, and the captures showed exactly that: the
    // pilot floating with no contact anywhere off the pad.
    const x0 = -extent + 12 * cell
    const z0 = -extent + 19 * cell
    // fx < fz picks the (a, b, d) triangle: (x0, z0+cell), (x0, z0), (x0+cell, z0+cell).
    const a = vertexPoint(x0, z0 + cell)
    const b = vertexPoint(x0, z0)
    const d = vertexPoint(x0 + cell, z0 + cell)
    const x = x0 + cell * 0.25
    const z = z0 + cell * 0.6
    const got = cityGroundRadiusAt(site, SEED, RADIUS, x, z)
    expect(got).toBeCloseTo(planeRadius(a, b, d, x, z), 6)
    // ...and it really is below the arc, i.e. the distinction is not academic at this scale.
    const arc = vertexRadius(x0, z0 + cell) * 0.15 + vertexRadius(x0, z0) * 0.4 + vertexRadius(x0 + cell, z0 + cell) * 0.45
    expect(arc - got).toBeGreaterThan(0.01)
  })

  it('picks the other triangle on the far side of the split diagonal', () => {
    // The diagonal runs from (x0, z0) to (x0+cell, z0+cell); fx > fz is the (b, c, d) side.
    const x0 = -extent + 12 * cell
    const z0 = -extent + 19 * cell
    const b = vertexPoint(x0, z0)
    const c = vertexPoint(x0 + cell, z0)
    const d = vertexPoint(x0 + cell, z0 + cell)
    const x = x0 + cell * 0.8
    const z = z0 + cell * 0.2
    expect(cityGroundRadiusAt(site, SEED, RADIUS, x, z)).toBeCloseTo(planeRadius(c, b, d, x, z), 6)
  })

  it('agrees with itself from both triangles along the diagonal', () => {
    const x0 = -extent + 12 * cell
    const z0 = -extent + 19 * cell
    for (const t of [0.25, 0.5, 0.75]) {
      const lo = cityGroundRadiusAt(site, SEED, RADIUS, x0 + cell * t - 1e-3, z0 + cell * t)
      const hi = cityGroundRadiusAt(site, SEED, RADIUS, x0 + cell * t + 1e-3, z0 + cell * t)
      expect(Math.abs(lo - hi)).toBeLessThan(1e-3)
    }
  })

  it('reproduces every corner of a cell from inside both of its triangles', () => {
    const x0 = -extent + 21 * cell
    const z0 = -extent + 7 * cell
    const eps = cell * 1e-6
    for (const [dx, dz] of [[eps, eps], [cell - eps, eps], [eps, cell - eps], [cell - eps, cell - eps]]) {
      const got = cityGroundRadiusAt(site, SEED, RADIUS, x0 + dx, z0 + dz)
      // 2 places, not more: the probe sits a whisker inside the corner rather than on it, and the
      // sheet's slope across a cell is steep enough to turn that whisker into a fraction of a mm.
      expect(got).toBeCloseTo(vertexRadius(x0 + Math.round(dx / cell) * cell, z0 + Math.round(dz / cell) * cell), 2)
    }
  })

  it('is continuous across a cell boundary', () => {
    const x = -extent + 14 * cell
    const z = 40
    const left = cityGroundRadiusAt(site, SEED, RADIUS, x - 1e-4, z)
    const right = cityGroundRadiusAt(site, SEED, RADIUS, x + 1e-4, z)
    expect(Math.abs(left - right)).toBeLessThan(1e-3)
  })

  it('puts the pad deck above the sheet it stands on, by the deck thickness', () => {
    // The pad is a slab laid on the sheet, so the kerb a pedestrian steps off is PAD_DECK_HEIGHT —
    // a real but survivable drop, not a cliff. computePadWorld samples the terrain directly rather
    // than through the sheet grid, so a small mesh-vs-field difference is expected on top.
    const pad = computePadWorld(site, planetPos, SEED, RADIUS)
    const { u, v } = cityTangentFrame(site.direction)
    const local = cityLocalFromDirection(site.direction, u, v, RADIUS, pad.normal)
    const sheet = cityGroundRadiusAt(site, SEED, RADIUS, local.x, local.z)
    const deck = pad.center.distanceTo(planetPos)
    expect(deck - sheet).toBeGreaterThan(0)
    expect(deck - sheet).toBeLessThan(PAD_DECK_HEIGHT + 12)
  })
})

describe('padDeckRadiusAt', () => {
  const normal = new THREE.Vector3(0.3, 1, -0.2).normalize()
  const padRadius = 4360

  it('is exactly the pad radius at the pad centre', () => {
    expect(padDeckRadiusAt(padRadius, normal, normal)).toBeCloseTo(padRadius, 9)
  })

  it('rises toward the rim, because the deck top is a plane and not a sphere', () => {
    // The failure this function exists for: at the 45-unit rim the flat deck stands 0.23 units
    // proud of a sphere through its own centre, which is more than a pedestrian's boots are tall.
    // The ship never noticed because beginLanding puts it dead centre.
    const tangent = new THREE.Vector3(1, 0, 0).projectOnPlane(normal).normalize()
    const rim = normal.clone().multiplyScalar(padRadius).addScaledVector(tangent, PAD_RADIUS).normalize()
    const lift = padDeckRadiusAt(padRadius, normal, rim) - padRadius
    expect(lift).toBeGreaterThan(0.2)
    expect(lift).toBeLessThan(0.3)
  })

  it('puts every point of the deck on one plane', () => {
    const tangent = new THREE.Vector3(0, 0, 1).projectOnPlane(normal).normalize()
    for (const d of [0, 12, 30, PAD_RADIUS]) {
      const dir = normal.clone().multiplyScalar(padRadius).addScaledVector(tangent, d).normalize()
      const point = dir.clone().multiplyScalar(padDeckRadiusAt(padRadius, normal, dir))
      expect(point.dot(normal)).toBeCloseTo(padRadius, 6) // constant height along the normal
    }
  })

  it('refuses to divide by an edge-on direction', () => {
    const edgeOn = new THREE.Vector3(1, 0, 0).projectOnPlane(normal).normalize()
    expect(padDeckRadiusAt(padRadius, normal, edgeOn)).toBe(padRadius)
  })
})

describe('cityLocalFromDirection', () => {
  const site = new THREE.Vector3(1, 0.2, 0.3).normalize()
  const { u, v } = cityTangentFrame(site)

  it('round-trips the parametrisation the whole city is laid out with', () => {
    for (const [x, z] of [[0, 0], [120, -340], [-1399, 800], [45, 45]] as [number, number][]) {
      const dir = site.clone().multiplyScalar(4300).addScaledVector(u, x).addScaledVector(v, z).normalize()
      const back = cityLocalFromDirection(site, u, v, 4300, dir)
      expect(back.x).toBeCloseTo(x, 6)
      expect(back.z).toBeCloseTo(z, 6)
    }
  })

  it('is exact at the city rim, where a small-angle approximation would not be', () => {
    // 1400 units on a 4300-unit planet is ~18 degrees; tan(18 deg) differs from 18 deg by ~3%,
    // which at this extent is 45 metres of drift in where the walker thinks the ground is.
    const x = 1400
    const dir = site.clone().multiplyScalar(4300).addScaledVector(u, x).normalize()
    expect(cityLocalFromDirection(site, u, v, 4300, dir).x).toBeCloseTo(x, 6)
    const naive = 4300 * Math.asin(dir.dot(u))
    expect(Math.abs(naive - x)).toBeGreaterThan(10) // the approximation really is that far off
  })

  it('refuses a direction on the far side of the planet rather than reflecting it', () => {
    expect(cityLocalFromDirection(site, u, v, 4300, site.clone().negate())).toEqual({ x: 0, z: 0 })
  })
})
