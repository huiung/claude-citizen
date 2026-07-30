import * as THREE from 'three'
import { HULL_FX_MESH_KEYS } from '../render/rcs'

/** `cockpit` sits at the hull's canopy looking forward — the view that makes flying read as being
 *  inside a ship rather than steering a small object from behind. `rear` is still the mode the game
 *  starts in; cockpit is a mode a pilot opts into with C. */
export type CameraMode = 'cockpit' | 'rear' | 'orbit'

/** Near plane for the cockpit view. The eye sits a fraction of a unit off the canopy glass, so the
 *  flight near plane (0.5) clips the glass and the hull around it straight out of the frame and the
 *  view degenerates into the rear view's framing minus the ship. main.ts creates the renderer with
 *  `logarithmicDepthBuffer: true`, which is what makes a near plane this tight affordable: depth
 *  precision no longer depends on the near/far ratio, so dropping to 0.05 costs nothing at the
 *  far end where the planets and the star field live. */
export const COCKPIT_NEAR_PLANE = 0.05

/** The flight camera's resting field of view, before the boost / quantum / black-hole widening.
 *  Shared with the ship studio so a cockpit capture is framed through the same lens the player gets:
 *  the studio's own 55° is right for external shots but crops away most of the hull that a cockpit
 *  view is supposed to have in its periphery, which would make the harness flatter its subject. */
export const FLIGHT_BASE_FOV = 72

const ORBIT_RADIUS = 8.3
const ORBIT_MIN_RADIUS = 4.5
const ORBIT_MAX_RADIUS = 14
const ORBIT_HEIGHT = 2.8
const ORBIT_SPEED = 0.45
const ORBIT_ZOOM_PER_WHEEL_UNIT = 0.003
const ORBIT_MAX_QUEUED_WHEEL_DELTA = 900
const REAR_RADIUS = 14
const REAR_MIN_RADIUS = 10
const REAR_MAX_RADIUS = 26
const REAR_ZOOM_PER_WHEEL_UNIT = 0.006

// updateCamera() now has a real cockpit branch, so 'cockpit' is reachable. It sits after 'orbit'
// rather than first so the existing rear -> orbit step is unchanged for anyone used to tapping C
// once; 'rear' is still the mode the game starts in.
const CAMERA_MODE_CYCLE: readonly CameraMode[] = ['rear', 'orbit', 'cockpit']

export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_MODE_CYCLE.indexOf(mode)
  return CAMERA_MODE_CYCLE[(i + 1) % CAMERA_MODE_CYCLE.length]
}

/** Where the eye sits, in hull-local space, given the canopy mesh's local bounding box and the
 *  hull's forward extent.
 *
 *  This takes the canopy's BOX, not its centre, and puts the eye just OUTSIDE the glass rather than
 *  behind it. Both of those reverse the shape this function had as groundwork, because the assumption
 *  underneath it does not hold for a single hull in the fleet: none of them has a cockpit interior.
 *  Measured off the GLBs, every "canopy" is a thin glass plate laid on the hull's skin —
 *
 *    hauler   wide_cyan_bridge_window       1.49 x 0.40 x 0.31
 *    miner    wide_worksite_visor           1.27 x 0.27 x 0.26
 *    fighter  large_cyan_bubble_canopy      0.63 x 0.31 x 0.74
 *
 *  — 0.2 to 0.5 units tall, with solid chassis directly behind. A setback of 0.5, which is what
 *  `hullLength * 0.06` gives for these hulls, is larger than the whole canopy, so the eye landed
 *  inside the fuselage: captures came back as flat-shaded walls at point-blank range, the interior
 *  faces of a solid block.
 *
 *  So the eye goes just ABOVE and just BEHIND the glass — on the hull's skin at the canopy, looking
 *  forward over it, rather than out of a room that was never modelled. `resolveCockpitEyeAnchor` then
 *  lifts it clear of any structure it still overlaps.
 *
 *  Behind rather than in front of the glass is the second thing captures forced. On `hauler`, `miner`
 *  and `holder-abyssal-driller` the canopy is on the hull's front FACE — the hauler's window spans
 *  z -4.48..-4.17 and the hull ends at -4.48 — so an eye at the glass's leading edge has the entire
 *  ship behind it and the forward view came back as bare star field, no hull, no frame, nothing for
 *  the pilot to place themselves against. Sitting `aftBias` back puts the hull in frame on every
 *  class. How much is still very much per hull, and that is the assets talking, not this function:
 *  the interceptor and fighter frame their canopy and wings handsomely, while the boxy hauler and
 *  miner give a flat roof receding to a level horizon, because that is the shape they are.
 *
 *  Every player-flyable hull carries a canopy/cockpit node by name (`narrow_cyan_predator_canopy`,
 *  `raised_cockpit_pod`, `forward_command_bridge`, `low_cockpit`, `wide_worksite_visor`), so the
 *  anchor is derived rather than hand-authored per ship. Forward is -Z throughout, which the four
 *  base hulls state outright in their root node's `extras: { forward: "-Z" }`; the holder skins
 *  carry no extras but are modelled to the same convention.
 */
