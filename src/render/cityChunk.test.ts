import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, buildCityChunk, computeCityLayout, computeStreetGlowPixels, computeWindowPixels } from './cityChunk'
import { computeCitySites } from './citySites'

describe('computeCityLayout', () => {
  it('is deterministic per seed', () => {
    const a = computeCityLayout(4242, 2)
    const b = computeCityLayout(4242, 2)
    expect(a.length).toBe(b.length)
    expect(a[0]).toEqual(b[0])
  })

  it('lays a dense fabric — several buildings per block', () => {
    const metro = computeCityLayout(7, 2)
    const town = computeCityLayout(7, 0)
    expect(metro.length).toBeGreaterThanOrEqual(600)
    expect(metro.length).toBeLessThanOrEqual(2200)
    expect(town.length).toBeGreaterThanOrEqual(40)
    expect(metro.length).toBeGreaterThan(town.length * 3)
  })

  it('keeps everything inside the tier radius with tight footprints', () => {
    const extent = CITY_TIER_RADIUS[2]
    expect(CITY_BLOCK + CITY_ROAD).toBe(120) // street lattice tile == one cell
    for (const b of computeCityLayout(99, 2)) {
      expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(extent + CITY_BLOCK)
      expect(b.w).toBeGreaterThanOrEqual(12)
      expect(b.w).toBeLessThanOrEqual(32)
      expect(b.d).toBeGreaterThanOrEqual(12)
      expect(b.d).toBeLessThanOrEqual(32)
      expect(b.h).toBeGreaterThan(0)
    }
  })

  it('follows a tower power law — few tall, many low', () => {
    const heights = computeCityLayout(123, 2).map((b) => b.h).sort((a, b) => a - b)
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

describe('computeStreetGlowPixels', () => {
  it('lights the tile borders (street lattice) and keeps the block interior dark', () => {
    const size = 64
    const px = computeStreetGlowPixels(size)
    expect(px.length).toBe(size * size * 4)
    expect(px[0]).toBe(255) // corner — street light
    const centre = ((size / 2) * size + size / 2) * 4
    expect(px[centre]).toBe(0) // block interior stays dark
    // border width matches the road share of a cell
    const expected = Math.max(2, Math.round((size * (CITY_ROAD / 2)) / (CITY_BLOCK + CITY_ROAD)))
    expect(px[((size / 2) * size + (expected - 1)) * 4]).toBe(255)
    expect(px[((size / 2) * size + (expected + 1)) * 4]).toBe(0)
  })
})

describe('buildCityChunk', () => {
  const sites = computeCitySites(1274, 4300, 8)
  const planetPos = new THREE.Vector3(0, -4000, 18000)

  it('creates one terrain-hugging ground sheet plus building instances near the surface', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    const instanced = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    const plain = chunk.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh))
    expect(instanced.length).toBe(1) // bodies
    expect(plain.length).toBe(1) // ground sheet
    const [bodies] = instanced
    const [ground] = plain
    expect(bodies.count).toBeGreaterThanOrEqual(450)
    const groundMat = ground.material as THREE.MeshStandardMaterial
    expect(groundMat.emissiveMap).not.toBeNull()
    expect(groundMat.emissiveMap!.wrapS).toBe(THREE.RepeatWrapping)
    // ground vertices bend onto the sphere: interior vertices sit near the planet
    // surface (plane corners are skirt vertices that dive below terrain by design)
    const gp = ground.geometry.getAttribute('position') as THREE.BufferAttribute
    const vpos = new THREE.Vector3()
    const side = Math.sqrt(gp.count) // (seg+1) per row
    const mid = Math.floor(side / 2)
    for (const i of [mid * side + mid, mid * side + Math.floor(side / 4), Math.floor(side / 4) * side + mid]) {
      vpos.fromBufferAttribute(gp, i).add(ground.position).sub(planetPos)
      expect(vpos.length()).toBeGreaterThan(4300 * 0.95)
      expect(vpos.length()).toBeLessThan(4300 * 1.1)
    }
    const mats = bodies.material as THREE.Material[]
    expect(mats.length).toBe(2) // sides + roof — one draw call each, 4 total per city with ground
    expect(bodies.geometry.groups.length).toBe(3) // ±x sides / ±y roof / ±z sides
    expect((mats[0] as THREE.MeshStandardMaterial).emissiveMap).not.toBeNull()
    expect((mats[1] as THREE.MeshStandardMaterial).emissiveMap).toBeNull() // roof (±y) has no windows
    expect(bodies.geometry.groups[1].materialIndex).toBe(1) // ±y faces → roof material
    const m = new THREE.Matrix4()
    const bpos = new THREE.Vector3()
    bodies.getMatrixAt(0, m)
    bpos.setFromMatrixPosition(m)
    const dist = bpos.distanceTo(planetPos)
    expect(dist).toBeGreaterThan(4300 * 0.95)
    expect(dist).toBeLessThan(4300 * 1.1)
    chunk.dispose()
  })

  it('update() night-gates windows and street glow; dispose() empties the group', () => {
    const chunk = buildCityChunk(sites[0], planetPos, 1274, 4300)
    chunk.update(1)
    const instanced = chunk.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    const plain = chunk.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh))
    const side = (instanced[0].material as THREE.Material[])[0] as THREE.MeshStandardMaterial // sides material
    const groundMat = plain[0].material as THREE.MeshStandardMaterial
    expect(side.emissiveIntensity).toBeGreaterThan(0.6)
    expect(groundMat.emissiveIntensity).toBeGreaterThan(0.4)
    chunk.update(0)
    expect(side.emissiveIntensity).toBe(0)
    expect(groundMat.emissiveIntensity).toBe(0)
    chunk.dispose()
    expect(chunk.group.children.length).toBe(0)
  })
})
