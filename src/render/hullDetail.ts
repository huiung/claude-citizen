import * as THREE from 'three'

/** Procedural surface detail for generated hulls.
 *
 *  Why: the ship GLBs ship with `images: 0, textures: 0` — every hull material is a flat solid
 *  colour. A flat-coloured panel has no surface information for light to catch, so it reads as
 *  paper no matter how well it is lit. This is the third of the three gaps against Star Citizen's
 *  look (the others being self-illumination and environment probes); it is the one that survives
 *  any lighting change, because it is about the surface rather than the light.
 *
 *  Why this approach and not lights: adding a light in three.js extends the per-fragment light
 *  loop for EVERY lit material in the scene — planets, stations, asteroids included, not just the
 *  ship. A detail map adds one texture fetch on hull materials only and leaves the light loop
 *  untouched, so the cost is bounded and local.
 *
 *  The hulls already carry TEXCOORD_0 on every primitive, so no re-UVing is needed. Those UVs are
 *  default per-primitive box UVs though: every panel spans the full 0..1 range regardless of its
 *  physical size. A single shared repeat would therefore render the same detail huge on a wing and
 *  microscopic on a strut. `repeat` is scaled per mesh from its bounding box to hold texel density
 *  roughly constant — quantised into a few buckets so the whole fleet shares a handful of Texture
 *  instances rather than uploading one per mesh (repeat lives on the Texture, not the Material).
 */

const DETAIL_TEXTURE_SIZE = 256

/** Physical size (in model units) that one tile of detail should span. Chosen so a ~7-unit hull
 *  shows plate seams at a plausible spacing rather than either a single giant plate or noise. */
const TILE_WORLD_SIZE = 0.9

/** Strength of the normal perturbation.
 *
 *  Measured, not guessed. Studio A/B at `?dist=0.55` (`?detail=off` against `?nscale=`) shows the
 *  original 0.55 producing a frame indistinguishable from no detail map at all, on a hull whose
 *  label confirmed 19 of 30 materials were carrying one. The cause is the source texture rather
 *  than the code: the seams deviate about 32/255 from flat and the machining noise is drawn at
 *  half alpha, so a normalScale under 1 leaves a perturbation smaller than the tone curve can
 *  resolve. 2.5 is where plate seams and surface grain read on the hauler and miner at close and
 *  mid range; by 4 the noise has coarsened into visible speckle that reads as dirt.
 *
 *  Scaling here rather than redrawing the canvases keeps the change to one reviewable number, and
 *  the deviation stays well inside 8-bit range at 2.5, so nothing bands.
 *
 *  This is a close-range effect by design. At the studio's default framing the detail is nearly
 *  gone even at 3 — that is mipmapping doing its job, not a failure. */
const DETAIL_NORMAL_SCALE = 2.5

/** Repeat values are snapped to these, so a fleet needs this many Texture instances at most. */
const REPEAT_BUCKETS = [1, 2, 3, 5, 8] as const

function snapRepeat(raw: number): number {
  let best: number = REPEAT_BUCKETS[0]
  for (const b of REPEAT_BUCKETS) {
    if (Math.abs(b - raw) < Math.abs(best - raw)) best = b
  }
  return best
}

/** Tangent-space normal map: plate seams plus fine machining noise. Flat RGB (128,128,255) is
 *  "no perturbation", so every feature is a deviation from that. */
function drawDetailNormalCanvas(): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = DETAIL_TEXTURE_SIZE
  // No 2D context: headless test envs, and browsers that refuse one under memory pressure or a
  // hardened canvas policy. Detail is cosmetic, so bail out — never let it break hull loading.
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = 'rgb(128,128,255)'
  ctx.fillRect(0, 0, DETAIL_TEXTURE_SIZE, DETAIL_TEXTURE_SIZE)

  // Plate seams: a groove reads as one dark and one light lip, which is what makes it look cut
  // into the surface rather than drawn on it.
  const seam = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = 'rgb(96,128,236)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgb(160,128,236)'
    ctx.fillRect(x + (w > h ? 0 : 1), y + (w > h ? 1 : 0), w, h)
  }
  seam(0, DETAIL_TEXTURE_SIZE * 0.5, DETAIL_TEXTURE_SIZE, 1) // horizontal plate join
  seam(DETAIL_TEXTURE_SIZE * 0.33, 0, 1, DETAIL_TEXTURE_SIZE * 0.5) // two shorter verticals, so
  seam(DETAIL_TEXTURE_SIZE * 0.72, DETAIL_TEXTURE_SIZE * 0.5, 1, DETAIL_TEXTURE_SIZE * 0.5) // the
  // tiling does not read as a regular grid.

  // Fine machining noise. Deterministic (no Math.random) so the texture is identical across
  // reloads and two studio captures never differ by the noise.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rand() * DETAIL_TEXTURE_SIZE)
    const y = Math.floor(rand() * DETAIL_TEXTURE_SIZE)
    const bump = rand() > 0.5
    ctx.fillStyle = bump ? 'rgba(150,138,252,0.5)' : 'rgba(106,118,252,0.5)'
    ctx.fillRect(x, y, 1 + Math.floor(rand() * 2), 1)
  }

  return canvas
}

