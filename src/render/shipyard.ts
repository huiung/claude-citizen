import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ShipType } from '../sim/shipTypes'

const gltfLoader = new GLTFLoader()

const CRAFT_MODEL_URLS: Record<ShipType, string> = {
  hauler: '/assets/ships/hauler.glb',
  fighter: '/assets/ships/fighter.glb',
  miner: '/assets/ships/miner.glb',
  interceptor: '/assets/ships/interceptor.glb',
}

const CRAFT_MODEL_TARGET_SIZES: Record<ShipType, number> = {
  hauler: 9.5,
  fighter: 8.2,
  miner: 9,
  interceptor: 8.4,
}

const PIRATE_MODEL_URL = '/assets/ships/pirate-raider.glb'
const PIRATE_MODEL_TARGET_SIZE = 8.8

export function craftModelUrl(type: ShipType): string {
  return CRAFT_MODEL_URLS[type]
}

export function pirateModelUrl(): string {
  return PIRATE_MODEL_URL
}

/** Load a generated GLB hull, normalized to game scale (by bounding box) and wrapped in a
 *  Group so the caller drives a stable transform. Returns null on 404/parse failure
 *  so callers can fall back to the procedural hull. Nose alignment is tuned per-asset. */
export async function loadCraftModel(url: string, targetSize = 8): Promise<THREE.Group | null> {
  try {
    const gltf = await gltfLoader.loadAsync(url)
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const s = targetSize / maxDim
    model.scale.setScalar(s)
    model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s)) // recenter at origin
    const group = new THREE.Group()
    group.add(model)
    return group
  } catch {
    return null
  }
}

export async function loadCraftModelForType(type: ShipType): Promise<THREE.Group | null> {
  return loadCraftModel(CRAFT_MODEL_URLS[type], CRAFT_MODEL_TARGET_SIZES[type])
}

export async function loadPirateModel(): Promise<THREE.Group | null> {
  return loadCraftModel(PIRATE_MODEL_URL, PIRATE_MODEL_TARGET_SIZE)
}

/**
 * Shipyard — procedural low-poly flat-shaded hulls, one distinct silhouette per
 * ship class. No asset files: the silhouette is the identity, exactly as in
 * render/ship.ts. Forward is -Z throughout. The 'hauler' case reproduces the
 * stock craft from ship.ts so the catalog and the live ship read identically.
 *
 * render-only: this module must NOT import game logic from sim/ (the ShipType
 * union is a type-only import and erases at compile time).
 */
export function buildCraft(type: ShipType, color: number): THREE.Group {
  switch (type) {
    case 'hauler':
      return buildHauler(color)
    case 'fighter':
      return buildFighter(color)
    case 'miner':
      return buildMiner(color)
    case 'interceptor':
      return buildInterceptor(color)
  }
}

/** Shared material factory — keeps the flat-shaded low-poly look consistent.
 *  `accent` is a brighter, faintly-emissive trim derived from the hull tint (glows
 *  under bloom); `glass` reads as a lit canopy. */
function makeMaterials(color: number): {
  hull: THREE.MeshStandardMaterial
  dark: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
} {
  const accentColor = new THREE.Color(color).offsetHSL(0, 0.12, 0.2)
  return {
    hull: new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.5, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x242a32, flatShading: true, metalness: 0.6, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x66e0ff, flatShading: true, emissive: 0x2a6688, emissiveIntensity: 1.4, metalness: 0.1, roughness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.45, flatShading: true, metalness: 0.3, roughness: 0.4 }),
  }
}

/** Glowing engine bell: a coloured disc with a white-hot core — pops under bloom. */
function addEngineGlow(group: THREE.Group, x: number, y: number, z: number, color: number, r: number): void {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color }))
  disc.position.set(x, y, z)
  group.add(disc)
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.5, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  core.position.set(x, y, z + 0.02)
  group.add(core)
}

/** Thin emissive accent stripe (a glowing panel line / racing trim). */
function addAccentStripe(group: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): void {
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  stripe.position.set(x, y, z)
  group.add(stripe)
}

