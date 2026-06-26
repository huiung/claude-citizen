import * as THREE from 'three'
import { buildCraft } from '../render/shipyard'
import { createShipCosmetics, type ShipCosmetics } from '../render/craftCosmetics'
import { cosmeticStyle } from '../sim/cosmetics'
import type { CraftingRarity } from '../sim/crafting'

const WIDTH = 1920
const HEIGHT = 1080
const FPS = 30
const DURATION_SECONDS = 16
const TOTAL_FRAMES = FPS * DURATION_SECONDS

interface Lane {
  rarity: CraftingRarity
  group: THREE.Group
  cosmetics: ShipCosmetics
  y: number
  phase: number
}

const root = document.getElementById('showcase-root')
if (!root) throw new Error('missing showcase root')

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(WIDTH, HEIGHT, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.domElement.width = WIDTH
renderer.domElement.height = HEIGHT
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x020507)

const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 120)
camera.position.set(0, 6.8, 24)
camera.lookAt(0, 0, 0)

scene.add(new THREE.AmbientLight(0x7fb0c8, 0.8))
const key = new THREE.DirectionalLight(0xffffff, 2.6)
key.position.set(6, 8, 8)
scene.add(key)
const rim = new THREE.DirectionalLight(0x6fe8ff, 1.4)
rim.position.set(-8, 5, -6)
scene.add(rim)

const starGeo = new THREE.BufferGeometry()
const starPositions = new Float32Array(900 * 3)
for (let i = 0; i < 900; i++) {
  starPositions[i * 3] = (fract(Math.sin(i * 17.17) * 43758.5453) - 0.5) * 60
  starPositions[i * 3 + 1] = (fract(Math.sin(i * 31.71) * 24634.6345) - 0.5) * 30
  starPositions[i * 3 + 2] = -10 - fract(Math.sin(i * 47.37) * 91324.9317) * 50
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xaee9ff,
  size: 0.045,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
}))
scene.add(stars)

const lanes: Lane[] = [
  { rarity: 'common', y: 4.9, phase: 0, group: buildCraft('interceptor', 0x8d98a3), cosmetics: undefined as unknown as ShipCosmetics },
  { rarity: 'rare', y: 1.7, phase: 0.13, group: buildCraft('interceptor', 0x789fd6), cosmetics: undefined as unknown as ShipCosmetics },
  { rarity: 'epic', y: -1.5, phase: 0.26, group: buildCraft('interceptor', 0x9370c8), cosmetics: undefined as unknown as ShipCosmetics },
  { rarity: 'legendary', y: -4.7, phase: 0.39, group: buildCraft('interceptor', 0xcaa86b), cosmetics: undefined as unknown as ShipCosmetics },
]

for (const lane of lanes) {
  lane.group.scale.setScalar(0.72)
  lane.group.rotation.set(0.1, -Math.PI / 2, -0.06)
  lane.group.position.set(-8.5, lane.y, 0)
  scene.add(lane.group)
  lane.cosmetics = createShipCosmetics(lane.group, scene)
  lane.cosmetics.apply([cosmeticStyle('comet-wake-kit', lane.rarity)])
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function easeInOutSine(value: number): number {
  return -(Math.cos(Math.PI * value) - 1) / 2
}

function laneX(progress: number, phase: number): number {
  const loop = (progress + phase) % 1
  return -8.8 + easeInOutSine(loop) * 17.6
}

function renderShowcaseFrame(frame: number, total = TOTAL_FRAMES): void {
  const safeTotal = Math.max(1, total)
  const t = ((frame % safeTotal) / safeTotal)
  const seconds = frame / FPS
  stars.rotation.z = seconds * 0.004
  stars.position.x = Math.sin(seconds * 0.18) * 0.32

  for (const lane of lanes) {
    const x = laneX(t, lane.phase)
    const bob = Math.sin(seconds * 2.2 + lane.phase * 12) * 0.08
    lane.group.position.set(x, lane.y + bob, 0)
    lane.group.rotation.y = -Math.PI / 2 + Math.sin(seconds * 0.9 + lane.phase * 9) * 0.06
    lane.group.rotation.z = -0.06 + Math.sin(seconds * 1.15 + lane.phase * 11) * 0.035
    lane.cosmetics.update(1 / FPS, lane.group.position)
  }

  renderer.render(scene, camera)
}

renderShowcaseFrame(0)

declare global {
  interface Window {
    __showcaseReady?: boolean
    __showcaseTotalFrames?: number
    renderShowcaseFrame?: (frame: number, total?: number) => void
  }
}

window.__showcaseReady = true
window.__showcaseTotalFrames = TOTAL_FRAMES
window.renderShowcaseFrame = renderShowcaseFrame
