/** Ship studio — a deterministic rig for judging hull appearance.
 *
 *  Why this exists: the in-game capture path drives the `?bot=1` autopilot, which picks a random
 *  route every launch. Across three runs it never once framed the player's hull at a usable angle,
 *  and two captures are never comparable anyway because the scene, the bodies in frame and the
 *  lighting all differ. Nothing about hull materials can be judged that way.
 *
 *  Here the camera, the hull, its rotation and the lighting are all fixed and URL-driven, and
 *  nothing animates. Two loads that differ by one query param differ by exactly that param.
 *
 *  The default rig is the GAME's lighting, not the showcase pages' — the showcase adds a key and
 *  a rim DirectionalLight the game does not have, which is very likely why the same GLBs look good
 *  in showcase renders and read as black silhouettes in flight. `?rig=showcase` switches to it so
 *  the two can be compared directly.
 *
 *  Params:
 *    ?ship=hauler|fighter|miner|interceptor   hull to load               (default interceptor)
 *    ?visual=<holder visual id>               holder skin                (default standard)
 *    ?tier=0..3                               holder tier                (default 0)
 *    ?rig=game|showcase                       lighting rig               (default game)
 *    ?cam=external|cockpit                    camera mount               (default external)
 *    ?yaw=<deg>&pitch=<deg>                   hull orientation, or the
 *                                             pilot's look direction
 *                                             when ?cam=cockpit          (default 3/4 view, 0/0 in cockpit)
 *    ?dist=<number>                           camera distance            (default auto from bbox; ignored in cockpit)
 *    ?detail=on|off                           procedural detail maps     (default on)
 *    ?nscale=<number>                         normalScale override       (default the module's own)
 *    ?tile=<number>                           detail tile size, in model
 *                                             units                      (default the module's own)
 *    ?env=on|off                              hull environment probe     (default on)
 *    ?envi=<number>                           probe strength override    (default the module's own)
 *    ?metal=<number>                          metalness ceiling override (default the module's own)
 *
 *  A note on ?detail: it is the control half of an A/B, and the only way to answer "are the detail
 *  maps visible at all". They were committed while the hulls were still too dark to show anything,
 *  so "the capture looks flat" and "the maps are not attached" are indistinguishable in one frame.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { addCraftEngineGlowRig, buildCraft, loadCraftModelForType } from '../render/shipyard'
import { applyHullDetail, applyHullMetalnessCeiling, stripHullDetail } from '../render/hullDetail'
import { hullEnvProbeReport, initHullEnvProbe, setHullEnvIntensity, sweepHullEnvProbeNow } from '../render/envProbe'
import { buildLights, buildNebula, buildStarfield } from '../render/world'
import { SUN_COLOR } from '../sim/solarSystem'
import type { ShipType } from '../sim/shipTypes'
import type { HolderShipVisualId } from '../ui/holderShipVisual'
import { COCKPIT_NEAR_PLANE, FLIGHT_BASE_FOV, resolveCockpitEyeAnchor, showHullInteriorFaces } from '../ui/cameraView'
import { parseStudioParams, studioCameraPosition, STUDIO_HULL_TINT } from './shipStudioParams'

const params = parseStudioParams(new URLSearchParams(location.search))

const rootEl = document.getElementById('studio-root') as HTMLElement
const labelEl = document.getElementById('studio-label') as HTMLElement

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
// Matches src/main.ts exactly — a different tone curve would invalidate the whole comparison.
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
rootEl.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200000)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.78, 0.62, 0.74))

scene.add(buildNebula(), buildStarfield())

// Before the first hull loads, so hull materials compile with `envMap` already present rather than
// gaining it later — the same ordering the game needs, reproduced here so the two cannot diverge.
if (params.env) initHullEnvProbe(renderer, scene)
if (params.envIntensity !== null) setHullEnvIntensity(params.envIntensity)

// --- Lighting. `game` reproduces src/main.ts; `showcase` reproduces the social showcase pages.
buildLights(scene) // AmbientLight(0x223344, 0.85) — shared by both rigs
if (params.rig === 'game') {
  // One sun PointLight with no falloff, as in main.ts. Placed to the upper left of the hull so
  // roughly half of it is in genuine shadow — that shadowed half is the whole question.
  const sun = new THREE.PointLight(SUN_COLOR, 2.5, 0, 0)
  sun.position.set(-140, 90, 120)
  scene.add(sun)
} else {
  const key = new THREE.DirectionalLight(0xfff0c8, 1.6)
  key.position.set(-12, 14, 12)
  const rim = new THREE.DirectionalLight(0x4ee8ff, 1.4)
  rim.position.set(10, 7, -9)
  scene.add(key, rim)
}

let ship: THREE.Group = buildCraft(params.ship, STUDIO_HULL_TINT[params.ship])
scene.add(ship)

const _cockpitLookAt = new THREE.Vector3()
const _cockpitAim = new THREE.Quaternion()
const _cockpitEuler = new THREE.Euler(0, 0, 0, 'YXZ')

/** Reproduce main.ts's cockpit mount on a stationary hull.
 *
 *  The hull is left unrotated and the camera is aimed instead. In flight the eye is bolted to the
 *  hull and turns with it, so hull rotation and camera rotation are the same rotation; rotating the
 *  hull here as `external` does would only move the interior out from around a fixed camera. yaw and
 *  pitch therefore steer the pilot's head, which is what makes it possible to capture the canopy roof
 *  and the side frames rather than only the forward view.
 *
 *  Near plane and the DoubleSide override come from the same module the game uses, on purpose: if
 *  either were reproduced by hand here, this rig could show a good cockpit while the game showed a
 *  hole, and the harness would be worse than no harness.
 */
