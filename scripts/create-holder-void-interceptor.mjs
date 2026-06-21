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

const hullMat = material({ color: 0x111722, emissive: 0x04070c, metalness: 0.9, roughness: 0.22 })
const armorMat = material({ color: 0x05070d, emissive: 0x11081d, emissiveIntensity: 0.12, metalness: 0.96, roughness: 0.18 })
const seamMat = material({ color: 0x9f6cff, emissive: 0x9f6cff, emissiveIntensity: 1.8, metalness: 0.25, roughness: 0.2 })
const cyanMat = material({ color: 0x72f7ff, emissive: 0x72f7ff, emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.25 })
const glassMat = material({ color: 0x1a2848, emissive: 0x314dff, emissiveIntensity: 0.32, metalness: 0.3, roughness: 0.1 })
const engineMat = material({ color: 0x8fdfff, emissive: 0x4ebaff, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.18 })

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

function trianglePrism(points, thickness) {
  const z = thickness / 2
  const vertices = [
    points[0][0], points[0][1], -z,
    points[1][0], points[1][1], -z,
    points[2][0], points[2][1], -z,
    points[0][0], points[0][1], z,
    points[1][0], points[1][1], z,
    points[2][0], points[2][1], z,
  ]
  const indices = [
    0, 2, 1, 3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    2, 0, 3, 2, 3, 5,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function mirrorPoints(points, side) {
  return points.map(([x, y]) => [x * side, y])
}

function addMesh(group, geometry, meshMaterial, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], name = '') {
  const mesh = new THREE.Mesh(geometry, meshMaterial)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.scale.set(...scale)
  mesh.name = name
  group.add(mesh)
  return mesh
}

const ship = new THREE.Group()
ship.name = 'Holder_Void_Interceptor'

const wingPoints = [
  [0.45, -0.25],
  [4.3, 0.48],
  [0.65, 1.5],
]

const rudderPoints = [
  [1.0, -0.1],
  [1.85, 0.18],
  [1.1, 1.0],
]

addMesh(ship, wedgeGeometry([
  { z: -4.7, w: 0.18, h: 0.16 },
  { z: -3.25, w: 0.82, h: 0.34 },
  { z: -0.8, w: 1.55, h: 0.58 },
  { z: 2.25, w: 1.28, h: 0.5 },
  { z: 3.25, w: 1.9, h: 0.68 },
]), hullMat, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], 'knife_hull')

addMesh(ship, wedgeGeometry([
  { z: -2.9, w: 0.36, h: 0.12 },
  { z: -1.45, w: 0.82, h: 0.22 },
  { z: 0.1, w: 0.52, h: 0.18 },
]), glassMat, [0, 0.43, 0], [0, 0, 0], [1, 1, 1], 'low_cockpit')

for (const side of [-1, 1]) {
  addMesh(
    ship,
    trianglePrism(mirrorPoints(wingPoints, side), 0.13),
    armorMat,
    [0, -0.05, -0.38],
    [Math.PI / 2, 0, 0],
    [1, 1, 1],
    side < 0 ? 'left_scimitar_wing' : 'right_scimitar_wing',
  )

  addMesh(ship, new THREE.BoxGeometry(0.08, 0.07, 5.25), seamMat, [side * 0.72, 0.39, -0.7], [0, side * 0.08, 0], [1, 1, 1], 'purple_spine_seam')
  addMesh(ship, new THREE.BoxGeometry(0.08, 0.07, 3.3), cyanMat, [side * 1.72, -0.02, -0.2], [0, side * -0.28, 0], [1, 1, 1], 'cyan_wing_seam')

  addMesh(ship, new THREE.CylinderGeometry(0.33, 0.42, 0.7, 24), armorMat, [side * 1.18, 0, 3.38], [Math.PI / 2, 0, 0], [1, 1, 1], 'engine_cowling')
  addMesh(ship, new THREE.CylinderGeometry(0.16, 0.18, 0.06, 24), engineMat, [side * 1.18, 0, 3.76], [Math.PI / 2, 0, 0], [1, 1, 1], 'cyan_engine_core')
  addMesh(
    ship,
    trianglePrism(mirrorPoints(rudderPoints, side), 0.16),
    armorMat,
    [0, 0.22, 2.2],
    [0, side * -0.15, 0],
    [1, 1, 1],
    side < 0 ? 'left_rear_rudder' : 'right_rear_rudder',
  )
}

addMesh(ship, trianglePrism([[-0.22, 0], [0.22, 0], [0, 1.15]], 1.55), armorMat, [0, 0.38, 1.0], [0, 0, 0], [1, 1, 1], 'dorsal_blade')
addMesh(ship, new THREE.BoxGeometry(1.25, 0.08, 4.9), seamMat, [0, 0.52, -0.56], [0, 0, 0], [1, 1, 1], 'center_void_seam')
addMesh(ship, new THREE.BoxGeometry(1.8, 0.16, 0.72), armorMat, [0, -0.2, 2.9], [0, 0, 0], [1, 1, 1], 'rear_dark_armor')
addMesh(ship, new THREE.BoxGeometry(1.6, 0.1, 0.08), seamMat, [0, 0.46, 3.36], [0, 0, 0], [1, 1, 1], 'rear_purple_signature')

ship.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
})

const scene = new THREE.Scene()
scene.add(ship)

const exporter = new GLTFExporter()
const outputPath = resolve('public/assets/ships/holder-void-interceptor.glb')
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
