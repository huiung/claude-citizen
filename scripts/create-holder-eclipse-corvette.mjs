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

const eclipseMat = material({ color: 0x030406, emissive: 0x010101, emissiveIntensity: 0.04, metalness: 0.98, roughness: 0.22 })
const armorMat = material({ color: 0x15171b, emissive: 0x030303, emissiveIntensity: 0.06, metalness: 0.92, roughness: 0.3 })
const plateMat = material({ color: 0x2b2e34, emissive: 0x050505, emissiveIntensity: 0.04, metalness: 0.86, roughness: 0.34 })
const ivoryMat = material({ color: 0xd9d2bd, emissive: 0x2a2416, emissiveIntensity: 0.1, metalness: 0.72, roughness: 0.28 })
const goldTrimMat = material({ color: 0xd7a743, emissive: 0x6b3d09, emissiveIntensity: 0.32, metalness: 0.9, roughness: 0.2 })
const canopyMat = material({ color: 0x1c0b09, emissive: 0xff4d2f, emissiveIntensity: 0.48, metalness: 0.24, roughness: 0.1 })
const redLightMat = material({ color: 0xff4c2d, emissive: 0xff1d12, emissiveIntensity: 1.05, metalness: 0.18, roughness: 0.18 })
const engineMat = material({ color: 0xfff0d8, emissive: 0xff3418, emissiveIntensity: 2.1, metalness: 0.08, roughness: 0.1 })
const nozzleMat = material({ color: 0x020307, emissive: 0x000000, emissiveIntensity: 0, metalness: 0.98, roughness: 0.24 })

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

function addEngine(group, x, y, z, scale = 1, name = 'engine') {
  addMesh(group, new THREE.CylinderGeometry(0.62 * scale, 0.88 * scale, 1.25 * scale, 30), armorMat, [x, y, z], [Math.PI / 2, 0, 0], [1.16, 1, 1], `${name}_cowling`)
  addMesh(group, new THREE.CylinderGeometry(0.52 * scale, 0.68 * scale, 0.3 * scale, 30), nozzleMat, [x, y, z + 0.6 * scale], [Math.PI / 2, 0, 0], [1.1, 1, 1], `${name}_dark_nozzle`)
  addMesh(group, new THREE.TorusGeometry(0.52 * scale, 0.032 * scale, 8, 36), redLightMat, [x, y, z + 0.78 * scale], [0, 0, 0], [1, 1, 1], `${name}_red_halo`)
  addMesh(group, new THREE.CircleGeometry(0.28 * scale, 36), engineMat, [x, y, z + 0.82 * scale], [0, 0, 0], [1, 1, 1], `${name}_white_core`)
}

function addTurret(group, x, y, z, side = 1, name = 'turret') {
  addMesh(group, new THREE.CylinderGeometry(0.24, 0.3, 0.18, 14), plateMat, [x, y, z], [0, 0, 0], [1, 1, 1], `${name}_base`)
  addMesh(group, new THREE.BoxGeometry(0.16, 0.14, 0.9), goldTrimMat, [x + side * 0.08, y + 0.1, z - 0.52], [0, side * 0.1, 0], [1, 1, 1], `${name}_barrel`)
}

function addWindowBand(group, z, w, y, name) {
  addMesh(group, new THREE.BoxGeometry(w, 0.045, 0.06), redLightMat, [0, y, z], [0, 0, 0], [1, 1, 1], `${name}_bridge_light`)
}

const ship = new THREE.Group()
ship.name = 'Holder_Eclipse_Corvette'

addMesh(ship, wedgeGeometry([
  { z: -7.8, w: 0.48, h: 0.3 },
  { z: -6.1, w: 1.22, h: 0.56 },
  { z: -3.3, w: 2.95, h: 1.0 },
  { z: -0.4, w: 4.65, h: 1.48 },
  { z: 3.35, w: 5.8, h: 1.72 },
  { z: 6.0, w: 4.4, h: 1.45 },
  { z: 7.2, w: 2.7, h: 1.0 },
]), armorMat, [0, 0, 0], [0, 0, 0], [1, 1, 1], 'eclipse_long_armored_keel')

