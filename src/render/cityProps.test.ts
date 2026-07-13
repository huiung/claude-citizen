import { describe, expect, it } from 'vitest'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, computeCityLayout, SKIRT_MARGIN } from './cityLayout'
import { computePropLayout } from './cityProps'

const buildings = computeCityLayout(1234, 2)
const layout = computePropLayout(1234, 2, buildings)

describe('computePropLayout', () => {
  it('is deterministic', () => {
    expect(computePropLayout(1234, 2, buildings)).toEqual(layout)
  })

  it('puts masts on roughly 40% of buildings, offsets inside the footprint', () => {
    const ratio = layout.masts.length / buildings.length
    expect(ratio).toBeGreaterThan(0.3)
    expect(ratio).toBeLessThan(0.5)
    for (const m of layout.masts) {
      const b = buildings[m.buildingIdx]
      expect(Math.abs(m.ox)).toBeLessThanOrEqual(b.w / 2)
      expect(Math.abs(m.oz)).toBeLessThanOrEqual(b.d / 2)
      expect(m.h).toBeGreaterThanOrEqual(9)
      expect(m.h).toBeLessThanOrEqual(18)
    }
  })

  it('puts tanks only on large-footprint buildings, fully inside the roof', () => {
    expect(layout.tanks.length).toBeGreaterThan(0)
    for (const t of layout.tanks) {
      const b = buildings[t.buildingIdx]
      expect(b.w * b.d).toBeGreaterThanOrEqual(400)
      expect(Math.abs(t.ox) + t.r).toBeLessThanOrEqual(b.w / 2)
      expect(Math.abs(t.oz) + t.r).toBeLessThanOrEqual(b.d / 2)
    }
  })

  it('beacons sit on the tallest buildings, split near-evenly into two phase groups', () => {
    const count = layout.beaconsA.length + layout.beaconsB.length
    expect(count).toBe(Math.max(2, Math.round(buildings.length * 0.15)))
    expect(Math.abs(layout.beaconsA.length - layout.beaconsB.length)).toBeLessThanOrEqual(1)
    const minBeaconH = Math.min(...[...layout.beaconsA, ...layout.beaconsB].map((x) => buildings[x.buildingIdx].h))
    const nonBeacon = buildings.filter((_, i) =>
      !layout.beaconsA.some((x) => x.buildingIdx === i) && !layout.beaconsB.some((x) => x.buildingIdx === i))
    for (const b of nonBeacon) expect(b.h).toBeLessThanOrEqual(minBeaconH)
  })

  it('lamps land on street-grid intersections inside the skirt radius', () => {
    expect(layout.lamps.length).toBeGreaterThan(100) // tier 2: 수백 기
    const extent = CITY_TIER_RADIUS[2]
    const cell = CITY_BLOCK + CITY_ROAD
    for (const l of layout.lamps) {
      expect(Math.hypot(l.x, l.z)).toBeLessThan(extent - SKIRT_MARGIN)
      // 교차점 격자 정합: (x + extent)가 cell의 정수배
      expect(Math.abs((l.x + extent) / cell - Math.round((l.x + extent) / cell))).toBeLessThan(1e-9)
      expect(Math.abs((l.z + extent) / cell - Math.round((l.z + extent) / cell))).toBeLessThan(1e-9)
    }
  })
})
