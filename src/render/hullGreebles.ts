import * as THREE from 'three'
import { isSelfLitMaterial, liftToLuminanceFloor } from './hullDetail'

/** Procedural greebles — the surface clutter that makes a hull read as machinery.
 *
 *  The problem this solves is the silhouette, not the lighting. The generated hulls are 388-776
 *  triangles of intersecting boxes and cylinders; once the material work made them visible, what read
 *  was how few edges they have. Star Citizen's density comes from hand-authored high-poly assets and
 *  multi-hundred-megabyte texture sets, and this project's whole value is that it loads and flies with
 *  zero downloaded art — so the answer is not to chase that literally, it is to spend an order of
 *  magnitude more triangles that cost nothing to ship because they are generated at load.
 *
 *  Why at load, in the model loader, rather than in the generator scripts: three of the four base-hull
 *  generator scripts are lost (only `scripts/create-hauler.mjs` survives). A load-time pass is the only
 *  route that reaches the whole fleet — four base classes, five holder skins, two capital ships, the
 *  season hub and the pirate raider — without regenerating anything.
 *
 *  Why `InstancedMesh`: 500 -> 8,000 triangles is nothing for any GPU made this century, but 500
 *  separate draw calls would be. Everything here collapses into ONE draw call per greeble SHAPE, so the
 *  cost grows with variety (4) and not with count (~500). Per-instance colour carries the tonal
 *  variation that would otherwise have needed a second material, and therefore a second draw call, per
 *  shape.
 *
 *  Placement is derived from GEOMETRY, not from UVs. The hulls do carry `TEXCOORD_0` on every
 *  primitive, but those are default per-primitive box UVs — every panel spans the full 0..1 range
 *  regardless of its size — so there is no layout to place anything by. Triangles are walked instead,
 *  and each greeble is seated on a face with its up axis along that face's normal and its long axis
 *  along the face's longest edge. That last part is what makes the result read as panelling rather than
 *  as confetti: aligned clutter looks manufactured, randomly rotated clutter looks like a rash.
 *
 *  Deterministic by construction — a fixed seed advanced in traversal order, no `Math.random` — because
 *  two runs of `scripts/capture-ship-studio.mjs` that differ by the greeble layout are not a comparison
 *  of anything.
 */

/** Fraction of a hull's eligible surface that greebles cover. This, not a triangle count, is what sets
 *  the density.
 *
 *  Driving density from a triangle BUDGET was tried first and is wrong in an instructive way: a budget
 *  of "target minus what the asset already has" hands the most greebles to the asset with the fewest
 *  triangles, which is the fighter — the SMALLEST hull, with the least surface to put them on. Measured,
 *  that came out at roughly 47% coverage on the fighter against 23% on the hauler, and the capture shows
 *  exactly that: the hauler read as machinery while the fighter's delta wing had disappeared under a
 *  carpet of clutter, silhouette and all.
 *
 *  Coverage is the invariant that actually means "how detailed does this look", because greeble size is
 *  already hull-relative — so the same coverage puts the same amount of visual business on an 8-unit
 *  fighter and a 620-unit dreadnought. 0.16 is where a hull reads as covered in equipment rather than
 *  either bare or infested. */
const GREEBLE_COVERAGE = 0.16

/** Hard ceiling on total triangles, INCLUDING what the GLB already has.
 *
 *  A ceiling rather than a target now that coverage sets the density — its job is to bound the cost of
 *  a large or already-dense asset rather than to fill a quota. That is what lets one pass cover both a
 *  388-triangle fighter and the 59,852-triangle season hub with no per-asset table: the hub is already
 *  over the ceiling and gets nothing, which is right, because the hub was never what read as crude.
 *
 *  14,000 is inside the range this was aimed at. Well above ~20,000 the per-frame instance-matrix
 *  upload starts to matter with a dozen ships in a scene, and long before that the greebles are
 *  sub-pixel at any distance you actually see a ship from. */
const GREEBLE_TRIANGLE_TARGET = 14000

/** Greeble size as a fraction of the hull's longest extent.
 *
 *  Hull-relative rather than absolute because the fleet spans 8 units (fighter) to 1,700 (season hub)
 *  after normalisation, and any absolute size that reads on the fighter is invisible on a capital ship.
 *  0.014 puts a greeble at ~0.13 units on a 9.5-unit hauler — roughly a hand-sized panel on a
 *  five-metre craft, which is the scale real airframe clutter (access hatches, vents, antennas) sits at
 *  relative to the airframe. Smaller reads as finer, and finer is what "less crude" means: at a fixed
 *  coverage, halving the size quadruples the count. */