addMesh(ship, wedgeGeometry([
  { z: -5.4, w: 1.4, h: 0.12 },
  { z: -2.0, w: 3.4, h: 0.2 },
  { z: 3.8, w: 4.6, h: 0.24 },
  { z: 6.2, w: 3.2, h: 0.18 },
]), ivoryMat, [0, 0.68, 0.12], [0, 0, 0], [1, 1, 1], 'ivory_dorsal_capital_armor')

addMesh(ship, wedgeGeometry([
  { z: -5.8, w: 0.92, h: 0.18 },
  { z: -2.4, w: 2.45, h: 0.38 },
  { z: 2.6, w: 3.1, h: 0.46 },
  { z: 5.9, w: 2.2, h: 0.34 },
]), eclipseMat, [0, 1.06, 0.1], [0, 0, 0], [1, 1, 1], 'eclipse_black_command_spine')

addMesh(ship, wedgeGeometry([
  { z: -3.95, w: 0.52, h: 0.16 },
  { z: -2.6, w: 1.0, h: 0.28 },
  { z: -1.15, w: 0.72, h: 0.22 },
]), canopyMat, [0, 1.38, 0], [0, 0, 0], [1, 1, 1], 'eclipse_forward_bridge_glass')
addMesh(ship, new THREE.BoxGeometry(1.08, 0.36, 1.4), plateMat, [0, 1.42, 1.2], [0, 0, 0], [1, 1, 1], 'raised_command_bridge')
addMesh(ship, new THREE.BoxGeometry(0.82, 0.84, 0.9), ivoryMat, [0, 1.92, 1.78], [0, 0, 0], [1, 1, 1], 'ivory_command_tower')
addMesh(ship, new THREE.BoxGeometry(0.48, 0.22, 1.16), eclipseMat, [0, 2.42, 2.1], [0, 0, 0], [1, 1, 1], 'black_flag_bridge_crown')
addMesh(ship, new THREE.BoxGeometry(0.08, 0.88, 0.08), goldTrimMat, [0, 2.98, 2.26], [0, 0, 0], [1, 1, 1], 'gold_bridge_antenna')
addWindowBand(ship, 0.56, 1.08, 1.64, 'front')
addWindowBand(ship, 1.18, 1.16, 1.66, 'mid')
addWindowBand(ship, 2.12, 0.78, 2.38, 'tower')

addMesh(ship, new THREE.BoxGeometry(0.52, 0.22, 7.8), goldTrimMat, [0, 1.23, 0.9], [0, 0, 0], [1, 1, 1], 'gold_dorsal_armor_spine')
addMesh(ship, new THREE.BoxGeometry(4.3, 0.32, 0.88), ivoryMat, [0, 0.95, 5.78], [0, 0, 0], [1, 1, 1], 'ivory_rear_command_crossbar')

const shoulder = [
  [1.15, -0.74],
  [4.8, -0.46],
  [6.05, 0.42],
  [3.7, 1.48],
  [1.0, 1.02],
]
const outerPlate = [
  [2.15, -0.44],
  [5.35, -0.58],
  [4.65, 0.55],
  [1.7, 0.62],
]
const keelFin = [
  [0.36, -0.1],
  [1.18, 0.05],
  [0.78, 1.55],
]