export function cockpitEyeOffset(canopyLocalBox: THREE.Box3, hullLength: number): THREE.Vector3 {
  // Both offsets scale off the hull so they land the same relative to an 8-unit interceptor and a
  // 15-unit corvette, then clamp. Clearance below ~0.06 grazes the glass it is meant to sit on;
  // above ~0.25 the eye visibly floats. Aft bias below ~0.3 leaves too thin a sliver of hull in
  // frame on the nose-canopy hulls; above ~0.7 it stops reading as the cockpit and starts reading
  // as a very short chase boom.
  const clearance = THREE.MathUtils.clamp(hullLength * 0.03, 0.06, 0.25)
  const aftBias = THREE.MathUtils.clamp(hullLength * 0.06, 0.3, 0.7)
  return new THREE.Vector3(
    (canopyLocalBox.min.x + canopyLocalBox.max.x) * 0.5,
    canopyLocalBox.max.y + clearance, // above the glass, where a bubble canopy's crown would be
    canopyLocalBox.max.z + aftBias, // +Z is aft, so this sits behind the glass looking over it
  )
}

/** How far above the hull's skin the eye is held once it has been lifted clear of structure. */
const COCKPIT_HULL_CLEARANCE = 0.14

/** Name test for the canopy/cockpit node a hull's eye anchor is derived from.
 *
 *  `visor` and a whole `cab` segment are in here because `miner` was believed to have no canopy node
 *  at all: it carries `blocky_operator_cab` and `wide_worksite_visor` — a real cockpit, just not
 *  named after glass. `holder-abyssal-driller` has `amber_mining_visor` for the same reason. Those
 *  three are the only names the two extra alternatives add across all thirteen GLBs, so the miner
 *  gets a derived anchor instead of a guessed one and no other hull changes.
 *
 *  `cab` is anchored to segment boundaries (`(^|_)cab(_|$)`) so it cannot fire on an unrelated
 *  substring; a bare /cab/ would match things like `cable` or `cabin_strut` that are not eye points.
 */
export function isCanopyNodeName(name: string): boolean {
  return /canop|cockpit|bridge_window|bridge$|deck window|visor|(^|_)cab(_|$)/i.test(name)
}

/** Eye point for a hull with no canopy node at all, in hull-local space.
 *
 *  Reached by the procedural `buildCraft()` hulls, whose meshes are unnamed, and by
 *  `capital-dreadnought`. The procedural hull is on screen for the frames before the GLB swaps in —
 *  and permanently if the GLB 404s — so this path has to put the eye somewhere sane, not just
 *  somewhere that does not throw.
 *
 *  A fraction along the forward extent rather than a fixed distance: hull lengths across the fleet
 *  run from 6 to 17 units, and any absolute offset that sits inside the interceptor is outside the
 *  corvette. Biased up from mid-height because a cockpit is on top of a hull, never in its middle.
 */