/** Roughness variation: mottling so specular highlights break up instead of sweeping a uniform
 *  sheen across a whole panel. Mid grey = leave the material's own roughness roughly alone. */
function drawDetailRoughnessCanvas(): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = DETAIL_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = 'rgb(150,150,150)'
  ctx.fillRect(0, 0, DETAIL_TEXTURE_SIZE, DETAIL_TEXTURE_SIZE)

  let seed = 0x85ebca6b
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let i = 0; i < 700; i++) {
    const x = rand() * DETAIL_TEXTURE_SIZE
    const y = rand() * DETAIL_TEXTURE_SIZE
    const r = 3 + rand() * 14
    const light = rand() > 0.5
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, light ? 'rgba(196,196,196,0.34)' : 'rgba(104,104,104,0.34)')
    g.addColorStop(1, 'rgba(150,150,150,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

interface DetailSource {
  normal: HTMLCanvasElement
  roughness: HTMLCanvasElement
  /** One Texture pair per repeat bucket, shared across every hull in the fleet. */
  byRepeat: Map<number, { normal: THREE.Texture; roughness: THREE.Texture }>
}

let source: DetailSource | null = null
/** Distinguishes "not built yet" from "cannot be built here", so a failed attempt is not retried
 *  for every mesh of every hull. */
let sourceUnavailable = false

function detailSource(): DetailSource | null {
  if (sourceUnavailable) return null
  if (!source) {
    const normal = drawDetailNormalCanvas()
    const roughness = drawDetailRoughnessCanvas()
    if (!normal || !roughness) { sourceUnavailable = true; return null }
    source = { normal, roughness, byRepeat: new Map() }
  }
  return source
}

function texturesForRepeat(repeat: number): { normal: THREE.Texture; roughness: THREE.Texture } | null {
  const src = detailSource()
  if (!src) return null
  const existing = src.byRepeat.get(repeat)
  if (existing) return existing

  const make = (canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.Texture => {
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.colorSpace = colorSpace
    tex.anisotropy = 4
    tex.needsUpdate = true
    return tex
  }
  // Normal and roughness are DATA, not colour — sampling them through sRGB decode would skew both.
  const pair = {
    normal: make(src.normal, THREE.NoColorSpace),
    roughness: make(src.roughness, THREE.NoColorSpace),
  }
  src.byRepeat.set(repeat, pair)
  return pair
}

/** True for materials that are their own light source — glow discs, nav lights, canopy glass.
 *  Perturbing the normal of a panel that emits rather than reflects only adds noise to a flat
 *  colour, and a roughness map does nothing at all for it. */
function isEmissiveSurface(mat: THREE.MeshStandardMaterial): boolean {
  if (mat.emissive && mat.emissive.getHex() !== 0x000000 && mat.emissiveIntensity > 0) return true
  return /glow|emissive|light|glass|window|canop/i.test(mat.name)
}

/** Reflectance floor for a hull surface, as relative luminance.
 *
 *  The generated GLBs contain surfaces far below anything a camera could resolve: the
 *  `dark_gunmetal` shared by every hull sits at 0.011 — 1.1% reflectance, darker than coal (~4%)
 *  and approaching a light trap. At metalness 0.72 with no environment map to sample, such a
 *  surface has neither a diffuse response (metalness cancels it) nor a specular one (nothing to
 *  reflect), so it renders black under any light rig. Two separate attempts to fix this with
 *  lighting — an image-based environment, then a brighter hemisphere fill — both measured as no
 *  change, for exactly this reason.
 *
 *  0.085 is roughly dark grey machine paint: still clearly the "dark" material next to a lighter
 *  hull panel, but able to describe a shape. */
const MIN_BASE_LUMINANCE = 0.085

/** Metalness ceiling while the scene has no environment map.
 *
 *  In PBR a metal's appearance IS its reflection of the surroundings; its diffuse term is scaled
 *  toward zero as metalness rises. High metalness is therefore only meaningful with something to
 *  reflect. Until a proper environment probe exists (the Star Citizen approach: capture the
 *  genuinely bright nearby planet, not a fabricated dark box), capping metalness converts hulls
 *  from black mirrors-of-nothing into surfaces that respond to the lights that do exist. */
const MAX_METALNESS_WITHOUT_ENV = 0.4

const _lumColor = new THREE.Color()

function relativeLuminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** Raise `color` to at least the luminance floor, preserving hue. Returns true if it changed.
 *  Exported shape is pure so the thresholds are testable without a GPU. */
export function liftToLuminanceFloor(color: THREE.Color, floor = MIN_BASE_LUMINANCE): boolean {
  const lum = relativeLuminance(color)
  if (lum >= floor) return false
  if (lum <= 1e-6) {
    // Pure black carries no hue to preserve — go neutral rather than pick one arbitrarily.
    color.setScalar(floor)
    return true
  }
  const scale = floor / lum
  // Scaling can push a saturated channel past 1; clamping there would shift the hue, so cap the
  // scale at whatever keeps the brightest channel in range and accept a slightly lower luminance.
  const maxChannel = Math.max(color.r, color.g, color.b)
  color.multiplyScalar(Math.min(scale, maxChannel > 0 ? 1 / maxChannel : scale))
  return true
}

const _box = new THREE.Box3()
const _size = new THREE.Vector3()

/** Make hull materials respond to the lights the scene actually has.
 *
 *  Applied at load to every generated hull, so it covers all twelve GLBs — the four base classes,
 *  the five holder skins and the capital ships — without regenerating any of them. Three of the
 *  four base-hull generator scripts are lost, so a load-time pass is also the only route that
 *  reaches the whole fleet.
 *
 *  Leaves emissive surfaces alone: they are their own light source, and dimming or de-metalling a
 *  glow disc or a nav light would only break the one part of the ship that already reads.
 */
export function tuneHullMaterialsForNoEnvironment(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    for (const raw of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !('roughness' in mat) || seen.has(mat)) continue
      seen.add(mat)
      if (isEmissiveSurface(mat)) continue

      if (mat.metalness > MAX_METALNESS_WITHOUT_ENV) mat.metalness = MAX_METALNESS_WITHOUT_ENV
      _lumColor.copy(mat.color)
      if (liftToLuminanceFloor(_lumColor)) mat.color.copy(_lumColor)
      mat.needsUpdate = true
    }
  })
}

