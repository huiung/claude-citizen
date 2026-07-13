import * as THREE from 'three'
import { samplePlanetSurface } from './planetTextures'
import { computePadMarkingPixels, computePadWorld, PAD_DECK_HEIGHT, PAD_RADIUS } from './cityPad'
import {
  CITY_BLOCK, CITY_ROAD, CITY_TERRAIN_SCALE, CITY_TIER_RADIUS, cityGroundRadius, cityTangentFrame,
  computeCityLayout, SHEET_LIFT, SKIRT_MARGIN,
} from './cityLayout'
import type { CitySite } from './citySites'

// Layout primitives live in cityLayout (shared with cityPad); re-exported so existing
// consumers keep their import site.
export { CITY_BLOCK, CITY_ROAD, CITY_TIER_RADIUS, computeCityLayout } from './cityLayout'
export type { BuildingSpec } from './cityLayout'

// Deterministic PRNG — duplicated per repo convention (see starSky.ts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Streaming altitude band for the full-geometry chunk: build below, drop above — the
 *  gap between them is a dead zone so hovering at the boundary can't thrash a build. */
export const CITY_CHUNK_BUILD_ALT = 1200
export const CITY_CHUNK_DROP_ALT = 2000
/** A newly-nearest site must win by this much ground distance before the chunk swaps. */
const CHUNK_SWITCH_HYSTERESIS = 150

/** Which site (if any) owns the single streamed chunk this frame. Real megacities sit
 *  closer together than one chunk footprint (London–Paris is ~230u here, Seoul–Tokyo
 *  ~770u) — geometry for all nearby sites would interpenetrate into one continent-wide
 *  slab, so exactly one materializes: the nearest, with hysteresis on the switch and
 *  wider keep-bands than build-bands on both altitude and ground distance. */
