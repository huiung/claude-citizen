import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    }).catch((error) => {
      this.error = error
      this.onerror?.(error)
    })
  }
}

function material({ color, emissive = 0x000000, emissiveIntensity = 0, metalness = 0, roughness = 0.45 }) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness,
    flatShading: true,
  })
}

const obsidianMat = material({ color: 0x050608, emissive: 0x010205, emissiveIntensity: 0.05, metalness: 0.98, roughness: 0.2 })
const gunmetalMat = material({ color: 0x18202a, emissive: 0x03070d, emissiveIntensity: 0.08, metalness: 0.92, roughness: 0.26 })
const armorMat = material({ color: 0x0b1018, emissive: 0x02040a, emissiveIntensity: 0.06, metalness: 0.88, roughness: 0.32 })
const crownMat = material({ color: 0x7f8b92, emissive: 0x11191f, emissiveIntensity: 0.08, metalness: 0.96, roughness: 0.24 })
const goldAccentMat = material({ color: 0x9a7732, emissive: 0x2a1b06, emissiveIntensity: 0.08, metalness: 0.94, roughness: 0.24 })
const canopyMat = material({ color: 0x102237, emissive: 0x1e63c9, emissiveIntensity: 0.36, metalness: 0.38, roughness: 0.12 })
const cyanMat = material({ color: 0x46aeb8, emissive: 0x147783, emissiveIntensity: 0.28, metalness: 0.24, roughness: 0.26 })
const engineMat = material({ color: 0x5fdde8, emissive: 0x22aeba, emissiveIntensity: 0.5, metalness: 0.14, roughness: 0.2 })
const nozzleMat = material({ color: 0x030407, emissive: 0x000000, emissiveIntensity: 0, metalness: 0.96, roughness: 0.24 })

function addMesh(group, geometry, meshMaterial, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], name = '') {
  const mesh = new THREE.Mesh(geometry, meshMaterial)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  mesh.name = name
  group.add(mesh)
  return mesh
}

