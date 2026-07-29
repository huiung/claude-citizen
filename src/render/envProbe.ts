import * as THREE from 'three'

/** Environment probe for hull materials — the reflection a metal needs in order to be a metal.
 *
 *  Why this exists: in PBR a metal's appearance IS its reflection of the surroundings. Its diffuse
 *  term is scaled toward zero as metalness rises, so a metal with nothing to reflect renders black.
 *  That is the entire reason the metalness ceiling in `hullDetail` exists (it was named
 *  `MAX_METALNESS_WITHOUT_ENV` for exactly this condition).
 *
 *  Why the previous attempt measured nothing. A *fabricated* environment — a near-black box standing
 *  in for space — was tried and removed, having produced zero measurable change even at 3.5x
 *  intensity. That is not a bug: reflecting a dark box returns dark at any gain. The reason Star
 *  Citizen's probes work is that they capture the genuinely bright nearby body; a sunlit planet
 *  filling half the sky is a real light source with real radiance. So this probe renders THE ACTUAL
 *  SCENE. Nothing here is synthesised.
 *
 *  Scoped to hull materials, NOT `scene.environment`. Two reasons, both about not paying for more
 *  than we asked for:
 *    * `scene.environment` applies to every standard material in the world — planets, stations,
 *      asteroids, the city — so it would change the look of things nobody complained about, and it
 *      would recompile all of them at the moment it is first set.
 *    * The same discipline `groundFill` and `hullDetail` already follow: touch hull materials and
 *      nothing else, so the cost is bounded and local and any regression has one place to be.
 *
 *  Cost control — the hard constraint is no per-frame regression:
 *    * A cubemap is 6 render passes. Those are spread over 6 CONSECUTIVE FRAMES, one face each, so
 *      the worst single frame carries one extra 128x128 scene pass rather than six. A sweep is never
 *      an all-at-once spike.
 *    * A sweep only starts when the surroundings have actually changed: the ship has travelled far
 *      enough that the sky it sees is different, rate-limited so a fast ship cannot chain sweeps.
 *      Standing still (docked, landed, parked) costs nothing at all.
 *    * No lights are added. Adding a light extends the per-fragment light loop for every lit material
 *      in the scene and cannot be scoped to ships.
 *    * The PMREM output target is allocated once, at init, and reused, so the texture object handed to
 *      the materials never changes identity. That matters more than it looks: swapping `envMap` for a
 *      different texture instance is a uniform write, but going from null to non-null (or changing
 *      the mapping) invalidates three.js's program cache and recompiles every hull shader. Refreshes
 *      must never recompile anything.
 *
 *  Allocating at init rather than on the first completed sweep is also what makes this reach the
 *  fleet at all, and getting it wrong measured as a total no-op. `createCraftModelLoader` runs the
 *  material pass once on a CACHED source model and then hands every spawned ship its own
 *  `material.clone()`. `MeshStandardMaterial.copy` copies `envMap` by value, so a clone gets whatever
 *  the source had AT CLONE TIME — null, if the probe was still waiting for its first sweep — and the
 *  clone is not in this module's registry, so it never gets one afterwards. Every hull a player
 *  actually sees was one of those clones. With the texture existing from init, the clone inherits the
 *  same texture object and every later sweep reaches it for free, because a sweep writes into that
 *  texture rather than replacing it.
 *
 *  Known overlap with `groundFill`, left alone deliberately. On a daylit pad the probe's lower
 *  hemisphere IS the deck, so its diffuse term and the analytic ground-bounce fill are modelling the
 *  same photons, and a hull on the ground now gets both. Measured on `?earthview=seoul-foot`, the hull
 *  band goes 107.9 -> 134.3 mean with the probe on, against a deck that reads 135 — so the result is a
 *  hull that belongs to its scene rather than one that is blown out, and nothing clips (0.00% of hull
 *  pixels at 250+). Deduplicating the two would mean retuning `GROUND_FILL_INTENSITY`, which was
 *  measured against a scene with no probe in it, and that number is not this change's to move: the
 *  fill still carries the cases the probe cannot, being continuous during a descent where the probe
 *  refreshes every few hundred metres, and correct while parked where the probe never refreshes at all.
 *
 *  A note on why PMREM is not optional. `envmap_physical_pars_fragment` guards both
 *  `getIBLIrradiance` and `getIBLRadiance` with `#ifdef ENVMAP_TYPE_CUBE_UV` and returns
 *  `vec3( 0.0 )` otherwise. Handing a `MeshStandardMaterial` a raw `WebGLCubeRenderTarget.texture`
 *  therefore compiles cleanly, costs a texture unit, and contributes exactly nothing — a silent
 *  no-op that looks identical to "the probe is too dark". The cube must go through PMREMGenerator.
 */