for (const side of [-1, 1]) {
  addMesh(ship, prismGeometry(mirrored(shoulder, side), 0.62), eclipseMat, [0, -0.08, 0.1], [Math.PI / 2, 0, 0], [1, 1, 1], side < 0 ? 'left_eclipse_broad_shoulder' : 'right_eclipse_broad_shoulder')
  addMesh(ship, prismGeometry(mirrored(outerPlate, side), 0.46), plateMat, [0, -0.62, 1.35], [Math.PI / 2, 0, 0], [1, 1, 1], side < 0 ? 'left_eclipse_lower_armor' : 'right_eclipse_lower_armor')
  addMesh(ship, new THREE.BoxGeometry(1.52, 0.18, 5.8), ivoryMat, [side * 3.28, 0.1, 1.78], [0, side * -0.16, side * 0.025], [1, 1, 1], side < 0 ? 'left_ivory_capital_side_panel' : 'right_ivory_capital_side_panel')
  addMesh(ship, new THREE.BoxGeometry(0.16, 0.1, 4.8), goldTrimMat, [side * 4.12, 0.26, 1.88], [0, side * -0.16, side * 0.025], [1, 1, 1], side < 0 ? 'left_gold_side_keel' : 'right_gold_side_keel')
  addMesh(ship, prismGeometry(mirrored(keelFin, side), 0.36), armorMat, [side * 0.72, -1.02, 2.8], [0, side * -0.1, side * 0.08], [1, 1, 1], side < 0 ? 'left_downward_keel_fin' : 'right_downward_keel_fin')

  addMesh(ship, new THREE.BoxGeometry(0.72, 0.66, 4.6), armorMat, [side * 2.1, -0.36, 3.45], [0, side * -0.12, 0], [1, 1, 1], 'inner_engine_boom')
  addMesh(ship, new THREE.BoxGeometry(1.18, 0.78, 2.45), plateMat, [side * 3.15, -0.32, 4.55], [0, side * -0.12, 0], [1, 1, 1], 'outer_engine_pod')
  addMesh(ship, new THREE.BoxGeometry(0.14, 0.08, 3.1), redLightMat, [side * 4.76, 0.0, 1.45], [0, side * -0.16, 0], [1, 1, 1], 'thin_side_navigation_light')
  addMesh(ship, new THREE.BoxGeometry(2.18, 0.22, 0.38), goldTrimMat, [side * 2.72, 0.48, -1.18], [0, side * -0.08, side * 0.04], [1, 1, 1], 'gold_shoulder_plate')

  addTurret(ship, side * 1.15, 1.36, -2.25, side, side < 0 ? 'left_forward' : 'right_forward')
  addTurret(ship, side * 1.72, 1.12, 2.45, side, side < 0 ? 'left_aft' : 'right_aft')

  addEngine(ship, side * 0.92, -0.26, 6.65, 1.12, 'inner_main')
  addEngine(ship, side * 2.35, -0.42, 6.25, 0.96, 'outer_main')
  addEngine(ship, side * 3.45, -0.34, 5.72, 0.74, 'outboard')
  addEngine(ship, side * 1.58, 0.42, 6.78, 0.62, 'upper_auxiliary')
}

addMesh(ship, new THREE.ConeGeometry(0.36, 1.35, 14), goldTrimMat, [0, -0.02, -8.56], [-Math.PI / 2, 0, 0], [1, 0.78, 1], 'gold_spear_bow')
addMesh(ship, new THREE.BoxGeometry(4.9, 0.42, 1.1), armorMat, [0, -0.9, 6.52], [0, 0, 0], [1, 1, 1], 'heavy_engine_diffuser')
addMesh(ship, new THREE.BoxGeometry(2.92, 0.88, 1.78), plateMat, [0, -0.36, 6.55], [0, 0, 0], [1, 1, 1], 'central_reactor_block')
addMesh(ship, new THREE.BoxGeometry(1.72, 0.24, 1.92), ivoryMat, [0, 0.34, 6.72], [0, 0, 0], [1, 1, 1], 'ivory_reactor_cap')
addEngine(ship, 0, -0.1, 7.02, 1.58, 'central_command_drive')
addMesh(ship, new THREE.TorusGeometry(0.88, 0.04, 8, 44), redLightMat, [0, -0.1, 8.22], [0, 0, 0], [1, 1, 1], 'central_drive_outer_halo')

for (const z of [-3.7, -1.8, 0.2, 2.2, 4.2]) {
  addMesh(ship, new THREE.BoxGeometry(0.12, 0.04, 0.42), redLightMat, [-2.22, 0.72, z], [0, 0, 0], [1, 1, 1], 'left_running_light')
  addMesh(ship, new THREE.BoxGeometry(0.12, 0.04, 0.42), redLightMat, [2.22, 0.72, z], [0, 0, 0], [1, 1, 1], 'right_running_light')
}

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const scene = new THREE.Scene()
scene.add(ship)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/holder-eclipse-corvette.glb')
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