function wedgeGeometry(sections) {
  const vertices = []
  for (const s of sections) {
    const hw = s.w / 2
    const hh = s.h / 2
    vertices.push(-hw, -hh, s.z, hw, -hh, s.z, hw, hh, s.z, -hw, hh, s.z)
  }
  const indices = []
  for (let i = 0; i < sections.length - 1; i++) {
    const a = i * 4
    const b = a + 4
    indices.push(
      a, b, a + 1, a + 1, b, b + 1,
      a + 1, b + 1, a + 2, a + 2, b + 1, b + 2,
      a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
      a + 3, b + 3, a, a, b + 3, b,
    )
  }
  indices.push(0, 1, 2, 0, 2, 3)
  const last = (sections.length - 1) * 4
  indices.push(last, last + 2, last + 1, last, last + 3, last + 2)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function prismGeometry(points, thickness) {
  const half = thickness / 2
  const vertices = []
  for (const z of [-half, half]) {
    for (const [x, y] of points) vertices.push(x, y, z)
  }
  const indices = []
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1)
  const offset = points.length
  for (let i = 1; i < points.length - 1; i++) indices.push(offset, offset + i + 1, offset + i)
  for (let i = 0; i < points.length; i++) {
    const n = (i + 1) % points.length
    indices.push(i, n, offset + n, i, offset + n, offset + i)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function mirrored(points, side) {
  return points.map(([x, y]) => [x * side, y])
}

function addEngine(group, x, y, z, scale = 1) {
  addMesh(group, new THREE.CylinderGeometry(0.58 * scale, 0.82 * scale, 1.1 * scale, 28), armorMat, [x, y, z], [Math.PI / 2, 0, 0], [1.18, 1, 1], 'sovereign_engine_cowling')
  addMesh(group, new THREE.CylinderGeometry(0.5 * scale, 0.64 * scale, 0.28 * scale, 28), nozzleMat, [x, y, z + 0.53 * scale], [Math.PI / 2, 0, 0], [1.12, 1, 1], 'sovereign_dark_nozzle')
  addMesh(group, new THREE.TorusGeometry(0.48 * scale, 0.02 * scale, 8, 32), cyanMat, [x, y, z + 0.69 * scale], [0, 0, 0], [1, 1, 1], 'sovereign_muted_engine_ring')
  addMesh(group, new THREE.CircleGeometry(0.2 * scale, 32), engineMat, [x, y, z + 0.72 * scale], [0, 0, 0], [1, 1, 1], 'sovereign_engine_core')
}

const ship = new THREE.Group()
ship.name = 'Holder_Sovereign_Wraith'

addMesh(ship, wedgeGeometry([
  { z: -5.05, w: 0.62, h: 0.28 },
  { z: -3.35, w: 1.72, h: 0.7 },
  { z: -1.1, w: 3.25, h: 1.22 },
  { z: 1.35, w: 4.25, h: 1.55 },
  { z: 3.25, w: 4.75, h: 1.62 },
  { z: 4.55, w: 3.45, h: 1.28 },
]), gunmetalMat, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], 'sovereign_heavy_core')

addMesh(ship, wedgeGeometry([
  { z: -3.55, w: 1.15, h: 0.24 },
  { z: -1.3, w: 2.55, h: 0.46 },
  { z: 1.95, w: 3.28, h: 0.5 },
  { z: 3.85, w: 2.7, h: 0.42 },
]), obsidianMat, [0, 0.82, 0.12], [0, 0, 0], [1, 1, 1], 'raised_black_command_deck')

addMesh(ship, wedgeGeometry([
  { z: -2.68, w: 0.54, h: 0.12 },
  { z: -1.05, w: 1.18, h: 0.24 },
  { z: 0.55, w: 0.92, h: 0.2 },
]), canopyMat, [0, 1.28, -0.2], [0, 0, 0], [1, 1, 1], 'recessed_blue_canopy')

addMesh(ship, new THREE.BoxGeometry(0.68, 0.24, 3.65), crownMat, [0, 1.43, 1.02], [0, 0, 0], [1, 1, 1], 'gold_crown_spine')
addMesh(ship, new THREE.BoxGeometry(3.95, 0.48, 0.62), crownMat, [0, 0.93, 3.52], [0, 0, 0], [1, 1, 1], 'rear_crown_bar')
addMesh(ship, new THREE.BoxGeometry(2.1, 0.2, 1.18), crownMat, [0, 1.18, 2.12], [0, 0, 0], [1, 1, 1], 'central_gold_armor_plate')

const shoulderWing = [
  [0.88, -0.72],
  [4.35, -0.56],
  [5.05, 0.34],
  [2.85, 1.38],
  [0.85, 0.95],
]

const lowerBlade = [
  [1.05, -0.44],
  [3.85, -0.8],
  [3.2, 0.42],
  [0.9, 0.5],
]

const crownFin = [
  [0.54, -0.16],
  [1.62, 0.08],
  [1.08, 1.36],
]

for (const side of [-1, 1]) {
  addMesh(
    ship,
    prismGeometry(mirrored(shoulderWing, side), 0.54),
    obsidianMat,
    [0, -0.02, -0.1],
    [Math.PI / 2, 0, 0],
    [1, 1, 1],
    side < 0 ? 'left_sovereign_shoulder_wing' : 'right_sovereign_shoulder_wing',
  )
  addMesh(
    ship,
    prismGeometry(mirrored(lowerBlade, side), 0.34),
    armorMat,
    [0, -0.72, 0.9],
    [Math.PI / 2, 0, 0],
    [1, 1, 1],
    side < 0 ? 'left_lower_armor_blade' : 'right_lower_armor_blade',
  )
  addMesh(
    ship,
    prismGeometry(mirrored(crownFin, side), 0.32),
    armorMat,
    [side * 0.48, 1.03, 2.58],
    [0, side * -0.16, side * -0.1],
    [1, 1, 1],
    side < 0 ? 'left_raised_crown_fin' : 'right_raised_crown_fin',
  )
  addMesh(ship, new THREE.BoxGeometry(1.9, 0.28, 0.48), crownMat, [side * 2.42, 0.38, -0.04], [0, side * -0.05, side * 0.05], [1, 1, 1], 'short_gold_wing_crest')
  addMesh(ship, new THREE.BoxGeometry(0.1, 0.08, 1.1), cyanMat, [side * 3.92, -0.12, 0.2], [0, side * -0.18, 0], [1, 1, 1], 'compact_cyan_edge_light')
  addMesh(ship, new THREE.BoxGeometry(0.62, 0.5, 3.75), armorMat, [side * 1.78, -0.42, 2.18], [0, side * -0.16, 0], [1, 1, 1], 'rear_armor_pod')
  addMesh(ship, new THREE.BoxGeometry(0.9, 0.58, 1.85), gunmetalMat, [side * 2.72, -0.38, 3.35], [0, side * -0.1, 0], [1, 1, 1], 'outer_engine_block')

  addEngine(ship, side * 0.9, -0.26, 4.28, 1.1)
  addEngine(ship, side * 2.05, -0.4, 3.92, 0.92)
}

addEngine(ship, 0, -0.08, 4.62, 1.42)
addMesh(ship, new THREE.ConeGeometry(0.36, 1.1, 14), goldAccentMat, [0, 0.0, -5.78], [-Math.PI / 2, 0, 0], [1, 0.85, 1], 'gold_blunt_spear_nose')
addMesh(ship, new THREE.BoxGeometry(4.9, 0.36, 0.88), armorMat, [0, -0.74, 3.86], [0, 0, 0], [1, 1, 1], 'heavy_rear_diffuser')
addMesh(ship, new THREE.BoxGeometry(2.35, 0.82, 1.45), gunmetalMat, [0, -0.34, 3.92], [0, 0, 0], [1, 1, 1], 'central_engine_block')
addMesh(ship, new THREE.CylinderGeometry(0.88, 1.16, 0.3, 36), nozzleMat, [0, -0.08, 5.28], [Math.PI / 2, 0, 0], [1.1, 1, 1], 'central_dark_nozzle')
addMesh(ship, new THREE.TorusGeometry(0.68, 0.024, 8, 40), cyanMat, [0, -0.08, 5.45], [0, 0, 0], [1, 1, 1], 'central_engine_halo')

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const scene = new THREE.Scene()
scene.add(ship)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/holder-sovereign-wraith.glb')
mkdirSync(dirname(outputPath), { recursive: true })

try {
  const result = await exporter.parseAsync(scene, { binary: true, trs: false })
  writeFileSync(outputPath, Buffer.from(result))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

if (!process.exitCode) {
  console.log(JSON.stringify({ outputPath, bytes: readFileSync(outputPath).byteLength }, null, 2))
}