const GREEBLE_SIZE_FRACTION = 0.014

/** A part must be this many greebles across, in its two largest extents, to carry any.
 *
 *  Face area alone is not enough of a test, and the capture said so: a cannon barrel or a nose sensor
 *  can present a face wide enough to qualify while being barely thicker than the greeble itself, and
 *  what that produces is a starburst of blades sticking out of a thin cylinder in every direction. It
 *  read as debris hanging off the ship. A part has to be substantially bigger than its own detail. */
const MIN_SURFACE_SPAN_IN_GREEBLES = 5

/** A triangle must be this many greeble footprints in area before it carries one.
 *
 *  A greeble needs a face big enough to sit on: on a face comparable to its own footprint it overhangs
 *  every edge and reads as damage rather than as detail. Measured in footprints rather than in units, so
 *  it scales with the hull automatically. */
const MIN_FACE_AREA_IN_GREEBLES = 1.5

/** Most of a face's area greebles may cover.
 *
 *  This replaces a fixed per-triangle cap, which was the wrong shape and measurably so: a first pass
 *  with a cap of 6 placed 28 greebles on the interceptor and 143 on the hauler against a budget of
 *  ~510, because the hauler's cargo flank is TWO triangles of 8.5 square units each and both were
 *  clipped to 6. An area-derived ceiling instead says what it means — a face may not be more than half
 *  covered — and needs no retuning per hull, because a big face and a small one are both allowed their
 *  own share. */
const MAX_FACE_COVERAGE = 0.5

/** Absolute ceiling per triangle, purely as a bound on the worst case. Nothing should reach it; it
 *  exists so a degenerate asset with one enormous face cannot make a load take arbitrarily long. */
const HARD_CAP_PER_TRIANGLE = 64

/** Attempts allowed per accepted greeble.
 *
 *  Placements are rejected for being buried in another part of the hull or too close to something that
 *  must stay readable, and without retries every rejection was a greeble the budget never got back —
 *  which is the other half of why the first pass came in at a fifth of its target. Retrying is cheap
 *  and self-limiting: a face that is entirely buried burns its three attempts, places nothing, and that
 *  is the correct answer. */
const ATTEMPTS_PER_GREEBLE = 3

/** How far a greeble may be from another solid before it counts as buried inside it, as a multiple of
 *  greeble size. The hulls are assemblies of INTERSECTING boxes and cylinders — ribs through a cargo
 *  spine, struts into nacelles — so a large fraction of their triangle area is interior surface that is
 *  never visible. Greebles placed there would be invisible and would still cost their triangles. */
const BURIED_MARGIN_IN_GREEBLES = 0.75

/** Clearance around the COCKPIT, as a fraction of the hull's longest extent.
 *
 *  Sized to contain the cockpit eye, not guessed. `cockpitEyeOffset` seats the eye at
 *  `canopyBox.max.y + clamp(hullLength * 0.03, 0.06, 0.25)` and `canopyBox.max.z + clamp(hullLength *
 *  0.06, 0.3, 0.7)`, so a clearance of a tenth of the hull's extent around the canopy box provably
 *  contains both offsets for every hull in the fleet. That matters because the cockpit camera sits just
 *  above and behind the glass with a 0.05 near plane: a greeble there would either fill the forward view
 *  or clip through it, and the cockpit view took several capture rounds to get right. */
const COCKPIT_CLEAR_FRACTION = 0.1

/** Clearance around every OTHER thing that must stay readable, as a multiple of greeble size.
 *
 *  Separate from the cockpit's, and much smaller, because the cockpit's figure is justified by the
 *  camera and nothing else is. Applying it to nav lights and engine glows as well cost the interceptor
 *  four fifths of its greebles in the first pass: it carries twelve emissive nodes spread along its
 *  length, and a 0.84-unit exclusion around each of them on an 8.4-unit hull forbids most of the ship.
 *  What an emissive detail actually needs is enough room not to be physically covered. */
const EMISSIVE_CLEAR_IN_GREEBLES = 2

