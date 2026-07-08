import * as THREE from 'three'
import { samplePlanetSurface } from './planetTextures'
import type { CitySite } from './citySites'

// Deterministic PRNG — duplicated per repo convention (see starSky.ts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** City footprint radius (tangent-plane units ≈ metres) per tier: town / city / metropolis. */
export const CITY_TIER_RADIUS = [500, 900, 1400] as const

export const CITY_BLOCK = 96
export const CITY_ROAD = 24

export interface BuildingSpec { x: number; z: number; w: number; d: number; h: number }

/** Dense block-grid, pure and deterministic: 3-5 tight-footprint (12-32u) buildings per
 *  built block, 18% plaza blocks, power-law heights peaking downtown. Streets are drawn
 *  by the ground sheet's repeating grid texture, so the layout only emits buildings. */
export function computeCityLayout(siteSeed: number, tier: 0 | 1 | 2): BuildingSpec[] {
  const rand = mulberry32(siteSeed)
  const extent = CITY_TIER_RADIUS[tier]
  const cell = CITY_BLOCK + CITY_ROAD
  const cells = Math.floor((extent * 2) / cell)
  const buildings: BuildingSpec[] = []
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx = -extent + cell * (gx + 0.5)
      const cz = -extent + cell * (gz + 0.5)
      const r = Math.hypot(cx, cz)
      if (r > extent) continue
      if (rand() < 0.18) continue // plaza/park — paved but unbuilt
      const core = Math.max(0, 1 - r / extent)
      const perBlock = 3 + Math.floor(rand() * 3) // 3-5
      for (let b = 0; b < perBlock; b++) {
        const w = 12 + rand() * 20
        const d = 12 + rand() * 20
        const h = 10 + Math.pow(rand(), 5.0) * 210 * (0.2 + core * 0.8) + rand() * 14
        buildings.push({
          x: cx + (rand() - 0.5) * (CITY_BLOCK - w - 6),
          z: cz + (rand() - 0.5) * (CITY_BLOCK - d - 6),
          w, d, h,
        })
      }
    }
  }
  return buildings
}

/** Procedural facade: 8x16 window grid, ~40% lit warm, dark mullions/facade. Used as an
 *  emissiveMap so the windows only appear as the night factor rises. Pure, canvas-free. */
export function computeWindowPixels(size = 64, seed = 9): Uint8Array<ArrayBuffer> {
  const rand = mulberry32(seed)
  const data = new Uint8Array(size * size * 4)
  const cols = 8
  const rows = 16
  const cw = size / cols
  const rh = size / rows
  const lit: number[] = []
  for (let i = 0; i < cols * rows; i++) lit.push(rand() < 0.4 ? 0.5 + rand() * 0.5 : 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = Math.min(cols - 1, Math.floor(x / cw))
      const wy = Math.min(rows - 1, Math.floor(y / rh))
      const inPane = x - wx * cw >= 2 && x - wx * cw < cw - 2 && y - wy * rh >= 1 && y - wy * rh < rh - 1
      const level = inPane ? lit[wy * cols + wx] : 0
      const i = (y * size + x) * 4
      data[i] = Math.round(255 * level)
      data[i + 1] = Math.round(214 * level)
      data[i + 2] = Math.round(160 * level)
      data[i + 3] = 255
    }
  }
  return data
}

/** One tile of the street lattice (repeats once per city cell): warm street-light lines
 *  along the tile edges, dark elsewhere. Used as the ground sheet's emissiveMap — at
 *  night the repeating borders fuse into a CONTINUOUS glowing road grid. */
export function computeStreetGlowPixels(size = 64): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * 4)
  const border = Math.max(2, Math.round((size * (CITY_ROAD / 2)) / (CITY_BLOCK + CITY_ROAD)))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x < border || x >= size - border || y < border || y >= size - border
      const i = (y * size + x) * 4
      data[i] = edge ? 255 : 0
      data[i + 1] = edge ? 200 : 0
      data[i + 2] = edge ? 140 : 0
      data[i + 3] = 255
    }
  }
  return data
}

export interface CityChunk {
  group: THREE.Group
  update(nightFactor: number): void
  dispose(): void
}

/** Radial lift applied to the whole city (sheet AND buildings). The planet render mesh
 *  linearly interpolates between its vertices, so in rough terrain its surface can sit
 *  well above the analytic sample — lift the city fabric clear of those chords. */
const SHEET_LIFT = 30

/** One city: a single ground sheet BENT onto the planet (each vertex follows the analytic
 *  terrain, water clamped to coast level so bays become harbor platforms) carrying a
 *  repeating street-grid emissiveMap — rigid pads can never tile a curved bumpy surface,
 *  a curved sheet with a texture lattice can. Buildings are one InstancedMesh whose side
 *  faces carry procedural lit windows; both glows are night-gated via update(). */
