import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyHullDetail, tuneHullMaterials } from './hullDetail'
import { applyHullGreebles } from './hullGreebles'
import { rcsPortLayout, RCS_PORT_COLOR, type RcsPort } from './rcs'
import type { ShipType } from '../sim/shipTypes'
import type { HolderShipVisualId } from '../ui/holderShipVisual'

const gltfLoader = new GLTFLoader()

const CRAFT_MODEL_URLS: Record<ShipType, string> = {
  hauler: '/assets/ships/hauler.glb',
  fighter: '/assets/ships/fighter.glb',
  miner: '/assets/ships/miner.glb',
  interceptor: '/assets/ships/interceptor.glb',
}
const HOLDER_DOGE_RUNNER_MODEL_URL = '/assets/ships/holder-doge-runner.glb'
const HOLDER_VOID_INTERCEPTOR_MODEL_URL = '/assets/ships/holder-void-interceptor.glb'
const HOLDER_SOVEREIGN_WRAITH_MODEL_URL = '/assets/ships/holder-sovereign-wraith.glb'
const HOLDER_ECLIPSE_CORVETTE_MODEL_URL = '/assets/ships/holder-eclipse-corvette.glb'
const HOLDER_ABYSSAL_DRILLER_MODEL_URL = '/assets/ships/holder-abyssal-driller.glb'

const CRAFT_MODEL_TARGET_SIZES: Record<ShipType, number> = {
  hauler: 9.5,
  fighter: 8.2,
  miner: 9,
  interceptor: 8.4,
}

const PIRATE_MODEL_URL = '/assets/ships/pirate-raider.glb'
const PIRATE_MODEL_TARGET_SIZE = 8.8
const CAPITAL_MODEL_URL = '/assets/ships/capital-dreadnought.glb'
const CAPITAL_CARRIER_MODEL_URL = '/assets/ships/capital-carrier.glb'
const CAPITAL_MODEL_TARGET_SIZE = 620
const SEASON_HUB_MODEL_URL = '/assets/landmarks/citizen-season-1-hub.glb'
const SEASON_HUB_MODEL_TARGET_SIZE = 1700

type CraftModelSceneLoader = (url: string) => Promise<THREE.Group>
type CraftModelLoader = (url: string, targetSize?: number) => Promise<THREE.Group | null>

export type CraftEngineGlowRole = 'disc' | 'core'

export interface CraftEngineGlow {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  role: CraftEngineGlowRole
}

interface EngineGlowUserData {
  craftEngineGlow?: {
    role: CraftEngineGlowRole
  }
}

interface EngineGlowMount {
  x: number
  y: number
  z: number
  color: number
  r: number
}

const CRAFT_ENGINE_GLOW_MOUNTS: Record<ShipType, readonly EngineGlowMount[]> = {
  hauler: [
    { x: -1.95, y: 0, z: 1.71, color: 0x7fd4ff, r: 0.4 },
    { x: 1.95, y: 0, z: 1.71, color: 0x7fd4ff, r: 0.4 },
    { x: -0.6, y: 0.45, z: 2.95, color: 0x9fe0ff, r: 0.32 },
    { x: 0.6, y: 0.45, z: 2.95, color: 0x9fe0ff, r: 0.32 },
    { x: -0.6, y: -0.45, z: 2.95, color: 0x9fe0ff, r: 0.32 },
    { x: 0.6, y: -0.45, z: 2.95, color: 0x9fe0ff, r: 0.32 },
  ],
  fighter: [
    { x: -0.4, y: 0, z: 2.36, color: 0x9fe0ff, r: 0.26 },
    { x: 0.4, y: 0, z: 2.36, color: 0x9fe0ff, r: 0.26 },
  ],
  miner: [
    { x: -0.9, y: 0.5, z: 3.82, color: 0xffb24d, r: 0.32 },
    { x: 0.9, y: 0.5, z: 3.82, color: 0xffb24d, r: 0.32 },
    { x: -0.9, y: -0.5, z: 3.82, color: 0xffb24d, r: 0.32 },
    { x: 0.9, y: -0.5, z: 3.82, color: 0xffb24d, r: 0.32 },
  ],
  interceptor: [
    { x: -0.55, y: 0, z: 2.66, color: 0xff5a3c, r: 0.4 },
    { x: 0.55, y: 0, z: 2.66, color: 0xff5a3c, r: 0.4 },
  ],
}

export function craftModelUrl(type: ShipType): string {
  return CRAFT_MODEL_URLS[type]
}

