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
  buildPlanet,
  buildStarfield,
  buildStation,
  buildWarpField,
  updateDustField,
  updateWarpField,
} from '../render/world'
import { createShipCosmetics, type ShipCosmetics } from '../render/craftCosmetics'
import { engineGlowStyle, type EngineGlowStyle } from '../render/engineGlow'
import { cosmeticStyle } from '../sim/cosmetics'
import type { CraftingRarity } from '../sim/crafting'
import { rearCameraOffset } from '../ui/cameraView'

const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const DURATION_SECONDS = 16
const TOTAL_FRAMES = FPS * DURATION_SECONDS
const SEGMENT_FRAMES = TOTAL_FRAMES / 4
const PLAYER_TINT = 0x58ddff

interface Variant {
  rarity: CraftingRarity
  badge: string
  name: string
  color: string
}

const VARIANTS: Variant[] = [
  { rarity: 'common', badge: 'COMMON', name: 'Dust Comet Wake', color: '#cfe3d0' },
  { rarity: 'rare', badge: 'RARE', name: 'Ion Comet Wake', color: '#6fe8ff' },
  { rarity: 'epic', badge: 'EPIC', name: 'Solar Comet Wake', color: '#c08aff' },
  { rarity: 'legendary', badge: 'LEGENDARY', name: 'Celestial Comet Wake', color: '#ffe08a' },
]

const root = document.getElementById('showcase-root')
if (!root) throw new Error('missing showcase root')

const rarityEl = document.getElementById('rarity')
const variantEl = document.getElementById('variant')
const progressEls = Array.from(document.querySelectorAll<HTMLElement>('.grade-step'))

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(WIDTH, HEIGHT, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.06
renderer.domElement.width = WIDTH
renderer.domElement.height = HEIGHT
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010206)
scene.fog = new THREE.FogExp2(0x010206, 0.00042)

const camera = new THREE.PerspectiveCamera(72, WIDTH / HEIGHT, 0.5, 500000)
scene.add(camera)

const composer = new EffectComposer(renderer)
composer.setSize(WIDTH, HEIGHT)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH, HEIGHT), 0.7, 0.5, 0.85))

buildLights(scene)

const nebula = buildNebula()
const starfield = buildStarfield()
const planet = buildPlanet()
const asteroidBelt = buildAsteroids()
const dustField = buildDustField()
const warpField = buildWarpField()
camera.add(warpField)
scene.add(nebula, starfield, planet, asteroidBelt, dustField)

const station = buildStation()
station.position.set(145, 22, -360)
station.rotation.set(0.15, -0.48, 0.04)
scene.add(station)

const oreRock = buildMineableAsteroid()
oreRock.position.set(-64, -16, -132)
oreRock.scale.setScalar(0.9)
scene.add(oreRock)

const rareRock = buildMineableAsteroid(true)
rareRock.position.set(118, 24, -225)
rareRock.scale.setScalar(0.72)
scene.add(rareRock)

let shipMesh = buildCraft('interceptor', PLAYER_TINT)
scene.add(shipMesh)
let engineGlows: CraftEngineGlow[] = collectCraftEngineGlows(shipMesh)
let cosmetics: ShipCosmetics = createShipCosmetics(shipMesh, scene)

const shipPosition = new THREE.Vector3()
const nextShipPosition = new THREE.Vector3()
const cameraOffset = new THREE.Vector3()
const lookMatrix = new THREE.Matrix4()
const up = new THREE.Vector3(0, 1, 0)
const rollQuat = new THREE.Quaternion()
let activeVariantIndex = -1

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

function flightPositionAt(seconds: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    Math.sin(seconds * 0.58) * 12,
    -2 + Math.sin(seconds * 0.43 + 0.5) * 2.4,
    74 - seconds * 34,
  )
  return out
}

function setActiveVariant(index: number): void {
  if (activeVariantIndex === index) return
  activeVariantIndex = index
  const variant = VARIANTS[index]
  cosmetics.apply([cosmeticStyle('comet-wake-kit', variant.rarity)])
  if (rarityEl) {
    rarityEl.textContent = variant.badge
    rarityEl.style.color = variant.color
  }
  if (variantEl) variantEl.textContent = variant.name
  for (const [stepIndex, el] of progressEls.entries()) {
    el.classList.toggle('active', stepIndex === index)
    el.classList.toggle('past', stepIndex < index)
  }
}

function renderShowcaseFrame(frame: number, total = TOTAL_FRAMES): void {
  const safeTotal = Math.max(1, total)
  const seconds = frame / FPS
  const segmentFrame = frame % SEGMENT_FRAMES
  const variantIndex = Math.min(VARIANTS.length - 1, Math.floor((frame / safeTotal) * VARIANTS.length))
  const boostKick = 0.18 + Math.sin(seconds * 2.1) * 0.05
  const bank = Math.sin(seconds * 0.72) * 0.11
  const dt = 1 / FPS

  setActiveVariant(variantIndex)
  flightPositionAt(seconds, shipPosition)
  flightPositionAt(seconds + 0.12, nextShipPosition)
  lookMatrix.lookAt(shipPosition, nextShipPosition, up)
  shipMesh.quaternion.setFromRotationMatrix(lookMatrix)
  rollQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank)
  shipMesh.quaternion.multiply(rollQuat)
  shipMesh.position.copy(shipPosition)

  cameraOffset.copy(rearCameraOffset(boostKick, 14)).applyQuaternion(shipMesh.quaternion)
  camera.position.copy(shipPosition).add(cameraOffset)
  camera.quaternion.copy(shipMesh.quaternion)
  camera.fov = 74 + boostKick * 4
  camera.updateProjectionMatrix()

  nebula.position.copy(shipPosition)
  starfield.position.copy(shipPosition)
  planet.rotation.y += dt * 0.015
  asteroidBelt.rotation.y += dt * 0.008
  station.rotation.z += dt * 0.05
  oreRock.rotation.y += dt * 0.34
  rareRock.rotation.x += dt * 0.25
  updateDustField(dustField, camera.position)
  updateWarpField(warpField, 0, dt)

  const segmentProgress = segmentFrame / SEGMENT_FRAMES
  applyEngineGlowStyle(engineGlows, engineGlowStyle({
    thrust: 0.78,
    boost: segmentProgress > 0.68 && segmentProgress < 0.9,
    speedFrac: 0.76 + Math.sin(seconds * 1.1) * 0.04,
    cosmeticTier: 0,
    time: seconds,
  }))
  cosmetics.update(dt, shipPosition)

  composer.render()
}

async function useGameShipModel(): Promise<void> {
  const model = await loadCraftModelForType('interceptor', 0, 'standard')
  if (!model) return
  cosmetics.dispose()
  scene.remove(shipMesh)
  addCraftEngineGlowRig(model, 'interceptor')
  shipMesh = model
  scene.add(shipMesh)
  engineGlows = collectCraftEngineGlows(shipMesh)
  cosmetics = createShipCosmetics(shipMesh, scene)
  activeVariantIndex = -1
}

async function boot(): Promise<void> {
  await useGameShipModel()
  renderShowcaseFrame(0)
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
  renderShowcaseFrame(0)
  window.__showcaseReady = true
})