/** Nodes that are the pilot's view, and must keep a camera's worth of clearance.
 *
 *  Character for character the pattern `cameraView.isCanopyNodeName` uses to FIND the eye, on purpose:
 *  this is the volume that has to contain whatever that finds, so the two must not be able to disagree.
 *  Node names in these GLBs are meaningful and consistent enough to carry it —
 *  `narrow_cyan_predator_canopy`, `forward_command_bridge`, `wide_cyan_bridge_window`,
 *  `wide_worksite_visor`, `blocky_operator_cab`. */
const COCKPIT_NAME = /canop|cockpit|bridge_window|bridge$|deck window|visor|(^|_)cab(_|$)/i

/** Windows and glass, which are readable detail but not the pilot's seat. Name-tested only as
 *  belt-and-braces on top of the value test below, which already catches the ones authored as lit. */
const GLAZING_NAME = /window|glass/i

/** Do NOT reintroduce a name test for glows, cores, nav lights or beacons.
 *
 *  It was tried and it was wrong across the fleet, which a test caught rather than a capture. The
 *  tokens collide with structure on exactly the hulls that most need greebles: `core` matches
 *  `needle_core_octahedral_body` (the interceptor's entire fuselage), `jagged_arrowhead_core` (the
 *  pirate raider's entire body) and `sovereign_heavy_core`; `light` matches `flight deck spine` and
 *  `outer flight pod` on the capital carrier. Each of those reserved a main structural member AND
 *  forbade a clearance zone around it, which is how the interceptor came back with a fifth of the
 *  greebles of the hauler.
 *
 *  `isSelfLit` below classifies by what the material IS instead, and the generator's authored values
 *  make that clean: every glow disc, hot core and nav light is metalness 0, roughness 0.9 and a bright
 *  saturated colour, while every hull material is metalness 0.35-0.72, roughness 0.36-0.55 and dark.
 *  There is no overlap to resolve. It also cannot be broken by a future asset's naming.
 */
const SELF_LIT_MAX_METALNESS = 0.05
const SELF_LIT_MIN_ROUGHNESS = 0.85
const SELF_LIT_MIN_CHANNEL = 0.75

/** True for a surface that is its own light source rather than one that reflects.
 *
 *  Nothing may be placed on one, and — because the runtime engine rig (`CRAFT_ENGINE_GLOW_MOUNTS`,
 *  added by `addCraftEngineGlowRig` after the model loads) mounts its discs at the same points as the
 *  GLB's own glow nodes — keeping clear of these keeps clear of the mounts too, without this module
 *  having to know the ship type. It cannot: the loader it runs in is given a URL. */
function isSelfLit(mat: THREE.MeshStandardMaterial): boolean {
  // The emissive half comes from hullDetail so the two passes cannot disagree about what a light is.
  // It is a THRESHOLD, not "any emissive": every material in all five holder skins carries a faint one.
  if (isSelfLitMaterial(mat)) return true
  const brightest = Math.max(mat.color.r, mat.color.g, mat.color.b)
  return mat.metalness <= SELF_LIT_MAX_METALNESS
    && mat.roughness >= SELF_LIT_MIN_ROUGHNESS
    && brightest >= SELF_LIT_MIN_CHANNEL
}

/** Name of the group every greeble mesh is parented to. Public so consumers that walk a hull's meshes
 *  can find or skip the pass's output with one test instead of by guessing at mesh names. */
export const GREEBLE_GROUP_NAME = 'hull_greebles'

/** Greeble shapes. One `InstancedMesh` each, so this list IS the draw-call count.
 *
 *  Each is authored with its base at y = 0 and its long axis on z, so an instance matrix built from
 *  (face tangent, face normal, face long-edge) seats it on the surface the right way up. Triangle
 *  counts are the reason the shapes are this crude: a box is 12 triangles and a bevelled box is 40-ish,
 *  and at these sizes the bevel is sub-pixel. The read comes from the number and arrangement of
 *  silhouette edges, not from the quality of any single one.
 *
 *  `weight` is the share of the budget each shape takes. Plates dominate because panelling is what a
 *  hull is mostly made of; fins are rare because a hull covered in blades reads as a sea urchin. */
interface GreebleShape {
  name: string
  weight: number
  /** Local size multipliers applied to (across, up, along) before the instance's own jitter. */
  proportions: [number, number, number]
  build: () => THREE.BufferGeometry
}