export function craftModelUrlForHolderVisual(type: ShipType, visual: HolderShipVisualId, holderTier: number): string {
  if (visual === 'doge-runner' && holderTier >= 2) return HOLDER_DOGE_RUNNER_MODEL_URL
  if (visual === 'void-interceptor' && holderTier >= 3) return HOLDER_VOID_INTERCEPTOR_MODEL_URL
  if (visual === 'sovereign-wraith' && holderTier >= 3) return HOLDER_SOVEREIGN_WRAITH_MODEL_URL
  if (visual === 'eclipse-corvette' && holderTier >= 3) return HOLDER_ECLIPSE_CORVETTE_MODEL_URL
  if (visual === 'abyssal-driller' && holderTier >= 3) return HOLDER_ABYSSAL_DRILLER_MODEL_URL
  return CRAFT_MODEL_URLS[type]
}

export function craftModelTargetSizeForHolderVisual(type: ShipType, visual: HolderShipVisualId, holderTier: number): number {
  if (visual === 'doge-runner' && holderTier >= 2) return 9.7
  if (visual === 'void-interceptor' && holderTier >= 3) return 10.5
  if (visual === 'sovereign-wraith' && holderTier >= 3) return 12.2
  if (visual === 'eclipse-corvette' && holderTier >= 3) return 15
  if (visual === 'abyssal-driller' && holderTier >= 3) return 14.8
  return CRAFT_MODEL_TARGET_SIZES[type]
}

export function pirateModelUrl(): string {
  return PIRATE_MODEL_URL
}

export function capitalModelUrl(): string {
  return CAPITAL_MODEL_URL
}

export function capitalCarrierModelUrl(): string {
  return CAPITAL_CARRIER_MODEL_URL
}

export function seasonHubModelUrl(): string {
  return SEASON_HUB_MODEL_URL
}

export function addCraftEngineGlowRig(group: THREE.Group, type: ShipType): void {
  for (const mount of CRAFT_ENGINE_GLOW_MOUNTS[type]) {
    addEngineGlow(group, mount.x, mount.y, mount.z, mount.color, mount.r)
  }
}

export function collectCraftEngineGlows(root: THREE.Object3D): CraftEngineGlow[] {
  const glows: CraftEngineGlow[] = []
  root.traverse((child) => {
    const meta = (child.userData as EngineGlowUserData).craftEngineGlow
    if (!meta || !(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) return
    glows.push({ mesh: child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, role: meta.role })
  })
  return glows
}

/** Flag on the mesh's userData rather than a name match: `collectCraftRcsThrusters` runs on whatever
 *  hull happens to be installed, procedural or GLB or holder skin, and a GLB node is free to be named
 *  anything the generator liked. */
export const RCS_MESH_FLAG = 'craftRcsPort'

interface RcsUserData {
  craftRcsPort?: RcsPort
}

export interface CraftRcsThruster {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  port: RcsPort
  /** Smoothed drive, owned by whoever updates the rig each frame. Lives here so the caller does not
   *  need a parallel array keyed by index. */
  drive: number
}

/** Bolt twelve attitude-thruster puffs onto a hull, derived from its own bounding box.
 *
 *  Derived rather than hand-authored per ship, unlike `CRAFT_ENGINE_GLOW_MOUNTS`. There are thirteen
 *  GLBs across four base hulls and five holder skins plus the procedural placeholders, and only the
 *  base four have mount tables — the holder skins already borrow their base type's engine mounts, which
 *  is visible on the corvette. A bounding box is the one thing every one of them has, and the ports are
 *  at hull extremities where a box is a good approximation of the skin.
 *
 *  Call this BEFORE `addCraftEngineGlowRig`: the box has to be the hull's, and the engine glow discs
 *  would otherwise be folded into it.
 */
export function addCraftRcsRig(group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return
  // One geometry for the whole rig, scaled per port. Unit radius so `rcsPortStyle().scale` and the
  // port's own radius multiply cleanly into `mesh.scale`.
  const geometry = new THREE.SphereGeometry(1, 8, 6)
  for (const port of rcsPortLayout({
    minX: box.min.x, maxX: box.max.x,
    minY: box.min.y, maxY: box.max.y,
    minZ: box.min.z, maxZ: box.max.z,
  })) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: RCS_PORT_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }))
    mesh.position.set(port.x, port.y, port.z)
    mesh.scale.setScalar(port.radius)
    mesh.visible = false // idle hull: no draw call at all until a thruster is asked for
    mesh.name = `rcs_${port.name}`
    ;(mesh.userData as RcsUserData).craftRcsPort = port
    group.add(mesh)
  }
}