function fallbackCanopyBox(hullBox: THREE.Box3): THREE.Box3 {
  const size = hullBox.getSize(new THREE.Vector3())
  const center = hullBox.getCenter(new THREE.Vector3())
  const z = hullBox.min.z + size.z * 0.18
  return new THREE.Box3(
    new THREE.Vector3(center.x - size.x * 0.05, hullBox.max.y - size.y * 0.05, z),
    new THREE.Vector3(center.x + size.x * 0.05, hullBox.max.y, z + size.z * 0.05),
  )
}

/** True for a mesh whose `geometry.boundingBox` says nothing about where it actually is.
 *
 *  An `InstancedMesh`'s geometry is the single unscaled prototype every instance is drawn from; its
 *  bounding box sits at the object's origin at unit size, and the real extents live in
 *  `instanceMatrix`. Both traverses below read `geometry.boundingBox` directly — which is correct and
 *  allocation-free for ordinary meshes and simply wrong for an instanced one.
 *
 *  This matters as of the procedural greeble pass (`render/hullGreebles`), which parents four
 *  `InstancedMesh`es to every loaded hull. Folding their unit prototype boxes in would move
 *  `hullBox`, and every cockpit offset is a fraction of `hullLength` derived from it, so a decoration
 *  pass would silently relocate the pilot's eye. `Box3.setFromObject` handles instancing properly
 *  (via `Object3D.boundingBox`) and needs no such guard; these hand-rolled walks do.
 *
 *  Skipping rather than expanding is deliberate: greebles sit ON the hull's skin by construction, so
 *  they can add nothing to a box the skin already defines, and they must not be allowed to lift an eye
 *  that is meant to clear structure.
 */
function isInstancedGeometryProxy(mesh: THREE.Mesh): boolean {
  return (mesh as THREE.InstancedMesh).isInstancedMesh === true
}

/** True for an additive effect billboard bolted to the hull — a thruster puff, an engine glow disc.
 *
 *  Same reasoning as the instancing guard above, for a different cause. These sit AT hull extremities
 *  by design, including one puff above the nose and one below it, which is exactly the region
 *  `liftClearOfStructure` probes. Folding them in would let a feedback layer relocate the pilot's eye,
 *  and unlike a greeble they are not on the skin — they stick out of it on purpose.
 */
function isHullEffectBillboard(mesh: THREE.Mesh): boolean {
  for (const key of HULL_FX_MESH_KEYS) if (mesh.userData[key] !== undefined) return true
  return false
}

/** Bounding box of `root`'s meshes expressed in the space `toLocal` maps world space into.
 *
 *  `Box3.setFromObject` would give a world-space box, which is useless here: the hull is parented to
 *  a group that carries the ship's live position and orientation, so a world box changes every
 *  frame and cannot be cached. Going through each mesh's geometry box and `matrixWorld` instead
 *  yields a box in the hull group's own space, which is stable for the lifetime of the hull.
 */
function localMeshBox(root: THREE.Object3D, toLocal: THREE.Matrix4, target: THREE.Box3): THREE.Box3 {
  const box = new THREE.Box3()
  const matrix = new THREE.Matrix4()
  target.makeEmpty()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (isInstancedGeometryProxy(mesh) || isHullEffectBillboard(mesh)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (!mesh.geometry.boundingBox) return
    box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix.multiplyMatrices(toLocal, mesh.matrixWorld))
    target.union(box)
  })
  return target
}

/** How far ahead of the eye structure is allowed to veto the eye's height, as a fraction of the
 *  hull's length. */
const COCKPIT_FORWARD_PROBE = 0.25

