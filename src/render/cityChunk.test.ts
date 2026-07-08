import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CITY_TIER_RADIUS, buildCityChunk, computeCityLayout } from './cityChunk'
import { computeCitySites } from './citySites'

describe('computeCityLayout', () => {
  it('is deterministic per seed', () => {
    const a = computeCityLayout(4242, 2)
    const b = computeCityLayout(4242, 2)
    expect(a.length).toBe(b.length)
    expect(a[0]).toEqual(b[0])
  })

  it('scales building count with tier', () => {
    const town = computeCityLayout(7, 0).length
    const metro = computeCityLayout(7, 2).length
    expect(town).toBeGreaterThanOrEqual(20)
    expect(town).toBeLessThanOrEqual(200)
    expect(metro).toBeGreaterThanOrEqual(400)
    expect(metro).toBeLessThanOrEqual(1600)
    expect(metro).toBeGreaterThan(town * 3)
  })

  it('keeps every building inside the tier radius', () => {
    const extent = CITY_TIER_RADIUS[2]
    for (const b of computeCityLayout(99, 2)) {
      expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(extent + 60)
      expect(b.w).toBeGreaterThan(0)
      expect(b.d).toBeGreaterThan(0)
      expect(b.h).toBeGreaterThan(0)
      expect(b.lit).toBeGreaterThanOrEqual(0)
      expect(b.lit).toBeLessThanOrEqual(1)
    }
  })

  it('follows a tower power law — few tall, many low', () => {
    const heights = computeCityLayout(123, 2).map((b) => b.h).sort((a, b) => a - b)
    const median = heights[Math.floor(heights.length / 2)]
    const max = heights[heights.length - 1]
    expect(median).toBeLessThan(70)
    expect(max).toBeGreaterThan(120)
  })
})

describe('buildCityChunk', () => {
  const sites = computeCitySites(1274, 4300, 8)
  const planetPos = new THREE.Vector3(0, -4000, 18000)

  it('creates two instanced meshes covering every kept building, positioned near the planet surface', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    const meshes = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    expect(meshes.length).toBe(2)
    const layoutCount = meshes[0].count
    expect(meshes[1].count).toBe(layoutCount)
    // metropolis, minus lots dropped by the per-building water filter (rim bays are real
    // on this seed) — must stay a dense city but may be well under the raw layout count
    expect(layoutCount).toBeGreaterThanOrEqual(250)
    expect(layoutCount).toBeLessThanOrEqual(computeCityLayout(sites[0].seed, sites[0].tier).length)
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    meshes[0].getMatrixAt(0, m)
    pos.setFromMatrixPosition(m)
    const dist = pos.distanceTo(planetPos)
    expect(dist).toBeGreaterThan(4300 * 0.95)
    expect(dist).toBeLessThan(4300 * 1.1)
    chunk.dispose()
  })

  it('update() drives night emissive/glow and dispose() empties the group', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    chunk.update(1)
    const meshes = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    const body = meshes[0].material as THREE.MeshStandardMaterial
    const glow = meshes[1].material as THREE.MeshBasicMaterial
    expect(body.emissiveIntensity).toBeGreaterThan(0.3)
    expect(glow.opacity).toBeGreaterThan(0.1)
    chunk.update(0)
    expect(body.emissiveIntensity).toBe(0)
    expect(glow.opacity).toBe(0)
    chunk.dispose()
    expect(chunk.group.children.length).toBe(0)
  })
})