const GREEBLE_SHAPES: readonly GreebleShape[] = [
  {
    name: 'plate',
    weight: 0.44,
    proportions: [1.6, 0.16, 2.2],
    build: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  },
  {
    name: 'block',
    weight: 0.26,
    proportions: [0.9, 0.7, 1.1],
    build: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  },
  {
    name: 'can',
    weight: 0.18,
    // Six sides rather than a smooth cylinder: at this size the facets ARE the detail, and a
    // 16-segment cylinder would spend three times the triangles to look like a smooth dot.
    proportions: [0.62, 0.55, 0.62],
    build: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false).translate(0, 0.5, 0),
  },
  {
    name: 'fin',
    // Rare and short. A blade is the one shape that breaks a silhouette rather than enriching it, so a
    // hull covered in them reads as a sea urchin — and at 1.15 high they were the shape that turned
    // small parts into starbursts in the first capture.
    weight: 0.1,
    proportions: [0.14, 0.8, 0.95],
    build: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  },
]

/** Triangles one instance of each shape costs, in shape order. Derived rather than written down so it
 *  cannot drift out of step with `build`. */
function shapeTriangleCounts(geometries: readonly THREE.BufferGeometry[]): number[] {
  return geometries.map((g) => {
    const index = g.getIndex()
    const count = index ? index.count : (g.getAttribute('position')?.count ?? 0)
    return count / 3
  })
}

/** Deterministic PRNG. The same generator `hullDetail` uses for its canvases, for the same reason:
 *  identical output across reloads, so a capture never differs by the noise. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

interface Surface {
  mesh: THREE.Mesh
  /** Mesh geometry -> hull-root space, so everything below is in one comparable frame. */
  toRoot: THREE.Matrix4
  /** Bounding box in hull-root space. */
  box: THREE.Box3
  /** Must be kept CLEAR: it is its own light source or it is the pilot's view. */
  reserved: boolean
  /** May carry greebles. Distinct from `!reserved`, because a part can also be merely too small to
   *  carry its own detail — and such a part must not then start reserving space around itself. */
  eligible: boolean
  /** Colour a greeble on this part takes, already through the hull luminance floor. */
  hostColor: THREE.Color
}

/** Collect every mesh under `root` in one comparable space, split into surfaces that may carry
 *  greebles and volumes that may not. */
function collectSurfaces(root: THREE.Object3D): { surfaces: Surface[]; existingTriangles: number } {
  root.updateWorldMatrix(false, true)
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const surfaces: Surface[] = []
  let existingTriangles = 0

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    // An InstancedMesh here would be a previous run's own output. Skipping it keeps this idempotent,
    // which matters because the loader caches the source model and the studio re-runs passes on it.
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return

    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return
    const index = mesh.geometry.getIndex()
    existingTriangles += (index ? index.count : position.count) / 3

    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld)
    const box = new THREE.Box3().setFromBufferAttribute(position).applyMatrix4(toRoot)

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const selfLit = materials.some((raw) => {
      const mat = raw as THREE.MeshStandardMaterial
      // An unlit or non-standard material is treated as self-lit rather than as hull: it is either a
      // MeshBasicMaterial glow (which is what the procedural builders use) or something this pass has
      // no model of, and both are better left alone than greebled.
      return !mat || !('roughness' in mat) || isSelfLit(mat)
    })
    const reserved = selfLit || COCKPIT_NAME.test(mesh.name) || GLAZING_NAME.test(mesh.name)
    // The colour a greeble on this part will take. Lifted here with the SAME function and the same
    // default floor `tuneHullMaterials` uses, because the greeble colour arrives as a per-instance
    // attribute rather than as `material.color` and so is not something that pass can reach.
    const hostColor = new THREE.Color(1, 1, 1)
    for (const raw of materials) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !('roughness' in mat)) continue
      hostColor.copy(mat.color)
      break
    }
    liftToLuminanceFloor(hostColor)
    surfaces.push({ mesh, toRoot, box, reserved, eligible: !reserved, hostColor })
  })

  return { surfaces, existingTriangles }
}

/** The one material every greeble on a hull shares — which is what keeps this to one draw call per
 *  shape — carrying the surface RESPONSE of whichever material the hull spends the most triangles on.
 *
 *  Colour is deliberately NOT taken from it: it is white, and the actual colour arrives per instance
 *  from the panel each greeble sits on (see `Surface.hostColor`). Inheriting metalness and roughness
 *  rather than inventing them is what makes this work across five holder skins and two capital ships
 *  with no per-asset table, including skins that do not exist yet.
 *
 *  A fresh material rather than a shared reference to the donor: `tuneHullMaterials` and
 *  `applyHullDetail` run over this afterwards, and sharing the donor's instance would give the greebles
 *  the donor's detail-map tiling, computed from the donor's bounding box rather than from a 0.13-unit
 *  plate. */