/** Raise `eye` until it is above the structure it sits in AND the structure directly ahead of it.
 *
 *  Two separate failures made this necessary, both found by looking at captures rather than by
 *  reasoning about the assets:
 *
 *    * Sitting in it. The eye is placed off the canopy alone, and the canopy is not always the tallest
 *      thing around it — `holder-eclipse-corvette`'s `raised_command_bridge` tops out at y 0.55 with
 *      superstructure reaching y 3.4 — so a canopy-relative eye is simply inside the ship.
 *    * Sitting behind it. Clearing only what the eye is inside leaves whatever is ahead of it free to
 *      fill the entire forward view, which is exactly what the corvette did: a lit wall of hull from
 *      edge to edge, sky visible only in the two top corners.
 *
 *  Hence the forward probe. It is a quarter of the hull rather than the whole thing because a hull's
 *  full length always reaches its own nose, and every hull's nose is taller than the skin right at
 *  the canopy — probing the lot would push the eye above the entire ship on all nine hulls and turn a
 *  cockpit view into a mast cam.
 *
 *  The x test uses the mesh's own footprint, not a hull-wide box, so wingtips and outrigger nacelles
 *  off to the side do not vote on the height of an eye that sits on the centreline.
 *
 *  Box-level, not triangle-level, on purpose: a box is conservative in the direction that matters —
 *  it can only ever lift the eye further out, never leave it embedded — and it needs no raycasts.
 */
function liftClearOfStructure(
  hull: THREE.Object3D,
  toLocal: THREE.Matrix4,
  eye: THREE.Vector3,
  hullLength: number,
): void {
  const box = new THREE.Box3()
  const matrix = new THREE.Matrix4()
  const probeFrom = eye.z - hullLength * COCKPIT_FORWARD_PROBE
  let top = -Infinity
  hull.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (isInstancedGeometryProxy(mesh) || isHullEffectBillboard(mesh)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (!mesh.geometry.boundingBox) return
    box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix.multiplyMatrices(toLocal, mesh.matrixWorld))
    if (eye.x < box.min.x || eye.x > box.max.x) return
    if (box.min.z > eye.z || box.max.z < probeFrom) return // neither under the eye nor just ahead of it
    if (eye.y > box.max.y) return // already above this one
    top = Math.max(top, box.max.y)
  })
  if (top > -Infinity) eye.y = top + COCKPIT_HULL_CLEARANCE
}

/** Resolve the cockpit eye point for a loaded hull, in the hull group's local space.
 *
 *  Result is a fixed property of the hull, so callers cache it per hull rather than searching the
 *  node tree every frame — the capital carrier alone is 166 nodes.
 *
 *  Picks the MOST FORWARD canopy candidate, not the first one found. `holder-doge-runner` has both
 *  `flush_blue_canopy` at the nose and `dark_gold_tail_bridge` at z = +3.1, and the latter matches
 *  `bridge$`; taking traversal order would seat the pilot in the tail looking down the length of
 *  their own ship.
 */
export function resolveCockpitEyeAnchor(hull: THREE.Object3D): THREE.Vector3 {
  hull.updateWorldMatrix(false, true)
  const toLocal = new THREE.Matrix4().copy(hull.matrixWorld).invert()
  const hullBox = localMeshBox(hull, toLocal, new THREE.Box3())
  if (hullBox.isEmpty()) return new THREE.Vector3() // nothing loaded yet; centre is as good as it gets
  const hullLength = hullBox.getSize(new THREE.Vector3()).z

  let canopyBox: THREE.Box3 | null = null
  const candidateBox = new THREE.Box3()
  hull.traverse((child) => {
    if (!isCanopyNodeName(child.name)) return
    if (localMeshBox(child, toLocal, candidateBox).isEmpty()) return
    if (!canopyBox || candidateBox.min.z < canopyBox.min.z) canopyBox = candidateBox.clone()
  })

  const eye = cockpitEyeOffset(canopyBox ?? fallbackCanopyBox(hullBox), hullLength)
  liftClearOfStructure(hull, toLocal, eye, hullLength)
  return eye
}

/** Restores the `side` each material was authored with. */
export interface HullInteriorFaces {
  restore(): void
}