export function collectCraftRcsThrusters(root: THREE.Object3D): CraftRcsThruster[] {
  const thrusters: CraftRcsThruster[] = []
  root.traverse((child) => {
    const port = (child.userData as RcsUserData).craftRcsPort
    if (!port || !(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) return
    thrusters.push({ mesh: child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, port, drive: 0 })
  })
  return thrusters
}

function craftModelCacheKey(url: string, targetSize: number): string {
  return `${url}#${targetSize}`
}

/** Clone a material for one spawned instance, keeping the shader patches the load pass installed.
 *
 *  `Material.copy()` walks a fixed list of value properties; `onBeforeCompile` is a prototype METHOD
 *  and is not on that list, so a plain `clone()` silently reverts to three.js's no-op and the clone
 *  compiles an unpatched shader. Everything hullDetail sets — colour, metalness, the detail maps — is
 *  a value and does survive, which is what makes the loss so easy to miss: the hull looks patched.
 *  Copying the reference (rather than a per-clone wrapper) also keeps every instance sharing one
 *  program, since three.js keys the program cache on `onBeforeCompile.toString()`. */
function cloneCraftMaterial(material: THREE.Material): THREE.Material {
  const clone = material.clone()
  clone.onBeforeCompile = material.onBeforeCompile
  return clone
}

function cloneCraftModelInstance(source: THREE.Group): THREE.Group {
  const instance = source.clone(true)
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry = child.geometry.clone()
    child.material = Array.isArray(child.material)
      ? child.material.map(cloneCraftMaterial)
      : cloneCraftMaterial(child.material)
  })
  return instance
}

function normalizeCraftModel(model: THREE.Group, targetSize: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const s = targetSize / maxDim
  model.scale.setScalar(s)
  model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s)) // recenter at origin
  const group = new THREE.Group()
  group.add(model)
  return group
}

export function createCraftModelLoader(
  loadScene: CraftModelSceneLoader = async (url) => (await gltfLoader.loadAsync(url)).scene,
): CraftModelLoader {
  const sourceCache = new Map<string, Promise<THREE.Group | null>>()
  return async (url: string, targetSize = 8): Promise<THREE.Group | null> => {
    const key = craftModelCacheKey(url, targetSize)
    let source = sourceCache.get(key)
    if (!source) {
      source = loadScene(url)
        .then((model) => normalizeCraftModel(model, targetSize))
        // Detail maps go on the cached source, so this runs once per (url, size) rather than per
        // spawned instance — clones copy the materials but share the same textures, so the upload
        // happens once for the whole fleet. What a clone does NOT inherit is `onBeforeCompile`; see
        // cloneCraftMaterial.
        // Isolated from the .catch below on purpose: detail is cosmetic, and letting it share that
        // handler would turn "no canvas 2d context" into "this hull failed to load", silently
        // dropping every player back to the procedural placeholder.
        .then((model) => {
          if (!model) return model
          // Greebles FIRST, so the two material passes below reach the geometry they add as well as the
          // asset's own. Their material is cloned from the hull's dominant one and still carries the
          // GLB's authored colour at this point, so it goes through the luminance floor, the ground
          // fill and the environment probe alongside the panel it is bolted to — which is what keeps
          // greebles from drifting into looking like a different alloy after any future tuning.
          try { applyHullGreebles(model) } catch { /* keep the bare hull */ }
          // Material tuning second: detail maps only read on a surface bright enough to show them.
          try { tuneHullMaterials(model) } catch { /* keep the authored materials */ }
          try { applyHullDetail(model) } catch { /* keep the undetailed hull */ }
          return model
        })
        .catch(() => null)
      sourceCache.set(key, source)
    }
    const cached = await source
    return cached ? cloneCraftModelInstance(cached) : null
  }
}

/** Load a generated GLB hull, normalized to game scale (by bounding box) and wrapped in a
 *  Group so the caller drives a stable transform. Returns null on 404/parse failure
 *  so callers can fall back to the procedural hull. Nose alignment is tuned per-asset. */
export const loadCraftModel = createCraftModelLoader()

export async function loadCraftModelForType(type: ShipType, holderTier = 0, visual: HolderShipVisualId = 'standard'): Promise<THREE.Group | null> {
  return loadCraftModel(
    craftModelUrlForHolderVisual(type, visual, holderTier),
    craftModelTargetSizeForHolderVisual(type, visual, holderTier),
  )
}

export async function loadPirateModel(): Promise<THREE.Group | null> {
  return loadCraftModel(PIRATE_MODEL_URL, PIRATE_MODEL_TARGET_SIZE)
}

export async function loadCapitalModel(): Promise<THREE.Group | null> {
  return loadCraftModel(CAPITAL_MODEL_URL, CAPITAL_MODEL_TARGET_SIZE)
}

export async function loadCapitalCarrierModel(): Promise<THREE.Group | null> {
  return loadCraftModel(CAPITAL_CARRIER_MODEL_URL, CAPITAL_MODEL_TARGET_SIZE)
}

export async function loadSeasonHubModel(): Promise<THREE.Group | null> {
  return loadCraftModel(SEASON_HUB_MODEL_URL, SEASON_HUB_MODEL_TARGET_SIZE)
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
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }))
  disc.position.set(x, y, z)
  ;(disc.userData as EngineGlowUserData).craftEngineGlow = { role: 'disc' }
  group.add(disc)
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.5, 10), new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }))
  core.position.set(x, y, z + 0.02)
  ;(core.userData as EngineGlowUserData).craftEngineGlow = { role: 'core' }
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