/** Stock hauler — central cargo container, side nacelles, rear engine cluster,
 *  nose mining rig. Mirrors render/ship.ts buildShip so they read identically. */
function buildHauler(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat, accent: accentMat } = makeMaterials(color)

  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 4.2), hullMat)
  group.add(cargo)
  for (const z of [-1.1, 0, 1.1]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.22), darkMat)
    rib.position.z = z
    group.add(rib)
  }

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.4), darkMat)
  cockpit.position.set(0, 0.35, -2.7)
  group.add(cockpit)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.7), glassMat)
  canopy.position.set(0, 0.5, -3.2)
  group.add(canopy)

  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.6), darkMat)
    strut.position.set(side * 1.4, 0, 0.4)
    group.add(strut)
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.8, 6), hullMat)
    nacelle.rotation.x = Math.PI / 2
    nacelle.position.set(side * 1.95, 0, 0.3)
    group.add(nacelle)
    // Glowing accent ring around each nacelle.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 6, 12), accentMat)
    ring.position.set(side * 1.95, 0, -0.6)
    group.add(ring)
    addEngineGlow(group, side * 1.95, 0, 1.71, 0x7fd4ff, 0.4)
  }

  for (const [x, y] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]] as [number, number][]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.46, 1.0, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(x, y, 2.4)
    group.add(engine)
    addEngineGlow(group, x, y, 2.95, 0x9fe0ff, 0.32)
  }

  // Emissive trim stripes down the cargo flanks + a dorsal sensor antenna.
  for (const side of [-1, 1]) addAccentStripe(group, accentMat, 0.08, 0.5, 3.6, side * 1.12, 0.2, 0)
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), darkMat)
  mast.position.set(0, 1.05, 0.6)
  group.add(mast)
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: 0xff5a5a }))
  beacon.position.set(0, 1.55, 0.6)
  group.add(beacon)

  const rig = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.2), darkMat)
  rig.position.set(0, -0.7, -2.9)
  group.add(rig)
  const emitter = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshBasicMaterial({ color: 0x6fe8ff }))
  emitter.position.set(0, -0.7, -3.6)
  group.add(emitter)

  return group
}

/** Strike fighter — sleek dart fuselage, swept delta wings, twin engines, small
 *  forward canopy. Small footprint, all forward thrust, reads as a hot rod. */
function buildFighter(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat, accent: accentMat } = makeMaterials(color)

  // Slim tapering fuselage — a cone nose blended into a thin body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 3.4), hullMat)
  group.add(body)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 6), hullMat)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0, -2.4)
  group.add(nose)

  // Bubble canopy slightly forward and up.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.9), glassMat)
  canopy.position.set(0, 0.4, -0.9)
  group.add(canopy)

  // Swept delta wings — flat trapezoids angled back, the fighter signature.
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), hullMat)
    wing.position.set(side * 1.3, -0.05, 0.5)
    wing.rotation.y = side * -0.35
    group.add(wing)
    // Glowing leading-edge accent on each wing.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.12), accentMat)
    edge.position.set(side * 1.3, 0.02, -0.15)
    edge.rotation.y = side * -0.35
    group.add(edge)
    // Wingtip cannon.
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 5), darkMat)
    cannon.rotation.x = Math.PI / 2
    cannon.position.set(side * 2.3, -0.05, -0.3)
    group.add(cannon)
  }

  // Glowing nose tip + a dorsal spine stripe.
  const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0x9fe0ff }))
  tip.position.set(0, 0, -3.25)
  group.add(tip)
  addAccentStripe(group, accentMat, 0.1, 0.1, 2.8, 0, 0.4, 0.2)

  // Tail fin for that aerofoil read.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.9), darkMat)
  fin.position.set(0, 0.5, 1.4)
  group.add(fin)

  // Twin tail engines + glow.
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.9, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.4, 0, 1.9)
    group.add(engine)
    addEngineGlow(group, side * 0.4, 0, 2.36, 0x9fe0ff, 0.26)
  }

  return group
}