/** Cube face resolution.
 *
 *  128 is chosen for what a reflection on a rough hull can carry, not for detail: hull roughness runs
 *  0.36-0.55, and PMREM's roughness mips discard most of the high frequencies at those values anyway.
 *  Six faces at 128 is 98k pixels — less than a 320x320 window — so the fragment cost of a sweep is
 *  noise. What a sweep actually costs is draw-call submission, which is resolution-independent, and
 *  that is what the one-face-per-frame schedule below is for. */
const PROBE_SIZE = 128

/** Near/far for the probe cameras. Far has to reach the star and the planets — the two things in the
 *  scene bright enough to matter as a reflection — so it matches the flight camera's far plane.
 *  Near is well outside any hull so the ship's own geometry cannot clip into its own reflection even
 *  if the hide below is ever bypassed. */
const PROBE_NEAR = 4
const PROBE_FAR = 500000

/** How far the ship must travel before the sky it sees is worth re-capturing, in world units
 *  (~metres).
 *
 *  A body at planetary distance subtends a near-identical solid angle after a few hundred metres of
 *  travel, so a smaller threshold would buy nothing but sweeps. This is deliberately far larger than
 *  a hull: the probe is a model of "what is around me", and around here changes on the scale of
 *  approaches and departures, not of manoeuvres. Docking, landing and parking are all inside it, so
 *  a stationary ship never sweeps at all.
 *
 *  This is also why there is no explicit "invalidate on arrival" hook. A quantum jump displaces the
 *  ship by thousands of units in one frame, so the distance test fires by itself on the frame after
 *  arrival; a separate event hook would be a second mechanism for the same thing, and one that could
 *  silently rot if the jump code moved. */
const PROBE_REFRESH_DISTANCE = 400

/** Floor on the interval between sweeps, in seconds. At quantum speeds the distance test would fire
 *  every frame; this converts that into a steady trickle whose cost is known. Also covers the case
 *  where a scripted move (jump arrival, a dev teleport) invalidates the probe repeatedly. */
const PROBE_MIN_INTERVAL_S = 1.5

/** Multiplier on the probe's contribution to hull shading.
 *
 *  1.0 — the physically neutral value — on purpose. The whole failure of the fabricated-environment
 *  attempt was reaching for gain to compensate for a source that had no light in it; a gain here
 *  would be the same mistake wearing the probe's clothes. If the captured sky is dark, the correct
 *  reflection IS dark, and that is the honest answer for deep space. */
const HULL_ENV_INTENSITY = 1.0

/** The live value, so a harness can sweep it. Production never writes it.
 *
 *  This knob is not a licence to add gain; it is the control half of an A/B, and it earns its keep by
 *  answering the one question a capture cannot: whether a frame that did not change is a probe that
 *  captured a dark sky (correct) or a probe whose texture never reached the shader (a silent no-op,
 *  which is what `#ifdef ENVMAP_TYPE_CUBE_UV` turns a non-PMREM cube into). Those look identical and
 *  need opposite fixes. A large value that STILL changes nothing means the second one. */
let envIntensity = HULL_ENV_INTENSITY