function greebleMaterialFrom(surfaces: readonly Surface[]): THREE.MeshStandardMaterial | null {
  const weightByMaterial = new Map<THREE.MeshStandardMaterial, number>()
  for (const surface of surfaces) {
    if (!surface.eligible) continue
    const index = surface.mesh.geometry.getIndex()
    const position = surface.mesh.geometry.getAttribute('position')
    const triangles = (index ? index.count : position.count) / 3
    for (const raw of Array.isArray(surface.mesh.material) ? surface.mesh.material : [surface.mesh.material]) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !('roughness' in mat)) continue
      weightByMaterial.set(mat, (weightByMaterial.get(mat) ?? 0) + triangles)
    }
  }
  let donor: THREE.MeshStandardMaterial | null = null
  let best = -1
  for (const [mat, weight] of weightByMaterial) {
    if (weight > best) { best = weight; donor = mat }
  }
  if (!donor) return null
  return new THREE.MeshStandardMaterial({
    name: 'hull_greeble',
    // White, so `instanceColor` is the colour rather than a tint on top of one. It also means the
    // luminance floor has nothing to do here — the floor is applied per instance instead, where the
    // colours actually live.
    color: new THREE.Color(1, 1, 1),
    metalness: donor.metalness,
    roughness: donor.roughness,
    // Flat shading so every greeble facet catches the light as its own plane. Smooth normals on a
    // 0.17-unit box would average the whole thing into a single soft blob, which is the opposite of
    // the extra silhouette edges this pass exists to add.
    flatShading: true,
  })
}

/** Per-instance tonal spread around the host panel's colour.
 *
 *  This is the whole reason the greebles read as separate parts rather than as a bumpy skin, and it is
 *  free: `instanceColor` is a per-instance attribute, so it costs no draw call and no material. The
 *  range is deliberately narrow — wide enough that adjacent greebles separate, narrow enough that none
 *  of them reads as a different alloy from the panel it is bolted to. */
const GREEBLE_TONE_MIN = 0.8
const GREEBLE_TONE_MAX = 1.15

/** Weighted mean footprint of one greeble, in units of size squared. Derived from the shape table so a
 *  change to the shapes or their weights cannot leave the density maths behind. */
function averageFootprintInSizes(): number {
  return GREEBLE_SHAPES.reduce((sum, s) => sum + s.weight * s.proportions[0] * s.proportions[2], 0)
}

/** Kill switch for the whole pass.
 *
 *  Exists so `scripts/capture-planetfall.mjs` has a control half. The studio can answer "how much did
 *  the density change" with `?greeble=0`, but the studio's sky is a nebula and a starfield with no star
 *  and no planet in it, and judging a value in one lighting condition and not the other is the mistake
 *  this project has had to undo more than once. Daylight on a planet needs the real game, and without a
 *  switch the "before" half of that comparison would be a source edit and a reload. DEV-gated at the
 *  call site in main.ts, so it cannot be reached in production. */
let enabled = true

export function setHullGreeblesEnabled(value: boolean): void {
  enabled = value
}

