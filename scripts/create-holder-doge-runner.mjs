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

const pearlMat = material({ color: 0xf4efe5, emissive: 0x151006, emissiveIntensity: 0.04, metalness: 0.58, roughness: 0.24 })
const goldMat = material({ color: 0xe4b23d, emissive: 0xffb12f, emissiveIntensity: 0.32, metalness: 0.9, roughness: 0.14 })
const darkMat = material({ color: 0x12151b, emissive: 0x020306, emissiveIntensity: 0.04, metalness: 0.72, roughness: 0.24 })
const graphiteMat = material({ color: 0x30343c, emissive: 0x05070a, emissiveIntensity: 0.05, metalness: 0.82, roughness: 0.2 })
const glassMat = material({ color: 0x48d7ff, emissive: 0x1c8cff, emissiveIntensity: 0.55, metalness: 0.18, roughness: 0.08 })
const flameMat = material({ color: 0xfff0aa, emissive: 0xffb12f, emissiveIntensity: 1.65, metalness: 0.1, roughness: 0.16 })
const shadowGoldMat = material({ color: 0x6e4b17, emissive: 0x120801, emissiveIntensity: 0.08, metalness: 0.78, roughness: 0.24 })

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

function addBadge(group, x, y, z, radius, side, name) {
  addMesh(group, new THREE.CylinderGeometry(radius, radius, 0.08, 24), goldMat, [x, y, z], [Math.PI / 2, 0, 0], [1, 1, 1], `${name}_badge`)
  addMesh(group, new THREE.TorusGeometry(radius * 1.02, radius * 0.055, 8, 24), flameMat, [x, y, z - 0.05], [0, 0, 0], [1, 1, 1], `${name}_thin_rim`)
  addMesh(group, new THREE.BoxGeometry(radius * 0.48, radius * 0.06, 0.03), darkMat, [x, y + radius * 0.16, z - 0.095], [0, 0, side * 0.52], [1, 1, 1], `${name}_slash`)
}

function addEngine(group, x, y, z, scale = 1) {
  addMesh(group, new THREE.CylinderGeometry(0.3 * scale, 0.48 * scale, 1.18 * scale, 18), darkMat, [x, y, z], [Math.PI / 2, 0, 0], [1, 1, 1], 'engine_cowling')
  addMesh(group, new THREE.TorusGeometry(0.5 * scale, 0.055 * scale, 8, 28), goldMat, [x, y, z + 0.62 * scale], [0, 0, 0], [1, 1, 1], 'gold_engine_ring')
  addMesh(group, new THREE.CircleGeometry(0.28 * scale, 28), flameMat, [x, y, z + 0.69 * scale], [0, 0, 0], [1, 1, 1], 'warm_engine_core')
}

const ship = new THREE.Group()
ship.name = 'Holder_Doge_Runner_MkII'

addMesh(ship, wedgeGeometry([
  { z: -5.55, w: 0.14, h: 0.1 },
  { z: -3.85, w: 0.7, h: 0.32 },
  { z: -1.1, w: 1.34, h: 0.52 },
  { z: 1.75, w: 1.1, h: 0.46 },
  { z: 3.55, w: 1.72, h: 0.64 },
]), pearlMat, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], 'low_grand_prix_fuselage')

addMesh(ship, wedgeGeometry([
  { z: -3.35, w: 0.34, h: 0.1 },
  { z: -1.55, w: 0.78, h: 0.2 },
  { z: -0.35, w: 0.5, h: 0.14 },
]), glassMat, [0, 0.46, 0], [0, 0, 0], [1, 1, 1], 'flush_blue_canopy')
addMesh(ship, new THREE.BoxGeometry(0.2, 0.09, 6.4), goldMat, [0, 0.56, -0.9], [0, 0, 0], [1, 1, 1], 'bold_gold_spine')
for (const side of [-1, 1]) {
  addMesh(ship, new THREE.BoxGeometry(0.07, 0.07, 4.25), goldMat, [side * 0.52, 0.32, -0.05], [0, side * 0.06, 0], [1, 1, 1], 'side_gold_rail')
}
addMesh(ship, new THREE.BoxGeometry(1.45, 0.08, 0.14), shadowGoldMat, [0, -0.24, 3.08], [0, 0, 0], [1, 1, 1], 'dark_gold_tail_bridge')

for (const side of [-1, 1]) {
  addMesh(ship, new THREE.BoxGeometry(4.05, 0.1, 1.36), pearlMat, [side * 1.96, -0.08, 0.08], [0, side * -0.53, side * 0.025], [1, 1, 1], side < 0 ? 'left_blade_wing' : 'right_blade_wing')
  addMesh(ship, new THREE.BoxGeometry(3.25, 0.09, 0.13), goldMat, [side * 2.24, 0.04, -0.72], [0, side * -0.53, side * 0.025], [1, 1, 1], 'razor_gold_leading_edge')
  addMesh(ship, new THREE.BoxGeometry(0.24, 0.17, 2.7), graphiteMat, [side * 2.0, -0.12, 0.82], [0, side * -0.53, 0], [1, 1, 1], 'graphite_wing_keel')
  addMesh(ship, new THREE.BoxGeometry(0.14, 1.35, 1.25), darkMat, [side * 0.84, 0.7, 2.18], [0, side * -0.18, side * -0.43], [1, 1, 1], 'canted_tail_fin')
  addMesh(ship, new THREE.BoxGeometry(1.18, 0.13, 0.12), goldMat, [side * 0.96, 1.16, 1.82], [0, side * -0.2, side * -0.43], [1, 1, 1], 'tail_fin_gold_tip')
  addEngine(ship, side * 0.52, -0.14, 3.0, 0.98)
  addEngine(ship, side * 1.18, -0.22, 2.78, 0.76)
  addBadge(ship, side * 1.25, 0.2, 0.9, 0.22, side, side < 0 ? 'left_side' : 'right_side')
}

addMesh(ship, new THREE.ConeGeometry(0.22, 1.2, 12), goldMat, [0, 0.02, -6.1], [-Math.PI / 2, 0, 0], [1, 0.72, 1], 'needle_gold_nose')
addMesh(ship, new THREE.BoxGeometry(1.75, 0.18, 0.36), darkMat, [0, -0.22, 3.48], [0, 0, 0], [1, 1, 1], 'rear_diffuser')
addMesh(ship, new THREE.TorusGeometry(0.52, 0.055, 8, 30), goldMat, [0, 0.08, 3.82], [0, 0, 0], [1, 1, 1], 'subtle_rear_coin_halo')

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const scene = new THREE.Scene()
scene.add(ship)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/holder-doge-runner.glb')
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