/** Where the eye ended up, and the hull box it ended up in — reported on the page because a cockpit
 *  capture is otherwise impossible to diagnose. "A dark flat plane fills the lower frame" is the same
 *  picture whether the eye is resting on the hull's roof or buried just under it, and the second one
 *  is a bug. With the numbers on screen the capture answers that itself. */
let cockpitDebug = ''

function placeCockpitCamera(group: THREE.Group): void {
  group.rotation.set(0, 0, 0)
  group.updateMatrixWorld(true)
  camera.near = COCKPIT_NEAR_PLANE
  camera.fov = FLIGHT_BASE_FOV
  camera.updateProjectionMatrix()
  camera.position.copy(resolveCockpitEyeAnchor(group))
  const hull = new THREE.Box3().setFromObject(group)
  const f = (v: THREE.Vector3): string => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`
  cockpitDebug = `eye[${f(camera.position)}] hull[${f(hull.min)} .. ${f(hull.max)}]`
  // Yaw before pitch (YXZ), so pitching up at the canopy roof does not roll the horizon.
  _cockpitEuler.set(params.pitchRad, params.yawRad, 0)
  _cockpitAim.setFromEuler(_cockpitEuler)
  _cockpitLookAt.set(0, 0, -1).applyQuaternion(_cockpitAim).add(camera.position)
  camera.lookAt(_cockpitLookAt)
  showHullInteriorFaces(group) // never restored: this page renders one frame in one mode and exits
}

function placeShip(group: THREE.Group): void {
  if (params.cam === 'cockpit') {
    placeCockpitCamera(group)
    return
  }
  group.rotation.set(params.pitchRad, params.yawRad, 0)
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
  camera.position.copy(studioCameraPosition(size, params.dist))
  camera.lookAt(0, 0, 0)
}
placeShip(ship)

// Rebuilt after the GLB swaps in, not just for the placeholder: the cockpit numbers are derived from
// whichever hull is actually in the scene, and reporting the placeholder's would be worse than
// reporting none.
function updateLabel(suffix = ''): void {
  const deg = (rad: number): number => Math.round(THREE.MathUtils.radToDeg(rad))
  labelEl.textContent = [
    params.ship.toUpperCase(),
    params.visual !== 'standard' ? params.visual : null,
    `rig=${params.rig}`,
    params.cam === 'cockpit' ? `cockpit yaw=${deg(params.yawRad)} pitch=${deg(params.pitchRad)}` : null,
    params.cam === 'cockpit' ? cockpitDebug : null,
  ].filter(Boolean).join('  ·  ') + suffix
}
updateLabel()

// Nothing animates — one render is the whole output, so a capture never races an animation.
// Re-render only on resize and after the GLB swaps in.
//
// `autoReset = false` is what makes the geometry report readable. `renderer.info` clears itself at the
// top of every `renderer.render()` call, and `composer.render()` is several of those — the bloom
// passes come last, so an auto-resetting counter reports the bloom quad and nothing else (it read
// "0 tris 0 draws" for a hull plainly on screen). Resetting once per frame instead accumulates the
// whole composer chain, which is fine because the background baseline is measured through the same
// chain and subtracts it out.
renderer.info.autoReset = false

function render(): void {
  renderer.info.reset()
  composer.render()
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  render()
})

/** Re-run the detail pass on the loaded hull with this page's overrides.
 *
 *  Safe to mutate: cloneCraftModelInstance() gives every spawned hull its own material copies, so
 *  nothing here leaks back into the loader's cached source or into a later capture in the same run.
 *  The strip is unconditional because applyHullDetail() skips materials that already carry a
 *  normalMap — without it, `?nscale=` and `?tile=` would silently do nothing.
 */
function applyDetailOverrides(group: THREE.Group): void {
  if (params.detail && params.normalScale === null && params.tileWorldSize === null) return
  stripHullDetail(group)
  if (!params.detail) return
  applyHullDetail(group, {
    normalScale: params.normalScale ?? undefined,
    tileWorldSize: params.tileWorldSize ?? undefined,
  })
}

/** Triangles and draw calls the hull itself costs, read off `renderer.info` after a render.
 *
 *  On the label rather than in a console line because a capture PNG is the artefact that gets
 *  reviewed, and "the silhouette got denser" is a claim that needs a number next to it in the same
 *  frame. `renderer.info` counts the whole scene, so the nebula/starfield background is subtracted by
 *  measuring it once with no hull present — otherwise the two dominate and the hull's own cost is
 *  invisible in the total. */
let backgroundTris = 0
let backgroundCalls = 0

function geometryReport(): string {
  const r = renderer.info.render
  return `${Math.max(0, r.triangles - backgroundTris)} tris  ${Math.max(0, r.calls - backgroundCalls)} draws`
}

/** Count what the detail pass actually reached. A PNG cannot distinguish "the map is attached and
 *  too subtle to see" from "the map was never attached", and those need opposite fixes. */
function detailReport(group: THREE.Group): string {
  const seen = new Set<THREE.Material>()
  let lit = 0
  let detailed = 0
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    for (const raw of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = raw as THREE.MeshStandardMaterial
      if (!mat || !('roughness' in mat) || seen.has(mat)) continue
      seen.add(mat)
      lit++
      if (mat.normalMap) detailed++
    }
  })
  return `detail ${detailed}/${lit} mats`
}

async function boot(): Promise<void> {
  // Background-only baseline for the geometry report, taken before any hull is in the scene. The
  // placeholder is removed rather than hidden: an invisible mesh is skipped by the renderer, but
  // leaving it visible would fold its cost into the "background" figure and understate every hull.
  scene.remove(ship)
  render()
  backgroundTris = renderer.info.render.triangles
  backgroundCalls = renderer.info.render.calls
  scene.add(ship)

  // buildCraft() is the procedural placeholder; the real hull players fly is the GLB. Judge the GLB.
  const model = await loadCraftModelForType(params.ship, params.tier, params.visual)
  if (model) {
    scene.remove(ship)
    addCraftEngineGlowRig(model, params.ship)
    applyDetailOverrides(model)
    ship = model
    scene.add(ship)
    placeShip(ship)
    if (params.metalCeiling !== null) applyHullMetalnessCeiling(ship, params.metalCeiling)
    // One synchronous sweep. In flight the probe spreads its six faces over six frames, but this page
    // renders one frame and exits, so a scheduled probe would never produce anything to look at. The
    // hull is hidden by the sweep itself, so it does not appear in its own reflection here either.
    if (params.env) sweepHullEnvProbeNow(new THREE.Vector3(0, 0, 0), [ship])
    render()
    updateLabel(`  ·  ${detailReport(ship)}  ·  ${geometryReport()}  ·  ${hullEnvProbeReport()}`)
  } else {
    updateLabel('  ·  GLB MISSING (procedural fallback)')
  }
  render()
  // Capture tooling polls this instead of guessing a settle delay.
  ;(window as unknown as { studioReady: boolean }).studioReady = true
}

void boot()

export type { ShipType, HolderShipVisualId }
