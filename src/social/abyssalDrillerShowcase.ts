import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import {
  addCraftEngineGlowRig,
  buildCraft,
  collectCraftEngineGlows,
  loadCraftModelForType,
  type CraftEngineGlow,
} from '../render/shipyard'
import {
  buildAsteroids,
  buildDustField,
  buildLights,
  buildMineableAsteroid,
  buildNebula,
  buildStarfield,
  updateDustField,
} from '../render/world'
import { engineGlowStyle, type EngineGlowStyle } from '../render/engineGlow'

const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const DURATION_SECONDS = 16
const TOTAL_FRAMES = FPS * DURATION_SECONDS
const SHOWCASE_PREVIEW_FRAME = Math.floor(TOTAL_FRAMES * 0.2)
const MINER_TINT = 0xe0a83c

const root = document.getElementById('showcase-root')
if (!root) throw new Error('missing showcase root')

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(WIDTH, HEIGHT, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.08
renderer.domElement.width = WIDTH
renderer.domElement.height = HEIGHT
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010206)
scene.fog = new THREE.FogExp2(0x010206, 0.0012)

const camera = new THREE.PerspectiveCamera(42, WIDTH / HEIGHT, 0.1, 500000)
const composer = new EffectComposer(renderer)
composer.setSize(WIDTH, HEIGHT)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH, HEIGHT), 0.78, 0.62, 0.74))

buildLights(scene)
const key = new THREE.DirectionalLight(0xfff0c8, 1.6)
key.position.set(-12, 14, 12)
const rim = new THREE.DirectionalLight(0x4ee8ff, 1.4)
rim.position.set(10, 7, -9)
scene.add(key, rim)

const nebula = buildNebula()
const starfield = buildStarfield()
const dustField = buildDustField()
const asteroidBelt = buildAsteroids()
asteroidBelt.scale.setScalar(0.64)
scene.add(nebula, starfield, dustField, asteroidBelt)

const oreRock = buildMineableAsteroid(true)
oreRock.position.set(-8.8, -3.4, -8)
oreRock.scale.setScalar(0.16)
scene.add(oreRock)

const foregroundRock = buildMineableAsteroid()
foregroundRock.position.set(9.4, 3.4, -18)
foregroundRock.scale.setScalar(0.1)
scene.add(foregroundRock)

let ship = buildCraft('miner', MINER_TINT)
ship.rotation.set(0.04, Math.PI * 0.88, -0.02)
scene.add(ship)
let engineGlows: CraftEngineGlow[] = collectCraftEngineGlows(ship)

const target = new THREE.Vector3(0, 0.35, 0)
const cameraPosition = new THREE.Vector3()

function applyEngineGlowStyle(glows: CraftEngineGlow[], style: EngineGlowStyle): void {
  for (const glow of glows) {
    const mat = glow.mesh.material
    const isCore = glow.role === 'core'
    mat.color.setHex(isCore ? 0xffffff : style.color)
    mat.color.multiplyScalar(isCore ? style.coreIntensity : style.discIntensity)
    mat.opacity = isCore ? style.coreOpacity : style.discOpacity
    glow.mesh.scale.setScalar(style.scale * (isCore ? 0.92 : 1))
  }
}

function renderShowcaseFrame(frame: number, total = TOTAL_FRAMES): void {
  const safeTotal = Math.max(1, total)
  const progress = (frame % safeTotal) / safeTotal
  const seconds = frame / FPS
  const dt = 1 / FPS
  const angle = -0.72 + progress * Math.PI * 2.1
  const radius = 24 + Math.sin(seconds * 0.35) * 1.2
  cameraPosition.set(
    Math.sin(angle) * radius,
    5.9 + Math.sin(seconds * 0.48 + 0.6) * 0.62,
    Math.cos(angle) * radius,
  )
  camera.position.copy(cameraPosition)
  camera.lookAt(target)
  camera.fov = 42 + Math.sin(seconds * 0.7) * 1.4
  camera.updateProjectionMatrix()

  ship.position.y = Math.sin(seconds * 0.85) * 0.18
  ship.rotation.y = Math.PI * 0.88 + Math.sin(seconds * 0.24) * 0.08
  ship.rotation.z = -0.02 + Math.sin(seconds * 0.62) * 0.025

  oreRock.rotation.y += dt * 0.42
  oreRock.rotation.x += dt * 0.18
  foregroundRock.rotation.y -= dt * 0.22
  asteroidBelt.rotation.y += dt * 0.006
  nebula.position.copy(camera.position)
  starfield.position.copy(camera.position)
  updateDustField(dustField, camera.position)
  applyEngineGlowStyle(engineGlows, engineGlowStyle({
    thrust: 0.48 + Math.sin(seconds * 1.3) * 0.08,
    boost: false,
    speedFrac: 0.28,
    cosmeticTier: 0,
    time: seconds,
  }))

  composer.render()
}

async function boot(): Promise<void> {
  const model = await loadCraftModelForType('miner', 3, 'abyssal-driller')
  if (model) {
    scene.remove(ship)
    addCraftEngineGlowRig(model, 'miner')
    ship = model
    scene.add(ship)
    engineGlows = collectCraftEngineGlows(ship)
  }
  renderShowcaseFrame(SHOWCASE_PREVIEW_FRAME)
  window.__showcaseReady = true
}

declare global {
  interface Window {
    __showcaseReady?: boolean
    __showcaseTotalFrames?: number
    renderShowcaseFrame?: (frame: number, total?: number) => void
  }
}

window.__showcaseReady = false
window.__showcaseTotalFrames = TOTAL_FRAMES
window.renderShowcaseFrame = renderShowcaseFrame

boot().catch((error: unknown) => {
  console.error(error)
  renderShowcaseFrame(SHOWCASE_PREVIEW_FRAME)
  window.__showcaseReady = true
})
