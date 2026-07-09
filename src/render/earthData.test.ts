import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetEarthDataForTests, _setEarthRastersForTests, dirToEquirectUv, isEarthDataReady,
  latLonToDir, sampleEarthElevation,
} from './earthData'

describe('latLonToDir / dirToEquirectUv', () => {
  it('round-trips real city coordinates through the sphere mapping', () => {
    for (const [lat, lon] of [[37.57, 126.98], [-33.87, 151.21], [0, 0], [51.51, -0.13]] as const) {
      const dir = latLonToDir(lat, lon)
      expect(dir.length()).toBeCloseTo(1, 6)
      const { u, v } = dirToEquirectUv(dir.x, dir.y, dir.z)
      expect(u).toBeCloseTo((lon + 180) / 360, 5)
      expect(v).toBeCloseTo((90 - lat) / 180, 5)
    }
  })

  it('maps the poles to v=0 (north) and v=1 (south)', () => {
    expect(dirToEquirectUv(0, 1, 0).v).toBeCloseTo(0, 6)
    expect(dirToEquirectUv(0, -1, 0).v).toBeCloseTo(1, 6)
  })

  it('wraps longitude across the date line into [0,1)', () => {
    const east = latLonToDir(0, 179.9)
    const west = latLonToDir(0, -179.9)
    const uEast = dirToEquirectUv(east.x, east.y, east.z).u
    const uWest = dirToEquirectUv(west.x, west.y, west.z).u
    expect(uEast).toBeGreaterThan(0.999)
    expect(uWest).toBeLessThan(0.001)
  })
})

describe('sampleEarthElevation', () => {
  beforeEach(() => _resetEarthDataForTests())

  it('is not ready before rasters load', () => {
    expect(isEarthDataReady()).toBe(false)
  })

  /** 4x2 synthetic world: west half deep ocean (bath 40), east half land (bath 255)
   *  with elevation ramping 0 → 255. */
  function injectSyntheticWorld() {
    const w = 4, h = 2
    const elev = new Uint8ClampedArray([0, 0, 100, 255, 0, 0, 100, 255])
    const bath = new Uint8ClampedArray([40, 40, 255, 255, 40, 40, 255, 255])
    _setEarthRastersForTests(elev, bath, w, h)
  }

  it('classifies water from the bathymetry raster with ocean-depth heights', () => {
    injectSyntheticWorld()
    expect(isEarthDataReady()).toBe(true)
    const dir = latLonToDir(0, -135) // u=0.125 → first column, pure ocean
    const s = sampleEarthElevation(dir.x, dir.y, dir.z)
    expect(s.water).toBe(true)
    expect(s.height).toBeLessThan(-0.18) // deep water sits below the old procedural sea level
    expect(s.height).toBeGreaterThan(-0.27)
  })

  it('maps land elevation into the procedural height range (0.06..0.40)', () => {
    injectSyntheticWorld()
    const low = sampleEarthElevation(...latLonToDir(0, 45).toArray() as [number, number, number]) // u=0.625 → elev 100
    expect(low.water).toBe(false)
    expect(low.height).toBeCloseTo(0.06 + (100 / 255) * 0.34, 3)
    const high = sampleEarthElevation(...latLonToDir(0, 135).toArray() as [number, number, number]) // u=0.875 → elev 255
    expect(high.height).toBeCloseTo(0.4, 3)
  })

  it('bilinearly interpolates between texels', () => {
    const w = 4, h = 2
    // all land; elevation 0 and 200 in adjacent columns
    const elev = new Uint8ClampedArray([0, 200, 0, 0, 0, 200, 0, 0])
    const bath = new Uint8ClampedArray(8).fill(255)
    _setEarthRastersForTests(elev, bath, w, h)
    // longitude halfway between texel centers of columns 0 and 1 → mean elevation 100
    const dir = latLonToDir(0, -135 + 45) // u = 0.25 → px 0.5 → 50/50 blend
    const s = sampleEarthElevation(dir.x, dir.y, dir.z)
    expect(s.height).toBeCloseTo(0.06 + (100 / 255) * 0.34, 3)
  })
})
