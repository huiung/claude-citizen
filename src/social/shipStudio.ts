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
 *    ?yaw=<deg>&pitch=<deg>                   hull orientation           (default 3/4 view)
 *    ?dist=<number>                           camera distance            (default auto from bbox)
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { addCraftEngineGlowRig, buildCraft, loadCraftModelForType } from '../render/shipyard'
import { buildLights, buildNebula, buildStarfield } from '../render/world'
import { SUN_COLOR } from '../sim/solarSystem'
import type { ShipType } from '../sim/shipTypes'
import type { HolderShipVisualId } from '../ui/holderShipVisual'
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

function placeShip(group: THREE.Group): void {
  group.rotation.set(params.pitchRad, params.yawRad, 0)
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
  camera.position.copy(studioCameraPosition(size, params.dist))
  camera.lookAt(0, 0, 0)
}
placeShip(ship)

labelEl.textContent = [
  params.ship.toUpperCase(),
  params.visual !== 'standard' ? params.visual : null,
  `rig=${params.rig}`,
].filter(Boolean).join('  ·  ')

// Nothing animates — one render is the whole output, so a capture never races an animation.
// Re-render only on resize and after the GLB swaps in.
function render(): void {
  composer.render()
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  render()
})

async function boot(): Promise<void> {
  // buildCraft() is the procedural placeholder; the real hull players fly is the GLB. Judge the GLB.
  const model = await loadCraftModelForType(params.ship, params.tier, params.visual)
  if (model) {
    scene.remove(ship)
    addCraftEngineGlowRig(model, params.ship)
    ship = model
    scene.add(ship)
    placeShip(ship)
  } else {
    labelEl.textContent += '  ·  GLB MISSING (procedural fallback)'
  }
  render()
  // Capture tooling polls this instead of guessing a settle delay.
  ;(window as unknown as { studioReady: boolean }).studioReady = true
}

void boot()

export type { ShipType, HolderShipVisualId }