/** Overrides for the detail pass, so the ship studio can sweep several values in one capture run
 *  instead of needing a source edit and a reload per value. Production passes nothing and gets the
 *  constants above. */
export interface HullDetailTuning {
  /** Strength of the normal perturbation. 0 leaves the surface geometrically flat. */
  normalScale?: number
  /** Model units one detail tile spans — smaller means denser, finer plating. */
  tileWorldSize?: number
}

/** Attach detail maps to every reflective hull material under `root`, in place.
 *  Idempotent: a material that already carries a normalMap is left alone, so calling this twice
 *  (or on an already-processed cached model) cannot stack textures. */
export function applyHullDetail(root: THREE.Object3D, tuning: HullDetailTuning = {}): void {
  const normalScale = tuning.normalScale ?? DETAIL_NORMAL_SCALE
  const tileWorldSize = tuning.tileWorldSize ?? TILE_WORLD_SIZE
  if (!detailSource()) return // no canvas here — hulls load undetailed rather than not at all
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    // No UVs means no way to place the map; the generated hulls all have them, but imported or
    // future assets might not, and a missing TEXCOORD_0 would sample garbage.
    if (!mesh.geometry.getAttribute('uv')) return

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

    _box.setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute)
    _box.getSize(_size)
    // Largest two extents drive density: for a thin plate the thickness should not decide the tiling.
    const extents = [_size.x, _size.y, _size.z].sort((a, b) => b - a)
    const face = Math.max(1e-3, (extents[0] + extents[1]) * 0.5)
    const repeat = snapRepeat(face / tileWorldSize)

    for (const raw of materials) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !(mat as THREE.Material).isMaterial) continue
      if (!('roughness' in mat)) continue // not a Standard/Physical material
      if (mat.normalMap) continue // already detailed
      if (isEmissiveSurface(mat)) continue

      const pair = texturesForRepeat(repeat)
      if (!pair) return
      const { normal, roughness } = pair
      mat.normalMap = normal
      mat.normalScale.set(normalScale, normalScale)
      mat.roughnessMap = roughness
      mat.needsUpdate = true
    }
  })
}

/** Remove the detail maps this module attached. Exists for the studio's A/B rig: `?detail=off`
 *  against `?detail=on` is the only comparison that answers "is the detail map visible at all",
 *  and re-tuning needs the maps off before `applyHullDetail` will re-attach them (it skips any
 *  material that already has a normalMap). Not used in the game. */
export function stripHullDetail(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    for (const raw of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !('roughness' in mat)) continue
      if (!mat.normalMap) continue
      mat.normalMap = null
      mat.roughnessMap = null
      mat.needsUpdate = true
    }
  })
}

/** Release the shared textures. For tests and hot-reload; the fleet normally keeps them forever. */
export function disposeHullDetail(): void {
  if (!source) return
  for (const { normal, roughness } of source.byRepeat.values()) {
    normal.dispose()
    roughness.dispose()
  }
  source = null
}

export const HULL_DETAIL_INTERNALS = { REPEAT_BUCKETS, TILE_WORLD_SIZE, snapRepeat, isEmissiveSurface }
