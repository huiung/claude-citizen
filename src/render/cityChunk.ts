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

export interface BuildingSpec {
  /** tangent-plane offsets from the site centre */
  x: number
  z: number
  /** footprint + height */
  w: number
  d: number
  h: number
  /** 0..1 how brightly this building's windows glow at night */
  lit: number
}

/** Block-grid city layout, pure and deterministic: square blocks with road gaps, random
 *  vacant lots (parks), footprint jitter inside each block, and a power-law height
 *  distribution boosted toward the core so downtown grows a few real towers. */
export function computeCityLayout(siteSeed: number, tier: 0 | 1 | 2): BuildingSpec[] {
  const rand = mulberry32(siteSeed)
  const extent = CITY_TIER_RADIUS[tier]
  const block = 96
  const road = 24
  const cell = block + road
  const cells = Math.floor((extent * 2) / cell)
  const specs: BuildingSpec[] = []
  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const cx = -extent + cell * (gx + 0.5)
      const cz = -extent + cell * (gz + 0.5)
      const r = Math.hypot(cx, cz)
      if (r > extent) continue // round city edge
      if (rand() < 0.18) continue // parks / vacant lots
      const core = Math.max(0, 1 - r / extent)
      const perCell = rand() < 0.35 ? 2 : 1
      for (let b = 0; b < perCell; b++) {
        const w = 18 + rand() * 42
        const d = 18 + rand() * 42
        const h = 12 + Math.pow(rand(), 5.0) * 200 * (0.25 + core * 0.75) + rand() * 18
        specs.push({
          x: cx + (rand() - 0.5) * (block - w),
          z: cz + (rand() - 0.5) * (block - d),
          w, d, h,
          lit: 0.35 + rand() * 0.65,
        })
      }
    }
  }
  return specs
}

export interface CityChunk {
  group: THREE.Group
  update(nightFactor: number): void
  dispose(): void
}

/** Build one city as TWO instanced meshes: dark building bodies (visible by day) and a
 *  slightly inflated additive "lit windows" shell that update() fades in at night.
 *  Each instance follows the sphere: its own surface normal for orientation and the
 *  sampled terrain height for its base, so the grid hugs the planet's curvature. */
export function buildCityChunk(site: CitySite, planetPos: THREE.Vector3, planetSeed: number, radius: number): CityChunk {
  const specs = computeCityLayout(site.seed, site.tier)
  const n = site.direction
  const u = (Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).cross(n).normalize()
  const v = n.clone().cross(u).normalize()

  const bodyGeo = new THREE.BoxGeometry(1, 1, 1)
  bodyGeo.translate(0, 0.5, 0) // origin at the base so height scales upward
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2b323b, roughness: 0.92, metalness: 0.05,
    emissive: 0xffb45e, emissiveIntensity: 0,
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffc06a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })

  // First pass: sample terrain per building and DROP WATER CELLS — on the real seed half
  // the sites have ocean inside their footprint (rim bays); buildings must not stand in
  // the sea. InstancedMesh counts are therefore computed AFTER filtering.
  const OFFSETS = [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]] as const
  const placements: { s: BuildingSpec; dir: THREE.Vector3; ground: number; hBoost: number }[] = []
  for (const s of specs) {
    let ground = Infinity
    let centerGround = 0
    let water = false
    let dirC: THREE.Vector3 | null = null
    for (const [ox, oz] of OFFSETS) {
      const dirS = n.clone().multiplyScalar(radius).addScaledVector(u, s.x + ox).addScaledVector(v, s.z + oz).normalize()
      const t = samplePlanetSurface('earth', planetSeed, dirS.x, dirS.y, dirS.z, undefined, radius)
      if (ox === 0 && oz === 0) {
        if (t.height < 0.05) { water = true; break } // ocean/coast — skip this lot
        centerGround = radius + t.height * radius * 0.055 * 1.6
        dirC = dirS
      }
      ground = Math.min(ground, radius + t.height * radius * 0.055 * 1.6)
    }
    if (water || !dirC) continue
    // base at the lowest nearby terrain (mesh interpolates between ~140u-spaced vertices,
    // so the analytic centre alone leaves ~12% of buildings hovering); the height boost
    // keeps the roof where the layout intended it.
    placements.push({ s, dir: dirC, ground, hBoost: centerGround - ground })
  }
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, placements.length)
  const glow = new THREE.InstancedMesh(bodyGeo, glowMat, placements.length)

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const litColor = new THREE.Color()
  placements.forEach(({ s, dir, ground, hBoost }, i) => {
    q.setFromUnitVectors(up, dir)
    pos.copy(planetPos).addScaledVector(dir, ground - 2) // sink slightly to close float gaps
    m.compose(pos, q, scl.set(s.w, s.h + hBoost, s.d))
    bodies.setMatrixAt(i, m)
    m.compose(pos, q, scl.set(s.w * 1.03, (s.h + hBoost) * 1.01, s.d * 1.03))
    glow.setMatrixAt(i, m)
    glow.setColorAt(i, litColor.setScalar(s.lit))
  })
  bodies.instanceMatrix.needsUpdate = true
  glow.instanceMatrix.needsUpdate = true
  if (glow.instanceColor) glow.instanceColor.needsUpdate = true

  const group = new THREE.Group()
  group.add(bodies)
  group.add(glow)
  return {
    group,
    update(nightFactor: number) {
      bodyMat.emissiveIntensity = nightFactor * 0.55
      glowMat.opacity = nightFactor * 0.3
    },
    dispose() {
      group.remove(bodies)
      group.remove(glow)
      bodyGeo.dispose()
      bodyMat.dispose()
      glowMat.dispose()
      bodies.dispose()
      glow.dispose()
    },
  }
}
