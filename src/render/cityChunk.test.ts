import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, buildCityChunk, computeCityLayout, computeWindowPixels } from './cityChunk'
import { computeCitySites } from './citySites'

describe('computeCityLayout', () => {
  it('is deterministic and returns buildings plus block pads', () => {
    const a = computeCityLayout(4242, 2)
    const b = computeCityLayout(4242, 2)
    expect(a.buildings.length).toBe(b.buildings.length)
    expect(a.pads.length).toBe(b.pads.length)
    expect(a.buildings[0]).toEqual(b.buildings[0])
  })

  it('lays a dense fabric — several buildings per block, pads under every block', () => {
    const metro = computeCityLayout(7, 2)
    const town = computeCityLayout(7, 0)
    expect(metro.pads.length).toBeGreaterThanOrEqual(300)
    expect(metro.buildings.length).toBeGreaterThanOrEqual(600)
    expect(metro.buildings.length).toBeLessThanOrEqual(2200)
    expect(metro.buildings.length / metro.pads.length).toBeGreaterThan(1.8)
    expect(town.buildings.length).toBeGreaterThanOrEqual(40)
  })

  it('keeps everything inside the tier radius with tight footprints', () => {
    expect(CITY_ROAD).toBe(24)
    const extent = CITY_TIER_RADIUS[2]
    const { buildings, pads } = computeCityLayout(99, 2)
    for (const b of buildings) {
      expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(extent + CITY_BLOCK)
      expect(b.w).toBeGreaterThanOrEqual(12)
      expect(b.w).toBeLessThanOrEqual(32)
      expect(b.d).toBeGreaterThanOrEqual(12)
      expect(b.d).toBeLessThanOrEqual(32)
      expect(b.h).toBeGreaterThan(0)
    }
    for (const p of pads) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(extent + CITY_BLOCK)
  })

  it('follows a tower power law — few tall, many low', () => {
    const heights = computeCityLayout(123, 2).buildings.map((b) => b.h).sort((a, b) => a - b)
    expect(heights[Math.floor(heights.length / 2)]).toBeLessThan(60)
    expect(heights[heights.length - 1]).toBeGreaterThan(120)
  })
})

describe('computeWindowPixels', () => {
  it('draws a lit-window grid on a dark facade', () => {
    const size = 64
    const px = computeWindowPixels(size, 9)
    expect(px.length).toBe(size * size * 4)
    let litCount = 0
    let dark = 0
    for (let i = 0; i < size * size; i++) {
      const r = px[i * 4]
      if (r > 120) litCount++
      if (r < 24) dark++
    }
    const litRatio = litCount / (size * size)
    expect(litRatio).toBeGreaterThan(0.08)
    expect(litRatio).toBeLessThan(0.5)
    expect(dark / (size * size)).toBeGreaterThan(0.4)
  })

  it('is deterministic per seed and varies across seeds', () => {
    expect(computeWindowPixels(64, 9)).toEqual(computeWindowPixels(64, 9))
    expect(computeWindowPixels(64, 9)).not.toEqual(computeWindowPixels(64, 10))
  })
})

describe('buildCityChunk', () => {
  const sites = computeCitySites(1274, 4300, 8)
  const planetPos = new THREE.Vector3(0, -4000, 18000)

  it('creates pad + building instanced meshes anchored near the surface, windows on sides only', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    const meshes = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    expect(meshes.length).toBe(2)
    const [pads, bodies] = meshes
    expect(pads.count).toBeGreaterThanOrEqual(200)
    expect(bodies.count).toBeGreaterThanOrEqual(450)
    expect(Array.isArray(bodies.material)).toBe(true)
    const mats = bodies.material as THREE.Material[]
    expect(mats.length).toBe(6)
    expect((mats[0] as THREE.MeshStandardMaterial).emissiveMap).not.toBeNull()
    expect((mats[2] as THREE.MeshStandardMaterial).emissiveMap).toBeNull()
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    bodies.getMatrixAt(0, m)
    pos.setFromMatrixPosition(m)
    const dist = pos.distanceTo(planetPos)
    expect(dist).toBeGreaterThan(4300 * 0.95)
    expect(dist).toBeLessThan(4300 * 1.1)
    chunk.dispose()
  })

  it('update() night-gates the window emissive and dispose() empties the group', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    chunk.update(1)
    const meshes = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    const side = (meshes[1].material as THREE.Material[])[0] as THREE.MeshStandardMaterial
    expect(side.emissiveIntensity).toBeGreaterThan(0.6)
    chunk.update(0)
    expect(side.emissiveIntensity).toBe(0)
    chunk.dispose()
    expect(chunk.group.children.length).toBe(0)
  })
})