interface Probe {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cube: THREE.WebGLCubeRenderTarget
  cubeCamera: THREE.CubeCamera
  pmrem: THREE.PMREMGenerator
  /** Allocated at init and reused forever — see the note on texture identity above. */
  output: THREE.WebGLRenderTarget
  /** -1 = idle. 0..5 = the next cube face to render. */
  face: number
  /** Where the in-progress sweep is centred. Held for the whole sweep so the six faces agree with
   *  each other even though the ship keeps moving between them; a sweep whose faces were captured
   *  from six different points would have visible seams. */
  origin: THREE.Vector3
  /** Centre of the last COMPLETED sweep, which is what the distance test compares against. */
  lastOrigin: THREE.Vector3
  hasCompleted: boolean
  lastSweepStart: number
  sweeps: number
}

let probe: Probe | null = null

/** Hull materials waiting for, or already carrying, the probe. Kept so a probe created after a hull
 *  has loaded still reaches it, and so the intensity is set in exactly one place. */
const registered = new Set<THREE.MeshStandardMaterial>()

function assignEnvMap(mat: THREE.MeshStandardMaterial, texture: THREE.Texture | null): void {
  mat.envMapIntensity = envIntensity
  if (mat.envMap === texture) return
  mat.envMap = texture
  // Only needed when the map appears or disappears (a define change); harmless otherwise, and this
  // path runs once per material per probe lifetime rather than per frame.
  mat.needsUpdate = true
}

/** Override the probe's contribution strength. Harness only — see the note on `envIntensity`. */
export function setHullEnvIntensity(value: number): void {
  envIntensity = value
  for (const mat of registered) mat.envMapIntensity = value
}

/** Create the probe. Call once, from wherever the renderer and scene are built, and BEFORE any hull
 *  loads: a material that first compiles without `envMap` and gains one later pays a shader
 *  recompile, and doing that for the whole fleet mid-flight is a visible hitch.
 *
 *  Idempotent, and safe to skip entirely — every other function here no-ops without a probe, so a
 *  page that never calls this (or a unit test with no WebGL context) behaves exactly as before. */
export function initHullEnvProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  if (probe) return
  const cube = new THREE.WebGLCubeRenderTarget(PROBE_SIZE, { type: THREE.HalfFloatType })
  const cubeCamera = new THREE.CubeCamera(PROBE_NEAR, PROBE_FAR, cube)
  // CubeCamera normally does this inside update(), which renders all six faces in one call. This
  // module renders one face per frame instead, so the per-face cameras have to be oriented up front.
  cubeCamera.coordinateSystem = renderer.coordinateSystem
  cubeCamera.updateCoordinateSystem()

  const pmrem = new THREE.PMREMGenerator(renderer)
  // Compiling the cubemap-to-CubeUV shader now rather than during the first sweep keeps that one
  // frame from carrying a shader compile on top of its render.
  pmrem.compileCubemapShader()

  // Black out the cube before filtering it, so the environment materials get at init is "nothing to
  // reflect" rather than whatever the driver left in a fresh attachment. This is the ONLY fabricated
  // environment in the module, it lasts until the first sweep completes, and it is black on purpose:
  // black is the honest answer for "we have not looked yet".
  const previousTarget = renderer.getRenderTarget()
  for (let face = 0; face < 6; face++) {
    renderer.setRenderTarget(cube, face)
    renderer.clear(true, true, false)
  }
  renderer.setRenderTarget(previousTarget)

  probe = {
    renderer,
    scene,
    cube,
    cubeCamera,
    pmrem,
    output: pmrem.fromCubemap(cube.texture),
    face: -1,
    origin: new THREE.Vector3(),
    lastOrigin: new THREE.Vector3(),
    hasCompleted: false,
    lastSweepStart: -Infinity,
    sweeps: 0,
  }
}

/** Register a hull material with the probe. Called from `tuneHullMaterials`, which
 *  already walks every hull material exactly once, already dedupes shared materials, and already
 *  owns the rule for which surfaces are their own light source and must be left alone. */
export function attachEnvProbeToMaterial(mat: THREE.MeshStandardMaterial): void {
  registered.add(mat)
  // Intensity outside the probe check: a hull can load after a harness has swept the strength, and a
  // material that silently kept the default would make an intensity sweep report a mix of two values.
  mat.envMapIntensity = envIntensity
  if (probe) assignEnvMap(mat, probe.output.texture)
}