export interface HullGreebleTuning {
  /** Total triangle target including the asset's own. 0 disables the pass. */
  triangleTarget?: number
  /** Multiplier on greeble size, for judging the scale against a frame. */
  sizeScale?: number
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _edge1 = new THREE.Vector3()
const _edge2 = new THREE.Vector3()
const _third = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _point = new THREE.Vector3()
const _along = new THREE.Vector3()
const _across = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _scale = new THREE.Vector3()
const _tone = new THREE.Color()
const _probe = new THREE.Vector3()
const _cross = new THREE.Vector3()

/**
 * Add procedural greebles to a loaded hull, in place. Returns the meshes it added (empty if it added
 * none), so a caller can report the count without re-traversing.
 *
 * Call BEFORE `tuneHullMaterials` and `applyHullDetail`: the greeble material is meant to go through
 * the same luminance floor, ground fill and environment probe as the hull it sits on, and being tuned
 * by the same pass is what guarantees it cannot drift away from the hull's own surfaces.
 *
 * Idempotent — a second call finds the first call's `InstancedMesh`es, skips them as surfaces, and
 * bails on the name marker, so re-running a pass on the loader's cached source model cannot stack.
 */
export function applyHullGreebles(root: THREE.Object3D, tuning: HullGreebleTuning = {}): THREE.InstancedMesh[] {
  if (!enabled) return []
  const triangleTarget = tuning.triangleTarget ?? GREEBLE_TRIANGLE_TARGET
  if (triangleTarget <= 0) return []
  if (root.getObjectByName(GREEBLE_GROUP_NAME)) return []

  const { surfaces, existingTriangles } = collectSurfaces(root)
  const budget = triangleTarget - existingTriangles
  // Nothing to do for an asset that is already dense. This is the early-out that keeps the season hub
  // (59,852 triangles across 528 meshes) from paying for an analysis whose answer is zero.
  if (budget <= 0) return []

  const hullBox = new THREE.Box3()
  for (const surface of surfaces) hullBox.union(surface.box)
  if (hullBox.isEmpty()) return []
  const hullSpan = Math.max(...hullBox.getSize(_scale).toArray())
  if (!(hullSpan > 0)) return []

  const size = hullSpan * GREEBLE_SIZE_FRACTION * (tuning.sizeScale ?? 1)
  const buriedMargin = size * BURIED_MARGIN_IN_GREEBLES
  // Footprint of an average greeble, used both as the "is this face big enough" unit and as the
  // coverage denominator, so those two can never disagree about how much room one takes.
  const footprint = size * size * averageFootprintInSizes()
  const minFaceArea = footprint * MIN_FACE_AREA_IN_GREEBLES

  // Demote parts too small to carry their own detail. Done before the material pick and before the
  // area totals so a rejected part votes on neither: its material must not become the greebles' alloy
  // and its area must not inflate the density.
  const minSpan = size * MIN_SURFACE_SPAN_IN_GREEBLES
  for (const surface of surfaces) {
    if (!surface.eligible) continue
    const extents = surface.box.getSize(_scale).toArray().sort((x, y) => y - x)
    if (extents[1] < minSpan) surface.eligible = false
  }

  const material = greebleMaterialFrom(surfaces)
  if (!material) return []

  // Volumes to stay out of, in hull-root space, grown once here rather than per test. Two clearances:
  // a camera's worth around the cockpit, a greeble's worth around everything else that emits.
  const forbidden: THREE.Box3[] = []
  for (const surface of surfaces) {
    if (!surface.reserved) continue
    const clearance = COCKPIT_NAME.test(surface.mesh.name)
      ? hullSpan * COCKPIT_CLEAR_FRACTION
      : size * EMISSIVE_CLEAR_IN_GREEBLES
    forbidden.push(surface.box.clone().expandByScalar(clearance))
  }
  // Solids to stay INSIDE of, shrunk so that sitting on a shared face does not count as buried.
  const solids: { box: THREE.Box3; mesh: THREE.Mesh }[] = []
  for (const surface of surfaces) {
    const shrunk = surface.box.clone().expandByScalar(-buriedMargin)
    if (!shrunk.isEmpty()) solids.push({ box: shrunk, mesh: surface.mesh })
  }

  const geometries = GREEBLE_SHAPES.map((shape) => shape.build())
  const triangleCosts = shapeTriangleCounts(geometries)
  const averageCost = GREEBLE_SHAPES.reduce((sum, shape, i) => sum + shape.weight * triangleCosts[i], 0)

  // Pass one: total eligible face area. Density follows AREA, not triangle count — a hull's triangles
  // are wherever its generator happened to put them (six on a huge cargo flank, twelve on a tiny strut),
  // so a count-driven density would make the strut the most detailed thing on the ship.
  let totalArea = 0
  for (const surface of surfaces) {
    if (!surface.eligible) continue
    forEachTriangle(surface, (area) => { if (area >= minFaceArea) totalArea += area })
  }
  const wanted = Math.floor(totalArea * GREEBLE_COVERAGE / footprint)
  // The ceiling only ever binds for a large or already-dense asset; for the base hulls, coverage decides.
  const instanceTarget = Math.min(wanted, Math.floor(budget / Math.max(1, averageCost)))
  if (totalArea <= 0 || instanceTarget <= 0) {
    for (const geometry of geometries) geometry.dispose()
    material.dispose()
    return []
  }
  const density = instanceTarget / totalArea

  // Pass two: place. One array of matrices and one of colours per shape; the InstancedMeshes are built
  // once at the end at exactly the size they need, so nothing is uploaded and then resized.
  const placements: { matrices: THREE.Matrix4[]; tones: THREE.Color[] }[] =
    GREEBLE_SHAPES.map(() => ({ matrices: [], tones: [] }))
  // Cumulative weights, so a single random draw picks a shape.
  const cumulative: number[] = []
  let running = 0
  for (const shape of GREEBLE_SHAPES) { running += shape.weight; cumulative.push(running) }

  const random = makeRandom(0x5bf03635)

  for (const surface of surfaces) {
    if (!surface.eligible) continue
    forEachTriangle(surface, (area) => {
      if (area < minFaceArea) return
      const expected = area * density
      // Fractional expectation resolved by a draw rather than by rounding, so a hull made of many
      // faces each worth 0.4 greebles gets 40% of them covered instead of none.
      let count = Math.floor(expected)
      if (random() < expected - count) count++
      count = Math.min(count, Math.floor(area * MAX_FACE_COVERAGE / footprint), HARD_CAP_PER_TRIANGLE)
      if (count <= 0) return

      _normal.copy(_edge1).cross(_edge2).normalize()
      if (_normal.lengthSq() < 0.5) return // degenerate triangle: no usable normal

      // Long axis: the triangle's SHORTEST edge, made perpendicular to the normal.
      //
      // Shortest rather than longest, which is the counter-intuitive part and matters a lot. Every flat
      // panel in these hulls is a quad split into two right triangles, so its longest edge is always the
      // diagonal — orienting to that turns a wall of plates 45 degrees off the panel they sit on, and
      // diagonal clutter reads as debris where aligned clutter reads as manufactured. The shortest of the
      // three edges is a leg of the right angle, i.e. a real panel edge.
      _third.subVectors(_edge2, _edge1)
      _along.copy(_edge1)
      if (_edge2.lengthSq() < _along.lengthSq()) _along.copy(_edge2)
      if (_third.lengthSq() < _along.lengthSq()) _along.copy(_third)
      _along.addScaledVector(_normal, -_along.dot(_normal))
      if (_along.lengthSq() < 1e-12) return
      _along.normalize()
      _across.copy(_normal).cross(_along).normalize()

      // Retry rejected placements rather than forfeit them: without this, every greeble that landed on
      // buried or reserved surface was one the budget silently lost, which cost the first pass four
      // fifths of its target on the interceptor.
      let placed = 0
      for (let attempt = 0; attempt < count * ATTEMPTS_PER_GREEBLE && placed < count; attempt++) {
        // Uniform point in the triangle. The fold keeps it uniform; sampling u,v independently without
        // it would pile greebles into one corner.
        let u = random()
        let v = random()
        if (u + v > 1) { u = 1 - u; v = 1 - v }
        _point.copy(_a).addScaledVector(_edge1, u).addScaledVector(_edge2, v)

        if (isForbidden(_point, forbidden)) continue
        if (isBuried(_point, _normal, size, solids, surface.mesh)) continue
        placed++

        let pick = 0
        const draw = random() * running
        while (pick < cumulative.length - 1 && draw > cumulative[pick]) pick++
        const shape = GREEBLE_SHAPES[pick]

        // Per-instance size jitter, so a row of identical boxes does not read as a texture.
        const jitter = 0.62 + random() * 0.76
        _scale.set(
          size * shape.proportions[0] * jitter,
          size * shape.proportions[1] * jitter,
          size * shape.proportions[2] * jitter,
        )
        _matrix.makeBasis(_across, _normal, _along)
        _matrix.scale(_scale)
        // Sunk a hair into the skin so the greeble's lower edges intersect the hull rather than hover
        // over it with a visible seam of background between.
        _matrix.setPosition(_point.addScaledVector(_normal, -size * 0.04))
        placements[pick].matrices.push(_matrix.clone())
        // The panel's own colour, jittered. Per-instance rather than per-material is what lets one draw
        // call carry a hull's whole palette: a greeble on the fighter's teal wing is teal and one on its
        // gunmetal spine is gunmetal, where a single inherited colour made every greeble on the fighter
        // pale grey against a dark teal wing and the whole wing read as a rubble field.
        placements[pick].tones.push(_tone.copy(surface.hostColor)
          .multiplyScalar(GREEBLE_TONE_MIN + random() * (GREEBLE_TONE_MAX - GREEBLE_TONE_MIN)).clone())
      }
    })
  }

  const group = new THREE.Group()
  group.name = GREEBLE_GROUP_NAME
  const added: THREE.InstancedMesh[] = []
  for (let i = 0; i < GREEBLE_SHAPES.length; i++) {
    const { matrices, tones } = placements[i]
    if (matrices.length === 0) { geometries[i].dispose(); continue }
    const mesh = new THREE.InstancedMesh(geometries[i], material, matrices.length)
    mesh.name = `hull_greeble_${GREEBLE_SHAPES[i].name}`
    for (let k = 0; k < matrices.length; k++) {
      mesh.setMatrixAt(k, matrices[k])
      mesh.setColorAt(k, tones[k])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // Instances never move relative to the hull, so three.js can skip re-deriving these per frame.
    mesh.matrixAutoUpdate = false
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    group.add(mesh)
    added.push(mesh)
  }
  if (added.length === 0) { material.dispose(); return [] }
  root.add(group)
  return added
}

/** Remove and free the greebles this module added.
 *
 *  Exists for the studio's A/B rig, exactly as `stripHullDetail` does: `?greeble=0` against the default
 *  is the only comparison that answers "how much did the density actually change", and re-tuning needs
 *  the old pass gone before `applyHullGreebles` will run again (it bails on finding its own group).
 *  Not used in the game.
 *
 *  Disposes geometries and the material because a strip is followed by a rebuild, and a harness that
 *  leaked a material per sweep would make a `?greeble=` sweep progressively slower and blame the
 *  greebles for it. */
export function stripHullGreebles(root: THREE.Object3D): void {
  const group = root.getObjectByName(GREEBLE_GROUP_NAME)
  if (!group) return
  const materials = new Set<THREE.Material>()
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(mat)
  })
  for (const mat of materials) mat.dispose()
  group.removeFromParent()
}