export function buildCityChunk(site: CitySite, planetPos: THREE.Vector3, planetSeed: number, radius: number): CityChunk {
  const buildingSpecs = computeCityLayout(site.seed, site.tier)
  const extent = CITY_TIER_RADIUS[site.tier]
  const cell = CITY_BLOCK + CITY_ROAD
  const n = site.direction
  const u = (Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).cross(n).normalize()
  const v = n.clone().cross(u).normalize()
  const OFFSETS = [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]] as const

  interface Placement { w: number; d: number; h: number; dir: THREE.Vector3; ground: number }
  /** 5-point terrain anchor with center water gate (v1 technique kept). */
  function place(x: number, z: number, w: number, d: number, h: number): Placement | null {
    if (Math.hypot(x, z) > extent - 24) return null // skirt zone — the sheet dives here
    let ground = Infinity
    let centerGround = 0
    let dirC: THREE.Vector3 | null = null
    for (const [ox, oz] of OFFSETS) {
      const dirS = n.clone().multiplyScalar(radius).addScaledVector(u, x + ox).addScaledVector(v, z + oz).normalize()
      const t = samplePlanetSurface('earth', planetSeed, dirS.x, dirS.y, dirS.z, undefined, radius)
      if (ox === 0 && oz === 0) {
        if (t.height < 0.05) return null // ocean/coast — skip this lot
        centerGround = radius + t.height * radius * 0.055 * 1.6
        dirC = dirS
      }
      ground = Math.min(ground, radius + t.height * radius * 0.055 * 1.6)
    }
    if (!dirC) return null
    return { w, d, h: h + (centerGround - ground), dir: dirC, ground }
  }

  // --- Ground sheet: plane grid bent onto the sphere, hugging the analytic terrain ---
  const groundSpan = extent * 2
  const seg = 40
  const groundGeo = new THREE.PlaneGeometry(groundSpan, groundSpan, seg, seg)
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute
  const vDir = new THREE.Vector3()
  for (let i = 0; i < gp.count; i++) {
    const lx = gp.getX(i)
    const ly = gp.getY(i)
    vDir.copy(n).multiplyScalar(radius).addScaledVector(u, lx).addScaledVector(v, ly).normalize()
    const t = samplePlanetSurface('earth', planetSeed, vDir.x, vDir.y, vDir.z, undefined, radius)
    // Water clamps to coast level: bays inside the footprint become flat harbor platforms
    // instead of holes (buildings still skip water, so those read as docks/plazas).
    let g = radius + Math.max(0.05, t.height) * radius * 0.055 * 1.6 + SHEET_LIFT
    const lr = Math.hypot(lx, ly)
    if (lr > extent) g -= (lr - extent) * 0.9 // skirt: dive underground past the round city edge
    vDir.multiplyScalar(g)
    gp.setXYZ(i, vDir.x, vDir.y, vDir.z)
  }
  gp.needsUpdate = true
  groundGeo.computeVertexNormals()

  const streetRepeat = groundSpan / cell // texture tile == one city cell, aligned to block centres
  const glowTexture = new THREE.DataTexture(computeStreetGlowPixels(64), 64, 64, THREE.RGBAFormat)
  glowTexture.colorSpace = THREE.SRGBColorSpace
  glowTexture.magFilter = THREE.LinearFilter
  glowTexture.minFilter = THREE.LinearFilter
  glowTexture.wrapS = THREE.RepeatWrapping
  glowTexture.wrapT = THREE.RepeatWrapping
  glowTexture.repeat.set(streetRepeat, streetRepeat)
  glowTexture.needsUpdate = true
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1c2026, roughness: 0.95, metalness: 0,
    emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: glowTexture,
  })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.position.copy(planetPos)

  // --- Buildings ---
  const bodyPlacements: Placement[] = []
  for (const b of buildingSpecs) {
    const placed = place(b.x, b.z, b.w, b.d, b.h)
    if (placed) bodyPlacements.push(placed)
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  unitBox.translate(0, 0.5, 0) // base-anchored so height scales upward

  const windowTexture = new THREE.DataTexture(computeWindowPixels(64, site.seed), 64, 64, THREE.RGBAFormat)
  windowTexture.colorSpace = THREE.SRGBColorSpace
  windowTexture.magFilter = THREE.LinearFilter
  windowTexture.minFilter = THREE.LinearFilter
  windowTexture.needsUpdate = true
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x39424d, roughness: 0.85, metalness: 0.05,
    emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: windowTexture,
  })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x232a31, roughness: 0.95, metalness: 0 })
  // BoxGeometry group order: +x, -x, +y(roof), -y, +z, -z — windows on the four sides only.
  const bodies = new THREE.InstancedMesh(unitBox, [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat], bodyPlacements.length)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const grey = new THREE.Color()
  const greyRand = mulberry32(site.seed ^ 0x9e37)
  bodyPlacements.forEach((p, i) => {
    q.setFromUnitVectors(up, p.dir)
    pos.copy(planetPos).addScaledVector(p.dir, p.ground + SHEET_LIFT - 2) // ride the lifted sheet
    m.compose(pos, q, scl.set(p.w, p.h, p.d))
    bodies.setMatrixAt(i, m)
    bodies.setColorAt(i, grey.setScalar(0.75 + greyRand() * 0.35))
  })
  bodies.instanceMatrix.needsUpdate = true
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true

  const group = new THREE.Group()
  group.add(ground)
  group.add(bodies)
  return {
    group,
    update(nightFactor: number) {
      sideMat.emissiveIntensity = nightFactor * 1.2
      groundMat.emissiveIntensity = nightFactor * 0.95
    },
    dispose() {
      group.remove(ground)
      group.remove(bodies)
      groundGeo.dispose()
      groundMat.dispose()
      glowTexture.dispose()
      unitBox.dispose()
      sideMat.dispose()
      roofMat.dispose()
      windowTexture.dispose()
      bodies.dispose()
    },
  }
}