/** Make a hull's surfaces visible from inside it, returning a handle that undoes the change.
 *
 *  Hull and canopy materials are single-sided, which is correct for every view from outside. From
 *  the cockpit the camera is *inside* that shell, so backface culling removes exactly the surfaces
 *  that should be surrounding the pilot: the canopy frame vanishes and the hull reads as a hole
 *  onto the star field.
 *
 *  Scope is deliberately the whole hull rather than the meshes near the eye. A distance test sounds
 *  cheaper but is wrong at the edges — on the corvette the bridge sits amidships, so its own nose is
 *  ten units ahead and still needs to occlude — and these hulls are 19 to 91 nodes, one instance,
 *  so untangling that to save a few backface fragments buys nothing measurable.
 *
 *  Scope is also this hull *instance* only, and only while the cockpit view is active. Materials are
 *  cloned per instance by `cloneCraftModelInstance`, so peers and pirates keep their culling; and
 *  restoring on exit keeps the rear and orbit views pixel-identical to before this change, which
 *  matters because DoubleSide is not a no-op out there — it would reveal the back of every
 *  single-quad panel and window the hulls are built from.
 */
export function showHullInteriorFaces(hull: THREE.Object3D): HullInteriorFaces {
  const authored: { material: THREE.Material; side: THREE.Side }[] = []
  const seen = new Set<THREE.Material>()
  hull.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material || seen.has(material)) continue
      seen.add(material)
      authored.push({ material, side: material.side })
      material.side = THREE.DoubleSide
    }
  })
  return {
    restore(): void {
      for (const entry of authored) entry.material.side = entry.side
      authored.length = 0
    },
  }
}

export function rearCameraOffset(boostKick: number, distance = REAR_RADIUS): THREE.Vector3 {
  return new THREE.Vector3(0, 3.6, distance + boostKick * 4)
}

// --- Angular feedback
//
// The chase boom already leans against LINEAR acceleration (`gSway` in main.ts), which is what gives
// boosting and braking their shove. Rotation had no equivalent, so a hull that now takes half a second
// to come about did so with the camera welded rigidly to it — the pilot saw the world turn and nothing
// else, which is the difference between a heavy ship and a slow one.
//
// These are a lag, not a shake: the mount is treated as if it were on a soft arm the hull swings out
// from under, so the offset is proportional to the RATE and vanishes the moment rotation stops. That
// makes it a readout of the manoeuvre rather than noise on top of it.

/** Metres of boom offset per rad/s of rotation. */
const ANGULAR_SWAY_K = 0.62
/** Clamp per axis. At 2 m on a 14 m boom the hull is a comfortable few degrees off centre; much more
 *  and the crosshair — which sits at screen centre while the guns fire along the hull's nose — stops
 *  being a usable approximation of where the shots are going. */
const ANGULAR_SWAY_MAX = 1.6

/** Where the chase boom trails to, in the hull's own frame, for a given angular velocity.
 *
 *  Signs follow the rotation conventions in sim/physics with forward = -Z. +pitch lifts the nose, so a
 *  lagging camera ends up BELOW the boom's nominal position in the hull's new frame; +yaw swings the
 *  nose to port, so the camera ends up to starboard. Roll is deliberately absent: a camera that lags in
 *  roll rotates the horizon independently of the hull, which reads as the mount being broken rather
 *  than as the hull being heavy.
 */
export function angularSwayOffset(pitchRate: number, yawRate: number, target: THREE.Vector3): THREE.Vector3 {
  const clamp = (v: number): number => THREE.MathUtils.clamp(v * ANGULAR_SWAY_K, -ANGULAR_SWAY_MAX, ANGULAR_SWAY_MAX)
  return target.set(clamp(yawRate), clamp(-pitchRate), 0)
}

/** Radians of head lag per rad/s of rotation, and its clamp. */
const COCKPIT_HEAD_LAG_K = 0.035
const COCKPIT_HEAD_LAG_MAX = 0.045 // ~2.6°

/** Pilot's head lagging the hull in the cockpit view, as a small local-space euler offset.
 *
 *  The cockpit mount is rigid on purpose — the position lerp, the linear sway and a full orientation
 *  slerp all put the eye through the hull or make the interior swim — but that leaves the one view with
 *  the least sense of the ship's mass. A HARD-CLAMPED rotation offset is a different thing from a
 *  slerp: it is bounded at under three degrees, it is a function of the current rate rather than of
 *  accumulated error, and it returns to zero the instant rotation stops, so the interior cannot drift.
 *  Small enough to stay inside the slop the crosshair already has, since the guns fire along the hull.
 */