/** Walk a surface's triangles in hull-root space, leaving `_a`/`_edge1`/`_edge2` set for the callback.
 *  Shared scratch rather than allocation because a hull can have tens of thousands of triangles and
 *  this runs twice over all of them. */
function forEachTriangle(surface: Surface, visit: (area: number) => void): void {
  const geometry = surface.mesh.geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const index = geometry.getIndex()
  const triangles = (index ? index.count : position.count) / 3
  for (let t = 0; t < triangles; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    _a.fromBufferAttribute(position, i0).applyMatrix4(surface.toRoot)
    _b.fromBufferAttribute(position, i1).applyMatrix4(surface.toRoot)
    _c.fromBufferAttribute(position, i2).applyMatrix4(surface.toRoot)
    _edge1.subVectors(_b, _a)
    _edge2.subVectors(_c, _a)
    visit(_cross.copy(_edge1).cross(_edge2).length() * 0.5)
  }
}

function isForbidden(point: THREE.Vector3, forbidden: readonly THREE.Box3[]): boolean {
  for (const box of forbidden) {
    if (box.containsPoint(point)) return true
  }
  return false
}

/** True if a greeble at `point` would sit inside another part of the hull and never be seen.
 *
 *  Tested a little way ALONG the normal rather than at the surface point itself, because the point is
 *  by definition on a boundary and boundaries are ambiguous; a greeble's problem is whether the space
 *  it would occupy is already solid. Box-level rather than triangle-level on purpose: a box is
 *  conservative in the harmless direction — it can only ever reject a placement, never accept a buried
 *  one — and it needs no raycasts, at load, for every candidate on every hull.
 */
function isBuried(
  point: THREE.Vector3,
  normal: THREE.Vector3,
  size: number,
  solids: readonly { box: THREE.Box3; mesh: THREE.Mesh }[],
  own: THREE.Mesh,
): boolean {
  _probe.copy(point).addScaledVector(normal, size * 0.5)
  for (const solid of solids) {
    if (solid.mesh === own) continue
    if (solid.box.containsPoint(_probe)) return true
  }
  return false
}

export const HULL_GREEBLE_INTERNALS = {
  GREEBLE_SHAPES, GREEBLE_TRIANGLE_TARGET, GREEBLE_SIZE_FRACTION, GREEBLE_COVERAGE, COCKPIT_NAME,
  GLAZING_NAME, COCKPIT_CLEAR_FRACTION, MAX_FACE_COVERAGE, isSelfLit, shapeTriangleCounts, makeRandom,
  averageFootprintInSizes,
}