export function selectChunkSite(
  sites: readonly CitySite[], shipDir: THREE.Vector3, radius: number, alt: number, activeIdx: number | null,
): number | null {
  if (sites.length === 0) return null
  let nearest = -1
  let nearestArc = Infinity
  for (let i = 0; i < sites.length; i++) {
    const arc = shipDir.angleTo(sites[i].direction) * radius // ground distance to the city
    if (arc < nearestArc) { nearestArc = arc; nearest = i }
  }
  if (activeIdx !== null && activeIdx !== nearest && activeIdx < sites.length) {
    const activeArc = shipDir.angleTo(sites[activeIdx].direction) * radius
    if (activeArc < nearestArc + CHUNK_SWITCH_HYSTERESIS) { nearest = activeIdx; nearestArc = activeArc }
  }
  const reach = CITY_TIER_RADIUS[sites[nearest].tier]
  if (activeIdx === nearest) {
    return alt > CITY_CHUNK_DROP_ALT || nearestArc > reach + 4200 ? null : nearest
  }
  return alt < CITY_CHUNK_BUILD_ALT && nearestArc < reach + 2600 ? nearest : null
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
  /** skypad deck-top centre (world) — the landing target */
  padCenter: THREE.Vector3
  padNormal: THREE.Vector3
  update(nightFactor: number, timeSec: number): void
  dispose(): void
}

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
  const { u, v } = cityTangentFrame(n) // shared with cityPad — the beam and the pad must agree
  const OFFSETS = [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]] as const

  interface Placement { w: number; d: number; h: number; dir: THREE.Vector3; ground: number }
  /** 5-point terrain anchor with center water gate (v1 technique kept). */
  function place(x: number, z: number, w: number, d: number, h: number): Placement | null {
    if (Math.hypot(x, z) > extent - SKIRT_MARGIN) return null // the sheet dives here
    let ground = Infinity
    let centerGround = 0
    let dirC: THREE.Vector3 | null = null
    for (const [ox, oz] of OFFSETS) {
      const dirS = n.clone().multiplyScalar(radius).addScaledVector(u, x + ox).addScaledVector(v, z + oz).normalize()
      const t = samplePlanetSurface('earth', planetSeed, dirS.x, dirS.y, dirS.z, undefined, radius)
      if (ox === 0 && oz === 0) {
        if (t.height < 0.05) return null // ocean/coast — skip this lot
        centerGround = radius + t.height * radius * CITY_TERRAIN_SCALE
        dirC = dirS
      }
      ground = Math.min(ground, radius + t.height * radius * CITY_TERRAIN_SCALE)
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
    let g = cityGroundRadius(radius, t.height) + SHEET_LIFT
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
  // Daylight-readable urban fabric: sRGB greys below ~0x60 sit under 10% linear
  // reflectance and read as burnt rubble next to the ~45%-albedo Blue Marble terrain,
  // so these run light. Night look is unaffected — it comes from the emissive maps.
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x5d646c, roughness: 0.95, metalness: 0,
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
    color: 0x8a9099, roughness: 0.85, metalness: 0.05,
    emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: windowTexture,
  })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.95, metalness: 0 })
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (12 indices each). The renderer emits one
  // draw call PER GROUP even when groups share a material, so merge the default 6 groups into
  // 3 — windows on the four sides, plain roof on ±y — keeping the city at 4 draw calls total.
  unitBox.clearGroups()
  unitBox.addGroup(0, 12, 0) // +x, -x sides (6 indices per face)
  unitBox.addGroup(12, 12, 1) // +y, -y roof/underside
  unitBox.addGroup(24, 12, 0) // +z, -z sides
  const bodies = new THREE.InstancedMesh(unitBox, [sideMat, roofMat], bodyPlacements.length)

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

  // --- Skypad: landing deck + pulsing edge ring (spot chosen by cityPad's
  // deterministic lot, shared with the guidance beam in main) ---
  const pad = computePadWorld(site, planetPos, planetSeed, radius)
  const markTex = new THREE.DataTexture(computePadMarkingPixels(64), 64, 64, THREE.RGBAFormat)
  markTex.colorSpace = THREE.SRGBColorSpace
  markTex.magFilter = THREE.LinearFilter
  markTex.minFilter = THREE.LinearFilter
  markTex.needsUpdate = true
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab, roughness: 0.9, metalness: 0.05, // daylight-readable concrete (sRGB 0x8x+ lesson)
    emissive: 0xffd9a8, emissiveIntensity: 0.35, emissiveMap: markTex,
  })
  const deckGeo = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS * 1.08, PAD_DECK_HEIGHT, 8)
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.quaternion.setFromUnitVectors(up, pad.normal)
  deck.position.copy(pad.center).addScaledVector(pad.normal, -PAD_DECK_HEIGHT / 2) // padCenter is the top face — cylinder origin is mid-height
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc86e, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  const ringGeo = new THREE.TorusGeometry(PAD_RADIUS * 0.92, 1.5, 6, 32)
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.quaternion.copy(deck.quaternion)
  ring.rotateX(Math.PI / 2) // lay the torus flat on the deck face
  ring.position.copy(pad.center).addScaledVector(pad.normal, 0.8)

  const group = new THREE.Group()
  group.add(ground)
  group.add(bodies)
  group.add(deck)
  group.add(ring)
  return {
    group,
    padCenter: pad.center,
    padNormal: pad.normal,
    update(nightFactor: number, timeSec: number) {
      sideMat.emissiveIntensity = nightFactor * 1.2
      groundMat.emissiveIntensity = nightFactor * 0.95
      const pulse = 0.7 + 0.3 * Math.sin(timeSec * 2.4)
      deckMat.emissiveIntensity = (0.35 + nightFactor * 0.85) * pulse
      ringMat.opacity = (0.35 + nightFactor * 0.5) * pulse
    },
    dispose() {
      group.remove(ground)
      group.remove(bodies)
      group.remove(deck)
      group.remove(ring)
      groundGeo.dispose()
      groundMat.dispose()
      glowTexture.dispose()
      unitBox.dispose()
      sideMat.dispose()
      roofMat.dispose()
      windowTexture.dispose()
      bodies.dispose()
      deckGeo.dispose()
      deckMat.dispose()
      markTex.dispose()
      ringGeo.dispose()
      ringMat.dispose()
    },
  }
}