/**
 * Advance the probe by at most one cube face.
 *
 * `centre` is where the probe sits — the ship, so the hull reflects its own surroundings. `hide` is
 * the geometry that must not appear in its own reflection: the probe camera sits inside the ship, so
 * without this the cube is mostly the interior faces of the hull and the reflection is a dark smear
 * of itself.
 *
 * Call once per frame, before the scene is drawn. Returns true if a face was rendered, which is only
 * useful for diagnostics — the caller has nothing to do differently either way.
 */
export function updateHullEnvProbe(centre: THREE.Vector3, hide: readonly THREE.Object3D[] = []): boolean {
  if (!probe) return false
  const now = performance.now() / 1000

  if (probe.face < 0) {
    const moved = probe.hasCompleted ? centre.distanceTo(probe.lastOrigin) : Infinity
    if (moved < PROBE_REFRESH_DISTANCE) return false
    if (now - probe.lastSweepStart < PROBE_MIN_INTERVAL_S) return false
    probe.face = 0
    probe.origin.copy(centre)
    probe.lastSweepStart = now
  }

  const { renderer, scene, cube, cubeCamera } = probe
  cubeCamera.position.copy(probe.origin)
  cubeCamera.updateMatrixWorld(true)

  // Save/restore rather than assume: the caller is a long imperative frame function and the probe
  // must be invisible to everything downstream of it.
  const previousTarget = renderer.getRenderTarget()
  const hidden: THREE.Object3D[] = []
  for (const obj of hide) {
    if (!obj.visible) continue
    obj.visible = false
    hidden.push(obj)
  }
  try {
    const faceCamera = cubeCamera.children[probe.face] as THREE.PerspectiveCamera
    renderer.setRenderTarget(cube, probe.face)
    renderer.render(scene, faceCamera)
  } finally {
    for (const obj of hidden) obj.visible = true
    renderer.setRenderTarget(previousTarget)
  }

  probe.face++
  if (probe.face < 6) return true

  // Sweep complete: filter it. `fromCubemap` reuses the target it is handed, so this writes into the
  // same texture every hull material (and every clone of one) already points at. That is what makes a
  // refresh cost nothing beyond the render: no reassignment, no recompile, no traversal.
  probe.face = -1
  probe.pmrem.fromCubemap(cube.texture, probe.output)
  probe.lastOrigin.copy(probe.origin)
  probe.hasCompleted = true
  probe.sweeps++
  return true
}

/** Run a whole sweep in one call. For the deterministic capture harnesses only: they render a single
 *  frame, so a probe that needs six frames would never produce anything to look at. Never called
 *  from the game — the point of the per-frame schedule is that the game does not do this. */
export function sweepHullEnvProbeNow(centre: THREE.Vector3, hide: readonly THREE.Object3D[] = []): void {
  if (!probe) return
  probe.hasCompleted = false
  probe.lastSweepStart = -Infinity
  for (let i = 0; i < 6; i++) updateHullEnvProbe(centre, hide)
}

/** Diagnostics for the studio label. A capture PNG cannot distinguish "the probe ran and the sky is
 *  genuinely black" from "the probe never ran", and those need opposite fixes — the same trap
 *  `detailReport` exists for. */
export function hullEnvProbeReport(): string {
  if (!probe) return 'env off'
  return `env ${probe.sweeps} sweep(s) @${PROBE_SIZE} x${envIntensity}`
}

/** Drop the probe's GPU resources and detach it from every registered material. Tests and hot
 *  reload; the game keeps its probe for the session. */
export function disposeHullEnvProbe(): void {
  if (!probe) return
  for (const mat of registered) assignEnvMap(mat, null)
  probe.cube.dispose()
  probe.output.dispose()
  probe.pmrem.dispose()
  probe = null
}

export const ENV_PROBE_INTERNALS = {
  PROBE_SIZE, PROBE_REFRESH_DISTANCE, PROBE_MIN_INTERVAL_S, HULL_ENV_INTENSITY, registered,
}