/** Mining rig — bulky boxy hull with a huge cargo drum, two forward drill arms
 *  ending in spinning bits, and squat heavy engines. Reads slow and industrial. */
function buildMiner(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat, accent: accentMat } = makeMaterials(color)

  // Heavy chassis.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 3.6), hullMat)
  group.add(chassis)

  // Big rear cargo drum — the defining mass.
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 10), hullMat)
  drum.rotation.x = Math.PI / 2
  drum.position.set(0, 0, 2.1)
  group.add(drum)
  // Drum bands — middle one glows as an accent ring.
  for (const z of [1.4, 2.1, 2.8]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.12, 6, 12), z === 2.1 ? accentMat : darkMat)
    band.position.set(0, 0, z)
    group.add(band)
  }

  // Forward cockpit block + visor.
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), darkMat)
  cockpit.position.set(0, 0.7, -2.0)
  group.add(cockpit)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.3), glassMat)
  visor.position.set(0, 0.75, -2.55)
  group.add(visor)

  // Two forward drill arms with conical drill bits — the mining read.
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 2.2), darkMat)
    arm.position.set(side * 1.1, -0.4, -2.4)
    group.add(arm)
    const drill = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 6), hullMat)
    drill.rotation.x = -Math.PI / 2
    drill.position.set(side * 1.1, -0.4, -3.8)
    group.add(drill)
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: 0xffd27f }))
    tip.position.set(side * 1.1, -0.4, -4.5)
    group.add(tip)
  }

  // Squat heavy engine block + dim glows.
  for (const [x, y] of [[-0.9, 0.5], [0.9, 0.5], [-0.9, -0.5], [0.9, -0.5]] as [number, number][]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.8, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(x, y, 3.4)
    group.add(engine)
    addEngineGlow(group, x, y, 3.82, 0xffb24d, 0.32)
  }

  // Hazard accent stripes along the chassis flanks — industrial read.
  for (const side of [-1, 1]) addAccentStripe(group, accentMat, 0.1, 0.4, 3.2, side * 1.52, 0.6, 0)

  return group
}

/** Pirate interceptor — angular arrowhead hull, forward-swept aggressive wings,
 *  underslung cannons, oversized rear engines. Sharp and predatory. */
function buildInterceptor(color: number): THREE.Group {
  const group = new THREE.Group()
  const { hull: hullMat, dark: darkMat, glass: glassMat, accent: accentMat } = makeMaterials(color)

  // Arrowhead fuselage — a flattened octahedron gives hard angular facets.
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), hullMat)
  body.scale.set(0.8, 0.5, 1.9)
  group.add(body)

  // Sharp piercing nose spike.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.0, 4), hullMat)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0, -2.6)
  group.add(nose)

  // Slit canopy.
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 1.0), glassMat)
  canopy.position.set(0, 0.35, -0.8)
  group.add(canopy)

  // Forward-swept angular wings — aggressive, leaning toward the prey.
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.1), darkMat)
    wing.position.set(side * 1.4, 0, 0.2)
    wing.rotation.y = side * 0.4
    wing.rotation.z = side * 0.18
    group.add(wing)
    // Underslung cannon pods.
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.6), hullMat)
    pod.position.set(side * 1.9, -0.25, -0.6)
    group.add(pod)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5), darkMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(side * 1.9, -0.25, -1.6)
    group.add(barrel)
  }

  // Twin dorsal tail fins, canted out — menacing.
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.0), darkMat)
    fin.position.set(side * 0.45, 0.6, 1.3)
    fin.rotation.z = side * -0.4
    group.add(fin)
  }

  // Glowing menace stripe along each forward-swept wing.
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.1), accentMat)
    edge.position.set(side * 1.4, 0.02, -0.35)
    edge.rotation.y = side * 0.4
    edge.rotation.z = side * 0.18
    group.add(edge)
  }

  // Oversized rear engines with hot red glow — pirate menace.
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.3, 6), darkMat)
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 0.55, 0, 2.0)
    group.add(engine)
    addEngineGlow(group, side * 0.55, 0, 2.66, 0xff5a3c, 0.4)
  }

  return group
}