export function cockpitHeadLag(pitchRate: number, yawRate: number, target: THREE.Euler): THREE.Euler {
  const clamp = (v: number): number =>
    THREE.MathUtils.clamp(v * COCKPIT_HEAD_LAG_K, -COCKPIT_HEAD_LAG_MAX, COCKPIT_HEAD_LAG_MAX)
  return target.set(clamp(-pitchRate), clamp(-yawRate), 0, 'YXZ')
}

export function defaultRearDistance(): number {
  return REAR_RADIUS
}

export function defaultOrbitDistance(): number {
  return ORBIT_RADIUS
}

export function zoomRearDistance(distance: number, wheelDeltaY: number): number {
  const next = THREE.MathUtils.clamp(
    distance + wheelDeltaY * REAR_ZOOM_PER_WHEEL_UNIT,
    REAR_MIN_RADIUS,
    REAR_MAX_RADIUS,
  )
  return Math.round(next * 100) / 100
}

export function zoomOrbitDistance(distance: number, wheelDeltaY: number): number {
  const next = THREE.MathUtils.clamp(
    distance + wheelDeltaY * ORBIT_ZOOM_PER_WHEEL_UNIT,
    ORBIT_MIN_RADIUS,
    ORBIT_MAX_RADIUS,
  )
  return Math.round(next * 100) / 100
}

export function queueOrbitZoomDelta(pendingDeltaY: number, wheelDeltaY: number): number {
  return THREE.MathUtils.clamp(
    pendingDeltaY + wheelDeltaY,
    -ORBIT_MAX_QUEUED_WHEEL_DELTA,
    ORBIT_MAX_QUEUED_WHEEL_DELTA,
  )
}

// --- Third person (on foot)
//
// Structurally the same problem as the chase boom — an offset in the subject's frame, lerped
// toward — but the numbers share nothing with it. The subject is 1.8 units tall instead of 4 to 17,
// so a 14-unit boom would put the player at the size of a HUD icon; and unlike the ship, whose
// pitch the boom inherits from the hull, a walker's pitch is the player's own look input, so this
// takes an angle where `rearCameraOffset` takes a boost kick.
const FOOT_RADIUS = 4.6
const FOOT_MIN_RADIUS = 2.4
const FOOT_MAX_RADIUS = 9
const FOOT_ZOOM_PER_WHEEL_UNIT = 0.003
/** Height of the boom's pivot above the walker's feet — roughly the shoulder. The camera orbits
 *  this point and aims back at it, so it is also where the caller must point the look target;
 *  orbiting the pivot but aiming at the feet would make looking up impossible, since the camera
 *  would drop and re-aim at the same place. */
export const FOOT_PIVOT_HEIGHT = 1.45

/** Camera offset from the walker's feet, in a frame where +Y is the local up and +Z is behind the
 *  walker. `pitch` is the player's look angle: positive raises the camera and tips the view down,
 *  negative drops it and tips the view up. */
export function thirdPersonCameraOffset(pitch: number, distance = FOOT_RADIUS): THREE.Vector3 {
  return new THREE.Vector3(
    0,
    FOOT_PIVOT_HEIGHT + Math.sin(pitch) * distance,
    Math.cos(pitch) * distance,
  )
}

export function defaultFootDistance(): number {
  return FOOT_RADIUS
}

export function zoomFootDistance(distance: number, wheelDeltaY: number): number {
  const next = THREE.MathUtils.clamp(
    distance + wheelDeltaY * FOOT_ZOOM_PER_WHEEL_UNIT,
    FOOT_MIN_RADIUS,
    FOOT_MAX_RADIUS,
  )
  return Math.round(next * 100) / 100
}

export function orbitCameraOffset(elapsedSeconds: number, boostKick: number, distance = ORBIT_RADIUS): THREE.Vector3 {
  const radius = distance + boostKick * 1.4
  const angle = elapsedSeconds * ORBIT_SPEED
  return new THREE.Vector3(Math.sin(angle) * radius, ORBIT_HEIGHT, Math.cos(angle) * radius)
}
